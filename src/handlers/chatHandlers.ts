import { Server, Socket } from 'socket.io';
import { Room } from '../models/Room.js';
import { roomManager } from '../services/RoomManager.js';
import { gameEngine } from '../services/GameEngine.js';
import { validateMessage } from '../lib/profanityFilter.js';

const TURN_SECONDS = 60;

export function registerChatHandlers(io: Server, socket: Socket) {
  /**
   * CHAT
   */
  socket.on('chat', async ({ roomId, msg, name }) => {
    const room = await Room.findOne({ roomId });
    if (!room || !msg?.trim()) return;
    
    const cleanedMsg = validateMessage(msg);
    if (!cleanedMsg) {
      socket.emit('error', { message: 'Message blocked: inappropriate content or spam' });
      return;
    }
    
    room.chat = Array.isArray(room.chat) ? room.chat : [];
    room.chat.push({ id: socket.id, name, msg: cleanedMsg, ts: new Date() });
    await room.save();
    io.to(roomId).emit('chat', { id: socket.id, name, msg: cleanedMsg });
  });

  /**
   * GUESS
   */
  socket.on('guess', async ({ roomId, guess, name }) => {
    const room = await Room.findOne({ roomId });
    if (!room || !room.currentWord || !room.gameStarted) return;

    const cleanedGuess = validateMessage(guess);
    if (!cleanedGuess) {
      socket.emit('error', { message: 'Guess blocked: inappropriate content' });
      return;
    }

    const g = cleanedGuess.trim().toLowerCase().replace(/\s+/g, '');
    if (!g) return;

    const ans = room.currentWord.toLowerCase();

    // Check exact match
    if (g === ans) {
      const drawer = roomManager.getDrawer(room);
      const isDrawer = socket.id === drawer?.id;
      const already = room.correctGuessers?.includes(socket.id);
      
      if (isDrawer || already) return;

      room.correctGuessers = Array.isArray(room.correctGuessers) ? room.correctGuessers : [];
      room.correctGuessers.push(socket.id);

      // Calculate points
      const endsAt = room.turnEndsAt ? new Date(room.turnEndsAt).getTime() : 0;
      const timeRemaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      const points = gameEngine.calculatePoints(timeRemaining, TURN_SECONDS);

      const player = room.players.find((p: any) => p.id === socket.id);
      if (player) {
        player.score = (player.score || 0) + points;
        room.roundPoints.set(socket.id, points);
      }

      await room.save();

      io.to(roomId).emit('correctGuess', {
        playerId: socket.id,
        name,
        points,
        total: player?.score ?? 0,
      });

      // Check if everyone guessed
      if (roomManager.allGuessed(room)) {
        await gameEngine.endTurn(io, roomId);
      }
    } else {
      // Check for close guess
      const distance = gameEngine.getEditDistance(g, ans);
      
      if (ans.length >= 3 && distance === 1) {
        socket.emit('closeGuess', { message: 'You are very close!' });
      }
      
      io.to(roomId).emit('chat', { id: socket.id, name, msg: cleanedGuess });
    }
  });
}
