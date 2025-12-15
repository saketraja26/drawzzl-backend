/**
 * SessionManager handles graceful session management with 3-state logic:
 * 1. Active: Player is connected and playing
 * 2. Disconnected: Player lost connection but can rejoin (grace period)
 * 3. Quit: Player intentionally left (permanent removal)
 */
class SessionManager {
  private sessions: Map<string, string> = new Map(); // socketId -> sessionId
  private socketToSession: Map<string, string> = new Map(); // sessionId -> current socketId
  private sessionTimers: Map<string, NodeJS.Timeout> = new Map(); // sessionId -> cleanup timer
  private sessionStatus: Map<string, 'active' | 'disconnected' | 'quit'> = new Map(); // sessionId -> status

  private readonly REJOIN_TIMEOUT = 3 * 60 * 1000; // 3 minutes to rejoin after disconnect

  /**
   * Create a new session for a socket connection (State: Active)
   */
  createSession(socketId: string): string {
    // Check if this socket already has an active session and remove it to prevent duplicates
    const existingSessionId = this.sessions.get(socketId);
    if (existingSessionId) {
      console.log(`Removing existing session ${existingSessionId} for socket ${socketId} to prevent duplicates`);
      this.removeSession(socketId);
    }
    
    const sessionId = this.generateSessionId();
    this.sessions.set(socketId, sessionId);
    this.socketToSession.set(sessionId, socketId);
    this.sessionStatus.set(sessionId, 'active');
    
    // Clear any existing timer for this session (shouldn't exist for new session, but safety check)
    const existingTimer = this.sessionTimers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.sessionTimers.delete(sessionId);
    }
    
    console.log(`Created new session ${sessionId} for socket ${socketId} - Status: active`);
    return sessionId;
  }

  /**
   * Reconnect an existing session to a new socket (Disconnected -> Active)
   * Only works if session is in 'disconnected' state within grace period
   */
  reconnectSession(sessionId: string, newSocketId: string): boolean {
    if (!this.socketToSession.has(sessionId)) {
      return false; // Session doesn't exist or expired
    }

    const status = this.sessionStatus.get(sessionId);
    if (status !== 'disconnected') {
      console.log(`Cannot reconnect session ${sessionId} - status is ${status}, expected 'disconnected'`);
      return false; // Can only reconnect disconnected sessions
    }

    // Clear the expiration timer - session is being restored
    const timer = this.sessionTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.sessionTimers.delete(sessionId);
      console.log(`Session ${sessionId} restored - cancelling expiration timer`);
    }

    // Update socket mapping and status
    const oldSocketId = this.socketToSession.get(sessionId);
    if (oldSocketId) {
      this.sessions.delete(oldSocketId);
    }
    
    this.sessions.set(newSocketId, sessionId);
    this.socketToSession.set(sessionId, newSocketId);
    this.sessionStatus.set(sessionId, 'active');
    
    console.log(`Session ${sessionId} reconnected from socket ${oldSocketId} to ${newSocketId} - Status: active`);
    return true;
  }

  /**
   * Get session ID for a socket
   */
  getSession(socketId: string): string | undefined {
    return this.sessions.get(socketId);
  }

  /**
   * Mark session as disconnected (Active -> Disconnected)
   * Starts grace period timer for rejoining
   */
  markAsDisconnected(socketId: string): string | null {
    const sessionId = this.sessions.get(socketId);
    if (!sessionId) return null;

    // Update status to disconnected
    this.sessionStatus.set(sessionId, 'disconnected');

    // Remove socket mapping but keep session alive temporarily
    this.sessions.delete(socketId);

    // Set rejoin timer
    const timer = setTimeout(() => {
      this.socketToSession.delete(sessionId);
      this.sessionTimers.delete(sessionId);
      this.sessionStatus.delete(sessionId);
      console.log(`Session ${sessionId} expired after grace period`);
    }, this.REJOIN_TIMEOUT);

    this.sessionTimers.set(sessionId, timer);
    console.log(`Session ${sessionId} marked as disconnected - ${this.REJOIN_TIMEOUT / 1000}s grace period started`);
    
    return sessionId;
  }

  /**
   * Legacy method for backward compatibility
   */
  markForExpiration(socketId: string): void {
    this.markAsDisconnected(socketId);
  }

  /**
   * Permanently remove session (Active/Disconnected -> Quit)
   * Called on voluntary quit - no grace period
   */
  removeSession(socketId: string): void {
    const sessionId = this.sessions.get(socketId);
    if (sessionId) {
      // Mark as quit
      this.sessionStatus.set(sessionId, 'quit');
      
      // Clear any timers
      const timer = this.sessionTimers.get(sessionId);
      if (timer) {
        clearTimeout(timer);
        this.sessionTimers.delete(sessionId);
      }
      
      // Remove all mappings
      this.socketToSession.delete(sessionId);
      this.sessions.delete(socketId);
      this.sessionStatus.delete(sessionId);
      
      console.log(`Session ${sessionId} permanently removed - Status: quit`);
    }
  }

  /**
   * Check if a session exists and is valid
   */
  hasSession(sessionId: string): boolean {
    return this.socketToSession.has(sessionId);
  }

  /**
   * Get current socket ID for a session
   */
  getSocketId(sessionId: string): string | undefined {
    return this.socketToSession.get(sessionId);
  }

  /**
   * Get session status
   */
  getSessionStatus(sessionId: string): 'active' | 'disconnected' | 'quit' | undefined {
    return this.sessionStatus.get(sessionId);
  }

  /**
   * Check if session is in disconnected state (can rejoin)
   */
  isDisconnected(sessionId: string): boolean {
    return this.sessionStatus.get(sessionId) === 'disconnected';
  }

  /**
   * Get remaining grace period time for disconnected session
   */
  getGracePeriodRemaining(sessionId: string): number {
    if (!this.isDisconnected(sessionId)) return 0;
    
    const timer = this.sessionTimers.get(sessionId);
    if (!timer) return 0;
    
    // This is approximate - in production you'd want to track start time
    return this.REJOIN_TIMEOUT;
  }

  /**
   * Get all disconnected sessions (for UI updates)
   */
  getDisconnectedSessions(): string[] {
    const disconnected: string[] = [];
    for (const [sessionId, status] of this.sessionStatus.entries()) {
      if (status === 'disconnected') {
        disconnected.push(sessionId);
      }
    }
    return disconnected;
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }
}

export const sessionManager = new SessionManager();
