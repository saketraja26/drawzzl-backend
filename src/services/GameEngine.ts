import { Server } from 'socket.io';
import { Room } from '../models/Room.js';
import { roomManager } from './RoomManager.js';
import { getRandomWordByDifficulty } from '../lib/words.js';

const ROOM_TICK_MS = 1000;
const TURN_SECONDS = 60;
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
        scores: sortedPlayers.map((p: any) => ({ name: p.name, score: p.score || 0, avatar: p.avatar }))
      });

      // Broadcast to others
      io.to(room.roomId).emit('drawerSelecting', {
        drawerId: drawer.id,
        timeLimit: 8,
        scores: sortedPlayers.map((p: any) => ({ name: p.name, score: p.score || 0, avatar: p.avatar }))
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
      });

      if (drawer.id) {
        io.to(drawer.id).emit('yourWord', { word });
      }

      const prev = this.roomIntervals.get(room.roomId);
      if (prev) {
        clearInterval(prev);
        console.log(`Cleared previous interval for room ${room.roomId}`);
      }

      const halfTime = Math.floor(drawTime / 2);
      const firstHintTime = halfTime;
      const secondHintTime = 15;

      const hintState = { firstRevealed: false, secondRevealed: false };

      const timer = setInterval(async () => {
        try {
          const r = await Room.findOne({ roomId: room.roomId });
          if (!r) {
            console.error(`Room ${room.roomId} not found in timer, clearing interval`);
            clearInterval(timer);
            this.roomIntervals.delete(room.roomId);
            return;
          }
          
          if (!r.currentWord) {
            console.log(`No current word for room ${room.roomId}, ending turn`);
            clearInterval(timer);
            this.roomIntervals.delete(room.roomId);
            await this.endTurn(io, room.roomId);
            return;
          }

          const endsAt = r.turnEndsAt ? new Date(r.turnEndsAt).getTime() : 0;
          const now = Date.now();
          const secs = Math.max(0, Math.ceil((endsAt - now) / 1000));

          // Reveal hints
          if (!hintState.firstRevealed && secs <= firstHintTime && secs > secondHintTime) {
            hintState.firstRevealed = true;
            const newIndices = this.getRevealIndices(r.currentWord, 1, r.revealedLetters);
            r.revealedLetters = [...r.revealedLetters, ...newIndices];
            const newHint = this.maskWord(r.currentWord, r.revealedLetters);
            await r.save();
            io.to(room.roomId).emit('hintUpdate', { wordHint: newHint });
          }

          if (!hintState.secondRevealed && secs <= secondHintTime) {
            hintState.secondRevealed = true;
            const newIndices = this.getRevealIndices(r.currentWord, 1, r.revealedLetters);
            r.revealedLetters = [...r.revealedLetters, ...newIndices];
            const newHint = this.maskWord(r.currentWord, r.revealedLetters);
            await r.save();
            io.to(room.roomId).emit('hintUpdate', { wordHint: newHint });
          }

          io.to(room.roomId).emit('tick', { timeLeft: secs });

          const everyoneGuessed = roomManager.allGuessed(r);

          if (secs <= 0 || everyoneGuessed) {
            clearInterval(timer);
            this.roomIntervals.delete(room.roomId);
            await this.endTurn(io, room.roomId);
          }
        } catch (err) {
          console.error(`Error in game timer for room ${room.roomId}:`, err);
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
   * Clean up room timers
   */
  cleanupRoom(roomId: string): void {
    const timer = this.roomIntervals.get(roomId);
    if (timer) clearInterval(timer);
    this.roomIntervals.delete(roomId);

    const timeout = this.wordSelectionTimeouts.get(roomId);
    if (timeout) clearTimeout(timeout);
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
