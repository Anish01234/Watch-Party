import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? true : "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Serve static files from the React app in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));

  // Handle React routing, return all requests to React app
  app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

// Room state management
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join a room
  socket.on('join_room', ({ roomId, username }) => {
    socket.join(roomId);

    // Initialize room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        playlist: [],
        currentIndex: 0,
        isPlaying: false,
        currentTime: 0,
        users: []
      });
    }

    const room = rooms.get(roomId);
    room.users.push({ id: socket.id, username });

    // Send current room state to the new user
    socket.emit('room_state', room);

    // Notify others in the room
    socket.to(roomId).emit('user_joined', { username, userCount: room.users.length });

    // Request sync from existing users to ensure new user gets exact time
    if (room.users.length > 1) {
      const existingUser = room.users.find(u => u.id !== socket.id);
      if (existingUser) {
        io.to(existingUser.id).emit('request_sync', { requesterId: socket.id });
      }
    }

    console.log(`${username} joined room ${roomId}`);
  });

  // Add video to playlist
  socket.on('add_to_playlist', ({ roomId, videoUrl }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.playlist.push(videoUrl);
      io.to(roomId).emit('playlist_updated', { playlist: room.playlist });
      console.log(`Video added to room ${roomId}:`, videoUrl);
    }
  });

  // Remove video from playlist
  socket.on('remove_from_playlist', ({ roomId, index }) => {
    const room = rooms.get(roomId);
    if (room && index >= 0 && index < room.playlist.length) {
      room.playlist.splice(index, 1);
      // Adjust currentIndex if needed
      if (room.currentIndex >= room.playlist.length && room.playlist.length > 0) {
        room.currentIndex = room.playlist.length - 1;
      }
      io.to(roomId).emit('playlist_updated', {
        playlist: room.playlist,
        currentIndex: room.currentIndex
      });
    }
  });

  // Change video
  socket.on('change_video', ({ roomId, index }) => {
    const room = rooms.get(roomId);
    if (room && index >= 0 && index < room.playlist.length) {
      room.currentIndex = index;
      room.currentTime = 0;
      room.isPlaying = true;
      io.to(roomId).emit('video_changed', {
        currentIndex: index,
        currentTime: 0,
        isPlaying: true
      });
      console.log(`Room ${roomId} changed to video ${index}`);
    }
  });

  // Sync playback actions
  socket.on('sync_action', ({ roomId, action, data }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    switch (action) {
      case 'play':
        room.isPlaying = true;
        socket.to(roomId).emit('sync_play', { currentTime: data.currentTime });
        break;
      case 'pause':
        room.isPlaying = false;
        socket.to(roomId).emit('sync_pause', { currentTime: data.currentTime });
        break;
      case 'seek':
        room.currentTime = data.currentTime;
        if (data.isPlaying !== undefined) {
          room.isPlaying = data.isPlaying;
        }
        socket.to(roomId).emit('sync_seek', { currentTime: data.currentTime, isPlaying: data.isPlaying });
        break;
    }
  });

  // Handle sync response from existing user
  socket.on('sync_response', ({ requesterId, currentTime, isPlaying }) => {
    io.to(requesterId).emit('sync_seek', { currentTime, isPlaying });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    // Remove user from all rooms
    rooms.forEach((room, roomId) => {
      const userIndex = room.users.findIndex(u => u.id === socket.id);
      if (userIndex !== -1) {
        const username = room.users[userIndex].username;
        room.users.splice(userIndex, 1);

        // Clean up empty rooms
        // Clean up empty rooms - DISABLED for development to persist state on refresh
        /*
        if (room.users.length === 0) {
          rooms.delete(roomId);
          console.log(`Room ${roomId} deleted (empty)`);
        } else {
          io.to(roomId).emit('user_left', { username, userCount: room.users.length });
        }
        */
        io.to(roomId).emit('user_left', { username, userCount: room.users.length });
      }
    });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
