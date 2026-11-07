import { useState, useEffect } from 'react';
import { Printer, BookOpen, Music, Keyboard, CheckCircle2, Loader2, X, Palette, Waves, Zap } from 'lucide-react';
import ARCamera from './components/ARCamera';
import SongStudioPanel from './components/SongStudioPanel';
import WalkthroughModal from './components/WalkthroughModal';

export default function App() {
  const [logs, setLogs] = useState([]);
  const [showLogs, setShowLogs] = useState(false);
  const [openCvLoaded, setOpenCvLoaded] = useState(!!window.cv);
  const [mediaPipeLoaded, setMediaPipeLoaded] = useState(() => !!(window.FilesetResolver && window.HandLandmarker));
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('arguitar_theme') || 'cyber';
  });
  const [vfxMode, setVfxMode] = useState(() => {
    return localStorage.getItem('arguitar_vfx_mode') || 'calm';
  });
  const [cameraSize, setCameraSize] = useState(() => {
    const saved = localStorage.getItem('arguitar_camera_size');
    return ['800', '1000', '1200', 'full'].includes(saved) ? saved : '1000';
  });

  useEffect(() => {
    localStorage.setItem('arguitar_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('arguitar_vfx_mode', vfxMode);
  }, [vfxMode]);

  const cycleTheme = () => {
    setTheme(prev => {
      const themes = ['cyber', 'acoustic', 'nordic'];
      const nextIdx = (themes.indexOf(prev) + 1) % themes.length;
      const next = themes[nextIdx];
      // Smart pairing: switch VFX mode to match theme tone
      if (next === 'acoustic') setVfxMode('calm');
      if (next === 'cyber') setVfxMode('exciting');
      return next;
    });
  };

  const cycleVfxMode = () => {
    setVfxMode(prev => (prev === 'calm' ? 'exciting' : 'calm'));
  };

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

  // Global Keyboard Shortcuts (Hands-free control for practicing musicians)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore key events when typing inside inputs or textareas
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
        return;
      }
      
      const key = e.key.toLowerCase();
      if (key === 'p') {
        window.open('/neck/index.html', '_blank');
      } else if (key === 's') {
        e.preventDefault();
        setShowSongStudio(prev => !prev);
      } else if (key === 'h' || key === '?') {
        e.preventDefault();
        setShowWalkthrough(prev => !prev);
      } else if (key === 't') {
        e.preventDefault();
        cycleTheme();
      } else if (key === 'v') {
        e.preventDefault();
        cycleVfxMode();
      } else if (key === 'd') {
        e.preventDefault();
        setShowLogs(prev => !prev);
      } else if (key === 'o') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('toggle-guitar-options'));
      } else if (key === 'k') {
        e.preventDefault();
        setShowShortcuts(prev => !prev);
      } else if (e.key === 'Escape') {
        setShowShortcuts(false);
        setShowWalkthrough(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [theme, vfxMode]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header bar */}
      <header style={{
        padding: '12px 24px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'rgba(8, 9, 15, 0.92)',
        backdropFilter: 'blur(12px)',
        zIndex: 100
      }}>
        {/* Brand & Live Readiness Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontSize: '20px', fontWeight: 700 }} className="title-gradient">
            AR Guitar
          </span>
          <div
            className={`status-pill ${openCvLoaded && mediaPipeLoaded ? 'active' : 'warning'}`}
            style={{ fontSize: '11px', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            title={openCvLoaded && mediaPipeLoaded ? 'OpenCV & MediaPipe Ready' : 'Loading Computer Vision Models...'}
          >
            {openCvLoaded && mediaPipeLoaded ? (
              <CheckCircle2 size={12} color="var(--accent-green)" />
            ) : (
              <Loader2 size={12} className="rec-spinner" style={{ borderTopColor: 'var(--accent-yellow)' }} />
            )}
            <span>{openCvLoaded && mediaPipeLoaded ? 'System Ready' : 'Loading Vision...'}</span>
          </div>

          <button
            type="button"
            onClick={() => setShowShortcuts(prev => !prev)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '12px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 8px',
              borderRadius: '6px',
              transition: 'color 0.15s ease'
            }}
            title="View Keyboard Shortcuts [K]"
          >
            <Keyboard size={13} />
            <kbd>K</kbd>
          </button>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Theme Quick Switcher */}
          <button
            type="button"
            onClick={cycleTheme}
            className="header-action-btn"
            title={`Current Theme: ${theme.toUpperCase()} [T to cycle]`}
          >
            <Palette size={14} color="var(--accent-purple)" />
            <span style={{ textTransform: 'capitalize' }}>{theme}</span>
            <kbd>T</kbd>
          </button>

          {/* Strum VFX Mode Quick Switcher */}
          <button
            type="button"
            onClick={cycleVfxMode}
            className="header-action-btn"
            title={`Strum Visuals: ${vfxMode.toUpperCase()} [V to toggle]`}
          >
            {vfxMode === 'calm' ? (
              <Waves size={14} color="var(--accent-cyan)" />
            ) : (
              <Zap size={14} color="#f59e0b" />
            )}
            <span style={{ textTransform: 'capitalize' }}>{vfxMode}</span>
            <kbd>V</kbd>
          </button>

          <a
            href="/neck/index.html"
            target="_blank"
            rel="noopener noreferrer"
            className="header-action-btn"
            title="Download & print 1:1 paper guitar neck template [P]"
          >
            <Printer size={14} color="var(--accent-cyan)" />
            <span>Print Neck</span>
            <kbd>P</kbd>
          </a>

          <button
            type="button"
            onClick={() => setShowSongStudio(prev => !prev)}
            className={`header-action-btn ${showSongStudio ? 'active' : ''}`}
            title="Toggle Play-Along Song Studio [S]"
          >
            <Music size={14} color={showSongStudio ? 'var(--accent-cyan)' : 'var(--text-secondary)'} />
            <span>Songs</span>
            <kbd>S</kbd>
          </button>

          <button
            type="button"
            onClick={() => setShowWalkthrough(true)}
            className="header-action-btn primary-highlight"
            title="Open Beginner Play-Along Guide [H]"
          >
            <BookOpen size={14} color="#d8b4fe" />
            <span>How to Play</span>
            <kbd>H</kbd>
          </button>
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
            onOpenWalkthrough={() => setShowWalkthrough(true)}
            theme={theme}
            vfxMode={vfxMode}
            onVfxModeChange={setVfxMode}
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
                  className="btn-secondary"
                  style={{
                    padding: '3px 10px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)'
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
                background: 'rgba(0, 0, 0, 0.5)',
                borderRadius: '10px',
                padding: '12px',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: 'var(--text-primary)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}>
                {logs.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)' }}>Waiting for system logs...</div>
                ) : (
                  logs.map((log, idx) => (
                    <div key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '3px' }}>
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

      {/* Beginner Play-Along Walkthrough Modal */}
      <WalkthroughModal
        isOpen={showWalkthrough}
        onClose={() => setShowWalkthrough(false)}
        onOpenSongStudio={() => setShowSongStudio(true)}
      />

      {/* Keyboard Shortcuts Reference Modal */}
      {showShortcuts && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px'
          }}
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="glass-panel"
            style={{
              maxWidth: '460px',
              width: '100%',
              padding: '24px',
              position: 'relative'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Keyboard size={18} color="var(--accent-purple)" />
                <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Hands-Free Shortcuts</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowShortcuts(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '4px'
                }}
              >
                <X size={16} />
              </button>
            </div>
            
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.5 }}>
              Hold your paper guitar with both hands and control the app without reaching for your mouse:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { key: 'P', desc: 'Open printable paper guitar neck (PDF / Web)' },
                { key: 'S', desc: 'Toggle Song Play-Along Studio & Highway' },
                { key: 'T', desc: 'Cycle Theme (Cyber ↔ Acoustic ↔ Nordic)' },
                { key: 'V', desc: 'Toggle Strum VFX (Calm Waves ↔ Exciting Sparks)' },
                { key: 'H / ?', desc: 'Open Beginner Walkthrough Guide' },
                { key: 'O', desc: 'Toggle Guitar Settings & Options Drawer' },
                { key: 'D', desc: 'Toggle System Diagnostics & Log Drawer' },
                { key: 'K', desc: 'Toggle this Shortcuts Guide' },
                { key: 'Esc', desc: 'Close open dialogs & overlays' },
              ].map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border-color)'
                  }}
                >
                  <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{item.desc}</span>
                  <kbd style={{ fontSize: '11px', padding: '3px 8px' }}>{item.key}</kbd>
                </div>
              ))}
            </div>

            <div style={{ marginTop: '20px', textAlign: 'center' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowShortcuts(false)}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
