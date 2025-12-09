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

// ---------------------------------------------------------------------
// Express & Socket.IO Setup
// ---------------------------------------------------------------------
const app = express();
app.use(cors());

// Health check endpoint
app.get('/health', (req, res) => {
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
});

// ---------------------------------------------------------------------
// Database Connection
// ---------------------------------------------------------------------
connectDB().catch((err: Error) => {
  console.error('DB connection failed:', err);
  process.exit(1);
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
// Server Start
// ---------------------------------------------------------------------
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`drawzzl backend running on port ${PORT}`);
});
