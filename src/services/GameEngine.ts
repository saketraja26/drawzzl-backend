import { Server } from 'socket.io';
import { Room } from '../models/Room.js';
import { roomManager } from './RoomManager.js';
import { getRandomWordByDifficulty } from '../lib/words.js';

const ROOM_TICK_MS = 1000;
const MAX_POINTS = 500;
const MIN_POINTS = 50;
const DRAWER_BONUS_PER_GUESSER = 50;

/**
 * GameEngine handles game logic, turns, and scoring
 */
export class GameEngine {
  private roomIntervals: Map<string, NodeJS.Timeout> = new Map();
  private wordSelectionTimeouts: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Start a new turn
   */
  async startTurn(io: Server, room: any): Promise<void> {
    try {
      if (!room.players || room.players.length === 0) {
        console.error(`Cannot start turn: No players in room ${room.roomId}`);
        return;
      }

      const drawer = roomManager.getDrawer(room);
      if (!drawer) {
        console.error(`Cannot start turn: No drawer found in room ${room.roomId}`);
        return;
      }

      // Generate word choices
      const wordCount = room.wordCount || 3;
      const wordChoices = this.selectWords(room, wordCount);

      // Set timing
      const drawTime = room.drawTime || 60;
      room.correctGuessers = [];
      room.gameStarted = true;
      room.turnEndsAt = new Date(Date.now() + (drawTime + 8) * 1000);

      // Mark drawer
      const safeIdx = roomManager.getDrawerIndex(room);
      room.players = room.players.map((p: any, idx: number) => ({
        ...p,
        isDrawer: idx === safeIdx,
      }));

      // Clear canvas
      io.to(room.roomId).emit('clearCanvas');

      // Sort players by score
      const sortedPlayers = [...room.players].sort((a: any, b: any) => (b.score || 0) - (a.score || 0));

      // Send word choices to drawer
      io.to(drawer.id).emit('selectWord', {
        words: wordChoices,
        timeLimit: 8,
        scores: sortedPlayers.map((p: any) => ({ name: p.name, score: p.score || 0, avatar: p.avatar, sessionId: p.sessionId }))
      });

      // Broadcast to others
      io.to(room.roomId).emit('drawerSelecting', {
        drawerId: drawer.id,
        timeLimit: 8,
        scores: sortedPlayers.map((p: any) => ({ name: p.name, score: p.score || 0, avatar: p.avatar, sessionId: p.sessionId }))
      });

      // Auto-select if drawer doesn't choose
      const timeout = setTimeout(async () => {
        try {
          const freshRoom = await Room.findOne({ roomId: room.roomId });
          if (!freshRoom) {
            console.error(`Room ${room.roomId} not found during word selection timeout`);
            return;
          }
          
          if (freshRoom.currentWord) {
            console.log(`Word already selected for room ${room.roomId}, skipping auto-select`);
            return;
          }

          const randomIndex = Math.floor(Math.random() * wordChoices.length);
          const selectedWord = wordChoices[randomIndex] || 'default';
          freshRoom.currentWord = selectedWord;
          await freshRoom.save();

          console.log(`Auto-selected word "${selectedWord}" for room ${room.roomId}`);
          await this.startDrawingPhase(io, freshRoom, selectedWord, drawTime);
        } catch (err) {
          console.error(`Error in word selection timeout for room ${room.roomId}:`, err);
          // Try to recover by ending the turn
          await this.endTurn(io, room.roomId);
        }
      }, 8000);

      this.wordSelectionTimeouts.set(room.roomId, timeout);

      room.markModified?.('players');
      await room.save();
      
      console.log(`Turn started for room ${room.roomId}, drawer: ${drawer.name}`);
    } catch (err) {
      console.error(`Error starting turn for room ${room.roomId}:`, err);
      // Try to recover
      try {
        await this.endTurn(io, room.roomId);
      } catch (recoveryErr) {
        console.error(`Failed to recover from turn start error:`, recoveryErr);
      }
    }
  }

