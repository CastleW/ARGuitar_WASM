import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Settings,
  Sliders,
  Camera,
  Video,
  Cpu,
  Activity,
  Sparkles,
  Compass,
  Award,
  Focus,
  SwitchCamera,
  RotateCcw,
  Volume2
} from 'lucide-react';

export default function GuitarConfigDrawer({
  isOpen,
  onClose,
  containerRef,
  isFullscreen,
  // Play & Feel
  strumMode,
  setStrumMode,
  isPalmMuted,
  onTogglePalmMute,
  playLevel,
  setPlayLevel,
  smoothFingers,
  setSmoothFingers,
  // Neck Geometry
  neckWidthScale,
  setNeckWidthScale,
  fretScaleLength,
  setFretScaleLength,
  strumOffset,
  onZeroStrum,
  onResetStrumOffset,
  stereoStatus,
  // Camera & Video
  availableCameras = [],
  selectedDeviceId,
  onCameraChange,
  facingMode,
  onFlipCamera,
  isMobile,
  captureResolution,
  onResolutionChange,
  cameraSize,
  onCameraSizeChange,
  cameraActive,
  calibStatus,
  onOpenCalibration,
  cameraDiagnostics,
  onOpenDiagnostics,
  // Advanced & Diagnostics
  stereoEnabled,
  onToggleStereo,
  secondaryDeviceId,
  onSecondaryDeviceChange,
  showPip,
  setShowPip,
  mpDelegate,
  onToggleMpDelegate,
  showMarkerDebug,
  setShowMarkerDebug,
  showProfiler,
  setShowProfiler,
  showRecorder,
  setShowRecorder,
  recState
}) {
  const [activeTab, setActiveTab] = useState('play'); // 'play' | 'geometry' | 'camera' | 'advanced'

  // Determine portal mount target (active fullscreen element or document.body)
  const [mountNode, setMountNode] = useState(() => {
    if (typeof document === 'undefined') return null;
    return (
      (isFullscreen && containerRef?.current) ||
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.body
    );
  });

  useEffect(() => {
    const updateMountNode = () => {
      const fsEl =
        (isFullscreen && containerRef?.current) ||
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement;
      setMountNode(fsEl || document.body);
    };

    updateMountNode();
    document.addEventListener('fullscreenchange', updateMountNode);
    document.addEventListener('webkitfullscreenchange', updateMountNode);
    return () => {
      document.removeEventListener('fullscreenchange', updateMountNode);
      document.removeEventListener('webkitfullscreenchange', updateMountNode);
    };
  }, [isFullscreen, containerRef]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen || !mountNode) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        height: '100%',
        zIndex: 99999,
        display: 'flex',
        justifyContent: 'flex-end',
        background: 'rgba(0, 0, 0, 0.72)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        transition: 'all 0.25s ease'
      }}
      onClick={onClose}
    >
      <div
        className="glass-panel"
        style={{
          width: '100%',
          maxWidth: '460px',
          height: '100%',
          maxHeight: '100%',
          borderRadius: 0,
          borderLeft: '1px solid var(--border-color)',
          borderRight: 'none',
          borderTop: 'none',
          borderBottom: 'none',
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(10, 12, 20, 0.98)',
          boxShadow: '-12px 0 40px rgba(0, 0, 0, 0.7)',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 20px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(255, 255, 255, 0.02)',
            flexShrink: 0
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Settings size={18} color="var(--accent-purple)" />
            <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0, letterSpacing: '-0.01em' }}>
              Guitar Settings & Options
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.15s ease'
            }}
            title="Close Settings (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '4px',
            padding: '10px 14px',
            background: 'rgba(0, 0, 0, 0.25)',
            borderBottom: '1px solid var(--border-color)',
            flexShrink: 0
          }}
        >
          {[
            { id: 'play', label: 'Play & Feel', icon: '🎸' },
            { id: 'geometry', label: 'Geometry', icon: '📐' },
            { id: 'camera', label: 'Camera', icon: '📹' },
            { id: 'advanced', label: 'Advanced', icon: '🔬' }
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                padding: '8px 4px',
                fontSize: '11px',
                fontWeight: activeTab === tab.id ? 600 : 400,
                color: activeTab === tab.id ? '#fff' : 'var(--text-secondary)',
                background: activeTab === tab.id ? 'rgba(168, 85, 247, 0.16)' : 'transparent',
                border: activeTab === tab.id ? '1px solid rgba(168, 85, 247, 0.35)' : '1px solid transparent',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <span style={{ fontSize: '14px' }}>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Content Body */}
        <div style={{
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '22px',
          flex: 1,
          overflowY: 'auto',
          minHeight: 0
        }}>
          {/* TAB 1: PLAY & FEEL */}
          {activeTab === 'play' && (
            <>
              {/* Strum Mode */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Compass size={14} color="var(--accent-purple)" />
                  Strumming Motion Mode
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                  {[
                    { id: 'down', label: '⬇️ Down Only', desc: 'Classic beginner downstrokes' },
                    { id: 'smart', label: '🎯 Smart', desc: 'Allows upstrokes, mutes air resets' },
                    { id: 'both', label: '⇅ Down & Up', desc: 'Continuous alternate picking' }
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setStrumMode(m.id)}
                      style={{
                        padding: '9px 6px',
                        fontSize: '12px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontWeight: strumMode === m.id ? 600 : 400,
                        border: strumMode === m.id ? '1px solid var(--accent-cyan)' : '1px solid var(--border-color)',
                        background: strumMode === m.id ? 'rgba(6, 182, 212, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                        color: strumMode === m.id ? '#67e8f9' : 'var(--text-secondary)',
                        transition: 'all 0.15s ease'
                      }}
                      title={m.desc}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {strumMode === 'down' && 'Only downstrokes trigger chords. Safe for learners.'}
                  {strumMode === 'smart' && 'Plays both down & upstrokes, but mutes when your hand floats back out.'}
                  {strumMode === 'both' && 'Plays every string crossing in both directions.'}
                </span>
              </div>

              {/* Palm Muting */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>✋</span>
                  Palm Muting (Acoustic Damping / Rock Chug)
                </label>
                <button
                  type="button"
                  onClick={onTogglePalmMute}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    border: isPalmMuted ? '1px solid #ef4444' : '1px solid var(--border-color)',
                    background: isPalmMuted ? 'rgba(239, 68, 68, 0.16)' : 'rgba(255, 255, 255, 0.03)',
                    color: isPalmMuted ? '#fca5a5' : 'var(--text-secondary)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span style={{ fontSize: '13px', fontWeight: 500 }}>
                    {isPalmMuted ? '✋ Palm Muted (Tight Decay)' : '🎸 Open String Sustain'}
                  </span>
                  <span
                    style={{
                      fontSize: '10px',
                      padding: '2px 8px',
                      borderRadius: '999px',
                      fontWeight: 600,
                      background: isPalmMuted ? '#ef4444' : 'rgba(255, 255, 255, 0.1)',
                      color: '#fff'
                    }}
                  >
                    {isPalmMuted ? 'ON' : 'OFF'}
                  </span>
                </button>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Damps string vibrations for punchy staccato rhythm and tight rock chugging.
                </span>
              </div>

              {/* Song Difficulty Level */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Award size={14} color="#f59e0b" />
                  Song Play-Along Difficulty
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                  {[
                    { lvl: 1, label: '⭐ L1: Auto', desc: 'Chords play automatically in rhythm' },
                    { lvl: 2, label: '🎯 L2: Assist', desc: 'Chords must be close enough' },
                    { lvl: 3, label: '🔥 L3: Pro', desc: 'Requires exact realistic fingerings' }
                  ].map((item) => (
                    <button
                      key={item.lvl}
                      type="button"
                      onClick={() => setPlayLevel(item.lvl)}
                      style={{
                        padding: '9px 6px',
                        fontSize: '12px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontWeight: playLevel === item.lvl ? 600 : 400,
                        border: playLevel === item.lvl ? '1px solid #f59e0b' : '1px solid var(--border-color)',
                        background: playLevel === item.lvl ? 'rgba(245, 158, 11, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                        color: playLevel === item.lvl ? '#fbbf24' : 'var(--text-secondary)',
                        transition: 'all 0.15s ease'
                      }}
                      title={item.desc}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Level 1 lets complete beginners focus 100% on right-hand strumming timing without worrying about left-hand mistakes.
                </span>
              </div>

              {/* Finger & Pick Temporal Smoothing */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Sparkles size={14} color="#c084fc" />
                  Hand Tracking Filter (1-Euro)
                </label>
                <button
                  type="button"
                  onClick={() => setSmoothFingers((prev) => !prev)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    border: smoothFingers ? '1px solid #a855f7' : '1px solid var(--border-color)',
                    background: smoothFingers ? 'rgba(168, 85, 247, 0.16)' : 'rgba(255, 255, 255, 0.03)',
                    color: smoothFingers ? '#d8b4fe' : 'var(--text-secondary)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span style={{ fontSize: '13px', fontWeight: 500 }}>
                    {smoothFingers ? '✨ Smooth Tracking (Jitter Free)' : '⚡ Raw Sensor Stream (Unfiltered)'}
                  </span>
                  <span
                    style={{
                      fontSize: '10px',
                      padding: '2px 8px',
                      borderRadius: '999px',
                      fontWeight: 600,
                      background: smoothFingers ? 'var(--accent-purple)' : 'rgba(255, 255, 255, 0.1)',
                      color: '#fff'
                    }}
                  >
                    {smoothFingers ? 'ON' : 'OFF'}
                  </span>
                </button>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Adaptive algorithm that eliminates webcam landmark micro-jitter while preserving 0ms fast strum response.
                </span>
              </div>
            </>
          )}

          {/* TAB 2: NECK GEOMETRY */}
          {activeTab === 'geometry' && (
            <>
              {/* Neck Width Slider */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Sliders size={14} color="var(--accent-cyan)" />
                    Visual Neck Width
                  </label>
                  <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', fontWeight: 'bold', color: 'var(--accent-cyan)' }}>
                    {neckWidthScale.toFixed(2)}x
                  </span>
                </div>
                <input
                  type="range"
                  min="1.0"
                  max="2.5"
                  step="0.05"
                  value={neckWidthScale}
                  onChange={(e) => setNeckWidthScale(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent-cyan)', cursor: 'pointer' }}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Fine-tunes the physical spread of the 6 virtual strings to match your paper width.
                </span>
              </div>

              {/* Fret Scale Length Slider */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Sliders size={14} color="var(--accent-green)" />
                    Fretboard Scale Length
                  </label>
                  <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', fontWeight: 'bold', color: 'var(--accent-green)' }}>
                    {fretScaleLength.toFixed(1)} cm
                  </span>
                </div>
                <input
                  type="range"
                  min="46.0"
                  max="58.0"
                  step="0.2"
                  value={fretScaleLength}
                  onChange={(e) => setFretScaleLength(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent-green)', cursor: 'pointer' }}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Aligns the 12th fret octave and nut spacing along the length of your neck.
                </span>
              </div>

              {/* Strum Plane Depth & Zero Strum Calibration */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px', borderRadius: '10px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>Strum Strike Plane Offset</span>
                  <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: '#fbbf24', fontWeight: 'bold' }}>
                    {strumOffset.toFixed(1)} cm
                  </span>
                </div>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                  Touch the paper strings with your pick or finger, then tap <strong>Zero Strum</strong> to calibrate hover depth to your exact hand posture:
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={onZeroStrum}
                    className="btn-secondary"
                    style={{ flex: 1, justifyContent: 'center', padding: '8px 12px', fontSize: '12px', borderColor: '#f59e0b', color: '#fbbf24' }}
                  >
                    🎯 Zero Strum Depth
                    {stereoStatus?.liveClearance !== null && stereoStatus?.liveClearance !== undefined && (
                      <span style={{ fontSize: '10px', opacity: 0.85 }}>({stereoStatus.liveClearance}cm)</span>
                    )}
                  </button>
                  {Math.abs(strumOffset - 1.2) > 0.05 && (
                    <button
                      type="button"
                      onClick={onResetStrumOffset}
                      className="btn-secondary"
                      style={{ padding: '8px 12px', fontSize: '12px' }}
                      title="Reset strum offset to standard 1.2cm"
                    >
                      <RotateCcw size={14} />
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {/* TAB 3: CAMERA & DISPLAY */}
          {activeTab === 'camera' && (
            <>
              {/* Camera Selector */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Camera size={14} color="var(--accent-purple)" />
                  Webcam Input Device
                </label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <select
                    value={selectedDeviceId || facingMode}
                    onChange={(e) => onCameraChange(e.target.value)}
                    style={{
                      flex: 1,
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      padding: '8px 10px',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)',
                      cursor: 'pointer',
                      outline: 'none'
                    }}
                  >
                    {isMobile || availableCameras.length > 1 ? (
                      <>
                        <option value="user" style={{ background: '#0f172a' }}>Front (Selfie)</option>
                        <option value="environment" style={{ background: '#0f172a' }}>Back Camera</option>
                        {availableCameras.map((cam, idx) => (
                          <option key={cam.deviceId || idx} value={cam.deviceId} style={{ background: '#0f172a' }}>
                            {cam.label || `Camera ${idx + 1}`}
                          </option>
                        ))}
                      </>
                    ) : (
                      <option value="user" style={{ background: '#0f172a' }}>
                        {availableCameras[0]?.label || 'Default Webcam'}
                      </option>
                    )}
                  </select>
                  {(isMobile || availableCameras.length > 1) && (
                    <button
                      type="button"
                      onClick={onFlipCamera}
                      className="btn-secondary"
                      style={{ padding: '8px 10px', fontSize: '12px' }}
                      title="Flip between front and back cameras"
                    >
                      <SwitchCamera size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Resolution Selector */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Video size={14} color="var(--accent-cyan)" />
                  Video Capture Resolution
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                  {[
                    { id: '720p', label: '720p HD', desc: 'Optimal frame rate & fidelity' },
                    { id: '480p', label: '480p VGA', desc: 'Low CPU / older hardware' },
                    { id: '1080p', label: '1080p FHD', desc: 'Maximum marker detail' }
                  ].map((res) => (
                    <button
                      key={res.id}
                      type="button"
                      onClick={() => onResolutionChange(res.id)}
                      style={{
                        padding: '8px 6px',
                        fontSize: '12px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontWeight: captureResolution === res.id ? 600 : 400,
                        border: captureResolution === res.id ? '1px solid var(--accent-cyan)' : '1px solid var(--border-color)',
                        background: captureResolution === res.id ? 'rgba(6, 182, 212, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                        color: captureResolution === res.id ? '#67e8f9' : 'var(--text-secondary)'
                      }}
                      title={res.desc}
                    >
                      {res.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Viewport Width */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Screen Viewport Size
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                  {[
                    { label: '800 px', value: '800' },
                    { label: '1000 px', value: '1000' },
                    { label: '1200 px', value: '1200' },
                    { label: 'Full Fit', value: 'full' }
                  ].map((sz) => (
                    <button
                      key={sz.value}
                      type="button"
                      onClick={() => onCameraSizeChange(sz.value)}
                      style={{
                        padding: '8px 4px',
                        fontSize: '11px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontWeight: cameraSize === sz.value ? 600 : 400,
                        border: cameraSize === sz.value ? '1px solid var(--accent-purple)' : '1px solid var(--border-color)',
                        background: cameraSize === sz.value ? 'rgba(168, 85, 247, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                        color: cameraSize === sz.value ? '#d8b4fe' : 'var(--text-secondary)'
                      }}
                    >
                      {sz.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Calibration & Optics Diagnostics Modals */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '6px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={onOpenCalibration}
                    disabled={!cameraActive}
                    className="btn-secondary"
                    style={{
                      justifyContent: 'center',
                      fontSize: '12px',
                      padding: '9px 10px',
                      opacity: cameraActive ? 1 : 0.5,
                      borderColor: calibStatus?.cam1 ? '#4ade80' : 'var(--border-color)'
                    }}
                    title="Calibrate lens distortion with ArUco calibration board"
                  >
                    📐 Lens Calibrate {calibStatus?.cam1 ? '✓' : ''}
                  </button>
                  <button
                    type="button"
                    onClick={onOpenDiagnostics}
                    disabled={!cameraActive}
                    className="btn-secondary"
                    style={{
                      justifyContent: 'center',
                      fontSize: '12px',
                      padding: '9px 10px',
                      opacity: cameraActive ? 1 : 0.5
                    }}
                    title="Inspect camera focus mode, auto-exposure, and lens locks"
                  >
                    <Focus size={14} />
                    Optics {cameraDiagnostics?.isFocusLocked ? '🔒' : ''}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* TAB 4: ADVANCED & LAB TOOLS */}
          {activeTab === 'advanced' && (
            <>
              {/* Dual-Camera Stereo 3D */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', borderRadius: '10px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    👓 Dual-Camera Stereo 3D
                  </label>
                  <button
                    type="button"
                    onClick={onToggleStereo}
                    style={{
                      padding: '3px 10px',
                      fontSize: '11px',
                      borderRadius: '999px',
                      fontWeight: 600,
                      border: stereoEnabled ? '1px solid #38bdf8' : '1px solid var(--border-color)',
                      background: stereoEnabled ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                      color: stereoEnabled ? '#38bdf8' : 'var(--text-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    {stereoEnabled ? 'ENABLED' : 'DISABLED'}
                  </button>
                </div>
                {stereoEnabled && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                    <select
                      value={secondaryDeviceId}
                      onChange={(e) => onSecondaryDeviceChange(e.target.value)}
                      style={{
                        background: 'rgba(255, 255, 255, 0.08)',
                        border: '1px solid rgba(56, 189, 248, 0.35)',
                        borderRadius: '6px',
                        color: '#38bdf8',
                        padding: '6px 8px',
                        fontSize: '11px',
                        fontFamily: 'var(--font-mono)'
                      }}
                    >
                      <option value="">Select Secondary Camera (Cam 2)...</option>
                      {availableCameras
                        .filter((cam) => cam.deviceId !== selectedDeviceId)
                        .map((cam, idx) => (
                          <option key={cam.deviceId || idx} value={cam.deviceId} style={{ background: '#0f172a' }}>
                            {cam.label || `Camera ${idx + 2}`}
                          </option>
                        ))}
                    </select>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: stereoStatus?.calibrated ? '#4ade80' : '#f59e0b' }}>
                        {stereoStatus?.calibrated ? `🟢 Baseline: ${stereoStatus.baseline}cm (${stereoStatus.angle}°)` : '🟡 Aligning secondary camera...'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowPip((prev) => !prev)}
                        className="btn-secondary"
                        style={{ padding: '3px 8px', fontSize: '10px' }}
                      >
                        PiP Preview {showPip ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Hardware Acceleration Backend */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Cpu size={14} color="#86efac" />
                  MediaPipe Vision Backend
                </label>
                <button
                  type="button"
                  onClick={onToggleMpDelegate}
                  className="btn-secondary"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '9px 12px',
                    fontSize: '12px'
                  }}
                >
                  <span>Backend: {mpDelegate === 'GPU' ? '⚡ WebGL GPU Accelerated' : '🧠 Multi-core CPU (XNNPACK SIMD)'}</span>
                  <span style={{ fontSize: '11px', color: 'var(--accent-cyan)' }}>Tap to switch</span>
                </button>
              </div>

              {/* Debug Visuals & Ray Tracing */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Developer & Diagnostics Overlays
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setShowMarkerDebug((prev) => !prev)}
                    className="btn-secondary"
                    style={{
                      justifyContent: 'center',
                      fontSize: '11px',
                      padding: '8px 10px',
                      borderColor: showMarkerDebug ? '#f59e0b' : 'var(--border-color)',
                      color: showMarkerDebug ? '#fbbf24' : 'var(--text-secondary)'
                    }}
                  >
                    🛠️ Debug Rays {showMarkerDebug ? 'ON' : 'OFF'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowProfiler((prev) => !prev)}
                    className="btn-secondary"
                    style={{
                      justifyContent: 'center',
                      fontSize: '11px',
                      padding: '8px 10px',
                      borderColor: showProfiler ? 'var(--accent-cyan)' : 'var(--border-color)',
                      color: showProfiler ? '#38bdf8' : 'var(--text-secondary)'
                    }}
                  >
                    <Activity size={13} />
                    Profiler {showProfiler ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>

              {/* ArUco Session Recorder */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Video & Telemetry Session Recorder
                </label>
                <button
                  type="button"
                  onClick={() => setShowRecorder((prev) => !prev)}
                  className="btn-secondary"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '9px 12px',
                    fontSize: '12px',
                    borderColor: recState === 'recording' ? 'var(--accent-red)' : 'var(--border-color)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className={`rec-dot ${recState === 'recording' ? 'recording' : ''}`} />
                    <span>Recorder Panel {showRecorder ? '(Open)' : ''}</span>
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {recState === 'recording' ? '🔴 Recording...' : 'Configure'}
                  </span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            marginTop: 'auto',
            padding: '14px 20px',
            borderTop: '1px solid var(--border-color)',
            background: 'rgba(0, 0, 0, 0.3)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0
          }}
        >
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Shortcut: <kbd>O</kbd> to toggle, <kbd>Esc</kbd> to close
          </span>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            style={{ padding: '6px 14px', fontSize: '12px' }}
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    mountNode
  );
}
