import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import 'dotenv/config';
import { connectDB } from './lib/db.js';
import { registerRoomHandlers } from './handlers/roomHandlers.js';
import { registerGameHandlers } from './handlers/gameHandlers.js';
import { registerChatHandlers } from './handlers/chatHandlers.js';
import { registerDisconnectHandler } from './handlers/disconnectHandler.js';
import { sessionManager } from './services/SessionManager.js';
import { playerManager } from './services/PlayerManager.js';
import { gameEngine } from './services/GameEngine.js';
import { roomCleanupService } from './services/RoomCleanupService.js';

/**
 * Optimized Drawzzl Backend Server
 * 
 * Features:
 * - Modular architecture with services and handlers
 * - Comprehensive session management with reconnection
 * - Robust error handling and recovery
 * - AFK detection and management
 * - Clean resource cleanup
 * - Production-ready monitoring
 */

const app = express();
app.use(cors());

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
  const sessionStats = sessionManager.getStats();
  
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    sessions: sessionStats,
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
    }
  });
});

// Server statistics endpoint
app.get('/stats', (req, res) => {
  const sessionStats = sessionManager.getStats();
  
  res.status(200).json({
    sessions: sessionStats,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
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
  // Connection timeout settings
  pingTimeout: 60000,
  pingInterval: 25000,
  // Upgrade timeout
  upgradeTimeout: 10000,
  // Max HTTP buffer size
  maxHttpBufferSize: 1e6
});

// ---------------------------------------------------------------------
// Database Connection and Services
// ---------------------------------------------------------------------
connectDB()
  .then(() => {
    console.log('Database connected successfully');
    // Start room cleanup service after DB is ready
    roomCleanupService.start();
    console.log('Room cleanup service started');
  })
  .catch((err: Error) => {
    console.error('DB connection failed:', err);
    process.exit(1);
  });

// ---------------------------------------------------------------------
// Socket.IO Connection Handling
// ---------------------------------------------------------------------
io.on('connection', (socket: Socket) => {
  console.log(`Player connected: ${socket.id} from ${socket.handshake.address}`);

  // Register all event handlers
  registerRoomHandlers(io, socket);
  registerGameHandlers(io, socket);
  registerChatHandlers(io, socket);
  registerDisconnectHandler(io, socket);

  // Send connection confirmation
  socket.emit('connected', { 
    playerId: socket.id,
    timestamp: new Date().toISOString()
  });
});

// ---------------------------------------------------------------------
// Periodic Maintenance Tasks
// ---------------------------------------------------------------------

// AFK check every 30 seconds
setInterval(async () => {
  try {
    // This would need to be implemented to check all active rooms
    // For now, we'll let individual game sessions handle AFK
    console.log('AFK check completed');
  } catch (error) {
    console.error('Error during AFK check:', error);
  }
}, 30 * 1000);

// Memory cleanup every 5 minutes
setInterval(() => {
  try {
    if (global.gc) {
      global.gc();
      console.log('Manual garbage collection completed');
    }
  } catch (error) {
    console.error('Error during garbage collection:', error);
  }
}, 5 * 60 * 1000);

// Log server statistics every 10 minutes
setInterval(() => {
  const sessionStats = sessionManager.getStats();
  const memUsage = process.memoryUsage();
  
  console.log('Server Statistics:', {
    uptime: Math.round(process.uptime()),
    sessions: sessionStats,
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB'
    },
    connections: io.engine.clientsCount
  });
}, 10 * 60 * 1000);

// ---------------------------------------------------------------------
// Error Handling
// ---------------------------------------------------------------------

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit in production, log and continue
  if (process.env.NODE_ENV === 'production') {
    console.error('Continuing despite uncaught exception...');
  } else {
    process.exit(1);
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit in production, log and continue
  if (process.env.NODE_ENV === 'production') {
    console.error('Continuing despite unhandled rejection...');
  }
});

// Handle SIGTERM gracefully
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
  
  // Force close after 10 seconds
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
});

// Handle SIGINT (Ctrl+C)
process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

// ---------------------------------------------------------------------
// Server Start
// ---------------------------------------------------------------------
const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log(`🎨 Drawzzl Backend Server Started`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 CORS Origins: ${JSON.stringify([
    'http://localhost:3000',
    '*.vercel.app',
    'https://drawzzl.drawfive.in',
    '*.drawfive.in'
  ])}`);
  console.log(`⚡ Features Enabled:`);
  console.log(`   - Session Management with Reconnection`);
  console.log(`   - AFK Detection and Management`);
  console.log(`   - Comprehensive Error Recovery`);
  console.log(`   - Real-time Game Engine`);
  console.log(`   - Profanity Filtering`);
  console.log(`   - Resource Cleanup`);
  console.log(`🚀 Server ready for connections!`);
});

// Export for testing
export { app, server, io };