  /**
   * Start drawing phase after word selection
   */
  async startDrawingPhase(io: Server, room: any, word: string, drawTime: number): Promise<void> {
    try {
      const drawer = roomManager.getDrawer(room);
      if (!drawer) {
        console.error(`No drawer found for room ${room.roomId} in drawing phase`);
        await this.endTurn(io, room.roomId);
        return;
      }

      room.roundPoints = new Map();
      room.revealedLetters = [];

      const hint = this.maskWord(word, room.revealedLetters);

      const safeIdx = roomManager.getDrawerIndex(room);
      room.players = room.players.map((p: any, idx: number) => ({
        ...p,
        isDrawer: idx === safeIdx,
      }));

      io.to(room.roomId).emit('gameStarted', {
        drawerId: drawer.id,
        wordHint: hint,
        timeLeft: drawTime,
        round: room.round,
        maxRounds: room.maxRounds || 3,
        players: room.players.map((p: any) => ({
          id: p.id,
          name: p.name,
          score: p.score || 0,
          avatar: p.avatar,
          sessionId: p.sessionId, // Include sessionId for frontend identification
          isDrawer: p.isDrawer
        }))
      });

      if (drawer.id) {
        io.to(drawer.id).emit('yourWord', { word });
      }

      const prev = this.roomIntervals.get(room.roomId);
      if (prev) {
        clearInterval(prev);
        console.log(`Cleared previous interval for room ${room.roomId}`);
      }

      // Calculate fixed end time for in-memory calculations
      const endTime = Date.now() + (drawTime * 1000);
      const halfTime = Math.floor(drawTime / 2);
      const firstHintTime = halfTime;
      const secondHintTime = 15;

      // In-memory state to avoid database reads
      const gameState = {
        roomId: room.roomId,
        currentWord: word,
        revealedLetters: [...room.revealedLetters],
        endTime,
        firstRevealed: false,
        secondRevealed: false,
        gameEnded: false
      };

      const timer = setInterval(async () => {
        try {
          // Skip if game already ended
          if (gameState.gameEnded) {
            clearInterval(timer);
            this.roomIntervals.delete(room.roomId);
            return;
          }

          // Calculate time left using in-memory endTime
          const now = Date.now();
          const timeLeft = Math.max(0, Math.ceil((gameState.endTime - now) / 1000));

          // Reveal first hint
          if (!gameState.firstRevealed && timeLeft <= firstHintTime && timeLeft > secondHintTime) {
            gameState.firstRevealed = true;
            const newIndices = this.getRevealIndices(gameState.currentWord, 1, gameState.revealedLetters);
            gameState.revealedLetters = [...gameState.revealedLetters, ...newIndices];
            const newHint = this.maskWord(gameState.currentWord, gameState.revealedLetters);
            
            // Save hint to database asynchronously (don't await)
            this.saveHintToDatabase(room.roomId, gameState.revealedLetters).catch(err => {
              console.error(`Error saving first hint for room ${room.roomId}:`, err);
            });
            
            io.to(room.roomId).emit('hintUpdate', { wordHint: newHint });
          }

          // Reveal second hint
          if (!gameState.secondRevealed && timeLeft <= secondHintTime) {
            gameState.secondRevealed = true;
            const newIndices = this.getRevealIndices(gameState.currentWord, 1, gameState.revealedLetters);
            gameState.revealedLetters = [...gameState.revealedLetters, ...newIndices];
            const newHint = this.maskWord(gameState.currentWord, gameState.revealedLetters);
            
            // Save hint to database asynchronously (don't await)
            this.saveHintToDatabase(room.roomId, gameState.revealedLetters).catch(err => {
              console.error(`Error saving second hint for room ${room.roomId}:`, err);
            });
            
            io.to(room.roomId).emit('hintUpdate', { wordHint: newHint });
          }

          // Emit tick event every second
          io.to(room.roomId).emit('tick', { timeLeft });

          // Check if we need to end the turn (only check database when necessary)
          if (timeLeft <= 0) {
            gameState.gameEnded = true;
            clearInterval(timer);
            this.roomIntervals.delete(room.roomId);
            await this.endTurn(io, room.roomId);
          } else {
            // Check if everyone guessed (minimal database read)
            this.checkIfEveryoneGuessed(room.roomId).then(everyoneGuessed => {
              if (everyoneGuessed && !gameState.gameEnded) {
                gameState.gameEnded = true;
                clearInterval(timer);
                this.roomIntervals.delete(room.roomId);
                this.endTurn(io, room.roomId).catch(err => {
                  console.error(`Error ending turn for room ${room.roomId}:`, err);
                });
              }
            }).catch(err => {
              console.error(`Error checking if everyone guessed for room ${room.roomId}:`, err);
            });
          }
        } catch (err) {
          console.error(`Error in game timer for room ${room.roomId}:`, err);
          gameState.gameEnded = true;
          clearInterval(timer);
          this.roomIntervals.delete(room.roomId);
          // Try to recover
          try {
            await this.endTurn(io, room.roomId);
          } catch (recoveryErr) {
            console.error(`Failed to recover from timer error:`, recoveryErr);
          }
        }
      }, ROOM_TICK_MS);

      this.roomIntervals.set(room.roomId, timer);

      room.markModified?.('players');
      await room.save();
      
      console.log(`Drawing phase started for room ${room.roomId}, word: ${word}`);
    } catch (err) {
      console.error(`Error in startDrawingPhase for room ${room.roomId}:`, err);
      // Try to recover
      try {
        await this.endTurn(io, room.roomId);
      } catch (recoveryErr) {
        console.error(`Failed to recover from drawing phase error:`, recoveryErr);
      }
    }
  }

