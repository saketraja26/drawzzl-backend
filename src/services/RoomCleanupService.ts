import { Room } from '../models/Room.js';
import { gameEngine } from './GameEngine.js';
import { sessionManager } from './SessionManager.js';

/**
 * RoomCleanupService - FALLBACK ONLY for crashed rooms
 * Handles cleanup of rooms that should have been deleted but weren't due to server crashes
 * Normal room lifecycle is handled by PlayerManager with immediate deletion + grace period
 */
export class RoomCleanupService {
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes (less frequent)
  private readonly FALLBACK_TIMEOUT = 1 * 60 * 1000; // Delete empty rooms older than 1 minute

  /**
   * Start the cleanup service (fallback only)
   */
  start(): void {
    if (this.cleanupInterval) return;

    console.log('Room cleanup service started (fallback mode for crashed rooms)');
    
    this.cleanupInterval = setInterval(async () => {
      await this.cleanupCrashedRooms();
    }, this.CLEANUP_INTERVAL);

    // Run immediately on start
    this.cleanupCrashedRooms();
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
   * Clean up rooms that should have been deleted but weren't (server crash recovery)
   * Only handles edge cases where normal PlayerManager deletion failed
   */
  private async cleanupCrashedRooms(): Promise<void> {
    try {
      const rooms = await Room.find({});
      const now = Date.now();
      let cleanedCount = 0;

      for (const room of rooms) {
        // Only clean up completely empty rooms (should have been deleted by PlayerManager)
        if (room.players.length === 0) {
          const roomAge = now - new Date(room.createdAt).getTime();
          
          // Delete empty rooms older than 1 minute (fallback for crashed deletions)
          if (roomAge > this.FALLBACK_TIMEOUT) {
            await Room.deleteOne({ roomId: room.roomId });
            gameEngine.cleanupRoom(room.roomId);
            cleanedCount++;
            
            console.log(`FALLBACK: Cleaned up crashed empty room: ${room.roomId} (age: ${Math.round(roomAge / 1000)}s)`);
          }
        }
      }

      if (cleanedCount > 0) {
        console.log(`Fallback cleanup completed: ${cleanedCount} crashed rooms deleted`);
      }
    } catch (err) {
      console.error('Error in fallback room cleanup:', err);
    }
  }

  /**
   * Manually trigger cleanup (for testing)
   */
  async triggerCleanup(): Promise<void> {
    await this.cleanupCrashedRooms();
  }
}

export const roomCleanupService = new RoomCleanupService();
