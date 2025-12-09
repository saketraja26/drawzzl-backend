# Room Cleanup & Cookie-Based Sessions

## Overview
Implemented automatic cleanup of inactive rooms and proper cookie-based session management for better security and reliability.

## Features

### 1. Automatic Room Cleanup

**RoomCleanupService** runs in the background to clean up inactive rooms:

- **Check Interval**: Every 2 minutes
- **Cleanup Threshold**: Rooms inactive for 10+ minutes
- **Cleanup Criteria**: All players offline (no active sessions)

**How It Works:**
1. Service runs every 2 minutes
2. Checks all rooms in database
3. For each room, verifies if all players have expired sessions
4. If all players offline AND room older than 10 minutes:
   - Deletes room from database
   - Cleans up game timers
   - Removes all player sessions
   - Logs cleanup action

**Benefits:**
- Prevents database bloat
- Frees up server resources
- Removes abandoned rooms automatically
- No manual cleanup needed

### 2. Cookie-Based Sessions

**Socket.IO Cookie Configuration:**
```typescript
cookie: {
  name: 'drawzzl_session',
  httpOnly: true,           // Prevents JavaScript access
  sameSite: 'lax',          // CSRF protection
  secure: production only   // HTTPS only in production
}
```

**Security Benefits:**
- **HttpOnly**: Cookies can't be accessed by JavaScript (XSS protection)
- **SameSite**: Prevents CSRF attacks
- **Secure**: HTTPS-only in production
- **Server-Side**: Session validation happens on backend

**Session Flow:**
1. Player joins/creates room
2. Backend creates session
3. Session ID sent in Socket.IO handshake
4. Frontend stores in localStorage (backup)
5. Cookie automatically sent with each request

### 3. Session Lifecycle

**Active Session:**
- Player connected
- Session mapped to socket ID
- Room active

**Disconnected (Temporary):**
- Player disconnects
- Session marked for expiration (5 min)
- Room stays active
- Player can reconnect

**All Players Offline:**
- All sessions expired
- Room marked inactive
- After 10 minutes → Room deleted
- All sessions cleaned up

**Voluntary Quit:**
- Player clicks "Quit"
- Session immediately removed
- Cannot reconnect
- If last player → Room deleted immediately

## Configuration

### Cleanup Service Timings
```typescript
// RoomCleanupService.ts
private readonly CLEANUP_INTERVAL = 2 * 60 * 1000;  // 2 minutes
private readonly ROOM_TIMEOUT = 10 * 60 * 1000;     // 10 minutes
```

### Session Timeout
```typescript
// SessionManager.ts
private readonly SESSION_TIMEOUT = 5 * 60 * 1000;   // 5 minutes
```

## Scenarios

### Scenario 1: All Players Leave
1. Player 1 quits → Session removed
2. Player 2 quits → Session removed
3. Room now has 0 active sessions
4. Cleanup service runs (within 2 min)
5. Room older than 10 min → Deleted
6. All resources freed

### Scenario 2: All Players Disconnect
1. All players lose connection
2. Sessions marked for expiration (5 min each)
3. No one reconnects within 5 minutes
4. All sessions expire
5. Cleanup service detects all offline
6. After 10 min total → Room deleted

### Scenario 3: One Player Reconnects
1. All players disconnect
2. One player reconnects within 5 min
3. Session reactivated
4. Room stays active
5. Other sessions expire after 5 min
6. Room continues with active player

### Scenario 4: New Room, Quick Abandon
1. Player creates room
2. Immediately closes tab
3. Session expires after 5 min
4. Room inactive for 10 min total
5. Cleanup service deletes room
6. No database bloat

## Implementation Details

### Files Changed

**Backend:**
- `src/services/RoomCleanupService.ts` - NEW: Background cleanup service
- `src/index.ts` - Start cleanup service on server start
- `src/index.ts` - Added Socket.IO cookie configuration
- `src/handlers/roomHandlers.ts` - Store session in handshake auth

### Cleanup Service Methods

```typescript
start()              // Start background service
stop()               // Stop background service
triggerCleanup()     // Manual cleanup (testing)
cleanupInactiveRooms() // Main cleanup logic
```

### Database Impact

**Before:**
- Rooms accumulate indefinitely
- Abandoned rooms stay forever
- Database grows continuously

**After:**
- Rooms auto-deleted when inactive
- Maximum 10 minutes of inactive room storage
- Database stays clean

## Monitoring

**Logs:**
```
Room cleanup service started
Cleaned up inactive room: ABC123 (2 offline players)
Room XYZ789 deleted – empty after Player quit
```

**Health Check:**
- Endpoint: `/health`
- Shows server uptime
- Can be extended to show active rooms count

## Testing

1. **Create room → All quit → Wait 10 min**
   - Room should be deleted

2. **Create room → All disconnect → Wait 15 min**
   - Room should be deleted (5 min session + 10 min inactive)

3. **Create room → Disconnect → Reconnect within 5 min**
   - Room should stay active

4. **Create room → Leave open → Check after 2 hours**
   - Room should still exist if at least one session active

## Benefits Summary

✅ **Automatic Cleanup**: No manual intervention needed
✅ **Resource Efficient**: Frees memory and database space
✅ **Secure Sessions**: HttpOnly cookies prevent XSS
✅ **CSRF Protection**: SameSite cookie attribute
✅ **Scalable**: Handles many rooms without bloat
✅ **Reliable**: Background service runs independently
✅ **Configurable**: Easy to adjust timings

## Production Considerations

1. **Adjust Timings**: May want longer timeouts in production
2. **Monitoring**: Add metrics for cleanup operations
3. **Logging**: Consider structured logging for analytics
4. **Database Indexes**: Ensure `createdAt` is indexed for performance
5. **Load Testing**: Test cleanup under high room count
