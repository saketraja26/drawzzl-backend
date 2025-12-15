# Graceful Session Management Implementation

## ✅ IMPLEMENTED: 3-State Session Lifecycle

### 1. **Active State**
- **Trigger**: Player connects and creates/joins a room
- **Status**: `sessionStatus.set(sessionId, 'active')`
- **Behavior**: 
  - Player is fully connected and participating
  - `player.isOnline = true` in database
  - Socket ID is tracked and mapped to session

### 2. **Disconnected State (Grace Period)**
- **Trigger**: Socket disconnects WITHOUT `leaveRoom` event (accidental)
- **Status**: `sessionStatus.set(sessionId, 'disconnected')`
- **Behavior**:
  - Player remains in `room.players` list but marked `isOnline: false`
  - 3-minute rejoin timer starts
  - UI shows "Player X disconnected (waiting to rejoin...)"
  - Room stays alive even if all players are disconnected
  - Session can be reconnected with `reconnectRoom` event

### 3. **Quit State (Permanent Removal)**
- **Trigger**: Player clicks "Quit" button (emits `leaveRoom` event)
- **Status**: `sessionStatus.set(sessionId, 'quit')` then deleted
- **Behavior**:
  - Immediate removal from `room.players` list
  - Session permanently destroyed
  - UI shows "Player X left the game"
  - Room deleted immediately if empty

## 🔧 Implementation Details

### SessionManager Updates
```typescript
// New status tracking
private sessionStatus: Map<string, 'active' | 'disconnected' | 'quit'> = new Map();
private readonly REJOIN_TIMEOUT = 3 * 60 * 1000; // 3 minutes

// New methods
markAsDisconnected(socketId: string): string | null
getSessionStatus(sessionId: string): 'active' | 'disconnected' | 'quit' | undefined
isDisconnected(sessionId: string): boolean
getDisconnectedSessions(): string[]
```

### PlayerManager Updates
```typescript
// Enhanced removal with graceful flag
async removePlayerFromRoom(
  io: Server, roomId: string, playerId: string, 
  reason: 'disconnect' | 'quit', 
  graceful: boolean = reason === 'quit'
): Promise<boolean>

// New rejoin timer management
private rejoinTimers = new Map<string, NodeJS.Timeout>();
private readonly REJOIN_TIMEOUT_MS = 3 * 60 * 1000;
public cancelRejoinTimer(sessionId: string): void
```

### Player Model Updates
```typescript
export interface Player {
  id: string;
  name: string;
  score: number;
  isDrawer?: boolean;
  avatar?: number[];
  sessionId?: string;
  isOnline?: boolean;        // NEW: Track connection status
  disconnectedAt?: Date;     // NEW: Track disconnect time
}
```

## 🎯 Handler Logic

### Disconnect Handler (Accidental)
```typescript
socket.on('disconnect', async () => {
  const roomId = playerManager.getRoomId(socket.id);
  if (roomId) {
    // graceful = false (accidental disconnect)
    await playerManager.removePlayerFromRoom(io, roomId, socket.id, 'disconnect', false);
  }
});
```

### Leave Room Handler (Intentional)
```typescript
socket.on('leaveRoom', async ({ roomId }, callback) => {
  // graceful = true (intentional quit)
  await playerManager.removePlayerFromRoom(io, roomId, socket.id, 'quit', true);
});
```

### Reconnect Handler
```typescript
socket.on('reconnectRoom', async ({ roomId, sessionId }) => {
  // Only works for 'disconnected' sessions within grace period
  const reconnected = sessionManager.reconnectSession(sessionId, socket.id);
  if (reconnected) {
    player.isOnline = true;
    delete player.disconnectedAt;
    playerManager.cancelRejoinTimer(sessionId);
  }
});
```

## 🚀 Benefits

### User Experience
- **Accidental Disconnects**: Players can rejoin after page reload, network issues, etc.
- **Clear Feedback**: Different messages for disconnects vs. quits
- **Grace Period**: 3 minutes to rejoin without losing progress
- **Host Persistence**: Host role transfers only to online players

### System Reliability
- **No Ghost Players**: Proper cleanup after grace period expires
- **Room Lifecycle**: Rooms stay alive during disconnects, deleted on quits
- **Session Integrity**: 1-to-1 session mapping prevents conflicts
- **Timer Management**: Proper cleanup of all timers and resources

### Network Efficiency
- **Reduced Reconnections**: Players don't lose their spot in games
- **Smart Cleanup**: Only removes players who truly left
- **State Consistency**: All clients see accurate player status

## 🎮 Game Flow Examples

### Scenario A: Page Reload (Accidental)
1. Player refreshes browser → Socket disconnects
2. System marks player as `disconnected`, starts 3min timer
3. Other players see "Player X disconnected (waiting...)"
4. Player reconnects → Status back to `active`, timer cancelled
5. Game continues normally

### Scenario B: Quit Button (Intentional)
1. Player clicks "Quit" → `leaveRoom` event sent
2. System immediately removes player, destroys session
3. Other players see "Player X left the game"
4. If room empty → Immediate deletion
5. Player cannot rejoin (must create new session)

### Scenario C: Network Timeout (Grace Period Expires)
1. Player loses internet → Socket disconnects
2. System starts 3min grace period
3. Timer expires without reconnection
4. Player permanently removed from room
5. Other players see "Player X failed to rejoin and was removed"

## ✅ Status: FULLY IMPLEMENTED AND TESTED

All components are updated and working together to provide a robust, user-friendly session management system that handles both accidental disconnects and intentional quits gracefully.