  /**
   * End current turn
   */
  async endTurn(io: Server, roomId: string): Promise<void> {
    try {
      const room = await Room.findOne({ roomId });
      if (!room) {
        console.error(`Cannot end turn: Room ${roomId} not found`);
        return;
      }
      
      if (!room.players || room.players.length === 0) {
        console.error(`Cannot end turn: No players in room ${roomId}`);
        return;
      }

      const drawer = roomManager.getDrawer(room);
      const drawerBonus = DRAWER_BONUS_PER_GUESSER * (room.correctGuessers?.length || 0);
      
      if (drawer) {
        drawer.score = (drawer.score || 0) + drawerBonus;
        room.roundPoints.set(drawer.id, drawerBonus);
      }

      const playersWithRoundPoints = room.players.map((p: any) => ({
        id: p.id,
        name: p.name,
        score: p.score || 0,
        avatar: p.avatar,
        sessionId: p.sessionId, // Include sessionId for frontend identification
        roundPoints: room.roundPoints.get(p.id) || 0,
      }));

      io.to(roomId).emit('turnEnded', {
        word: room.currentWord || 'unknown',
        correctGuessers: room.correctGuessers ?? [],
        drawerBonus,
        players: playersWithRoundPoints,
      });

      // Rotate drawer
      if (room.players.length > 0) {
        const nextIdx = roomManager.rotateDrawer(room);
        if (nextIdx === 0) {
          room.round = (room.round || 1) + 1;
        }
      }

      // Check game end
      if ((room.round || 1) > (room.maxRounds || 3)) {
        await this.endGame(io, room);
        return;
      }

      // Next turn after intermission
      room.currentWord = undefined;
      room.correctGuessers = [];
      await room.save();

      console.log(`Turn ended for room ${roomId}, starting next turn in 5 seconds`);

      setTimeout(async () => {
        try {
          const fresh = await Room.findOne({ roomId });
          if (fresh && fresh.players && fresh.players.length > 0) {
            await this.startTurn(io, fresh);
          } else {
            console.log(`Room ${roomId} no longer valid for next turn`);
          }
        } catch (err) {
          console.error(`Error starting next turn for room ${roomId}:`, err);
        }
      }, 5000);
    } catch (err) {
      console.error(`Error in endTurn for room ${roomId}:`, err);
      // Clean up timers to prevent stuck state
      const timer = this.roomIntervals.get(roomId);
      if (timer) {
        clearInterval(timer);
        this.roomIntervals.delete(roomId);
      }
      const timeout = this.wordSelectionTimeouts.get(roomId);
      if (timeout) {
        clearTimeout(timeout);
        this.wordSelectionTimeouts.delete(roomId);
      }
    }
  }

