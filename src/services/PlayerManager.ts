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
  private readonly GRACE_PERIOD_MS = 30 * 1000; // 30 seconds grace period for reconnects

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
   * Remove a player from a room and handle all cleanup
   * Returns true if room was deleted, false otherwise
   */
  async removePlayerFromRoom(
    io: Server,
    roomId: string,
    playerId: string,
    reason: 'disconnect' | 'quit'
  ): Promise<boolean> {
    const room = await Room.findOne({ roomId });
    if (!room) return false;

    const player = room.players.find((p: any) => p.id === playerId);
    const wasHost = player && room.hostSessionId === player.sessionId;
    const playerName = player?.name;

    // Remove player
    await roomManager.removePlayer(room, playerId);

    // Remove from player room map - CRITICAL for preventing ghost players
    PlayerManager.socketToRoomMap.delete(playerId);

    // Handle session based on reason
    if (reason === 'quit') {
      // Permanent removal - player voluntarily quit
      sessionManager.removeSession(playerId);
    } else {
      // Temporary removal - mark for expiration (allows reconnect)
      sessionManager.markForExpiration(playerId);
    }

    // Strict room lifecycle: Handle empty rooms
    if (room.players.length === 0) {
      // Stop all game timers immediately
      gameEngine.cleanupRoom(roomId);
      
      if (reason === 'quit') {
        // Immediate deletion for voluntary quits
        await Room.deleteOne({ roomId });
        console.log(`Room ${roomId} deleted immediately - last player quit`);
        return true;
      } else {
        // Grace period for disconnects (allows page reload)
        this.scheduleRoomDeletion(io, roomId, `last player disconnected: ${playerName}`);
        return false; // Room not deleted yet, scheduled for deletion
      }
    }

    // Transfer host if needed
    if (wasHost) {
      const newHost = room.players[0];
      if (newHost) {
        room.hostId = newHost.id;
        room.hostSessionId = newHost.sessionId || '';
        await room.save();
        
        const message = reason === 'quit' 
          ? `${playerName} left. ${newHost.name} is now the host.`
          : `${playerName} disconnected. ${newHost.name} is now the host.`;
        
        io.to(roomId).emit('chat', {
          id: 'system',
          name: 'System',
          msg: message
        });

        io.to(newHost.id).emit('hostTransferred', { isHost: true });
      }
    } else if (reason === 'quit') {
      // Non-host quit voluntarily
      io.to(roomId).emit('chat', {
        id: 'system',
        name: 'System',
        msg: `${playerName} left the game.`
      });
    }

    // Broadcast updated player list
    io.to(roomId).emit('playerJoined', { players: room.players });
    
    console.log(`${playerName} ${reason === 'quit' ? 'left' : 'disconnected from'} room ${roomId}`);
    return false;
  }
}

export const playerManager = new PlayerManager();
