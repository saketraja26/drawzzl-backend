import { Room } from '../models/Room.js';
import { gameEngine } from './GameEngine.js';
import { sessionManager } from './SessionManager.js';

/**
 * RoomCleanupService handles cleanup of inactive rooms
 * Runs periodically to remove rooms where all players are offline
 */
export class RoomCleanupService {
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL = 2 * 60 * 1000; // Check every 2 minutes
  private readonly ROOM_TIMEOUT = 10 * 60 * 1000; // Delete room if inactive for 10 minutes

  /**
   * Start the cleanup service
   */
  start(): void {
    if (this.cleanupInterval) return;

    console.log('Room cleanup service started');
    
    this.cleanupInterval = setInterval(async () => {
      await this.cleanupInactiveRooms();
    }, this.CLEANUP_INTERVAL);

    // Run immediately on start
    this.cleanupInactiveRooms();
  }

  /**
   * Stop the cleanup service
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('Room cleanup service stopped');
    }
  }

  /**
   * Clean up rooms where all players are offline
   */
  private async cleanupInactiveRooms(): Promise<void> {
    try {
      const rooms = await Room.find({});
      const now = Date.now();

      for (const room of rooms) {
        // Check if all players have expired sessions
        const allPlayersOffline = room.players.every((player) => {
          if (!player.sessionId) return true; // No session = offline
          return !sessionManager.hasSession(player.sessionId);
        });

        if (allPlayersOffline) {
          const roomAge = now - new Date(room.createdAt).getTime();
          
          // Delete room if all players offline and room is old enough
          if (roomAge > this.ROOM_TIMEOUT) {
            await Room.deleteOne({ roomId: room.roomId });
            gameEngine.cleanupRoom(room.roomId);
            
            // Clean up all player sessions
            room.players.forEach((player) => {
              if (player.sessionId) {
                sessionManager.removeSession(player.id);
              }
            });
            
            console.log(`Cleaned up inactive room: ${room.roomId} (${room.players.length} offline players)`);
          }
        }
      }
    } catch (err) {
      console.error('Error in room cleanup:', err);
    }
  }

  /**
   * Manually trigger cleanup (for testing)
   */
  async triggerCleanup(): Promise<void> {
    await this.cleanupInactiveRooms();
  }
}

export const roomCleanupService = new RoomCleanupService();
