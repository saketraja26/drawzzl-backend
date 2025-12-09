import { Server, Socket } from 'socket.io';
import { Room } from '../models/Room.js';
import { roomManager } from '../services/RoomManager.js';
import { gameEngine } from '../services/GameEngine.js';

export function registerGameHandlers(io: Server, socket: Socket) {
  /**
   * START GAME (host only)
   */
  socket.on('startGame', async ({ roomId }) => {
    try {
      const room = await Room.findOne({ roomId });
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      // Only original host can start game
      if (room.hostId !== socket.id) {
        socket.emit('error', { message: 'Only the room owner can start the game' });
        return;
      }

      if (room.players.length < 2) {
        socket.emit('error', { message: 'Need 2+ players' });
        return;
      }

      if (room.gameStarted) return;

      room.round = 1;
      room.drawerIndex = 0;
      await room.save();

      await gameEngine.startTurn(io, room);
    } catch (err) {
      socket.emit('error', { message: 'Failed to start game' });
    }
  });

  /**
   * WORD SELECTION (drawer only)
   */
  socket.on('wordSelected', async ({ roomId, word }) => {
    try {
      const room = await Room.findOne({ roomId });
      if (!room || !room.gameStarted) return;

      const drawer = roomManager.getDrawer(room);
      if (!drawer || drawer.id !== socket.id) return;

      gameEngine.clearWordTimeout(roomId);

      room.currentWord = word;
      const drawTime = room.drawTime || 60;
      room.turnEndsAt = new Date(Date.now() + drawTime * 1000);
      await room.save();

      await gameEngine.startDrawingPhase(io, room, word, drawTime);
    } catch (err) {
      socket.emit('error', { message: 'Failed to select word' });
    }
  });

  /**
   * DRAW
   */
  socket.on('draw', ({ roomId, lines }) => {
    socket.to(roomId).emit('draw', { lines });
  });

  /**
   * CLEAR CANVAS
   */
  socket.on('clearCanvas', ({ roomId }) => {
    socket.to(roomId).emit('clearCanvas');
  });
}
