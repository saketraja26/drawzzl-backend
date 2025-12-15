import { Room } from '../models/Room.js';
import type { Player } from '../types/index.js';

/**
 * RoomManager handles room operations and host management
 */
export class RoomManager {
  /**
   * Generate a unique room ID
   */
  generateRoomId(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  /**
   * Get the host (first player) of a room
   */
  getHost(room: any): Player | undefined {
    return room.players[0];
  }

  /**
   * Check if a player is the host
   */
  isHost(room: any, playerId: string): boolean {
    const host = this.getHost(room);
    return host?.id === playerId;
  }

  /**
   * Transfer host to next player when current host leaves
   */
  async transferHost(room: any, oldHostId: string): Promise<Player | undefined> {
    if (room.players.length === 0) return undefined;

    // Remove old host
    room.players = room.players.filter((p: Player) => p.id !== oldHostId);

    if (room.players.length === 0) return undefined;

    // New host is now the first player
    const newHost = room.players[0];
    await room.save();

    return newHost;
  }

  /**
   * Check if room is full
   */
  isFull(room: any): boolean {
    return room.players.length >= (room.maxPlayers || 8);
  }

  /**
   * Find existing player by session ID (for session merging)
   */
  findPlayerBySession(room: any, sessionId: string): Player | undefined {
    return room.players.find((p: Player) => p.sessionId === sessionId);
  }

  /**
   * Find disconnected player by name (for session merging)
   */
  findDisconnectedPlayerByName(room: any, playerName: string): Player | undefined {
    return room.players.find((p: Player) => 
      p.name === playerName && (p.isOnline === false || !p.isOnline)
    );
  }

  /**
   * Add player to room
   */
  async addPlayer(room: any, player: Player): Promise<boolean> {
    if (this.isFull(room)) return false;

    const exists = room.players.some((p: Player) => p.id === player.id);
    if (exists) return false;

    room.players.push(player);
    await room.save();
    return true;
  }

  /**
   * Remove player from room
   */
  async removePlayer(room: any, playerId: string): Promise<void> {
    room.players = room.players.filter((p: Player) => p.id !== playerId);
    
    // Adjust drawer index if needed
    if ((room.drawerIndex ?? 0) >= room.players.length) {
      room.drawerIndex = 0;
    }

    await room.save();
  }

  /**
   * Get drawer for current turn
   */
  getDrawer(room: any): Player | undefined {
    if (!room.players || room.players.length === 0) return undefined;
    const idx = Math.min(Math.max(0, room.drawerIndex || 0), room.players.length - 1);
    return room.players[idx];
  }

  /**
   * Get drawer index safely
   */
  getDrawerIndex(room: any): number {
    const len = room.players?.length || 0;
    if (len === 0) return 0;
    const idx = room.drawerIndex ?? 0;
    return Math.min(Math.max(0, idx), len - 1);
  }

  /**
   * Rotate to next drawer
   */
  rotateDrawer(room: any): number {
    if (room.players.length === 0) return 0;
    const nextIdx = (this.getDrawerIndex(room) + 1) % room.players.length;
    room.drawerIndex = nextIdx;
    return nextIdx;
  }

  /**
   * Check if all non-drawers have guessed
   */
  allGuessed(room: any): boolean {
    const nonDrawers = Math.max(0, room.players.length - 1);
    return (room.correctGuessers?.length || 0) >= nonDrawers;
  }

  /**
   * Remove duplicate players (safety cleanup for edge cases)
   * This removes any duplicate entries that might exist due to race conditions
   */
  async removeDuplicatePlayers(room: any): Promise<boolean> {
    const seenNames = new Set<string>();
    const seenSessions = new Set<string>();
    const uniquePlayers: Player[] = [];
    let foundDuplicates = false;

    for (const player of room.players) {
      const isDuplicateName = seenNames.has(player.name);
      const isDuplicateSession = player.sessionId && seenSessions.has(player.sessionId);
      
      if (isDuplicateName || isDuplicateSession) {
        console.log(`🧹 DUPLICATE CLEANUP: Removing duplicate player ${player.name} (${player.id})`);
        foundDuplicates = true;
        continue;
      }
      
      seenNames.add(player.name);
      if (player.sessionId) {
        seenSessions.add(player.sessionId);
      }
      uniquePlayers.push(player);
    }

    if (foundDuplicates) {
      room.players = uniquePlayers;
      await room.save();
      console.log(`🧹 CLEANUP COMPLETE: Removed duplicates, ${uniquePlayers.length} players remain`);
    }

    return foundDuplicates;
  }
}

export const roomManager = new RoomManager();
