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

    const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
    
    for (const roomId of rooms) {
      await playerManager.removePlayerFromRoom(io, roomId, socket.id, 'disconnect');
    }
  });
}
