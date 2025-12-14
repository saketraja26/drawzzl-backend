import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import 'dotenv/config';
import { connectDB } from './lib/db.js';
import { registerRoomHandlers } from './handlers/roomHandlers.js';
import { registerGameHandlers } from './handlers/gameHandlers.js';
import { registerChatHandlers } from './handlers/chatHandlers.js';
import { registerDisconnectHandler } from './handlers/disconnectHandler.js';
import { roomCleanupService } from './services/RoomCleanupService.js';

// ---------------------------------------------------------------------
// Express & Socket.IO Setup
// ---------------------------------------------------------------------
const app = express();
app.use(cors());

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime() 
  });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { 
    origin: [
      'http://localhost:3000',
      /\.vercel\.app$/, // Allow all Vercel deployments
      'https://drawzzl.drawfive.in',
      /\.drawfive\.in$/ // Allow all drawfive.in subdomains
    ],
    credentials: true 
  },
  cookie: {
    name: 'drawzzl_session',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  },
  // Mobile stability settings - prevent disconnects when screen turns off
  pingTimeout: 60000, // 60 seconds
  pingInterval: 25000  // 25 seconds
});

// ---------------------------------------------------------------------
// Socket.IO Connection Handler
// ---------------------------------------------------------------------
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // Register all handlers
  registerRoomHandlers(io, socket);
  registerGameHandlers(io, socket);
  registerChatHandlers(io, socket);
  registerDisconnectHandler(io, socket);
});

// ---------------------------------------------------------------------
// Server Startup Function
// ---------------------------------------------------------------------
async function startServer() {
  try {
    // Wait for database connection to complete
    console.log('Connecting to database...');
    await connectDB();
    console.log('Database connected successfully');

    // Start room cleanup service only after DB is ready
    console.log('Starting room cleanup service...');
    roomCleanupService.start();

    // Start the server
    const PORT = process.env.PORT || 4000;
    server.listen(PORT, () => {
      console.log(`drawzzl backend running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------
// Start the application
// ---------------------------------------------------------------------
startServer();
