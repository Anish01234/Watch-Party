import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
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

  const videoRef = useRef(null);

  useEffect(() => {
    socket.on('room_state', (state) => {
      console.log('Room state:', state);
      setPlaylist(state.playlist || []);
      setCurrentIndex(state.currentIndex || 0);
      setUserCount(state.users.length);
    });

    socket.on('playlist_updated', ({ playlist: newPlaylist, currentIndex: newIndex }) => {
      console.log('Playlist updated:', newPlaylist);
      setPlaylist(newPlaylist || []);
      if (newIndex !== undefined) {
        setCurrentIndex(newIndex);
      }
    });

    socket.on('video_changed', ({ currentIndex: newIndex }) => {
      console.log('Video changed:', newIndex);
      setCurrentIndex(newIndex);
    });

    socket.on('user_joined', ({ username: newUser, userCount: count }) => {
      console.log('User joined:', newUser);
      setUserCount(count);
    });

    socket.on('user_left', ({ username: leftUser, userCount: count }) => {
      console.log('User left:', leftUser);
      setUserCount(count);
    });

    return () => {
      socket.off('room_state');
      socket.off('playlist_updated');
      socket.off('video_changed');
      socket.off('user_joined');
      socket.off('user_left');
    };
  }, []);

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

  const forcePlay = () => {
    if (videoRef.current) {
      videoRef.current.play().catch(err => console.error('Play failed:', err));
    }
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
  const isDirectVideo = currentVideoUrl && (currentVideoUrl.endsWith('.mp4') || currentVideoUrl.endsWith('.webm') || currentVideoUrl.endsWith('.ogg'));

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
              isDirectVideo ? (
                <video
                  ref={videoRef}
                  src={currentVideoUrl}
                  controls
                  style={{ width: '100%', height: '100%', background: '#000' }}
                  onError={(e) => console.error('Video error:', e)}
                />
              ) : (
                <div className="empty-player">
                  <div className="empty-icon">⚠️</div>
                  <p>YouTube videos are not supported</p>
                  <p className="hint">Please use direct video links (.mp4, .webm)</p>
                </div>
              )
            ) : (
              <div className="empty-player">
                <div className="empty-icon">🎬</div>
                <p>Add a video to get started</p>
                <p className="hint">Use direct video links (.mp4, .webm)</p>
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
              disabled={!isDirectVideo}
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

        <div className="playlist-section glass">
          <h3>Playlist</h3>

          <form onSubmit={handleAddVideo} className="add-video-form">
            <input
              type="text"
              className="input"
              placeholder="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
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
                <p className="hint">Add a direct video URL (.mp4) above</p>
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
                    {index === currentIndex && <span className="now-playing">▶ Now Playing</span>}
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
      </div>
    </div>
  );
}

export default App;
