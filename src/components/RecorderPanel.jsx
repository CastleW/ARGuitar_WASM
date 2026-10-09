import { useState } from 'react';
import { Circle, Square, Flag, X, Download, FolderCheck, RotateCcw, AlertTriangle } from 'lucide-react';
import { ARUCO_MARKER_MAP } from '../utils/guitar_math';

const markerLabel = (id) => (ARUCO_MARKER_MAP[id] !== undefined ? `${ARUCO_MARKER_MAP[id]}cm from nut` : '');

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function pctColor(pct) {
  if (pct >= 85) return '#86efac';
  if (pct >= 50) return '#fbbf24';
  return '#fca5a5';
}

const panelStyle = {
  background: 'rgba(15, 23, 42, 0.96)',
  backdropFilter: 'blur(16px)',
  borderRadius: '12px',
  border: '1px solid rgba(239, 68, 68, 0.35)',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6), 0 0 20px rgba(239, 68, 68, 0.12)',
  padding: '12px 16px',
  width: '100%',
  maxWidth: '520px',
  color: '#e2e8f0',
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  boxSizing: 'border-box'
};

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid rgba(255, 255, 255, 0.16)',
  borderRadius: '6px',
  color: '#f1f5f9',
  padding: '6px 8px',
  fontSize: '11.5px',
  fontFamily: 'var(--font-mono)',
  outline: 'none'
};

const smallBtn = {
  display: 'flex',
  alignItems: 'center',
  gap: '5px',
  padding: '5px 10px',
  fontSize: '11px',
  borderRadius: '6px',
  border: '1px solid rgba(255, 255, 255, 0.18)',
  background: 'rgba(255, 255, 255, 0.08)',
  color: '#cbd5e1',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  whiteSpace: 'nowrap',
  transition: 'all 0.15s ease'
};

