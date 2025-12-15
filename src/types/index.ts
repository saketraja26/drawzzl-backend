export interface Player {
  id: string;
  name: string;
  score: number;
  isDrawer?: boolean;
  avatar?: number[];
  sessionId?: string; // Track session for reconnection
  isOnline?: boolean; // Track if player is currently connected
  disconnectedAt?: Date; // When player disconnected (for grace period)
}

export interface GameSettings {
  maxRounds: number;
  drawTime: number;
  wordCount: number;
  maxPlayers: number;
  customWords: string[];
  customWordProbability: number;
}

export interface RoomState {
  roomId: string;
  hostId: string; // Original room creator
  players: Player[];
  gameStarted: boolean;
  round: number;
  drawerIndex: number;
  currentWord?: string;
  correctGuessers: string[];
  chat: any[];
  turnEndsAt?: Date;
  roundPoints: Map<string, number>;
  revealedLetters: number[];
  settings: GameSettings;
}
