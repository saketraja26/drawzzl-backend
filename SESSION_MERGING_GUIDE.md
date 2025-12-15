# Session Merging Implementation Guide

## Overview
The session merging feature prevents duplicate players when a disconnected user rejoins a room using the same name. Instead of creating a new player entry, the system merges the new connection with the existing disconnected session.

## How It Works

### 1. Join Room Flow
When a player attempts to join a room:

1. **Duplicate Socket Check**: Prevents the same socket from joining multiple times
2. **Existing Session Search**: Looks for disconnected players with the same name
3. **Session Merge vs New Join**: Decides whether to merge or create new player

### 2. Session Merge Path (Reconnection)
If an existing disconnected player is found:
- Reconnects the existing session with the new socket ID
- Updates player status to online
- Clears disconnect timestamp
- Cancels rejoin timers
- Preserves player score and game state
- Broadcasts "reconnected" message

### 3. New Join Path
If no existing session is found:
- Creates a new session and player entry
- Adds player to room (if not full)
- Broadcasts "joined" message

## Edge Cases Handled

### Multiple Disconnected Sessions
If a player has multiple disconnected sessions (rare edge case):
- Selects the most recently disconnected session
- Merges with that session
- Other orphaned sessions will be cleaned up by timers

### Duplicate Prevention
- Socket-level duplicate prevention
- Name-based duplicate cleanup
- Session ID duplicate cleanup

### Race Conditions
- Atomic database operations
- Proper error handling for failed reconnections
- Fallback to new join if session merge fails

## Key Benefits

1. **No Ghost Players**: Disconnected players don't accumulate in the lobby
2. **Preserved Game State**: Players keep their scores and drawer status
3. **Seamless UX**: Users can rejoin without losing progress
4. **Host Persistence**: Original host remains host even after disconnects

## Logging
The system provides detailed logging for debugging:
- `✅ SESSION MERGE SUCCESS`: Successful reconnection
- `✅ NEW PLAYER JOIN`: New player added
- `🧹 DUPLICATE CLEANUP`: Duplicate removal
- Session IDs and player counts for tracking

## Testing Scenarios

1. **Basic Reconnect**: Player disconnects and rejoins with same name
2. **Host Reconnect**: Host disconnects and rejoins (should remain host)
3. **Multiple Disconnects**: Same player disconnects/reconnects multiple times
4. **Rapid Reconnects**: Player reconnects quickly before grace period expires
5. **Expired Session**: Player tries to rejoin after grace period (should create new)

## Configuration

- **Grace Period**: 3 minutes for player rejoin
- **Room Deletion**: 30 seconds after all players disconnect
- **Session Timeout**: Handled by SessionManager