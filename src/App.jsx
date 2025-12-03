import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

const SOCKET_URL = import.meta.env.PROD
  ? window.location.origin
  : 'http://localhost:3001';

const socket = io(SOCKET_URL);

const extractYouTubeId = (url) => {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
};

const VideoPlayer = ({ stream }) => {
  const videoRef = useRef(null);
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);
  return <video ref={videoRef} autoPlay playsInline />;
};

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
  const isPlayingRef = useRef(false); // Track playing state for refs
  const isYouTubeRef = useRef(false); // Track YouTube state for refs

  const currentVideoUrl = playlist[currentIndex];
  const isYouTube = currentVideoUrl && (currentVideoUrl.includes('youtube.com') || currentVideoUrl.includes('youtu.be'));

  // Update refs when state changes
  useEffect(() => {
    isPlayingRef.current = isPlaying;
    isYouTubeRef.current = isYouTube;
  }, [isPlaying, isYouTube]);

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
          if (isYouTubeRef.current && youtubePlayerRef.current) {
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

    socket.on('user_joined', async ({ username: newUser, users: updatedUsers }) => {
      console.log(`${newUser} joined`);
      if (updatedUsers) setUsers(updatedUsers);

      // Initiate WebRTC call to new user
      updatedUsers.forEach(async (user) => {
        if (user.id !== socket.id && !peersRef.current[user.id]) {
          const peer = createPeer(user.id, true);
          peersRef.current[user.id] = { peer };

          try {
            const offer = await peer.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
            await peer.setLocalDescription(offer);
            socket.emit('offer', { offer, target: user.id, callerId: socket.id });
          } catch (err) {
            console.error('Error creating offer:', err);
          }
        }
      });
    });

    socket.on('user_left', ({ username: leftUser, users: updatedUsers }) => {
      console.log(`${leftUser} left`);
      if (updatedUsers) setUsers(updatedUsers);

      const currentIds = updatedUsers.map(u => u.id);

      // Cleanup peers
      Object.keys(peersRef.current).forEach(peerId => {
        if (!currentIds.includes(peerId)) {
          if (peersRef.current[peerId].peer) {
            peersRef.current[peerId].peer.close();
          }
          delete peersRef.current[peerId];
        }
      });

      // Cleanup streams - Force remove any stream not in currentIds
      setRemoteStreams(prev => prev.filter(s => currentIds.includes(s.id)));
    });

    // WebRTC Signaling Listeners
    socket.on('offer', async ({ offer, callerId }) => {
      let peerObj = peersRef.current[callerId];
      let peer;

      if (peerObj) {
        peer = peerObj.peer;
      } else {
        peer = createPeer(callerId);
        peersRef.current[callerId] = { peer };
      }

      try {
        await peer.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit('answer', { answer, target: callerId, callerId: socket.id });
      } catch (err) {
        console.error('Error handling offer:', err);
      }
    });

    socket.on('answer', async ({ answer, callerId }) => {
      const peerObj = peersRef.current[callerId];
      if (peerObj && peerObj.peer) {
        try {
          await peerObj.peer.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (err) {
          console.error('Error handling answer:', err);
        }
      }
    });

    socket.on('ice-candidate', async ({ candidate, callerId }) => {
      const peerObj = peersRef.current[callerId];
      if (peerObj && peerObj.peer) {
        try {
          await peerObj.peer.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error('Error adding ice candidate:', err);
        }
      }
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
      isPlayingRef.current = playing;
    });

    socket.on('sync_play', ({ currentTime }) => {
      const timeDiff = Math.abs((youtubePlayerRef.current ? youtubePlayerRef.current.getCurrentTime() : videoRef.current ? videoRef.current.currentTime : 0) - currentTime);

      if (isPlayingRef.current && timeDiff < 2) {
        return; // Already playing and synced, ignore
      }

      isSyncingRef.current = true;
      setIsPlaying(true);
      isPlayingRef.current = true;

      if (isYouTubeRef.current && youtubePlayerRef.current) {
        if (timeDiff >= 2) youtubePlayerRef.current.seekTo(currentTime, true);
        youtubePlayerRef.current.playVideo();
      } else if (videoRef.current) {
        if (timeDiff >= 2) videoRef.current.currentTime = currentTime;
        videoRef.current.play();
      }
      setTimeout(() => { isSyncingRef.current = false; }, 1000);
    });

    socket.on('sync_pause', ({ currentTime }) => {
      const timeDiff = Math.abs((youtubePlayerRef.current ? youtubePlayerRef.current.getCurrentTime() : videoRef.current ? videoRef.current.currentTime : 0) - currentTime);

      if (!isPlayingRef.current && timeDiff < 2) {
        return; // Already paused and synced, ignore
      }

      isSyncingRef.current = true;
      setIsPlaying(false);
      isPlayingRef.current = false;

      if (isYouTubeRef.current && youtubePlayerRef.current) {
        youtubePlayerRef.current.seekTo(currentTime, true);
        youtubePlayerRef.current.pauseVideo();
      } else if (videoRef.current) {
        videoRef.current.currentTime = currentTime;
        videoRef.current.pause();
      }
      setTimeout(() => { isSyncingRef.current = false; }, 1000);
    });

    socket.on('sync_seek', ({ currentTime, isPlaying: shouldPlay }) => {
      isSyncingRef.current = true;
      if (isYouTubeRef.current && youtubePlayerRef.current) {
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
      if (shouldPlay !== undefined) {
        setIsPlaying(shouldPlay);
        isPlayingRef.current = shouldPlay;
      }
      setTimeout(() => { isSyncingRef.current = false; }, 1000);
    });

    // Handle sync request from new user
    socket.on('request_sync', ({ requesterId }) => {
      let currentTime = 0;
      if (isYouTubeRef.current && youtubePlayerRef.current) {
        currentTime = youtubePlayerRef.current.getCurrentTime();
      } else if (videoRef.current) {
        currentTime = videoRef.current.currentTime;
      }
      socket.emit('sync_response', { requesterId, currentTime, isPlaying: isPlayingRef.current });
    });

    socket.on('user_muted', ({ userId, isMuted }) => {
      setRemoteStreams(prev => prev.map(p => p.id === userId ? { ...p, isMuted } : p));
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
      socket.off('user_joined');
      socket.off('user_left');
      socket.off('playlist_updated');
      socket.off('video_changed');
      socket.off('sync_play');
      socket.off('sync_pause');
      socket.off('sync_seek');
      socket.off('request_sync');
      socket.off('chat_message');
    };
  }, []); // Run only once

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
              if (isPlayingRef.current) {
                event.target.playVideo();
              }
              // Explicitly ask for sync when ready
              socket.emit('ask_for_time', { roomId: roomIdRef.current });
            },
            onStateChange: (event) => {
              if (isSyncingRef.current) return; // Don't emit if we're syncing

              if (event.data === window.YT.PlayerState.PLAYING) {
                if (!isPlayingRef.current) { // Only emit if state changed
                  const currentTime = youtubePlayerRef.current.getCurrentTime();
                  setIsPlaying(true);
                  socket.emit('sync_action', { roomId: roomIdRef.current, action: 'play', data: { currentTime } });
                }
              } else if (event.data === window.YT.PlayerState.PAUSED) {
                if (isPlayingRef.current) { // Only emit if state changed
                  const currentTime = youtubePlayerRef.current.getCurrentTime();
                  setIsPlaying(false);
                  socket.emit('sync_action', { roomId: roomIdRef.current, action: 'pause', data: { currentTime } });
                }
              }
            }
          }
        });
      }
    } else if (!isYouTube) {
      // Clear video ID ref when switching to non-YouTube
      currentVideoIdRef.current = null;
    }
  }, [currentVideoUrl, isYouTube]); // Removed isPlaying and roomId from dependencies

  // Auto-play MP4 videos if they should be playing when user joins
  useEffect(() => {
    if (!isYouTube && videoRef.current && currentVideoUrl && isPlaying) {
      videoRef.current.play().catch(e => console.log('Auto-play prevented:', e));
    }
  }, [currentVideoUrl, isYouTube, isPlaying]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);



  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState([]); // Array of { id, stream, username, isMuted }
  const [isMuted, setIsMuted] = useState(true);
  const [facingMode, setFacingMode] = useState('user');

  const peersRef = useRef({}); // socketId -> { peer: RTCPeerConnection }
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null); // Keep for local preview in grid

  // Helper to create peer connection
  const createPeer = (targetId, isInitiator = false) => {
    const peer = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
      ]
    });

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { candidate: event.candidate, target: targetId, callerId: socket.id });
      }
    };

    peer.onnegotiationneeded = async () => {
      try {
        const offer = await peer.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await peer.setLocalDescription(offer);
        socket.emit('offer', { offer, target: targetId, callerId: socket.id });
      } catch (err) {
        console.error('Error renegotiating:', err);
      }
    };

    peer.ontrack = (event) => {
      setRemoteStreams(prev => {
        const existing = prev.find(p => p.id === targetId);
        if (existing) {
          // If stream is different, update it
          if (existing.stream.id !== event.streams[0].id) {
            return prev.map(p => p.id === targetId ? { ...p, stream: event.streams[0] } : p);
          }
          return prev;
        }
        return [...prev, { id: targetId, stream: event.streams[0] }];
      });
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => peer.addTrack(track, localStreamRef.current));
    }

    return peer;
  };

  useEffect(() => {
    if (localStream && localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const handleToggleWebcam = async () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.stop();
        localStream.removeTrack(videoTrack);
        Object.values(peersRef.current).forEach(({ peer }) => {
          const senders = peer.getSenders();
          const sender = senders.find(s => s.track && s.track.kind === 'video');
          if (sender) peer.removeTrack(sender);
        });
        if (localStream.getAudioTracks().length === 0) {
          setLocalStream(null);
          localStreamRef.current = null;
        } else {
          setLocalStream(new MediaStream(localStream.getTracks()));
          localStreamRef.current = new MediaStream(localStream.getTracks());
        }
      } else {
        try {
          const videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode } });
          const newVideoTrack = videoStream.getVideoTracks()[0];
          localStream.addTrack(newVideoTrack);
          Object.values(peersRef.current).forEach(({ peer }) => {
            peer.addTrack(newVideoTrack, localStream);
          });
          setLocalStream(new MediaStream(localStream.getTracks()));
          localStreamRef.current = new MediaStream(localStream.getTracks());
        } catch (err) { console.error(err); }
      }
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: true });
        stream.getAudioTracks().forEach(t => t.enabled = false);
        setIsMuted(true);
        socket.emit('toggle_mute', { roomId: roomIdRef.current, isMuted: true });
        setLocalStream(stream);
        localStreamRef.current = stream;
        Object.values(peersRef.current).forEach(({ peer }) => {
          stream.getTracks().forEach(track => peer.addTrack(track, stream));
        });
      } catch (err) { console.error(err); }
    }
  };

  const handleFlipCamera = async () => {
    if (!localStream || localStream.getVideoTracks().length === 0) return;
    const newMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newMode);
    localStream.getVideoTracks().forEach(t => t.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: newMode } });
      const newTrack = stream.getVideoTracks()[0];
      localStream.getVideoTracks().forEach(t => localStream.removeTrack(t));
      localStream.addTrack(newTrack);
      setLocalStream(new MediaStream(localStream.getTracks()));
      localStreamRef.current = new MediaStream(localStream.getTracks());
      Object.values(peersRef.current).forEach(({ peer }) => {
        const senders = peer.getSenders();
        const sender = senders.find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(newTrack);
        else peer.addTrack(newTrack, localStream);
      });
    } catch (err) { console.error("Error flipping camera:", err); }
  };

  const handleToggleMic = async () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        const isNowMuted = !audioTrack.enabled;
        setIsMuted(isNowMuted);
        socket.emit('toggle_mute', { roomId: roomIdRef.current, isMuted: isNowMuted });
      } else {
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const audioTrack = audioStream.getAudioTracks()[0];
          localStream.addTrack(audioTrack);
          setIsMuted(false);
          socket.emit('toggle_mute', { roomId: roomIdRef.current, isMuted: false });
          Object.values(peersRef.current).forEach(({ peer }) => {
            peer.addTrack(audioTrack, localStream);
          });
          setLocalStream(new MediaStream(localStream.getTracks()));
          localStreamRef.current = new MediaStream(localStream.getTracks());
        } catch (err) { console.error(err); }
      }
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setLocalStream(stream);
        localStreamRef.current = stream;
        setIsMuted(false);
        socket.emit('toggle_mute', { roomId: roomIdRef.current, isMuted: false });
        Object.values(peersRef.current).forEach(({ peer }) => {
          stream.getTracks().forEach(track => peer.addTrack(track, stream));
        });
      } catch (err) { console.error(err); }
    }
  };

  const handleRemoveVideo = (e, index) => {
    e.stopPropagation(); // Prevent playing the video
    if (window.confirm('Remove this video from playlist?')) {
      socket.emit('remove_from_playlist', { roomId: roomIdRef.current, index });
    }
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
    socket.emit('sync_action', { roomId: roomIdRef.current, action: 'play', data: { currentTime } });
  };

  const handleVideoPause = () => {
    if (isSyncingRef.current) return; // Don't emit if we're syncing from another user
    const currentTime = videoRef.current ? videoRef.current.currentTime : 0;
    setIsPlaying(false);
    socket.emit('sync_action', { roomId: roomIdRef.current, action: 'pause', data: { currentTime } });
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
                    onLoadedMetadata={() => socket.emit('ask_for_time', { roomId: roomIdRef.current })}
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
            {isPlaying && (
              <button
                className="btn"
                onClick={() => {
                  if (isYouTubeRef.current && youtubePlayerRef.current) youtubePlayerRef.current.playVideo();
                  else if (videoRef.current) videoRef.current.play();
                }}
                style={{ marginLeft: 'auto', background: '#22c55e', padding: '0.25rem 0.5rem', fontSize: '0.8rem', minWidth: 'auto' }}
              >
                Force Play
              </button>
            )}
          </div>

          <div className="video-grid">
            {/* Local User */}
            <div className="video-card">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                style={{ opacity: (localStream && localStream.getVideoTracks().length > 0) ? 1 : 0 }}
              />
              {(!localStream || localStream.getVideoTracks().length === 0) && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
                  Camera Off
                </div>
              )}
              <div className="video-username">
                {username} (You)
              </div>
              <div className="video-controls">
                <button
                  className={`control-btn ${isMuted ? 'off' : ''}`}
                  onClick={handleToggleMic}
                  title={isMuted ? "Unmute" : "Mute"}
                >
                  {isMuted ? "🔇" : "🎤"}
                </button>
                <button
                  className={`control-btn ${(!localStream || localStream.getVideoTracks().length === 0) ? 'off' : ''}`}
                  onClick={handleToggleWebcam}
                  title={(localStream && localStream.getVideoTracks().length > 0) ? "Turn Off Camera" : "Turn On Camera"}
                >
                  {(localStream && localStream.getVideoTracks().length > 0) ? "📷" : "🚫"}
                </button>
                {localStream && localStream.getVideoTracks().length > 0 && (
                  <button
                    className="control-btn"
                    onClick={handleFlipCamera}
                    title="Flip Camera"
                  >
                    🔄
                  </button>
                )}
              </div>
            </div>

            {/* Remote Users */}
            {remoteStreams.map(remote => {
              const user = users.find(u => u.id === remote.id);
              const remoteUsername = user ? user.username : 'Unknown';
              return (
                <div key={remote.id} className="video-card">
                  <VideoPlayer stream={remote.stream} />
                  <div className="video-username">
                    {remoteUsername}
                  </div>
                  {remote.isMuted && (
                    <div style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', background: 'rgba(0,0,0,0.6)', padding: '0.25rem', borderRadius: '50%' }}>
                      🔇
                    </div>
                  )}
                </div>
              );
            })}
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
            <button
              className={`tab-btn ${activeTab === 'users' ? 'active' : ''}`}
              onClick={() => setActiveTab('users')}
            >
              Users ({users.length})
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
          ) : activeTab === 'playlist' ? (
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
                    <div className="playlist-item-info" onClick={() => handleChangeVideo(idx)} style={{ flex: 1, cursor: 'pointer' }}>
                      <span className="playlist-number">{idx + 1}</span>
                      <div style={{ overflow: 'hidden' }}>
                        <div className="playlist-url" title={url}>{url}</div>
                        {idx === currentIndex && <div className="now-playing">Now Playing</div>}
                      </div>
                    </div>
                    <button
                      className="btn-icon"
                      onClick={(e) => handleRemoveVideo(e, idx)}
                      style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0.25rem', marginLeft: '0.5rem' }}
                      title="Remove video"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {playlist.length === 0 && (
                  <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>
                    Playlist is empty
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="users-section" style={{ padding: '1rem', overflowY: 'auto' }}>
              <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>Connected Users</h3>
              <div className="users-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {users.map((user, idx) => (
                  <div key={idx} className="user-item" style={{
                    padding: '0.75rem',
                    background: 'rgba(255,255,255,0.05)',
                    borderRadius: '0.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    <div className="user-avatar" style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: 'var(--gradient-main)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 'bold',
                      fontSize: '0.8rem'
                    }}>
                      {user.username.charAt(0).toUpperCase()}
                    </div>
                    <span>{user.username} {user.username === username && '(You)'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

export default App;
