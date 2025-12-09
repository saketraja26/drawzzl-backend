import { Server } from 'socket.io';
import { Room } from '../models/Room.js';
import { roomManager } from './RoomManager.js';
import { sessionManager } from './SessionManager.js';
import { gameEngine } from './GameEngine.js';

/**
 * PlayerManager handles player removal and cleanup
 */
export class PlayerManager {
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

    const wasHost = room.hostId === playerId;
    const playerName = room.players.find((p: any) => p.id === playerId)?.name;

    // Remove player
    await roomManager.removePlayer(room, playerId);

    // Handle session based on reason
    if (reason === 'quit') {
      // Permanent removal - player voluntarily quit
      sessionManager.removeSession(playerId);
    } else {
      // Temporary removal - mark for expiration (allows reconnect)
      sessionManager.markForExpiration(playerId);
    }

    // If room empty, delete it
    if (room.players.length === 0) {
      await Room.deleteOne({ roomId });
      gameEngine.cleanupRoom(roomId);
      console.log(`Room ${roomId} deleted – empty after ${playerName} ${reason === 'quit' ? 'quit' : 'disconnected'}`);
      return true;
    }

    // Transfer host if needed
    if (wasHost) {
      const newHost = room.players[0];
      if (newHost) {
        room.hostId = newHost.id;
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
