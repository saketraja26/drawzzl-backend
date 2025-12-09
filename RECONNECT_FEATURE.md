# Reconnection Feature

## Overview
Players can now rejoin their game session if they accidentally reload the page or lose connection temporarily. Sessions remain active for 5 minutes after disconnect.

## How It Works

### Session Lifecycle

**1. Player Joins/Creates Room:**
- Backend creates unique session ID
- Frontend stores session ID + room ID in localStorage
- Session is active and mapped to socket ID

**2. Player Accidentally Reloads:**
- Frontend detects stored session in localStorage
- Automatically attempts reconnection
- Backend validates session and reconnects player
- Player rejoins with same score, role, and game state

**3. Player Voluntarily Quits:**
- Frontend clears localStorage
- Backend permanently removes session
- Player cannot rejoin (must create new room)

**4. Player Disconnects (network/tab close):**
- Backend marks session for expiration (5 min timer)
- Player removed from room temporarily
- If player reconnects within 5 minutes → rejoins successfully
- If 5 minutes pass → session expires permanently

## Implementation Details

### Backend Changes

**SessionManager (`services/SessionManager.ts`):**
- `createSession()` - Create new session
- `reconnectSession()` - Reconnect existing session to new socket
- `markForExpiration()` - Start 5-minute expiration timer
- `removeSession()` - Permanently delete session
- Sessions persist across disconnects with timeout

**PlayerManager (`services/PlayerManager.ts`):**
- Quit → `removeSession()` (permanent)
- Disconnect → `markForExpiration()` (temporary, 5 min)

**RoomHandlers (`handlers/roomHandlers.ts`):**
- New `reconnectRoom` event handler
- Validates session ID
- Updates player's socket ID
- Restores player to room with same state
- Sends `reconnected` event with game state

### Frontend Changes

**Lobby Component (`components/Lobby.tsx`):**
- Stores `sessionId` and `roomId` in localStorage
- On mount, checks for stored session
- Automatically emits `reconnectRoom` if session exists
- Handles `reconnected` event to restore state
- Clears localStorage on voluntary quit

## User Experience

### Scenario 1: Accidental Reload
1. Player is in game
2. Accidentally hits F5 or reloads page
3. Page reloads → Auto-reconnects
4. Player back in game with same score
5. Chat shows "Player reconnected"

### Scenario 2: Network Hiccup
1. Player loses connection briefly
2. Reconnects within 5 minutes
3. Automatically rejoins room
4. Game continues seamlessly

### Scenario 3: Voluntary Quit
1. Player clicks "Quit" button
2. localStorage cleared
3. Session permanently removed
4. Player cannot rejoin
5. Must create new room or join different room

### Scenario 4: Long Disconnect
1. Player closes tab
2. Doesn't return for 10 minutes
3. Session expired (5 min timeout)
4. Cannot rejoin
5. Room may have been deleted or continued without them

## Configuration

```typescript
// SessionManager.ts
private readonly SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes
```

Adjust this value to change how long sessions remain valid after disconnect.

## Benefits

✅ **Better UX**: Players don't lose progress on accidental reload
✅ **Network Resilience**: Brief disconnects don't kick players out
✅ **Intentional Quit**: Voluntary quit still removes player permanently
✅ **Security**: Sessions expire after timeout
✅ **Host Continuity**: Host can reconnect and maintain ownership
✅ **Score Preservation**: Players keep their score on reconnect

## Testing Scenarios

1. **Reload Test**: Join game → Reload page → Should auto-reconnect
2. **Quit Test**: Join game → Click Quit → Reload → Should NOT reconnect
3. **Timeout Test**: Join game → Close tab → Wait 6 minutes → Reopen → Should NOT reconnect
4. **Quick Reconnect**: Join game → Close tab → Reopen immediately → Should reconnect
5. **Host Reconnect**: Create room → Reload → Should reconnect as host

## Files Changed

**Backend:**
- `src/services/SessionManager.ts` - Added reconnection and expiration logic
- `src/services/PlayerManager.ts` - Different handling for quit vs disconnect
- `src/handlers/roomHandlers.ts` - Added reconnectRoom handler

**Frontend:**
- `src/components/Lobby.tsx` - Added localStorage, reconnection logic, and event handlers
