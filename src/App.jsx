import { useState, useEffect } from 'react';
import ARCamera from './components/ARCamera';
import SongStudioPanel from './components/SongStudioPanel';

export default function App() {
  const [logs, setLogs] = useState([]);
  const [showLogs, setShowLogs] = useState(false);
  const [openCvLoaded, setOpenCvLoaded] = useState(!!window.cv);
  const [mediaPipeLoaded, setMediaPipeLoaded] = useState(() => !!(window.FilesetResolver && window.HandLandmarker));
  const [cameraSize, setCameraSize] = useState(() => {
    const saved = localStorage.getItem('arguitar_camera_size');
    return ['800', '1000', '1200', 'full'].includes(saved) ? saved : '1000';
  });

  useEffect(() => {
    localStorage.setItem('arguitar_camera_size', cameraSize);
  }, [cameraSize]);

  // Add log entry helper
  const addLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [{ time: timestamp, msg: message }, ...prev].slice(0, 15));
  };

  // Listen for OpenCV.js and MediaPipe ready events
  useEffect(() => {
    if (window.cv) {
      setTimeout(() => {
        addLog("OpenCV.js is already loaded.");
      }, 0);
    } else {
      const handleCvReady = () => {
        setOpenCvLoaded(true);
        addLog("OpenCV.js loaded successfully!");
      };
      window.addEventListener('opencv-ready', handleCvReady);
      return () => window.removeEventListener('opencv-ready', handleCvReady);
    }
  }, []);

  useEffect(() => {
    if (window.FilesetResolver && window.HandLandmarker) {
      return;
    }
    const handleMpReady = () => {
      setMediaPipeLoaded(true);
      addLog("MediaPipe loaded globally!");
    };
    window.addEventListener('mediapipe-ready', handleMpReady);
    return () => window.removeEventListener('mediapipe-ready', handleMpReady);
  }, []);

  const [showSongStudio, setShowSongStudio] = useState(false);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header bar */}
      <header style={{
        padding: '14px 24px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'rgba(8, 9, 15, 0.9)',
        backdropFilter: 'blur(8px)',
        zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '22px', fontWeight: 'bold' }} className="title-gradient">
            AR Guitar
          </span>
          <span className="status-pill active" style={{ fontSize: '10px' }}>AR LIVE</span>
        </div>
      </header>

      {/* Main workspace container */}
      <main className={`app-container ${showSongStudio ? 'with-sidebar' : ''}`}>

        {/* Center / Left Side: Live AR Camera & Workspace */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: '16px',
          width: '100%',
          minWidth: 0,
          maxWidth: cameraSize === 'full' ? '100%' : `${cameraSize}px`,
          margin: '0 auto',
          transition: 'max-width 0.25s ease'
        }}>
          <ARCamera
            openCvLoaded={openCvLoaded}
            onMediaPipeLoaded={setMediaPipeLoaded}
            addLog={addLog}
            cameraSize={cameraSize}
            onCameraSizeChange={setCameraSize}
            showSongStudio={showSongStudio}
            onToggleSongStudio={() => setShowSongStudio(prev => !prev)}
          />

          {/* Subtle Diagnostics & Logs Toggle Link */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 4px' }}>
            <button
              onClick={() => setShowLogs(prev => !prev)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
                padding: '4px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
              title="Toggle System Diagnostics & Event Logs"
            >
              {showLogs ? '▲ Hide Diagnostics' : '▼ System Logs & Diagnostics'}
            </button>
          </div>

          {/* Logs & Diagnostics Console (Collapsible) */}
          {showLogs && (
            <div className="glass-panel info-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <h3 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em', margin: 0 }}>
                    System Diagnostics
                  </h3>
                  {/* Relocated OpenCV & MediaPipe Ready Statuses */}
                  <span className={`status-pill ${openCvLoaded ? 'active' : 'inactive'}`} style={{ fontSize: '11px' }}>
                    OpenCV.js: {openCvLoaded ? 'READY' : 'LOADING'}
                  </span>
                  <span className={`status-pill ${mediaPipeLoaded ? 'active' : 'inactive'}`} style={{ fontSize: '11px' }}>
                    MediaPipe: {mediaPipeLoaded ? 'READY' : 'LOADING'}
                  </span>
                </div>
                <button
                  onClick={() => setLogs([])}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '4px',
                    color: 'var(--text-muted)',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    cursor: 'pointer',
                    padding: '2px 8px'
                  }}
                >
                  Clear Logs
                </button>
              </div>
              <div style={{
                height: '160px',
                overflowY: 'auto',
                overflowX: 'hidden',
                wordBreak: 'break-word',
                whiteSpace: 'pre-wrap',
                background: 'rgba(0, 0, 0, 0.4)',
                borderRadius: '8px',
                padding: '10px',
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: '#d1d5db',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}>
                {logs.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)' }}>Waiting for system logs...</div>
                ) : (
                  logs.map((log, idx) => (
                    <div key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '2px' }}>
                      <span style={{ color: 'var(--text-muted)' }}>[{log.time}]</span> {log.msg}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Song Play-Along Studio (Conditional) */}
        {showSongStudio && (
          <aside className="sidebar">
            <SongStudioPanel />
          </aside>
        )}
      </main>
    </div>
  );
}
