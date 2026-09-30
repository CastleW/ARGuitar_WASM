import { useState, useEffect } from 'react';
import { songEngine, BUILT_IN_SONGS } from '../utils/song_engine';
import { Play, Pause, RotateCcw, Volume2, VolumeX, Sliders, Music, Zap } from 'lucide-react';

export default function SongStudioPanel() {
  const [song, setSong] = useState(songEngine.currentSong);
  const [isPlaying, setIsPlaying] = useState(songEngine.isPlaying);
  const [currentMeasure, setCurrentMeasure] = useState(songEngine.currentMeasure);
  const [effectiveBpm, setEffectiveBpm] = useState(songEngine.effectiveBpm);
  const [tempoMultiplier, setTempoMultiplier] = useState(songEngine.tempoMultiplier);
  const [backingVolume, setBackingVolume] = useState(songEngine.backingVolume);
  const [isMetronomeEnabled, setIsMetronomeEnabled] = useState(songEngine.isMetronomeEnabled);

  useEffect(() => {
    const unsubscribe = songEngine.subscribe((eventType, payload) => {
      if (eventType === 'beat') {
        setCurrentMeasure(payload.measure);
        setEffectiveBpm(payload.effectiveBpm);
      } else if (eventType === 'playStateChange') {
        setIsPlaying(payload.isPlaying);
      } else if (eventType === 'songChange') {
        setSong(payload.song);
        setEffectiveBpm(songEngine.effectiveBpm);
      } else if (eventType === 'tempoChange') {
        setEffectiveBpm(payload.bpm);
        setTempoMultiplier(payload.mult);
      } else if (eventType === 'metronomeChange') {
        setIsMetronomeEnabled(payload.enabled);
      }
    });

    return () => unsubscribe();
  }, []);

  const handlePlayPause = () => {
    if (isPlaying) {
      songEngine.stop();
    } else {
      songEngine.start();
    }
  };

  const handleRestart = () => {
    songEngine.resetPlayback();
  };

  const handleSongChange = (e) => {
    songEngine.setSong(e.target.value);
  };

  const handleVolumeChange = (e) => {
    const vol = parseFloat(e.target.value);
    setBackingVolume(vol);
    songEngine.setBackingVolume(vol);
  };

  const handleTempoSlider = (e) => {
    const mult = parseFloat(e.target.value);
    setTempoMultiplier(mult);
    songEngine.setTempoMultiplier(mult);
  };

  return (
    <div className="glass-panel info-card" style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Title & Status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Music size={16} style={{ color: 'var(--accent-cyan)' }} />
          <h3 style={{
            fontSize: '14px',
            textTransform: 'uppercase',
            color: 'var(--text-primary)',
            letterSpacing: '0.05em',
            margin: 0,
            fontWeight: '700'
          }}>
            Song Play-Along Studio
          </h3>
        </div>
        <span className={`status-pill ${isPlaying ? 'active' : 'inactive'}`} style={{ fontSize: '10px' }}>
          {isPlaying ? 'PLAYING' : 'READY'}
        </span>
      </div>

      {/* Song Selector */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <label style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
          CHOOSE BACKING TRACK:
        </label>
        <select
          value={song.id}
          onChange={handleSongChange}
          style={{
            background: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: '8px',
            color: 'var(--text-primary)',
            padding: '8px 12px',
            fontSize: '13px',
            fontFamily: 'var(--font-sans)',
            cursor: 'pointer',
            outline: 'none'
          }}
        >
          {BUILT_IN_SONGS.map(s => (
            <option key={s.id} value={s.id} style={{ background: '#0f172a', color: '#fff' }}>
              {s.title} — {s.genre} ({s.bpm} BPM)
            </option>
          ))}
        </select>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
          {song.description}
        </span>
      </div>

      {/* Main Playback Buttons */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={handlePlayPause}
          style={{
            flexGrow: 1,
            background: isPlaying ? 'rgba(239, 68, 68, 0.25)' : 'rgba(16, 185, 129, 0.25)',
            border: `1px solid ${isPlaying ? '#ef4444' : '#10b981'}`,
            color: isPlaying ? '#f87171' : '#34d399',
            borderRadius: '8px',
            padding: '10px',
            fontSize: '13px',
            fontWeight: 'bold',
            fontFamily: 'var(--font-mono)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            cursor: 'pointer'
          }}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          {isPlaying ? 'PAUSE ACCOMPANIMENT' : 'START PLAY-ALONG'}
        </button>

        <button
          onClick={handleRestart}
          style={{
            background: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            color: 'var(--text-secondary)',
            borderRadius: '8px',
            padding: '10px 14px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          title="Restart Progression"
        >
          <RotateCcw size={15} />
        </button>

        <button
          onClick={() => songEngine.toggleMetronome()}
          style={{
            background: isMetronomeEnabled ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255, 255, 255, 0.08)',
            border: `1px solid ${isMetronomeEnabled ? '#a855f7' : 'rgba(255, 255, 255, 0.2)'}`,
            color: isMetronomeEnabled ? '#c084fc' : 'var(--text-secondary)',
            borderRadius: '8px',
            padding: '10px 14px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          title={isMetronomeEnabled ? 'Metronome Click: ON' : 'Metronome Click: OFF'}
        >
          {isMetronomeEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
        </button>
      </div>

      {/* Chord Progression Roadmap */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
          MEASURE SEQUENCE:
        </span>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '6px'
        }}>
          {song.measures.map((m, idx) => {
            const isCurrent = isPlaying && (currentMeasure % song.measures.length === idx);
            return (
              <div
                key={idx}
                style={{
                  background: isCurrent
                    ? 'linear-gradient(135deg, rgba(6, 182, 212, 0.35), rgba(59, 130, 246, 0.35))'
                    : 'rgba(255, 255, 255, 0.04)',
                  border: isCurrent ? '2px solid #06b6d4' : '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '6px',
                  padding: '6px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  boxShadow: isCurrent ? '0 0 12px rgba(6, 182, 212, 0.5)' : 'none',
                  transform: isCurrent ? 'scale(1.05)' : 'scale(1)',
                  transition: 'all 0.15s ease'
                }}
              >
                <span style={{ fontSize: '9px', color: isCurrent ? '#38bdf8' : 'var(--text-muted)' }}>
                  Bar {idx + 1}
                </span>
                <span style={{
                  fontSize: '15px',
                  fontWeight: 'bold',
                  color: isCurrent ? '#ffffff' : 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)'
                }}>
                  {m.chord}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sliders for Tempo & Volume */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '4px' }}>
        {/* Tempo Slider */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontFamily: 'var(--font-mono)', marginBottom: '4px' }}>
            <span style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Sliders size={12} /> TEMPO:
            </span>
            <span style={{ color: 'var(--accent-cyan)' }}>
              {effectiveBpm} BPM ({tempoMultiplier.toFixed(2)}x)
            </span>
          </div>
          <input
            type="range"
            min="0.5"
            max="1.5"
            step="0.05"
            value={tempoMultiplier}
            onChange={handleTempoSlider}
            style={{ width: '100%', accentColor: 'var(--accent-cyan)' }}
          />
        </div>

        {/* Volume Slider */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontFamily: 'var(--font-mono)', marginBottom: '4px' }}>
            <span style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Volume2 size={12} /> BACKING DRUM & BASS:
            </span>
            <span style={{ color: 'var(--accent-cyan)' }}>
              {Math.round(backingVolume * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={backingVolume}
            onChange={handleVolumeChange}
            style={{ width: '100%', accentColor: 'var(--accent-cyan)' }}
          />
        </div>
      </div>

      {/* Pro-Tip */}
      <div style={{
        background: 'rgba(6, 182, 212, 0.08)',
        border: '1px solid rgba(6, 182, 212, 0.2)',
        borderRadius: '8px',
        padding: '10px',
        display: 'flex',
        gap: '8px',
        fontSize: '12px',
        color: '#bae6fd',
        lineHeight: '1.4'
      }}>
        <Zap size={15} style={{ color: 'var(--accent-cyan)', flexShrink: 0, marginTop: '2px' }} />
        <span>
          <strong>AR Ghost Finger Guidance:</strong> Look at your guitar fretboard on screen! Glowing rings show where to place your fingers for the target chord.
        </span>
      </div>
    </div>
  );
}
