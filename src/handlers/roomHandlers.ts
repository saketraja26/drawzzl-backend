import { Server, Socket } from 'socket.io';
import { Room } from '../models/Room.js';
import { roomManager } from '../services/RoomManager.js';
import { sessionManager } from '../services/SessionManager.js';
import { playerManager } from '../services/PlayerManager.js';
import { validateMessage } from '../lib/profanityFilter.js';
import { gameEngine } from '../services/GameEngine.js';
import { getRandomWordByDifficulty } from '../lib/words.js';

export function registerRoomHandlers(io: Server, socket: Socket) {
  
  /**
   * Helper function to restore drawer state when a player reconnects
   */
  async function restoreDrawerState(io: Server, socket: Socket, room: any, player: any, sessionId: string): Promise<void> {
    try {
      // Check if this player is the current drawer
      const currentDrawerIndex = room.drawerIndex || 0;
      const playerIndex = room.players.findIndex((p: any) => p.sessionId === sessionId);
      const isCurrentDrawer = playerIndex === currentDrawerIndex;
      
      console.log(`🎨 DRAWER STATE CHECK for ${player.name}:`);
      console.log(`- Player index: ${playerIndex}, Drawer index: ${currentDrawerIndex}`);
      console.log(`- Is current drawer: ${isCurrentDrawer}`);
      console.log(`- Game started: ${room.gameStarted}`);
      console.log(`- Current word: ${room.currentWord ? 'SET' : 'NOT SET'}`);

      if (isCurrentDrawer && room.gameStarted) {
        // Update player's drawer flag
        player.isDrawer = true;
        
        if (room.currentWord) {
          // SCENARIO 1: Drawing Phase - Restore word and drawing privileges
          console.log(`🎨 RESTORING DRAWING STATE: Sending word "${room.currentWord}" to ${player.name}`);
          
          // Send the current word to the drawer
          socket.emit('yourWord', { word: room.currentWord });
          
          // Send game state with drawer flag
          const timeLeft = room.turnEndsAt ? Math.max(0, Math.ceil((new Date(room.turnEndsAt).getTime() - Date.now()) / 1000)) : 60;
          socket.emit('gameStarted', {
            drawerId: socket.id,
            wordHint: room.currentWord ? maskWord(room.currentWord, room.revealedLetters || []) : '',
            timeLeft,
            round: room.round || 1,
            maxRounds: room.maxRounds || 3,
            isDrawer: true // Explicitly set drawer flag
          });
          
        } else {
          // SCENARIO 2: Word Selection Phase - Re-send word choices
          console.log(`🎨 RESTORING WORD SELECTION: Player ${player.name} needs to select a word`);
          
          // Generate fresh word choices using GameEngine logic
          const wordCount = room.wordCount || 3;
          const wordChoices = generateWordChoices(room, wordCount);
          
          // Sort players by score for display
          const sortedPlayers = [...room.players].sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
          
          socket.emit('selectWord', {
            words: wordChoices,
            timeLimit: 8,
            scores: sortedPlayers.map((p: any) => ({ 
              name: p.name, 
              score: p.score || 0, 
              avatar: p.avatar,
              sessionId: p.sessionId 
            }))
          });
        }
        
        console.log(`✅ DRAWER STATE RESTORED for ${player.name}`);
      } else {
        // Not the drawer - ensure drawer flag is false
        player.isDrawer = false;
        console.log(`👀 Player ${player.name} is not the drawer, restored as guesser`);
      }
      
    } catch (err) {
      console.error(`Error restoring drawer state for ${player.name}:`, err);
    }
  }

  /**
   * Helper function to mask word for hint display
   */
  function maskWord(word: string, revealedIndices: number[] = []): string {
    return word
      .split('')
      .map((char, idx) => (revealedIndices.includes(idx) ? char : '_'))
      .join(' ');
  }

  /**
   * Helper function to generate word choices (same logic as GameEngine)
   */
  function generateWordChoices(room: any, count: number): string[] {
    const selectedWords: string[] = [];
    const customWords = room.customWords || [];
    const probability = room.customWordProbability || 0;

    for (let i = 0; i < count; i++) {
      const useCustom = customWords.length > 0 && Math.random() * 100 < probability;
      
      if (useCustom && customWords.length > 0) {
        const word = customWords[Math.floor(Math.random() * customWords.length)] || 'default';
        selectedWords.push(word);
      } else {
        const rand = Math.random() * 100;
        let word: string;
        
        if (rand < 20) {
          word = getRandomWordByDifficulty('easy');
        } else if (rand < 60) {
          word = getRandomWordByDifficulty('medium');
        } else {
          word = getRandomWordByDifficulty('hard');
        }
        
        selectedWords.push(word);
      }
    }

    return selectedWords;
  }
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
        hostSessionId: sessionId, // Track host by session ID for persistence
        players: [{ 
          id: socket.id, 
          name: cleanedName, 
          score: 0, 
          isDrawer: true, 
          avatar: avatar || [0, 0, 0, 0],
          sessionId,
          isOnline: true
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
      
      // CRITICAL: Track player immediately after room save
      playerManager.trackPlayer(socket.id, roomId);

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

      // Update player's socket ID and status
      player.id = socket.id;
      player.isOnline = true;
      delete player.disconnectedAt;
      await room.save();
      
      // CRITICAL: Track player immediately after room save
      playerManager.trackPlayer(socket.id, roomId);

      const isHost = room.hostSessionId === sessionId;

      socket.join(roomId);
      
      // Cancel both room deletion and rejoin timers
      playerManager.cancelRoomDeletion(roomId);
      playerManager.cancelRejoinTimer(sessionId);
      
      // DRAWER STATE RESTORATION: Check if reconnecting player is the current drawer
      await restoreDrawerState(io, socket, room, player, sessionId);

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
   * JOIN ROOM - With Session Merging Logic
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

      // Prevent same socket from joining multiple times
      const alreadyInRoom = room.players.find((p: any) => p.id === socket.id);
      if (alreadyInRoom) {
        console.log(`Socket ${socket.id} already in room ${roomId}, ignoring duplicate join`);
        socket.emit('roomJoined', { roomId, isHost: room.hostSessionId === alreadyInRoom.sessionId, sessionId: alreadyInRoom.sessionId });
        return;
      }

      // STEP A: Search for Existing Session
      // Check if this player name already has a session in this room (disconnected player)
      // If multiple disconnected sessions exist, prefer the most recent one
      const disconnectedPlayers = room.players.filter((p: any) => 
        p.name === cleanedName && (p.isOnline === false || !p.isOnline)
      );
      
      const existingPlayer = disconnectedPlayers.length > 0 
        ? disconnectedPlayers.sort((a: any, b: any) => {
            // Sort by disconnectedAt timestamp (most recent first)
            const aTime = a.disconnectedAt ? new Date(a.disconnectedAt).getTime() : 0;
            const bTime = b.disconnectedAt ? new Date(b.disconnectedAt).getTime() : 0;
            return bTime - aTime;
          })[0]
        : undefined;

      console.log(`Join attempt by ${cleanedName} in room ${roomId}:`);
      console.log(`- Total players in room: ${room.players.length}`);
      console.log(`- Existing disconnected player found: ${existingPlayer ? 'YES' : 'NO'}`);
      if (existingPlayer) {
        console.log(`- Existing player session: ${existingPlayer.sessionId}, isOnline: ${existingPlayer.isOnline}`);
      }

      let sessionId: string = '';
      let isHost: boolean = false;
      let shouldMergeSession = false;
      
      if (existingPlayer && existingPlayer.sessionId && typeof existingPlayer.sessionId === 'string') {
        // STEP B: The "Merge" Path - Reconnect existing session
        console.log(`Found existing disconnected player ${cleanedName} in room ${roomId} - attempting session merge`);
        
        // Attempt to reconnect the existing session
        const reconnected = sessionManager.reconnectSession(existingPlayer.sessionId, socket.id);
        if (reconnected) {
          shouldMergeSession = true;
          sessionId = existingPlayer.sessionId;

          // Update existing player object in place
          existingPlayer.id = socket.id; // Update socket ID
          existingPlayer.isOnline = true; // Mark as online
          delete existingPlayer.disconnectedAt; // Clear disconnect timestamp
          
          // Ensure avatar is preserved or updated
          if (avatar && avatar.length === 4) {
            existingPlayer.avatar = avatar;
          }
          
          // Cancel any rejoin timers for this session
          playerManager.cancelRejoinTimer(sessionId);
          
          await room.save();

          console.log(`✅ SESSION MERGE SUCCESS: ${cleanedName} rejoined room ${roomId} via session merge`);
          console.log(`- Merged session ID: ${sessionId}`);
          console.log(`- New socket ID: ${socket.id}`);
          console.log(`- Total players after merge: ${room.players.length}`);
          
          // DRAWER STATE RESTORATION: Check if rejoining player is the current drawer
          await restoreDrawerState(io, socket, room, existingPlayer, sessionId);

          // Broadcast rejoin message
          io.to(roomId).emit('chat', {
            id: 'system',
            name: 'System',
            msg: `${cleanedName} reconnected.`
          });
        } else {
          console.error(`Failed to reconnect session ${existingPlayer.sessionId} for ${cleanedName}`);
          // Remove expired/invalid session and proceed with new join
          room.players = room.players.filter((p: any) => p !== existingPlayer);
          await room.save();
          console.log(`Removed expired session for ${cleanedName}, proceeding with new join`);
        }
      }

      if (!shouldMergeSession) {
        // STEP C: The "New Join" Path - Create new player
        if (roomManager.isFull(room)) {
          socket.emit('error', { message: 'Room is full' });
          return;
        }

        sessionId = sessionManager.createSession(socket.id);

        // STRICT MERGE: Check for existing player with same sessionId before adding new
        const existingBySession = room.players.find((p: any) => p.sessionId === sessionId);
        if (existingBySession) {
          // Update existing player instead of adding duplicate
          console.log(`🔄 UPDATING EXISTING PLAYER: Found player with session ${sessionId}, updating instead of adding`);
          existingBySession.id = socket.id;
          existingBySession.name = cleanedName;
          existingBySession.isOnline = true;
          existingBySession.avatar = avatar || existingBySession.avatar || [0, 0, 0, 0];
          delete existingBySession.disconnectedAt;
          room.markModified('players');
          await room.save();
        } else {
          // Add new player only if no existing session found
          const added = await roomManager.addPlayer(room, {
            id: socket.id,
            name: cleanedName,
            score: 0,
            avatar: avatar || [0, 0, 0, 0],
            sessionId,
            isOnline: true
          });

          if (!added) {
            socket.emit('error', { message: 'Already in room' });
            return;
          }
        }

        console.log(`✅ NEW PLAYER JOIN: ${cleanedName} joined room ${roomId} as new player`);
        console.log(`- New session ID: ${sessionId}`);
        console.log(`- Socket ID: ${socket.id}`);
        console.log(`- Total players after join: ${room.players.length}`);
      }

      // Common logic for both paths
      isHost = room.hostSessionId === sessionId;

      // CRITICAL: Track player immediately after adding/updating
      playerManager.trackPlayer(socket.id, roomId);

      socket.join(roomId);
      
      // Cancel room deletion timer - player joined/rejoined
      playerManager.cancelRoomDeletion(roomId);
      
      // Send session info via handshake data
      socket.handshake.auth = { ...socket.handshake.auth, sessionId, roomId };
      
      // Get the updated player data after potential session merge
      const updatedRoom = await Room.findOne({ roomId });
      const currentPlayer = updatedRoom?.players.find((p: any) => p.id === socket.id);
      
      socket.emit('roomJoined', { 
        roomId, 
        isHost, 
        sessionId,
        isDrawer: currentPlayer?.isDrawer || false,
        gameState: updatedRoom ? {
          gameStarted: updatedRoom.gameStarted,
          round: updatedRoom.round,
          maxRounds: updatedRoom.maxRounds
        } : undefined
      });

      // Safety cleanup: Remove any duplicate players that might exist
      await roomManager.removeDuplicatePlayers(room);

      // Broadcast updated player list to ALL players in room (including host)
      io.to(roomId).emit('playerJoined', { players: room.players });
      
    } catch (err) {
      console.error('Error in joinRoom:', err);
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

      // Check if player is the original host by session ID
      const player = room.players.find((p: any) => p.id === socket.id);
      if (!player || room.hostSessionId !== player.sessionId) {
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
