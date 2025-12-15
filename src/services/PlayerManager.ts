import { Server } from 'socket.io';
import { Room } from '../models/Room.js';
import { roomManager } from './RoomManager.js';
import { sessionManager } from './SessionManager.js';
import { gameEngine } from './GameEngine.js';

/**
 * PlayerManager handles player removal and cleanup with strict room lifecycle
 */
export class PlayerManager {
  // CRITICAL: Manual tracking map to prevent ghost players
  private static socketToRoomMap = new Map<string, string>(); // socketId -> roomId
  private roomDeletionTimers = new Map<string, NodeJS.Timeout>(); // roomId -> deletion timer
  private rejoinTimers = new Map<string, NodeJS.Timeout>(); // sessionId -> rejoin timer
  private readonly GRACE_PERIOD_MS = 30 * 1000; // 30 seconds grace period for empty rooms
  private readonly REJOIN_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes for player rejoin

  /**
   * Track a player in a room - MUST be called immediately after room save
   */
  public trackPlayer(socketId: string, roomId: string): void {
    PlayerManager.socketToRoomMap.set(socketId, roomId);
    console.log(`Tracking player ${socketId} in room ${roomId}`);
  }

  /**
   * Get the room ID for a given socket ID - used in disconnect handler
   */
  public getRoomId(socketId: string): string | undefined {
    return PlayerManager.socketToRoomMap.get(socketId);
  }

  /**
   * Legacy method for backward compatibility
   */
  registerPlayer(socketId: string, roomId: string): void {
    this.trackPlayer(socketId, roomId);
  }

