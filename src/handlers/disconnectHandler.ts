import { Server, Socket } from 'socket.io';
import { playerManager } from '../services/PlayerManager.js';

export function registerDisconnectHandler(io: Server, socket: Socket) {
  /**
   * DISCONNECT - Handle player leaving
   * - Remove session (player can't rejoin after reload)
   * - Transfer host if needed
   * - Clean up empty rooms
   */
  socket.on('disconnect', async () => {
    console.log('Player disconnected:', socket.id);

    // Use manual room tracking instead of socket.rooms
    const roomId = playerManager.getRoomId(socket.id);
    
    if (roomId) {
      await playerManager.removePlayerFromRoom(io, roomId, socket.id, 'disconnect');
    }
  });
}
