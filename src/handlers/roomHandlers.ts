import { Server, Socket } from 'socket.io';
import { Room } from '../models/Room.js';
import { roomManager } from '../services/RoomManager.js';
import { sessionManager } from '../services/SessionManager.js';
import { playerManager } from '../services/PlayerManager.js';
import { validateMessage } from '../lib/profanityFilter.js';

export function registerRoomHandlers(io: Server, socket: Socket) {
  /**
   * LEAVE ROOM - Player voluntarily leaves
   */
  socket.on('leaveRoom', async ({ roomId }, callback) => {
    try {
      console.log(`Player ${socket.id} leaving room ${roomId}`);
      
      // Remove player and handle cleanup
      await playerManager.removePlayerFromRoom(io, roomId, socket.id, 'quit');
      
      // Leave socket room after cleanup
      socket.leave(roomId);
      
      // Acknowledge to client
      if (typeof callback === 'function') {
        callback({ success: true });
      }
      
      console.log(`Player ${socket.id} successfully left room ${roomId}`);
    } catch (err) {
      console.error('Error in leaveRoom:', err);
      if (typeof callback === 'function') {
        callback({ success: false, error: 'Failed to leave room' });
      }
    }
  });

  /**
   * CREATE ROOM
   */
  socket.on('createRoom', async ({ playerName, avatar }) => {
    try {
      const cleanedName = validateMessage(playerName);
      if (!cleanedName) {
        socket.emit('error', { message: 'Invalid name: inappropriate content' });
        return;
      }

      const roomId = roomManager.generateRoomId();
      const sessionId = sessionManager.createSession(socket.id);

      const newRoom = new Room({
        roomId,
        hostId: socket.id, // Track original host
        players: [{ 
          id: socket.id, 
          name: cleanedName, 
          score: 0, 
          isDrawer: true, 
          avatar: avatar || [0, 0, 0, 0],
          sessionId 
        }],
        gameStarted: false,
        round: 1,
        drawerIndex: 0,
        maxRounds: 3,
        correctGuessers: [],
        chat: [],
        drawTime: 60,
        wordCount: 3,
        customWords: [],
        customWordProbability: 0,
        maxPlayers: 8,
        roundPoints: new Map(),
        revealedLetters: [],
      });
      await newRoom.save();

      socket.join(roomId);
      
      // Send session info via handshake data
      socket.handshake.auth = { ...socket.handshake.auth, sessionId, roomId };
      
      socket.emit('roomCreated', { roomId, playerId: socket.id, isHost: true, sessionId });
      socket.emit('playerJoined', { players: newRoom.players });
      console.log(`Room ${roomId} created by ${cleanedName}`);
    } catch (err) {
      socket.emit('error', { message: 'Failed to create room' });
    }
  });

  /**
   * RECONNECT TO ROOM - Player rejoins with existing session
   */
  socket.on('reconnectRoom', async ({ roomId, sessionId }) => {
    try {
      const room = await Room.findOne({ roomId });
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      // Find player by session ID
      const player = room.players.find((p: any) => p.sessionId === sessionId);
      if (!player) {
        socket.emit('error', { message: 'Session expired or invalid' });
        return;
      }

      // Reconnect the session
      const reconnected = sessionManager.reconnectSession(sessionId, socket.id);
      if (!reconnected) {
        socket.emit('error', { message: 'Session expired' });
        return;
      }

      // Update player's socket ID
      player.id = socket.id;
      await room.save();

      const isHost = room.hostId === socket.id;

      socket.join(roomId);
      socket.emit('reconnected', { 
        roomId, 
        isHost,
        playerData: player,
        gameState: {
          gameStarted: room.gameStarted,
          round: room.round,
          maxRounds: room.maxRounds
        }
      });

      // Broadcast updated player list
      io.to(roomId).emit('playerJoined', { players: room.players });
      
      io.to(roomId).emit('chat', {
        id: 'system',
        name: 'System',
        msg: `${player.name} reconnected.`
      });

      console.log(`${player.name} reconnected to room ${roomId}`);
    } catch (err) {
      socket.emit('error', { message: 'Failed to reconnect' });
    }
  });

  /**
   * JOIN ROOM
   */
  socket.on('joinRoom', async ({ roomId, playerName, avatar }) => {
    try {
      const cleanedName = validateMessage(playerName);
      if (!cleanedName) {
        socket.emit('error', { message: 'Invalid name: inappropriate content' });
        return;
      }

      const room = await Room.findOne({ roomId });
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      if (roomManager.isFull(room)) {
        socket.emit('error', { message: 'Room is full' });
        return;
      }

      const sessionId = sessionManager.createSession(socket.id);

      const added = await roomManager.addPlayer(room, {
        id: socket.id,
        name: cleanedName,
        score: 0,
        avatar: avatar || [0, 0, 0, 0],
        sessionId
      });

      if (!added) {
        socket.emit('error', { message: 'Already in room' });
        return;
      }

      // Check if this player is the host AFTER adding them
      const isHost = room.hostId === socket.id;

      socket.join(roomId);
      
      // Send session info via handshake data
      socket.handshake.auth = { ...socket.handshake.auth, sessionId, roomId };
      
      socket.emit('roomJoined', { roomId, isHost, sessionId });

      io.to(roomId).emit('playerJoined', { players: room.players });
      console.log(`${cleanedName} joined ${roomId}`);
    } catch (err) {
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  /**
   * UPDATE SETTINGS (host only)
   */
  socket.on('updateSettings', async ({ roomId, settings }) => {
    try {
      const room = await Room.findOne({ roomId });
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      // Check if player is the original host
      if (room.hostId !== socket.id) {
        socket.emit('error', { message: 'Only the room owner can change settings' });
        return;
      }

      if (room.gameStarted) {
        socket.emit('error', { message: 'Cannot change settings during game' });
        return;
      }

      room.maxRounds = settings.rounds || 3;
      room.drawTime = Math.max(30, Math.min(180, settings.drawTime || 60));
      room.wordCount = Math.max(3, Math.min(5, settings.wordCount || 3));
      room.maxPlayers = Math.max(2, Math.min(15, settings.maxPlayers || 8));
      
      const customWordsStr = settings.customWords || '';
      room.customWords = customWordsStr
        .split(',')
        .map((w: string) => w.trim().toLowerCase())
        .filter((w: string) => w.length > 0);
      
      room.customWordProbability = Math.max(0, Math.min(100, settings.customWordProbability || 0));

      await room.save();

      io.to(roomId).emit('settingsUpdated', {
        rounds: room.maxRounds,
        drawTime: room.drawTime,
        wordCount: room.wordCount,
        customWords: room.customWords.join(', '),
        customWordProbability: room.customWordProbability,
        maxPlayers: room.maxPlayers,
      });

      console.log(`Settings updated for room ${roomId}`);
    } catch (err) {
      socket.emit('error', { message: 'Failed to update settings' });
    }
  });
}