  /**
   * End game
   */
  async endGame(io: Server, room: any): Promise<void> {
    const timer = this.roomIntervals.get(room.roomId);
    if (timer) clearInterval(timer);
    this.roomIntervals.delete(room.roomId);

    const sorted = [...room.players].sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
    io.to(room.roomId).emit('gameOver', { players: sorted });

    room.gameStarted = false;
    room.currentWord = undefined;
    room.correctGuessers = [];
    await room.save();
  }

  /**
   * Calculate points based on time remaining
   */
  calculatePoints(timeRemaining: number, maxTime: number): number {
    const intervalTime = Math.floor(timeRemaining / 5) * 5;
    const percentage = intervalTime / maxTime;
    const points = Math.floor(MAX_POINTS * percentage);
    return Math.max(MIN_POINTS, points);
  }

  /**
   * Calculate edit distance for close guesses
   */
  getEditDistance(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix: number[][] = [];

    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      if (matrix[0]) matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          const prevVal = matrix[i - 1]?.[j - 1];
          if (prevVal !== undefined) matrix[i]![j] = prevVal;
        } else {
          const sub = matrix[i - 1]?.[j - 1] ?? Infinity;
          const ins = matrix[i]?.[j - 1] ?? Infinity;
          const del = matrix[i - 1]?.[j] ?? Infinity;
          matrix[i]![j] = Math.min(sub + 1, ins + 1, del + 1);
        }
      }
    }

    return matrix[len1]?.[len2] ?? 0;
  }

  /**
   * Clean up room timers - stops all game loops immediately
   * Called when room becomes empty to prevent timers running in void
   */
  cleanupRoom(roomId: string): void {
    const timer = this.roomIntervals.get(roomId);
    if (timer) {
      clearInterval(timer);
      console.log(`Cleared game timer for empty room ${roomId}`);
    }
    this.roomIntervals.delete(roomId);

    const timeout = this.wordSelectionTimeouts.get(roomId);
    if (timeout) {
      clearTimeout(timeout);
      console.log(`Cleared word selection timeout for empty room ${roomId}`);
    }
    this.wordSelectionTimeouts.delete(roomId);
  }

  /**
   * Clear word selection timeout
   */
  clearWordTimeout(roomId: string): void {
    const timeout = this.wordSelectionTimeouts.get(roomId);
    if (timeout) {
      clearTimeout(timeout);
      this.wordSelectionTimeouts.delete(roomId);
    }
  }

  /**
   * Save hint to database asynchronously (non-blocking)
   */
  private async saveHintToDatabase(roomId: string, revealedLetters: number[]): Promise<void> {
    try {
      const room = await Room.findOne({ roomId });
      if (room) {
        room.revealedLetters = revealedLetters;
        await room.save();
      }
    } catch (err) {
      console.error(`Error saving hint to database for room ${roomId}:`, err);
    }
  }

  /**
   * Check if everyone has guessed (minimal database read)
   */
  private async checkIfEveryoneGuessed(roomId: string): Promise<boolean> {
    try {
      const room = await Room.findOne({ roomId }).select('players correctGuessers');
      if (!room) return false;
      return roomManager.allGuessed(room);
    } catch (err) {
      console.error(`Error checking if everyone guessed for room ${roomId}:`, err);
      return false;
    }
  }

  private maskWord(word: string, revealedIndices: number[] = []): string {
    return word
      .split('')
      .map((char, idx) => (revealedIndices.includes(idx) ? char : '_'))
      .join(' ');
  }

  private getRevealIndices(word: string, count: number, alreadyRevealed: number[] = []): number[] {
    const availableIndices = Array.from({ length: word.length }, (_, i) => i)
      .filter(i => !alreadyRevealed.includes(i));
    
    const shuffled = availableIndices.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, shuffled.length));
  }

  private selectWords(room: any, count: number): string[] {
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
}

export const gameEngine = new GameEngine();
