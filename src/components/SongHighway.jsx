import { useState, useEffect } from 'react';
import { songEngine, BUILT_IN_SONGS } from '../utils/song_engine';
import { Play, Pause, RotateCcw, Volume2, VolumeX, Flame, Award, Music, ChevronDown, Eye, EyeOff } from 'lucide-react';

export default function SongHighway({
  showGhostFrets,
  onToggleGhostFrets
}) {
  const [song, setSong] = useState(songEngine.currentSong);
  const [isPlaying, setIsPlaying] = useState(songEngine.isPlaying);
  const [currentMeasure, setCurrentMeasure] = useState(songEngine.currentMeasure);
  const [currentBeat, setCurrentBeat] = useState(songEngine.currentBeat);
  const [targetChord, setTargetChord] = useState(songEngine.getTargetChord());
  const [upcomingChords, setUpcomingChords] = useState(songEngine.getUpcomingChords(4));
  const [effectiveBpm, setEffectiveBpm] = useState(songEngine.effectiveBpm);
  const [tempoMultiplier, setTempoMultiplier] = useState(songEngine.tempoMultiplier);
  const [isMetronomeEnabled, setIsMetronomeEnabled] = useState(songEngine.isMetronomeEnabled);
  const [score, setScore] = useState(songEngine.score);
  const [combo, setCombo] = useState(songEngine.combo);
  const [playLevel, setPlayLevel] = useState(songEngine.playLevel || 1);
  const [hitFeedback, setHitFeedback] = useState(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    const unsubscribe = songEngine.subscribe((eventType, payload) => {
      if (eventType === 'beat') {
        setCurrentMeasure(payload.measure);
        setCurrentBeat(payload.beat);
        setTargetChord(payload.targetChord);
        setUpcomingChords(payload.nextChords);
        setEffectiveBpm(payload.effectiveBpm);
      } else if (eventType === 'playStateChange') {
        setIsPlaying(payload.isPlaying);
      } else if (eventType === 'songChange') {
        setSong(payload.song);
        setTargetChord(songEngine.getTargetChord());
        setUpcomingChords(songEngine.getUpcomingChords(4));
        setEffectiveBpm(songEngine.effectiveBpm);
      } else if (eventType === 'tempoChange') {
        setEffectiveBpm(payload.bpm);
        setTempoMultiplier(payload.mult);
      } else if (eventType === 'levelChange') {
        setPlayLevel(payload.level);
      } else if (eventType === 'metronomeChange') {
        setIsMetronomeEnabled(payload.enabled);
      } else if (eventType === 'hit') {
        setScore(songEngine.score);
        setCombo(songEngine.combo);
        setHitFeedback(payload);
        setTimeout(() => setHitFeedback(null), 1200);
      } else if (eventType === 'seek') {
        setCurrentMeasure(payload.measure);
        setCurrentBeat(payload.beat);
        setTargetChord(payload.targetChord);
        setUpcomingChords(songEngine.getUpcomingChords(4));
        setScore(songEngine.score);
        setCombo(songEngine.combo);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleLevelChange = (lvl) => {
    songEngine.setPlayLevel(lvl);
    setPlayLevel(lvl);
  };

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

  const handleSongSelect = (songId) => {
    songEngine.setSong(songId);
  };

  const handleTempoChange = (multiplier) => {
    songEngine.setTempoMultiplier(multiplier);
  };

  return (
    <div style={{
      position: 'absolute',
      top: '12px',
      left: '12px',
      right: '64px',
      zIndex: 22,
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      pointerEvents: 'none'
    }}>
      {/* Top Banner Highway Container */}
      <div style={{
        background: 'rgba(15, 23, 42, 0.88)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        borderRadius: '12px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
        padding: isCollapsed ? '8px 14px' : '10px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        pointerEvents: 'auto',
        transition: 'all 0.25s ease'
      }}>
        {/* Header Controls Row */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px'
        }}>
          {/* Left: Song Picker & Play Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={handlePlayPause}
              style={{
                background: isPlaying ? 'rgba(239, 68, 68, 0.25)' : 'rgba(16, 185, 129, 0.25)',
                border: `1px solid ${isPlaying ? '#ef4444' : '#10b981'}`,
                color: isPlaying ? '#f87171' : '#34d399',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 'bold',
                fontFamily: 'var(--font-mono)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              title={isPlaying ? 'Pause Backing Audio' : 'Start Backing Audio & Strum Guide'}
            >
              {isPlaying ? <Pause size={14} /> : <Play size={14} />}
              {isPlaying ? 'PAUSE' : 'PLAY SONG'}
            </button>

            <button
              onClick={handleRestart}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.18)',
                color: 'var(--text-secondary)',
                borderRadius: '8px',
                padding: '6px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="Restart Song from Beginning"
            >
              <RotateCcw size={13} />
            </button>

            {/* Song Selection Dropdown */}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Music size={13} style={{ position: 'absolute', left: '8px', color: 'var(--accent-cyan)', pointerEvents: 'none' }} />
              <select
                value={song.id}
                onChange={(e) => handleSongSelect(e.target.value)}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.18)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  padding: '6px 24px 6px 26px',
                  fontSize: '12px',
                  fontFamily: 'var(--font-sans)',
                  cursor: 'pointer',
                  outline: 'none',
                  appearance: 'none',
                  fontWeight: '600'
                }}
              >
                {BUILT_IN_SONGS.map(s => {
                  const toneEmoji = s.recommendedTone === 'distortion' ? '🔥' : (s.recommendedTone === 'electric_clean' ? '⚡' : '🎸');
                  return (
                    <option key={s.id} value={s.id} style={{ background: '#0f172a', color: '#fff' }}>
                      {toneEmoji} {s.title} ({s.bpm} BPM)
                    </option>
                  );
                })}
              </select>
              <ChevronDown size={12} style={{ position: 'absolute', right: '8px', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            </div>

            {/* Tempo Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(0,0,0,0.25)', borderRadius: '6px', padding: '2px 4px' }}>
              {[0.75, 1.0, 1.25].map(mult => (
                <button
                  key={mult}
                  onClick={() => handleTempoChange(mult)}
                  style={{
                    background: tempoMultiplier === mult ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
                    border: tempoMultiplier === mult ? '1px solid #38bdf8' : 'none',
                    color: tempoMultiplier === mult ? '#38bdf8' : 'var(--text-muted)',
                    borderRadius: '4px',
                    padding: '3px 6px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    cursor: 'pointer'
                  }}
                >
                  {mult}x
                </button>
              ))}
              <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', marginLeft: '4px' }}>
                {effectiveBpm} BPM
              </span>
            </div>

            {/* Level Difficulty Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(0,0,0,0.35)', borderRadius: '7px', padding: '2px 3px' }}>
              {[
                { id: 1, label: '⭐ L1 Auto', title: 'Level 1: Auto-Chord (Strum sounds target chord regardless of fretting)' },
                { id: 2, label: '🎯 L2 Assist', title: 'Level 2: Smart Assist (Plays chord if fingers are close enough)' },
                { id: 3, label: '🔥 L3 Pro', title: 'Level 3: Pro (Realistic physics, exact fretting)' }
              ].map(lvl => (
                <button
                  key={lvl.id}
                  onClick={() => handleLevelChange(lvl.id)}
                  title={lvl.title}
                  style={{
                    background: playLevel === lvl.id
                      ? (lvl.id === 1 ? 'rgba(56, 189, 248, 0.28)' : lvl.id === 2 ? 'rgba(16, 185, 129, 0.28)' : 'rgba(245, 158, 11, 0.28)')
                      : 'transparent',
                    border: playLevel === lvl.id
                      ? `1px solid ${lvl.id === 1 ? '#38bdf8' : lvl.id === 2 ? '#10b981' : '#f59e0b'}`
                      : '1px solid transparent',
                    color: playLevel === lvl.id
                      ? (lvl.id === 1 ? '#38bdf8' : lvl.id === 2 ? '#34d399' : '#fbbf24')
                      : 'var(--text-muted)',
                    borderRadius: '5px',
                    padding: '3px 8px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {lvl.label}
                </button>
              ))}
            </div>
          </div>

          {/* Right: Metronome, Ghost Frets Toggle, Score & Combo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Metronome Toggle */}
            <button
              onClick={() => songEngine.toggleMetronome()}
              style={{
                background: isMetronomeEnabled ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                border: `1px solid ${isMetronomeEnabled ? '#a855f7' : 'rgba(255, 255, 255, 0.15)'}`,
                color: isMetronomeEnabled ? '#c084fc' : 'var(--text-muted)',
                borderRadius: '6px',
                padding: '5px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)'
              }}
              title="Toggle Metronome Audio Click"
            >
              {isMetronomeEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
              CLICK
            </button>

            {/* Ghost Frets Toggle */}
            <button
              onClick={onToggleGhostFrets}
              style={{
                background: showGhostFrets ? 'rgba(6, 182, 212, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                border: `1px solid ${showGhostFrets ? '#06b6d4' : 'rgba(255, 255, 255, 0.15)'}`,
                color: showGhostFrets ? '#22d3ee' : 'var(--text-muted)',
                borderRadius: '6px',
                padding: '5px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)'
              }}
              title="Toggle AR Glowing Ghost Fingering on Real Guitar Fretboard"
            >
              {showGhostFrets ? <Eye size={13} /> : <EyeOff size={13} />}
              AR FRETS
            </button>

            {/* Score & Combo */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px'
            }}>
              {combo > 1 && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  color: '#f59e0b',
                  fontWeight: 'bold',
                  animation: 'pulse 1s infinite'
                }}>
                  <Flame size={14} />
                  <span>x{combo}</span>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#10b981' }}>
                <Award size={14} />
                <span>{score.toLocaleString()}</span>
              </div>
            </div>

            {/* Collapse Button */}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center'
              }}
              title={isCollapsed ? 'Expand Highway' : 'Collapse Highway'}
            >
              <ChevronDown size={14} style={{ transform: isCollapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>
          </div>
        </div>

        {/* Main Highway Ribbon (if not collapsed) */}
        {!isCollapsed && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            background: 'rgba(0, 0, 0, 0.45)',
            borderRadius: '10px',
            padding: '8px 12px',
            border: '1px solid rgba(255, 255, 255, 0.08)'
          }}>
            {/* CURRENT TARGET CHORD CARD */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '100px',
              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.25), rgba(59, 130, 246, 0.25))',
              border: '2px solid #06b6d4',
              borderRadius: '8px',
              padding: '6px 12px',
              boxShadow: '0 0 20px rgba(6, 182, 212, 0.35)',
              position: 'relative'
            }}>
              <span style={{ fontSize: '9px', textTransform: 'uppercase', color: '#38bdf8', letterSpacing: '0.08em', fontWeight: '700' }}>
                PLAY NOW · BAR {currentMeasure + 1}
              </span>
              <span style={{ fontSize: '24px', fontWeight: '900', color: '#ffffff', lineHeight: 1.1, fontFamily: 'var(--font-mono)' }}>
                {targetChord ? targetChord.short : '—'}
              </span>
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.8)', whiteSpace: 'nowrap' }}>
                {targetChord ? targetChord.name : ''}
              </span>

              {/* Beat Dots Indicator */}
              <div style={{ display: 'flex', gap: '5px', marginTop: '6px' }}>
                {[0, 1, 2, 3].map(beatIdx => (
                  <div
                    key={beatIdx}
                    style={{
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      background: currentBeat === beatIdx ? '#38bdf8' : 'rgba(255, 255, 255, 0.2)',
                      boxShadow: currentBeat === beatIdx ? '0 0 8px #38bdf8' : 'none',
                      transform: currentBeat === beatIdx ? 'scale(1.25)' : 'scale(1)',
                      transition: 'all 0.08s ease'
                    }}
                  />
                ))}
              </div>
            </div>

            {/* STRIKE DIVIDER LINE */}
            <div style={{
              width: '2px',
              height: '52px',
              background: 'linear-gradient(to bottom, transparent, #06b6d4, transparent)'
            }} />

            {/* UPCOMING CHORDS STREAM */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              flexGrow: 1,
              overflowX: 'hidden',
              padding: '4px 0'
            }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                NEXT:
              </span>
              {upcomingChords.map((up, i) => (
                <div
                  key={`${up.chord}-${i}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '8px',
                    padding: '4px 14px',
                    minWidth: '60px',
                    opacity: 1 - i * 0.22,
                    transform: `scale(${1 - i * 0.06})`,
                    transition: 'all 0.3s ease'
                  }}
                >
                  <span style={{ fontSize: '16px', fontWeight: 'bold', color: '#f3f4f6', fontFamily: 'var(--font-mono)' }}>
                    {up.chord}
                  </span>
                  <span style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>
                    +{i + 1} Bar
                  </span>
                </div>
              ))}
            </div>

            {/* RHYTHM STRUM GUIDE ARROWS */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '3px',
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '6px',
              padding: '4px 10px',
              border: '1px solid rgba(255, 255, 255, 0.07)'
            }}>
              <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                RHYTHM
              </span>
              <div style={{ display: 'flex', gap: '6px', fontSize: '13px' }}>
                <span style={{ color: currentBeat === 0 || currentBeat === 2 ? '#38bdf8' : 'rgba(255,255,255,0.3)', fontWeight: 'bold' }}>
                  ⬇️
                </span>
                <span style={{ color: currentBeat === 1 || currentBeat === 3 ? '#a855f7' : 'rgba(255,255,255,0.3)', fontWeight: 'bold' }}>
                  ⬆️
                </span>
              </div>
            </div>

            {/* REAL-TIME HIT RATING POPUP */}
            {hitFeedback && (
              <div style={{
                position: 'absolute',
                top: '-32px',
                left: '50%',
                transform: 'translateX(-50%)',
                background: hitFeedback.isMatch ? 'rgba(16, 185, 129, 0.95)' : 'rgba(239, 68, 68, 0.9)',
                color: '#fff',
                padding: '4px 14px',
                borderRadius: '20px',
                fontSize: '13px',
                fontWeight: '900',
                fontFamily: 'var(--font-mono)',
                boxShadow: `0 0 16px ${hitFeedback.isMatch ? '#10b981' : '#ef4444'}`,
                animation: 'fadeUp 0.8s ease forwards',
                zIndex: 30
              }}>
                {hitFeedback.rating} {hitFeedback.points > 0 && `+${hitFeedback.points}`}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