function StatTile({ label, value, color = '#e2e8f0', title }) {
  return (
    <div title={title} style={{
      background: 'rgba(255, 255, 255, 0.04)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: '8px',
      padding: '6px 8px',
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      minWidth: 0
    }}>
      <span style={{ color: '#64748b', fontSize: '9.5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ color, fontWeight: 'bold', fontSize: '13px' }}>{value}</span>
    </div>
  );
}

function StatsGrid({ stats }) {
  if (!stats) return null;
  const neck = stats.neck || {};
  const cands = stats.candidates || {};
  const dictHist = cands.dictRejectHammingHist || {};
  const borderHist = cands.borderRejectHammingHist || {};
  const nearMissDict = (dictHist[1] || 0) + (dictHist[2] || 0);
  const nearMissBorder = (borderHist[0] || 0) + (borderHist[1] || 0) + (borderHist[2] || 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
        <StatTile
          label="≥2 markers"
          value={`${stats.pctTwoPlusMarkers}%`}
          color={pctColor(stats.pctTwoPlusMarkers)}
          title="Share of scanned frames with at least 2 decoded markers (needed to draw the neck)"
        />
        <StatTile
          label="Neck live"
          value={`${neck.rawPct ?? 0}%`}
          color={pctColor(neck.rawPct ?? 0)}
          title={`Raw geometry ${neck.rawPct}% · coasting ${neck.coastPct}% · none ${neck.nonePct}%`}
        />
        <StatTile
          label="Dropouts"
          value={`${neck.dropouts ?? 0}`}
          color={(neck.dropouts ?? 0) > 0 ? '#fbbf24' : '#86efac'}
          title={`Longest dropout: ${neck.longestDropoutFrames ?? 0} scanned frames`}
        />
        <StatTile
          label="ArUco ms"
          value={`${stats.avgArucoMs ?? 0}`}
          title="Average detector time per scanned frame"
        />
      </div>

      {/* Per-marker detection rate */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
        {Object.entries(stats.perId || {}).map(([id, info]) => (
          <div
            key={id}
            title={`Marker ${id} (${markerLabel(id)}) · avg side ${info.avgSidePx ?? '–'}px · min ${info.minSidePx ?? '–'}px`}
            style={{
              borderRadius: '8px',
              padding: '5px 4px',
              textAlign: 'center',
              border: `1px solid ${pctColor(info.pct)}55`,
              background: `${pctColor(info.pct)}14`
            }}
          >
            <div style={{ color: '#94a3b8', fontSize: '9.5px' }}>ID {id}</div>
            <div style={{ color: pctColor(info.pct), fontWeight: 'bold', fontSize: '12.5px' }}>{info.pct}%</div>
            <div style={{ color: '#64748b', fontSize: '9px' }}>{info.avgSidePx ? `${info.avgSidePx}px` : '—'}</div>
          </div>
        ))}
      </div>

      <div style={{ color: '#94a3b8', fontSize: '10.5px', lineHeight: 1.5 }}>
        Quads: <strong style={{ color: '#cbd5e1' }}>{cands.quads ?? 0}</strong>
        {' · '}border-rejected: <strong style={{ color: '#fbbf24' }}>{cands.border ?? 0}</strong>
        {' · '}dict-rejected: <strong style={{ color: '#fbbf24' }}>{cands.dict ?? 0}</strong>
        {(nearMissDict > 0 || nearMissBorder > 0) && (
          <div style={{ color: '#fcd34d' }}>
            Near misses (≤2 bits off a guitar ID): {nearMissDict} dict, {nearMissBorder} border
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Session recorder control panel.
 * state: 'idle' | 'recording' | 'saving' | 'done'
 */
export default function RecorderPanel({
  state,
  supported,
  cameraActive,
  liveStats,
  result,
  error,
  onStart,
  onStop,
  onMark,
  onReset,
  onClose
}) {
  const [label, setLabel] = useState(() => localStorage.getItem('arguitar_rec_label') || '');
  const [recordOverlay, setRecordOverlay] = useState(() => localStorage.getItem('arguitar_rec_overlay') === 'true');
  const [note, setNote] = useState('');
  const [lastMark, setLastMark] = useState(null);

  const handleStart = () => {
    localStorage.setItem('arguitar_rec_label', label);
    localStorage.setItem('arguitar_rec_overlay', recordOverlay ? 'true' : 'false');
    onStart({ label: label.trim(), recordOverlay });
  };

  const handleMark = () => {
    const ev = onMark(note.trim());
    if (ev) {
      setLastMark(ev);
      setNote('');
    }
  };

  const isRecording = state === 'recording';

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={isRecording ? 'rec-dot recording' : 'rec-dot'} />
          <span style={{ fontWeight: 'bold', fontSize: '12px', color: '#fff' }}>ArUco Session Recorder</span>
          {isRecording && (
            <span style={{
              fontSize: '10px',
              padding: '1px 7px',
              borderRadius: '999px',
              background: 'rgba(239, 68, 68, 0.22)',
              color: '#fca5a5',
              border: '1px solid rgba(239, 68, 68, 0.45)',
              fontWeight: 'bold'
            }}>
              REC {formatTime(liveStats?.elapsedSec)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '2px', display: 'flex' }}
          title={isRecording ? 'Hide panel (recording continues)' : 'Close recorder'}
        >
          <X size={14} />
        </button>
      </div>

      {!supported && (
        <div style={{ color: '#fca5a5', display: 'flex', gap: '6px', alignItems: 'center' }}>
          <AlertTriangle size={13} /> MediaRecorder is not supported in this browser.
        </div>
      )}

      {error && (
        <div style={{ color: '#fca5a5', display: 'flex', gap: '6px', alignItems: 'center' }}>
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {/* Idle: setup */}
      {state === 'idle' && supported && (
        <>
          <div style={{ color: '#94a3b8', lineHeight: 1.5 }}>
            Records the raw camera feed plus per-frame ArUco metrics (every candidate quad, why it was
            rejected, marker sizes, poses and neck-fit path) for offline analysis.
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ color: '#cbd5e1' }}>Scenario label</span>
            <input
              id="rec-scenario-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. lamp on, 1m away, neck tilted back"
              style={inputStyle}
              onKeyDown={(e) => { if (e.key === 'Enter' && cameraActive) handleStart(); }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#cbd5e1', cursor: 'pointer' }}>
            <input
              id="rec-overlay-toggle"
              type="checkbox"
              checked={recordOverlay}
              onChange={(e) => setRecordOverlay(e.target.checked)}
            />
            Also record AR overlay video (extra CPU; shows what you saw)
          </label>
          <button
            id="rec-start-btn"
            type="button"
            className="btn-premium"
            disabled={!cameraActive}
            onClick={handleStart}
            style={{
              justifyContent: 'center',
              background: cameraActive
                ? 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)'
                : 'rgba(100, 116, 139, 0.35)',
              cursor: cameraActive ? 'pointer' : 'not-allowed',
              boxShadow: cameraActive ? '0 4px 18px rgba(239, 68, 68, 0.35)' : 'none'
            }}
            title={cameraActive ? 'Start recording' : 'Start the camera first'}
          >
            <Circle size={13} fill="currentColor" /> {cameraActive ? 'Start Recording' : 'Start camera first'}
          </button>
        </>
      )}

      {/* Recording: live stats + event marking */}
      {isRecording && (
        <>
          <StatsGrid stats={liveStats} />
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              id="rec-event-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleMark(); }}
              placeholder="Event note (e.g. G chord fret 3, glare)"
              style={inputStyle}
            />
            <button id="rec-mark-btn" type="button" onClick={handleMark} style={{ ...smallBtn, borderColor: 'rgba(56, 189, 248, 0.5)', color: '#7dd3fc' }} title="Mark event (shortcut: M)">
              <Flag size={12} /> Mark
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <span style={{ color: '#64748b', fontSize: '10px' }}>
              {liveStats?.frames ?? 0} frames · {liveStats?.events ?? 0} events
              {lastMark ? ` · last mark @ ${(lastMark.t / 1000).toFixed(1)}s` : ''}
              {' · '}press <kbd style={{ color: '#cbd5e1' }}>M</kbd> to mark
            </span>
            <button
              id="rec-stop-btn"
              type="button"
              onClick={onStop}
              style={{ ...smallBtn, background: 'rgba(239, 68, 68, 0.25)', borderColor: '#ef4444', color: '#fecaca', fontWeight: 'bold' }}
            >
              <Square size={11} fill="currentColor" /> Stop &amp; Save
            </button>
          </div>
        </>
      )}

      {state === 'saving' && (
        <div style={{ color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="rec-spinner" /> Finalising video and saving files…
        </div>
      )}

      {/* Done: summary + file locations */}
      {state === 'done' && result && (
        <>
          <StatsGrid stats={result.summary} />
          <div style={{
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '8px',
            padding: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: result.save?.mode === 'server' ? '#86efac' : '#7dd3fc', fontWeight: 'bold' }}>
              {result.save?.mode === 'server' ? <FolderCheck size={13} /> : <Download size={13} />}
              {result.save?.mode === 'server' ? 'Saved to project recordings/ folder' : 'Download files'}
            </div>
            {(result.save?.items || []).map(item => (
              <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '10.5px' }}>
                {item.url ? (
                  <a href={item.url} download={item.name} style={{ color: '#7dd3fc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.name}
                  </a>
                ) : (
                  <span style={{ color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.path || item.name}</span>
                )}
                <span style={{ color: '#64748b', flexShrink: 0 }}>{formatBytes(item.size)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#64748b', fontSize: '10px' }}>
              {result.summary?.elapsedSec}s · {result.summary?.frames} frames · {result.summary?.events} events
            </span>
            <button id="rec-new-btn" type="button" onClick={onReset} style={smallBtn}>
              <RotateCcw size={12} /> New Recording
            </button>
          </div>
        </>
      )}
    </div>
  );
}
