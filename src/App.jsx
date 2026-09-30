import { useState, useEffect } from 'react';
import ARCamera from './components/ARCamera';
import SongStudioPanel from './components/SongStudioPanel';
import { Info } from 'lucide-react';

export default function App() {
  const [statusText, setStatusText] = useState('Camera offline. Press "Start Camera" to begin.');
  const [logs, setLogs] = useState([]);
  const [openCvLoaded, setOpenCvLoaded] = useState(!!window.cv);
  const [mediaPipeLoaded, setMediaPipeLoaded] = useState(() => !!(window.FilesetResolver && window.HandLandmarker));
  const [cameraSize, setCameraSize] = useState(() => {
    return localStorage.getItem('arguitar_camera_size') || '1000';
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

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header bar */}
      <header style={{
        padding: '16px 24px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'rgba(8, 9, 15, 0.9)',
        backdropFilter: 'blur(8px)',
        zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '24px', fontWeight: 'bold' }} className="title-gradient">
            AR Guitar - OpenCV Tracking
          </span>
          <span className="status-pill active" style={{ fontSize: '10px' }}>AR LIVE</span>
        </div>

        {/* Device Status Pills */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <span className={`status-pill ${openCvLoaded ? 'active' : 'inactive'}`}>
            OpenCV.js: {openCvLoaded ? 'READY' : 'LOADING'}
          </span>
          <span className={`status-pill ${mediaPipeLoaded ? 'active' : 'inactive'}`}>
            MediaPipe: {mediaPipeLoaded ? 'READY' : 'LOADING'}
          </span>
        </div>
      </header>

      {/* Main workspace container */}
      <main className="app-container">

        {/* Left Side: Live AR Camera */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          width: '100%',
          minWidth: 0,
          maxWidth: cameraSize === 'full' ? '100%' : `${cameraSize}px`,
          margin: '0 auto',
          transition: 'max-width 0.25s ease'
        }}>
          <ARCamera
            openCvLoaded={openCvLoaded}
            onStatusUpdate={(text) => setStatusText(text)}
            onMediaPipeLoaded={setMediaPipeLoaded}
            addLog={addLog}
            cameraSize={cameraSize}
            onCameraSizeChange={setCameraSize}
          />

          {/* Diagnostic Metrics and Status Bar */}
          <div className="glass-panel" style={{
            padding: '16px',
            minWidth: 0,
            fontSize: '14px',
            fontFamily: 'monospace',
            display: 'flex',
            gap: '12px',
            alignItems: 'center',
            height: '54px',
            boxSizing: 'border-box'
          }}>
            <Info size={16} style={{ flexShrink: 0, color: 'var(--accent-cyan)' }} />
            <span style={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              width: '100%'
            }}>{statusText}</span>
          </div>
        </div>

        {/* Right Side: Song Play-Along Studio & System Logs */}
        <div className="sidebar">

          {/* Interactive Play-Along Song Studio Panel */}
          <SongStudioPanel />

          {/* Logs Console */}
          <div className="glass-panel info-card" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: '200px' }}>
            <h3 style={{ fontSize: '14px', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em', marginBottom: '8px' }}>
              System Logs
            </h3>
            <div style={{
              height: '240px',
              overflowY: 'auto',
              overflowX: 'hidden',
              wordBreak: 'break-word',
              whiteSpace: 'pre-wrap',
              background: 'rgba(0, 0, 0, 0.3)',
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
                  <div key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)', paddingBottom: '2px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>[{log.time}]</span> {log.msg}
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
