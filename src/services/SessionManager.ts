/**
 * SessionManager handles player sessions and reconnection logic
 * Sessions persist across disconnects to allow reconnection
 */
class SessionManager {
  private sessions: Map<string, string> = new Map(); // socketId -> sessionId
  private socketToSession: Map<string, string> = new Map(); // sessionId -> current socketId
  private sessionTimers: Map<string, NodeJS.Timeout> = new Map(); // sessionId -> cleanup timer

  private readonly SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes to reconnect

  /**
   * Create a new session for a socket connection
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
    
    // Clear any existing timer for this session (shouldn't exist for new session, but safety check)
    const existingTimer = this.sessionTimers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.sessionTimers.delete(sessionId);
    }
    
    return sessionId;
  }

  /**
   * Reconnect an existing session to a new socket
   * Strict 1-to-1 binding: One Browser = One Session
   */
  reconnectSession(sessionId: string, newSocketId: string): boolean {
    if (!this.socketToSession.has(sessionId)) {
      return false; // Session doesn't exist or expired
    }

    // Clear the expiration timer - session is being restored
    const timer = this.sessionTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.sessionTimers.delete(sessionId);
      console.log(`Session ${sessionId} restored - cancelling expiration timer`);
    }

    // Update socket mapping - strict 1-to-1 binding
    const oldSocketId = this.socketToSession.get(sessionId);
    if (oldSocketId) {
      this.sessions.delete(oldSocketId);
    }
    
    this.sessions.set(newSocketId, sessionId);
    this.socketToSession.set(sessionId, newSocketId);
    
    console.log(`Session ${sessionId} reconnected from socket ${oldSocketId} to ${newSocketId}`);
    return true;
  }

  /**
   * Get session ID for a socket
   */
  getSession(socketId: string): string | undefined {
    return this.sessions.get(socketId);
  }

  /**
   * Mark session for expiration (called on disconnect)
   * Session will be removed after timeout unless player reconnects
   */
  markForExpiration(socketId: string): void {
    const sessionId = this.sessions.get(socketId);
    if (!sessionId) return;

    // Remove socket mapping but keep session alive temporarily
    this.sessions.delete(socketId);

    // Set expiration timer
    const timer = setTimeout(() => {
      this.socketToSession.delete(sessionId);
      this.sessionTimers.delete(sessionId);
      console.log(`Session ${sessionId} expired`);
    }, this.SESSION_TIMEOUT);

    this.sessionTimers.set(sessionId, timer);
  }

  /**
   * Permanently remove session (called on voluntary quit)
   */
  removeSession(socketId: string): void {
    const sessionId = this.sessions.get(socketId);
    if (sessionId) {
      // Clear any timers
      const timer = this.sessionTimers.get(sessionId);
      if (timer) {
        clearTimeout(timer);
        this.sessionTimers.delete(sessionId);
      }
      
      this.socketToSession.delete(sessionId);
      this.sessions.delete(socketId);
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

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }
}

export const sessionManager = new SessionManager();