  /**
   * Start rejoin timer for disconnected player
   */
  private startRejoinTimer(io: Server, roomId: string, sessionId: string, playerName: string): void {
    // Clear any existing timer for this session
    const existingTimer = this.rejoinTimers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      try {
        // Remove player permanently after grace period expires
        const room = await Room.findOne({ roomId });
        if (room) {
          const playerIndex = room.players.findIndex((p: any) => p.sessionId === sessionId);
          if (playerIndex !== -1) {
            room.players.splice(playerIndex, 1);
            await room.save();

            io.to(roomId).emit('chat', {
              id: 'system',
              name: 'System',
              msg: `${playerName} failed to rejoin and was removed.`
            });

            io.to(roomId).emit('playerJoined', { players: room.players });
            console.log(`${playerName} (${sessionId}) removed after grace period expired`);
          }
        }
        
        this.rejoinTimers.delete(sessionId);
      } catch (err) {
        console.error(`Error removing expired player ${sessionId}:`, err);
        this.rejoinTimers.delete(sessionId);
      }
    }, this.REJOIN_TIMEOUT_MS);

    this.rejoinTimers.set(sessionId, timer);
    console.log(`Started rejoin timer for ${playerName} (${sessionId}) - ${this.REJOIN_TIMEOUT_MS / 1000}s`);
  }

  /**
   * Cancel rejoin timer (called when player rejoins)
   */
  public cancelRejoinTimer(sessionId: string): void {
    const timer = this.rejoinTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.rejoinTimers.delete(sessionId);
      console.log(`Cancelled rejoin timer for session ${sessionId}`);
    }
  }

  /**
   * Cancel room deletion timer (called when someone rejoins)
   */
  cancelRoomDeletion(roomId: string): void {
    const timer = this.roomDeletionTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.roomDeletionTimers.delete(roomId);
      console.log(`Cancelled room deletion for ${roomId} - player rejoined`);
    }
  }

  /**
   * Schedule room deletion with grace period
   */
  private scheduleRoomDeletion(io: Server, roomId: string, reason: string): void {
    // Clear any existing timer
    this.cancelRoomDeletion(roomId);
    
    console.log(`Scheduling room ${roomId} for deletion in ${this.GRACE_PERIOD_MS / 1000}s - ${reason}`);
    
    const timer = setTimeout(async () => {
      try {
        // Double-check room is still empty before deletion
        const room = await Room.findOne({ roomId });
        if (room && room.players.length === 0) {
          await Room.deleteOne({ roomId });
          gameEngine.cleanupRoom(roomId);
          this.roomDeletionTimers.delete(roomId);
          console.log(`Room ${roomId} deleted after grace period - ${reason}`);
        } else {
          console.log(`Room ${roomId} deletion cancelled - players rejoined`);
          this.roomDeletionTimers.delete(roomId);
        }
      } catch (err) {
        console.error(`Error during scheduled room deletion for ${roomId}:`, err);
        this.roomDeletionTimers.delete(roomId);
      }
    }, this.GRACE_PERIOD_MS);
    
    this.roomDeletionTimers.set(roomId, timer);
  }

  /**
   * Remove a player from a room with graceful session management
   * @param graceful - true for intentional quit (immediate), false for accidental disconnect (grace period)
   */
  async removePlayerFromRoom(
    io: Server,
    roomId: string,
    playerId: string,
    reason: 'disconnect' | 'quit',
    graceful: boolean = reason === 'quit'
  ): Promise<boolean> {
    const room = await Room.findOne({ roomId });
    if (!room) return false;

    const player = room.players.find((p: any) => p.id === playerId);
    const wasHost = player && room.hostSessionId === player.sessionId;
    const playerName = player?.name;
    const sessionId = player?.sessionId;

    if (graceful) {
      // SCENARIO B: Intentional Quit - Immediate removal
      await roomManager.removePlayer(room, playerId);
      PlayerManager.socketToRoomMap.delete(playerId);
      sessionManager.removeSession(playerId);
      
      console.log(`${playerName} quit intentionally - immediate removal`);
    } else {
      // SCENARIO A: Accidental Disconnect - Grace period
      // Do NOT remove from room.players yet - mark as disconnected
      if (player) {
        player.isOnline = false;
        player.disconnectedAt = new Date();
        await room.save();
      }
      
      PlayerManager.socketToRoomMap.delete(playerId);
      const disconnectedSessionId = sessionManager.markAsDisconnected(playerId);
      
      if (disconnectedSessionId && sessionId) {
        // Start rejoin timer for this specific player
        this.startRejoinTimer(io, roomId, sessionId, playerName || 'Unknown');
      }
      
      console.log(`${playerName} disconnected accidentally - grace period started`);
    }

    // Check if room is truly empty (no online players)
    const onlinePlayers = room.players.filter((p: any) => p.isOnline !== false);
    
    if (onlinePlayers.length === 0) {
      // Stop all game timers immediately
      gameEngine.cleanupRoom(roomId);
      
      if (graceful) {
        // Immediate deletion for voluntary quits
        await Room.deleteOne({ roomId });
        console.log(`Room ${roomId} deleted immediately - last player quit`);
        return true;
      } else {
        // Grace period for disconnects (allows reconnection)
        this.scheduleRoomDeletion(io, roomId, `all players disconnected`);
        return false; // Room not deleted yet, scheduled for deletion
      }
    }

    // Transfer host if needed (only for online players)
    if (wasHost && onlinePlayers.length > 0) {
      const newHost = onlinePlayers[0];
      if (newHost) {
        room.hostId = newHost.id;
        room.hostSessionId = newHost.sessionId || '';
        await room.save();
        
        const message = graceful 
          ? `${playerName} left. ${newHost.name} is now the host.`
          : `${playerName} disconnected. ${newHost.name} is now the host.`;
        
        io.to(roomId).emit('chat', {
          id: 'system',
          name: 'System',
          msg: message
        });

        io.to(newHost.id).emit('hostTransferred', { isHost: true });
      }
    }

    // Broadcast appropriate message
    if (graceful) {
      io.to(roomId).emit('chat', {
        id: 'system',
        name: 'System',
        msg: `${playerName} left the game.`
      });
    } else {
      io.to(roomId).emit('chat', {
        id: 'system',
        name: 'System',
        msg: `${playerName} disconnected (waiting to rejoin...)`
      });
    }

    // Broadcast updated player list
    io.to(roomId).emit('playerJoined', { players: room.players });
    
    return false;
  }
}

export const playerManager = new PlayerManager();
