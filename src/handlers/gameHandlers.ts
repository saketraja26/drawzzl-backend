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

      // Only original host can start game by session ID
      const player = room.players.find((p: any) => p.id === socket.id);
      if (!player || room.hostSessionId !== player.sessionId) {
        socket.emit('error', { message: 'Only the room owner can start the game' });
        return;
      }

      if (room.players.length < 2) {
        socket.emit('error', { message: 'Need 2+ players' });
        return;
      }

      if (room.gameStarted) return;

      // RESET GAME STATE FOR NEW GAME
      console.log(`🔄 RESETTING GAME STATE for room ${roomId} - new game starting`);
      
      // 1. Reset Player Scores
      console.log(`📊 RESETTING SCORES: Clearing all player scores to 0`);
      room.players.forEach((player: any) => {
        const oldScore = player.score || 0;
        player.score = 0;
        console.log(`  - ${player.name}: ${oldScore} → 0`);
      });

      // 2. Clear Round Points
      console.log(`🎯 CLEARING ROUND POINTS: Resetting round points map`);
      room.roundPoints = new Map();

      // 3. Reset Game State
      console.log(`🎮 RESETTING GAME STATE: Round=1, DrawerIndex=0`);
      room.round = 1;
      room.drawerIndex = 0;
      
      // Clear any previous game state
      room.currentWord = undefined;
      room.correctGuessers = [];
      room.revealedLetters = [];
      
      // Mark players array as modified for Mongoose
      room.markModified('players');
      room.markModified('roundPoints');
      
      // CRITICAL: Save all resets to database before starting first turn
      await room.save();
      console.log(`💾 GAME RESET COMPLETE: All scores and state reset, starting fresh game`);

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
   * SIMPLE DRAW HANDLER - Works with Konva line format
   */
  socket.on('draw', ({ roomId, lines }) => {
    if (roomId) {
      socket.to(roomId).emit('draw', { lines });
    }
  });

  /**
   * CLEAR CANVAS
   */
  socket.on('clearCanvas', ({ roomId }) => {
    socket.to(roomId).emit('clearCanvas');
  });
}
