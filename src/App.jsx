import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import ReactPlayer from 'react-player';
import './App.css';

// Use production URL in production, localhost in development
const socket = io(import.meta.env.PROD ? window.location.origin : 'http://localhost:3001');

function App() {
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');
  const [joined, setJoined] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const [playlist, setPlaylist] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userCount, setUserCount] = useState(1);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' or 'playlist'
  const [isPlaying, setIsPlaying] = useState(false);

  const videoRef = useRef(null);
  const isSyncingRef = useRef(false);

  useEffect(() => {
    socket.on('room_state', (state) => {
      console.log('Room state:', state);
      setPlaylist(state.playlist || []);
      setCurrentIndex(state.currentIndex || 0);
      setUserCount(state.users.length);
      setMessages(state.messages || []); // Load existing messages
      setIsPlaying(state.isPlaying || false); // Set initial playing state

      // Sync initial playback state
      if (videoRef.current && state.isPlaying) {
        videoRef.current.seekTo(state.currentTime || 0);
      }
    });

    socket.on('playlist_updated', ({ playlist: newPlaylist, currentIndex: newIndex }) => {
      console.log('Playlist updated:', newPlaylist);
      setPlaylist(newPlaylist || []);
      if (newIndex !== undefined) {
        setCurrentIndex(newIndex);
      }
    });

    socket.on('video_changed', ({ currentIndex: newIndex, currentTime, isPlaying }) => {
      console.log('Video changed:', newIndex);
      setCurrentIndex(newIndex);
      setIsPlaying(isPlaying || false); // Set playing state from server
      if (videoRef.current) {
        videoRef.current.seekTo(currentTime || 0);
      }
    });

    socket.on('sync_play', ({ currentTime }) => {
      console.log('Sync play at:', currentTime);
      if (videoRef.current && !isSyncingRef.current) {
        isSyncingRef.current = true;
        videoRef.current.seekTo(currentTime);
        setIsPlaying(true);
        setTimeout(() => { isSyncingRef.current = false; }, 500);
      }
    });

    socket.on('sync_pause', ({ currentTime }) => {
      console.log('Sync pause at:', currentTime);
      if (videoRef.current && !isSyncingRef.current) {
        isSyncingRef.current = true;
        videoRef.current.seekTo(currentTime);
        setIsPlaying(false);
        setTimeout(() => { isSyncingRef.current = false; }, 500);
      }
    });

    socket.on('sync_seek', ({ currentTime, isPlaying }) => {
      console.log('Sync seek to:', currentTime, 'isPlaying:', isPlaying);
      if (videoRef.current && !isSyncingRef.current) {
        isSyncingRef.current = true;
        videoRef.current.seekTo(currentTime);
        setIsPlaying(isPlaying);
        setTimeout(() => { isSyncingRef.current = false; }, 500);
      }
    });

    socket.on('user_joined', ({ username: newUser, userCount: count }) => {
      console.log('User joined:', newUser);
      setUserCount(count);
    });

    socket.on('request_sync', ({ requesterId }) => {
      console.log('Received sync request from:', requesterId);
      if (videoRef.current) {
        const currentTime = videoRef.current.getCurrentTime();
        // We need to use the state variable for isPlaying since we control it
        socket.emit('sync_response', { requesterId, currentTime, isPlaying });
      }
    });

    socket.on('user_left', ({ username: leftUser, userCount: count }) => {
      console.log('User left:', leftUser);
      setUserCount(count);
    });

    socket.on('chat_message', (message) => {
      setMessages((prev) => [...prev, message]);
    });

    return () => {
      socket.off('room_state');
      socket.off('playlist_updated');
      socket.off('video_changed');
      socket.off('sync_play');
      socket.off('sync_pause');
      socket.off('sync_seek');
      socket.off('request_sync');
      socket.off('user_joined');
      socket.off('user_left');
      socket.off('chat_message');
    };
  }, []);

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (newMessage.trim()) {
      socket.emit('send_message', { roomId, message: newMessage, username });
      setNewMessage('');
    }
  };

  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (roomId.trim() && username.trim()) {
      console.log('Joining room:', roomId);
      socket.emit('join_room', { roomId, username });
      setJoined(true);
    }
  };

  const handleAddVideo = (e) => {
    e.preventDefault();
    if (videoUrl.trim()) {
      console.log('Adding video:', videoUrl);
      socket.emit('add_to_playlist', { roomId, videoUrl });
      setVideoUrl('');
    }
  };

  const handleRemoveVideo = (index) => {
    socket.emit('remove_from_playlist', { roomId, index });
  };

  const handleChangeVideo = (index) => {
    socket.emit('change_video', { roomId, index });
  };

  const handleNext = () => {
    if (currentIndex < playlist.length - 1) {
      handleChangeVideo(currentIndex + 1);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      handleChangeVideo(currentIndex - 1);
    }
  };

  const handlePlay = () => {
    if (!isSyncingRef.current) {
      setIsPlaying(true);
      const currentTime = videoRef.current ? videoRef.current.getCurrentTime() : 0;
      socket.emit('sync_action', { roomId, action: 'play', data: { currentTime } });
    }
  };

  const handlePause = () => {
    if (!isSyncingRef.current) {
      setIsPlaying(false);
      const currentTime = videoRef.current ? videoRef.current.getCurrentTime() : 0;
      socket.emit('sync_action', { roomId, action: 'pause', data: { currentTime } });
    }
  };

  const handleSeek = (seconds) => {
    if (!isSyncingRef.current) {
      // isPlaying state is already up to date
      socket.emit('sync_action', { roomId, action: 'seek', data: { currentTime: seconds, isPlaying } });
    }
  };

  const forcePlay = () => {
    if (!currentVideoUrl) return;
    setIsPlaying(true);
    const currentTime = videoRef.current ? videoRef.current.getCurrentTime() : 0;
    socket.emit('sync_action', { roomId, action: 'play', data: { currentTime } });
  };

  if (!joined) {
    return (
      <div className="join-screen">
        <div className="join-card glass">
          <h1 className="gradient-text">Watch Party</h1>
          <p className="subtitle">Watch videos together in perfect sync</p>

          <form onSubmit={handleJoinRoom}>
            <div className="form-group">
              <label>Your Name</label>
              <input
                type="text"
                className="input"
                placeholder="Enter your name"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>Room ID</label>
              <input
                type="text"
                className="input"
                placeholder="Enter or create a room ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="btn btn-primary">
              Join Room
            </button>
          </form>
        </div>
      </div>
    );
  }

  const currentVideoUrl = playlist[currentIndex];

  return (
    <div className="app">
      <header className="header glass">
        <h2 className="gradient-text">Watch Party</h2>
        <div className="header-info">
          <span className="room-badge">Room: {roomId}</span>
          <span className="user-badge">{userCount} {userCount === 1 ? 'user' : 'users'} online</span>
        </div>
      </header>

      <div className="main-content">
        <div className="player-section">
          <div className="player-wrapper">
            {currentVideoUrl ? (
              <ReactPlayer
                ref={videoRef}
                url={currentVideoUrl}
                playing={isPlaying}
                controls={true}
                width="100%"
                height="100%"
                onReady={() => {
                  console.log('Player ready:', currentVideoUrl);
                }}
                onProgress={({ playedSeconds }) => {
                  // Track progress for sync
                }}
                onError={(e) => console.error('Video error:', e)}
                config={{
                  youtube: {
                    playerVars: {
                      showinfo: 1,
                      modestbranding: 1,
                      rel: 0,
                      autoplay: 0
                    }
                  },
                  file: {
                    attributes: {
                      crossOrigin: "anonymous"
                    }
                  }
                }}
              />
            ) : (
              <div className="empty-player">
                <div className="empty-icon">🎬</div>
                <p>Add a video to get started</p>
                <p className="hint">Supports YouTube, Twitch, MP4, and more</p>
              </div>
            )}
          </div>

          <div className="controls glass">
            <button
              className="btn btn-secondary"
              onClick={handlePrevious}
              disabled={currentIndex === 0}
            >
              ⏮ Previous
            </button>

            <button
              className="btn btn-primary"
              onClick={forcePlay}
              disabled={!currentVideoUrl}
              style={{ fontSize: '18px', padding: '12px 24px' }}
            >
              ▶ PLAY VIDEO
            </button>

            <span className="video-info">
              {playlist.length > 0 ? `Video ${currentIndex + 1} of ${playlist.length}` : 'No videos'}
            </span>

            <button
              className="btn btn-secondary"
              onClick={handleNext}
              disabled={currentIndex >= playlist.length - 1}
            >
              Next ⏭
            </button>
          </div>
        </div>

        <div className="sidebar glass">
          <div className="tabs">
            <button
              className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              💬 Chat
            </button>
            <button
              className={`tab-btn ${activeTab === 'playlist' ? 'active' : ''}`}
              onClick={() => setActiveTab('playlist')}
            >
              📺 Playlist
            </button>
          </div>

          {activeTab === 'chat' ? (
            <div className="chat-section">
              <div className="messages-list">
                {messages.length === 0 ? (
                  <div className="empty-chat">
                    <p>No messages yet</p>
                    <p className="hint">Say hello!</p>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div key={msg.id} className={`message ${msg.username === username ? 'own' : ''}`}>
                      <div className="message-header">
                        <span className="username">{msg.username}</span>
                        <span className="timestamp">{msg.timestamp}</span>
                      </div>
                      <div className="message-content">{msg.message}</div>
                    </div>
                  ))
                )}
              </div>
              <form onSubmit={handleSendMessage} className="chat-form">
                <input
                  type="text"
                  className="input"
                  placeholder="Type a message..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                />
                <button type="submit" className="btn btn-primary">Send</button>
              </form>
            </div>
          ) : (
            <div className="playlist-section">
              <form onSubmit={handleAddVideo} className="add-video-form">
                <input
                  type="text"
                  className="input"
                  placeholder="Paste video URL (YouTube, MP4, etc.)"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                />
                <button type="submit" className="btn btn-primary">
                  + Add
                </button>
              </form>

              <div className="playlist-items">
                {playlist.length === 0 ? (
                  <div className="empty-playlist">
                    <p>No videos in playlist</p>
                    <p className="hint">Add a video URL above</p>
                  </div>
                ) : (
                  playlist.map((url, index) => (
                    <div
                      key={`${url}-${index}`}
                      className={`playlist-item ${index === currentIndex ? 'active' : ''}`}
                    >
                      <div className="playlist-item-info" onClick={() => handleChangeVideo(index)}>
                        <span className="playlist-number">{index + 1}</span>
                        <span className="playlist-url" title={url}>{url}</span>
                        {index === currentIndex && <span className="now-playing">▶ Playing</span>}
                      </div>
                      <button
                        className="btn-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveVideo(index);
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
