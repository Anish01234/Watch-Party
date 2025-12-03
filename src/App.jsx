import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

const SOCKET_URL = import.meta.env.PROD
  ? window.location.origin
  : 'http://localhost:3001';

const socket = io(SOCKET_URL);

function App() {
  const [joined, setJoined] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');

  const [playlist, setPlaylist] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [activeTab, setActiveTab] = useState('chat');
  const [users, setUsers] = useState([]);

  const videoRef = useRef(null);
  const youtubePlayerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const roomIdRef = useRef('');
  const usernameRef = useRef('');
  const isSyncingRef = useRef(false); // Prevent sync loops
  const currentVideoIdRef = useRef(null); // Track current YouTube video ID

  const currentVideoUrl = playlist[currentIndex];
  const isYouTube = currentVideoUrl && (currentVideoUrl.includes('youtube.com') || currentVideoUrl.includes('youtu.be'));

  // Socket listeners
  useEffect(() => {
    socket.on('connect', () => {
      console.log('Connected:', socket.id);
      if (roomIdRef.current && usernameRef.current) {
        socket.emit('join_room', { roomId: roomIdRef.current, username: usernameRef.current });
      }
    });

    socket.on('room_state', (data) => {
      console.log('Joined room:', data);
      setPlaylist(data.playlist);
      setCurrentIndex(data.currentIndex);
      setIsPlaying(data.isPlaying);
      setUsers(data.users || []);
      setMessages(data.messages.map(msg => ({
        username: msg.username,
        text: msg.message,
        timestamp: msg.timestamp
      })));
      setJoined(true);

      // Seek to current time if there is one
      if (data.currentTime && data.currentTime > 0) {
        setTimeout(() => {
          isSyncingRef.current = true;
          if (isYouTube && youtubePlayerRef.current) {
            youtubePlayerRef.current.seekTo(data.currentTime, true);
            if (data.isPlaying) {
              youtubePlayerRef.current.playVideo();
            }
          } else if (videoRef.current) {
            videoRef.current.currentTime = data.currentTime;
            if (data.isPlaying) {
              videoRef.current.play();
            }
          }
          setTimeout(() => { isSyncingRef.current = false; }, 500);
        }, 1000); // Wait for player to be ready
      }
    });

    socket.on('user_joined', ({ username: newUser, userCount, users: updatedUsers }) => {
      console.log(`${newUser} joined`);
      if (updatedUsers) setUsers(updatedUsers);
    });

    socket.on('user_left', ({ username: leftUser, userCount, users: updatedUsers }) => {
      console.log(`${leftUser} left`);
      if (updatedUsers) setUsers(updatedUsers);
    });

    socket.on('playlist_updated', (data) => {
      if (Array.isArray(data)) {
        setPlaylist(data);
      } else if (data.playlist) {
        setPlaylist(data.playlist);
        if (data.currentIndex !== undefined) setCurrentIndex(data.currentIndex);
      }
    });

    socket.on('video_changed', ({ currentIndex: index, isPlaying: playing }) => {
      setCurrentIndex(index);
      setIsPlaying(playing);
    });

    socket.on('sync_play', ({ currentTime }) => {
      isSyncingRef.current = true; // Mark as syncing to prevent loop
      setIsPlaying(true);
      if (isYouTube && youtubePlayerRef.current) {
        youtubePlayerRef.current.seekTo(currentTime, true);
        youtubePlayerRef.current.playVideo();
      } else if (videoRef.current) {
        videoRef.current.currentTime = currentTime;
        videoRef.current.play();
      }
      setTimeout(() => { isSyncingRef.current = false; }, 500);
    });

    socket.on('sync_pause', ({ currentTime }) => {
      isSyncingRef.current = true; // Mark as syncing to prevent loop
      setIsPlaying(false);
      if (isYouTube && youtubePlayerRef.current) {
        youtubePlayerRef.current.seekTo(currentTime, true);
        youtubePlayerRef.current.pauseVideo();
      } else if (videoRef.current) {
        videoRef.current.currentTime = currentTime;
        videoRef.current.pause();
      }
      setTimeout(() => { isSyncingRef.current = false; }, 500);
    });

    socket.on('sync_seek', ({ currentTime, isPlaying: shouldPlay }) => {
      isSyncingRef.current = true;
      if (isYouTube && youtubePlayerRef.current) {
        youtubePlayerRef.current.seekTo(currentTime, true);
        if (shouldPlay) {
          youtubePlayerRef.current.playVideo();
        } else if (shouldPlay === false) {
          youtubePlayerRef.current.pauseVideo();
        }
      } else if (videoRef.current) {
        videoRef.current.currentTime = currentTime;
        if (shouldPlay) {
          videoRef.current.play();
        } else if (shouldPlay === false) {
          videoRef.current.pause();
        }
      }
      if (shouldPlay !== undefined) setIsPlaying(shouldPlay);
      setTimeout(() => { isSyncingRef.current = false; }, 500);
    });

    // Handle sync request from new user
    socket.on('request_sync', ({ requesterId }) => {
      let currentTime = 0;
      if (isYouTube && youtubePlayerRef.current) {
        currentTime = youtubePlayerRef.current.getCurrentTime();
      } else if (videoRef.current) {
        currentTime = videoRef.current.currentTime;
      }
      socket.emit('sync_response', { requesterId, currentTime, isPlaying });
    });

    socket.on('chat_message', (message) => {
      setMessages((prev) => [...prev, {
        username: message.username,
        text: message.message,
        timestamp: message.timestamp
      }]);
    });

    return () => {
      socket.off('connect');
      socket.off('room_state');
      socket.off('playlist_updated');
      socket.off('video_changed');
      socket.off('sync_play');
      socket.off('sync_pause');
      socket.off('sync_seek');
      socket.off('chat_message');
    };
  }, [isYouTube]);

  // Load YouTube API
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }
  }, []);

  // Initialize YouTube player - ONLY when video ID actually changes
  useEffect(() => {
    if (isYouTube && currentVideoUrl && window.YT && window.YT.Player) {
      const videoId = extractYouTubeId(currentVideoUrl);

      // Only recreate if video ID changed
      if (videoId && videoId !== currentVideoIdRef.current) {
        console.log('Creating YouTube player for:', videoId);
        currentVideoIdRef.current = videoId;

        // Destroy old player
        if (youtubePlayerRef.current) {
          youtubePlayerRef.current.destroy();
        }

        // Create new player
        youtubePlayerRef.current = new window.YT.Player('youtube-player', {
          videoId: videoId,
          playerVars: {
            autoplay: 0,
            controls: 1,
            playsinline: 1
          },
          events: {
            onReady: (event) => {
              // If video should be playing when user joins, start it
              if (isPlaying) {
                event.target.playVideo();
              }
            },
            onStateChange: (event) => {
              if (isSyncingRef.current) return; // Don't emit if we're syncing

              if (event.data === window.YT.PlayerState.PLAYING) {
                const currentTime = youtubePlayerRef.current.getCurrentTime();
                setIsPlaying(true);
                socket.emit('sync_action', { roomId, action: 'play', data: { currentTime } });
              } else if (event.data === window.YT.PlayerState.PAUSED) {
                const currentTime = youtubePlayerRef.current.getCurrentTime();
                setIsPlaying(false);
                socket.emit('sync_action', { roomId, action: 'pause', data: { currentTime } });
              }
            }
          }
        });
      }
    } else if (!isYouTube) {
      // Clear video ID ref when switching to non-YouTube
      currentVideoIdRef.current = null;
    }
  }, [currentVideoUrl, isYouTube, roomId, isPlaying]);

  // Auto-play MP4 videos if they should be playing when user joins
  useEffect(() => {
    if (!isYouTube && videoRef.current && currentVideoUrl && isPlaying) {
      videoRef.current.play().catch(e => console.log('Auto-play prevented:', e));
    }
  }, [currentVideoUrl, isYouTube, isPlaying]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const extractYouTubeId = (url) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (roomId && username) {
      roomIdRef.current = roomId;
      usernameRef.current = username;
      socket.emit('join_room', { roomId, username });
    }
  };

  const handleAddVideo = (e) => {
    e.preventDefault();
    if (videoUrl) {
      socket.emit('add_to_playlist', { roomId, videoUrl });
      setVideoUrl('');
    }
  };

  const handleChangeVideo = (index) => {
    socket.emit('change_video', { roomId, index });
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (newMessage.trim()) {
      socket.emit('send_message', { roomId, username, message: newMessage });
      setNewMessage('');
    }
  };

  const handleVideoPlay = () => {
    if (isSyncingRef.current) return; // Don't emit if we're syncing from another user
    const currentTime = videoRef.current ? videoRef.current.currentTime : 0;
    setIsPlaying(true);
    socket.emit('sync_action', { roomId, action: 'play', data: { currentTime } });
  };

  const handleVideoPause = () => {
    if (isSyncingRef.current) return; // Don't emit if we're syncing from another user
    const currentTime = videoRef.current ? videoRef.current.currentTime : 0;
    setIsPlaying(false);
    socket.emit('sync_action', { roomId, action: 'pause', data: { currentTime } });
  };

  if (!joined) {
    return (
      <div className="join-screen">
        <div className="join-card glass">
          <h1 className="gradient-text">Watch Party</h1>
          <p className="subtitle">Watch videos in perfect sync with friends</p>
          <form onSubmit={handleJoinRoom}>
            <div className="form-group">
              <label>Username</label>
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
                placeholder="Enter room name"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary">Join Room</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header glass">
        <div className="logo">
          <h2 className="gradient-text">Watch Party</h2>
        </div>
        <div className="header-info">
          <span className="room-badge">Room: {roomId}</span>
          <span className="user-badge">👥 {users.length} {users.length === 1 ? 'User' : 'Users'}</span>
          <span className="user-badge" title={users.map(u => u.username).join(', ')}>
            You: {username}
          </span>
        </div>
      </header>

      <main className="main-content">
        <div className="player-section">
          <div className="player-wrapper">
            {currentVideoUrl ? (
              <div className="player-container">
                {isYouTube ? (
                  <div id="youtube-player" style={{ width: '100%', height: '100%' }}></div>
                ) : (
                  <video
                    ref={videoRef}
                    src={currentVideoUrl}
                    controls
                    style={{ width: '100%', height: '100%', backgroundColor: '#000' }}
                    onPlay={handleVideoPlay}
                    onPause={handleVideoPause}
                    playsInline
                    crossOrigin="anonymous"
                  />
                )}
              </div>
            ) : (
              <div className="empty-player">
                <div className="empty-icon">📺</div>
                <p>Add a video to start watching</p>
              </div>
            )}
          </div>

          <div className="controls glass">
            <div className="video-info">
              {currentVideoUrl ? (
                <span>Now Playing: <span className="gradient-text">{currentVideoUrl}</span></span>
              ) : (
                <span>No video selected</span>
              )}
            </div>
            <div style={{ fontSize: '10px', color: '#aaa' }}>
              State: {isPlaying ? 'PLAYING' : 'PAUSED'} | Index: {currentIndex} | Type: {isYouTube ? 'YouTube' : 'MP4'}
            </div>
          </div>
        </div>

        <aside className="sidebar glass">
          <div className="tabs">
            <button
              className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              Chat
            </button>
            <button
              className={`tab-btn ${activeTab === 'playlist' ? 'active' : ''}`}
              onClick={() => setActiveTab('playlist')}
            >
              Playlist
            </button>
          </div>

          {activeTab === 'chat' ? (
            <div className="chat-section">
              <div className="messages-list">
                {messages.map((msg, idx) => (
                  <div key={idx} className={`message ${msg.username === username ? 'own' : ''}`}>
                    <div className="message-header">
                      <span>{msg.username}</span>
                      <span>{msg.timestamp}</span>
                    </div>
                    <div className="message-content">{msg.text}</div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
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
                  placeholder="Paste video URL"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                />
                <button type="submit" className="btn btn-primary">+ Add</button>
              </form>
              <div className="playlist-items">
                {playlist.map((url, idx) => (
                  <div
                    key={idx}
                    className={`playlist-item ${idx === currentIndex ? 'active' : ''}`}
                  >
                    <div className="playlist-item-info" onClick={() => handleChangeVideo(idx)}>
                      <span className="playlist-number">{idx + 1}</span>
                      <div style={{ overflow: 'hidden' }}>
                        <div className="playlist-url" title={url}>{url}</div>
                        {idx === currentIndex && <div className="now-playing">Now Playing</div>}
                      </div>
                    </div>
                  </div>
                ))}
                {playlist.length === 0 && (
                  <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>
                    Playlist is empty
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

export default App;
