import { useState, useEffect } from 'react';
import ARCamera from './components/ARCamera';
import TestSuite from './components/TestSuite';
import { Info } from 'lucide-react';

export default function App() {
  const [statusText, setStatusText] = useState('Camera offline. Press "Start Camera" to begin.');
  const [logs, setLogs] = useState([]);
  const [openCvLoaded, setOpenCvLoaded] = useState(!!window.cv);
  const [activeTab, setActiveTab] = useState('camera'); // 'camera' or 'testsuite'
  const [mediaPipeLoaded, setMediaPipeLoaded] = useState(false);

  // Add log entry helper
  const addLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [{ time: timestamp, msg: message }, ...prev].slice(0, 15));
  };

  // Listen for OpenCV.js ready event
  useEffect(() => {
    if (window.cv) {
      setTimeout(() => {
        addLog("OpenCV.js is already loaded.");
      }, 0);
      return;
    }
    
    const handleCvReady = () => {
      setOpenCvLoaded(true);
      addLog("OpenCV.js loaded successfully!");
    };
    
    window.addEventListener('opencv-ready', handleCvReady);
    return () => window.removeEventListener('opencv-ready', handleCvReady);
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
          <span className="status-pill active" style={{ fontSize: '10px' }}>AR TRACKING</span>
        </div>

        {/* Tab selection */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            className={`btn-secondary ${activeTab === 'camera' ? 'active' : ''}`}
            onClick={() => setActiveTab('camera')}
            style={{ padding: '8px 16px', fontSize: '13px' }}
          >
            Live Camera
          </button>
          <button 
            className={`btn-secondary ${activeTab === 'testsuite' ? 'active' : ''}`}
            onClick={() => setActiveTab('testsuite')}
            style={{ padding: '8px 16px', fontSize: '13px' }}
          >
            Test Suite
          </button>
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
        
        {/* Left Side: Video stream or Test Suite */}
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '16px',
          width: '100%',
          maxWidth: activeTab === 'camera' ? '800px' : 'none',
          margin: activeTab === 'camera' ? '0 auto' : '0'
        }}>
          {activeTab === 'camera' ? (
            <>
              <ARCamera 
                openCvLoaded={openCvLoaded}
                onStatusUpdate={(text) => setStatusText(text)}
                onMediaPipeLoaded={setMediaPipeLoaded}
                addLog={addLog}
              />
              
              {/* Diagnostic Metrics and Text */}
              <div className="glass-panel" style={{ padding: '16px', fontSize: '14px', fontFamily: 'monospace', display: 'flex', gap: '12px', alignItems: 'center' }}>
                <Info size={16} style={{ color: 'var(--accent-cyan)' }} />
                <span>{statusText}</span>
              </div>
            </>
          ) : (
            <TestSuite openCvLoaded={openCvLoaded} />
          )}
        </div>
        
        {/* Right Side: Control panel / Info card and logs */}
        <div className="sidebar">
          
          {/* Instructions Panel */}
          <div className="glass-panel info-card" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '14px', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em', marginTop: 0, marginBottom: '12px' }}>
              Webcam Verification
            </h3>
            {activeTab === 'camera' ? (
              <>
                <p style={{ fontSize: '13px', lineHeight: '1.5', color: 'var(--text-secondary)', margin: '0 0 12px 0' }}>
                  This page has been stripped back to only display the raw live camera feed. All heavy library initializations (MediaPipe, OpenCV, Web Audio) are completely disabled.
                </p>
                <p style={{ fontSize: '13px', lineHeight: '1.5', color: 'var(--text-secondary)', margin: 0 }}>
                  Use the <strong>Start Camera</strong> button to verify if browser webcam permissions are operating correctly.
                </p>
              </>
            ) : (
              <>
                <p style={{ fontSize: '13px', lineHeight: '1.5', color: 'var(--text-secondary)', margin: '0 0 12px 0' }}>
                  The Visual Test Suite runs the ArUco marker detector and MediaPipe Hand Landmarker on the original static test images.
                </p>
                <p style={{ fontSize: '13px', lineHeight: '1.5', color: 'var(--text-secondary)', margin: 0 }}>
                  Click <strong>Run Verification Tests</strong> to execute all 38 alignment and fret accuracy tests.
                </p>
              </>
            )}
          </div>

          {/* Logs Console */}
          <div className="glass-panel info-card" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: '200px' }}>
            <h3 style={{ fontSize: '14px', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em', marginBottom: '8px' }}>
              System Logs
            </h3>
            <div style={{
              flexGrow: 1,
              overflowY: 'auto',
              background: 'rgba(0, 0, 0, 0.3)',
              borderRadius: '8px',
              padding: '10px',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: '#d1d5db',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              maxHeight: '280px'
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
