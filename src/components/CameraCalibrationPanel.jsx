import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Printer, Camera, Trash2, Check, RotateCcw, Crosshair } from 'lucide-react';
import { detectMarkers } from '../utils/aruco_detector';
import {
  CALIB_BOARD,
  MIN_VIEWS,
  RECOMMENDED_VIEWS,
  MIN_MARKERS_PER_VIEW,
  openPrintableBoard,
  imageDataToGray,
  refineMarkerCorners,
  buildView,
  viewNovelty,
  cornerMotion,
  calibrateFromViews,
  getStreamCameraInfo,
  getCalibrationFor,
  saveCalibration,
  deleteCalibration
} from '../utils/camera_calibration';

const COVER_COLS = 6;
const COVER_ROWS = 4;
const TICK_MS = 110;            // ~9 fps detection loop
const STILL_PX = 1.2;           // mean corner motion considered "still"
const STILL_FRAMES = 3;         // consecutive still frames before auto-capture
const MIN_NOVELTY = 0.12;       // how different a pose must be from captured ones
const MARKER_MM_KEY = 'arguitar_calib_marker_mm';

const GRADE_STYLE = {
  excellent: { color: '#4ade80', label: 'Excellent' },
  good: { color: '#a3e635', label: 'Good' },
  poor: { color: '#f59e0b', label: 'Poor: consider retaking' },
  failed: { color: '#f87171', label: 'Failed' }
};

/**
 * Guided per-camera intrinsic calibration using a printed ArUco grid board.
 * The main AR processing loop is paused while this panel is open.
 */
export default function CameraCalibrationPanel({ videoRef, secondaryVideoRef, stereoEnabled, mirrored = true, onClose, addLog }) {
  const [target, setTarget] = useState('cam1');
  const [markerMm, setMarkerMm] = useState(() => {
    const v = parseFloat(localStorage.getItem(MARKER_MM_KEY));
    return v > 10 && v < 300 ? v : CALIB_BOARD.defaultMarkerMm;
  });
  const [autoCapture, setAutoCapture] = useState(true);
  const [viewCount, setViewCount] = useState(0);
  const [coverage, setCoverage] = useState(() => new Array(COVER_COLS * COVER_ROWS).fill(false));
  const [live, setLive] = useState({ markers: 0, msg: 'Starting camera…', tone: 'info' });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const videoFor = (t) => (t === 'cam2' ? secondaryVideoRef.current : videoRef.current);
  const readCamInfo = (t) => {
    const info = getStreamCameraInfo(videoFor(t));
    return { label: info?.label || (t === 'cam2' ? 'Camera 2' : 'Camera 1'), existing: getCalibrationFor(info) };
  };
  const [camInfo, setCamInfo] = useState({ label: '', existing: null });
  const camInfoForRef = useRef(null);
  const existing = camInfo.existing;
  const camLabel = camInfo.label;
  const [flash, setFlash] = useState(false);

  const previewRef = useRef(null);
  const workCanvasRef = useRef(null);
  const viewsRef = useRef([]);
  const prevMarkersRef = useRef(null);
  const stillRef = useRef(0);
  const lastCaptureRef = useRef(0);
  const latestViewRef = useRef(null);
  const autoRef = useRef(autoCapture);
  const markerMmRef = useRef(markerMm);
  const resultRef = useRef(result);

  useEffect(() => { autoRef.current = autoCapture; }, [autoCapture]);
  useEffect(() => { resultRef.current = result; }, [result]);
  useEffect(() => {
    markerMmRef.current = markerMm;
    localStorage.setItem(MARKER_MM_KEY, String(markerMm));
  }, [markerMm]);

  const getVideo = () => videoFor(target);

  const resetSession = () => {
    viewsRef.current = [];
    prevMarkersRef.current = null;
    stillRef.current = 0;
    setViewCount(0);
    setCoverage(new Array(COVER_COLS * COVER_ROWS).fill(false));
    setResult(null);
  };

  // Changing camera or marker size invalidates collected views
  const selectTarget = (t) => {
    if (t === target) return;
    resetSession();
    setTarget(t);
    setCamInfo(readCamInfo(t));
  };
  const changeMarkerMm = (v) => {
    resetSession();
    setMarkerMm(v);
  };

  const markCoverage = (view, w, h) => {
    setCoverage(prev => {
      const next = prev.slice();
      for (const [u, v] of view.img) {
        const c = Math.min(COVER_COLS - 1, Math.max(0, Math.floor((u / w) * COVER_COLS)));
        const r = Math.min(COVER_ROWS - 1, Math.max(0, Math.floor((v / h) * COVER_ROWS)));
        next[r * COVER_COLS + c] = true;
      }
      return next;
    });
  };

  const captureView = (view, w, h) => {
    viewsRef.current.push({ ...view, w, h });
    lastCaptureRef.current = performance.now();
    setViewCount(viewsRef.current.length);
    markCoverage(view, w, h);
    setFlash(true);
    setTimeout(() => setFlash(false), 140);
  };

  // Detection / preview loop
  useEffect(() => {
    let timer = null;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      timer = setTimeout(tick, TICK_MS);
      if (resultRef.current) return; // freeze while reviewing a result

      const cv = window.cv;
      const video = getVideo();
      const preview = previewRef.current;
      if (!cv || !cv.Mat || !preview) return;
      if (!video || video.readyState < 2 || !video.videoWidth) {
        setLive({ markers: 0, msg: target === 'cam2' ? 'Camera 2 is not running: enable Stereo 3D and pick a 2nd camera' : 'Camera is not running: start the camera first', tone: 'warn' });
        return;
      }

      const w = video.videoWidth;
      const h = video.videoHeight;
      if (camInfoForRef.current !== target) {
        camInfoForRef.current = target;
        setCamInfo(readCamInfo(target));
      }
      if (!workCanvasRef.current) workCanvasRef.current = document.createElement('canvas');
      const work = workCanvasRef.current;
      if (work.width !== w || work.height !== h) { work.width = w; work.height = h; }
      const wctx = work.getContext('2d', { willReadFrequently: true });
      wctx.drawImage(video, 0, 0, w, h);
      const imgData = wctx.getImageData(0, 0, w, h);

      let markers;
      try {
        const mat = cv.matFromImageData(imgData);
        markers = (detectMarkers(cv, mat, {}).markers || []).filter(m => CALIB_BOARD.ids.includes(m.id));
        mat.delete();
      } catch {
        return;
      }
      if (markers.length > 0) {
        const gray = imageDataToGray(imgData);
        markers = markers.map(m => ({ ...m, corners: refineMarkerCorners(gray, w, h, m.corners) }));
      }

      // Planar consistency check (drops misread / foreign markers)
      const { view, rejected } = buildView(markers, markerMmRef.current, w, h, cv);
      const rejectedSet = new Set(rejected);

      // Draw preview: cyan = accepted, red = rejected; larger dot marks each marker's corner 0
      if (preview.width !== w || preview.height !== h) { preview.width = w; preview.height = h; }
      const pctx = preview.getContext('2d');
      pctx.putImageData(imgData, 0, 0);
      pctx.lineWidth = Math.max(2, w / 400);
      const dot = Math.max(3, w / 320);
      for (const m of markers) {
        const bad = rejectedSet.has(m.id);
        pctx.strokeStyle = bad ? '#ef4444' : '#22d3ee';
        pctx.beginPath();
        m.corners.forEach((p, i) => (i === 0 ? pctx.moveTo(p.x, p.y) : pctx.lineTo(p.x, p.y)));
        pctx.closePath();
        pctx.stroke();
        m.corners.forEach((p, i) => {
          pctx.fillStyle = i === 0 ? '#facc15' : (bad ? '#ef4444' : '#f472b6');
          pctx.beginPath(); pctx.arc(p.x, p.y, i === 0 ? dot * 1.8 : dot, 0, Math.PI * 2); pctx.fill();
        });
      }

      // Capture logic
      latestViewRef.current = view ? { view, w, h } : null;
      const motion = cornerMotion(prevMarkersRef.current, markers);
      prevMarkersRef.current = markers;
      stillRef.current = motion < STILL_PX ? stillRef.current + 1 : 0;

      if (!view) {
        const msg = rejected.length
          ? `Markers ${rejected.join(', ')} don't fit the board (red): is the guitar or a second board in view?`
          : `Show the board: ${markers.length}/6 markers visible (need ${MIN_MARKERS_PER_VIEW}+)`;
        setLive({ markers: markers.length, msg, tone: 'warn' });
        return;
      }
      const novelty = viewNovelty(view, viewsRef.current);
      if (novelty < MIN_NOVELTY) {
        setLive({ markers: markers.length, msg: 'Already captured this pose: move to an empty area or tilt the board', tone: 'info' });
        return;
      }
      if (stillRef.current < STILL_FRAMES) {
        setLive({ markers: markers.length, msg: autoRef.current ? 'New pose: hold still…' : 'New pose: press Capture', tone: 'good' });
        return;
      }
      if (autoRef.current && performance.now() - lastCaptureRef.current > 700) {
        captureView(view, w, h);
        setLive({ markers: markers.length, msg: 'Captured ✓  Move to the next position', tone: 'good' });
      }
    };

    tick();
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const manualCapture = () => {
    const lv = latestViewRef.current;
    if (lv) captureView(lv.view, lv.w, lv.h);
  };

  const runCalibration = (dropOutliers = false) => {
    const cv = window.cv;
    if (!cv) return;
    setBusy(true);
    setTimeout(() => {
      try {
        let views = viewsRef.current;
        if (dropOutliers && result?.perViewErrors?.length === views.length) {
          const sorted = [...result.perViewErrors].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          const keep = views.filter((_, i) => result.perViewErrors[i] <= Math.max(median * 2, 0.6));
          if (keep.length >= MIN_VIEWS) {
            viewsRef.current = keep;
            views = keep;
            setViewCount(keep.length);
          }
        }
        const { w, h } = views[0];
        const r = calibrateFromViews(cv, views, w, h);
        setResult(r);
        if (addLog) addLog(`📐 Calibration solved: RMS ${r.rms.toFixed(2)}px, hFOV ${r.hfovDeg.toFixed(1)}° (${r.verdict.grade})`);
      } catch (e) {
        setResult({ verdict: { ok: false, grade: 'failed', problems: [String(e?.message || e)] } });
      } finally {
        setBusy(false);
      }
    }, 30);
  };

  const save = () => {
    const info = getStreamCameraInfo(getVideo());
    if (!info || !result?.verdict?.ok) return;
    saveCalibration(info, { ...result, markerMm });
    setCamInfo(readCamInfo(target));
    if (addLog) addLog(`✅ Saved calibration for ${info.label || target}`);
    resetSession();
  };

  const removeExisting = () => {
    const info = getStreamCameraInfo(getVideo());
    deleteCalibration(info);
    setCamInfo(readCamInfo(target));
    if (addLog) addLog(`Removed calibration for ${info?.label || target}: using defaults`);
  };

  const coveredCount = coverage.filter(Boolean).length;
  const toneColor = { info: '#94a3b8', warn: '#f59e0b', good: '#4ade80' }[live.tone] || '#94a3b8';
  const grade = result?.verdict ? GRADE_STYLE[result.verdict.grade] : null;

  return createPortal(
    <div style={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="calib-title">
      <div style={styles.panel}>
        <header style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Crosshair size={18} color="#22d3ee" />
            <h2 id="calib-title" style={styles.title}>Camera Calibration</h2>
            <span style={styles.subtle}>{camLabel}</span>
          </div>
          <button id="calib-close" type="button" onClick={onClose} style={styles.iconBtn} title="Close (resumes AR tracking)"><X size={18} /></button>
        </header>

        <div style={styles.body}>
          {/* Left: live preview */}
          <div style={{ flex: '1 1 62%', minWidth: 0 }}>
            <div style={styles.previewWrap}>
              <canvas ref={previewRef} style={{ ...styles.preview, transform: mirrored ? 'scaleX(-1)' : 'none' }} />
              {/* Coverage grid overlay */}
              <div style={{ ...styles.coverGrid, transform: mirrored ? 'scaleX(-1)' : 'none' }}>
                {coverage.map((c, i) => (
                  <div key={i} style={{ border: '1px solid rgba(255,255,255,0.07)', background: c ? 'rgba(74,222,128,0.16)' : 'transparent' }} />
                ))}
              </div>
              {flash && <div style={styles.flash} />}
              {result && <div style={styles.frozen}>Preview paused while reviewing the result</div>}
            </div>
            <div style={{ ...styles.status, color: toneColor }}>{live.msg}</div>
          </div>

          {/* Right: controls */}
          <aside style={styles.side}>
            <section style={styles.card}>
              <div style={styles.label}>Camera</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button id="calib-target-cam1" type="button" onClick={() => selectTarget('cam1')} style={target === 'cam1' ? styles.segOn : styles.seg}>Camera 1</button>
                <button id="calib-target-cam2" type="button" disabled={!stereoEnabled} onClick={() => selectTarget('cam2')}
                  style={{ ...(target === 'cam2' ? styles.segOn : styles.seg), opacity: stereoEnabled ? 1 : 0.4 }}
                  title={stereoEnabled ? '' : 'Enable Stereo 3D to calibrate the second camera'}>Camera 2</button>
              </div>
              <div style={{ ...styles.subtle, marginTop: 8 }}>
                {existing
                  ? <>Calibrated {new Date(existing.date).toLocaleDateString()}: RMS {existing.rms.toFixed(2)}px, hFOV {existing.hfovDeg.toFixed(1)}°
                      <button id="calib-remove" type="button" onClick={removeExisting} style={styles.linkBtn} title="Remove and use defaults"><Trash2 size={12} /> remove</button></>
                  : 'Not calibrated: using default intrinsics, no distortion correction'}
              </div>
            </section>

            <section style={styles.card}>
              <div style={styles.label}>1 · Board</div>
              <button id="calib-print" type="button" onClick={() => openPrintableBoard(CALIB_BOARD.defaultMarkerMm)} style={styles.btn}>
                <Printer size={14} /> Print calibration board
              </button>
              <div style={{ ...styles.subtle, marginTop: 6 }}>
                or download: <a id="calib-download-svg" href="/calibration/calibration_board_60mm.svg" download style={{ color: '#7dd3fc' }}>SVG</a>
                {' · '}<a id="calib-download-png" href="/calibration/calibration_board_60mm_300dpi.png" download style={{ color: '#7dd3fc' }}>PNG (300 dpi)</a>
              </div>
              <label style={{ ...styles.subtle, display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                Measured black square side
                <input id="calib-marker-mm" type="number" min="20" max="250" step="0.5" value={markerMm}
                  onChange={e => { const v = parseFloat(e.target.value); if (v > 10) changeMarkerMm(v); }}
                  style={styles.input} /> mm
              </label>
              <div style={{ ...styles.subtle, marginTop: 6 }}>Mount it flat (card or clipboard). Keep the guitar out of view: it uses the same marker IDs.</div>
            </section>

            <section style={styles.card}>
              <div style={styles.label}>2 · Capture views</div>
              <div style={styles.progressTrack}>
                <div style={{ ...styles.progressFill, width: `${Math.min(100, (viewCount / RECOMMENDED_VIEWS) * 100)}%`, background: viewCount >= MIN_VIEWS ? '#4ade80' : '#22d3ee' }} />
              </div>
              <div style={{ ...styles.subtle, display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span>{viewCount} / {RECOMMENDED_VIEWS} views (min {MIN_VIEWS})</span>
                <span>coverage {Math.round((coveredCount / coverage.length) * 100)}%</span>
              </div>
              <ul style={styles.tips}>
                <li>Cover the whole frame, <b>especially corners and edges</b></li>
                <li>Tilt the board ~30–45° left/right/up/down</li>
                <li>Mix near and far (fill ¼ to ½ of the frame)</li>
              </ul>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <label style={{ ...styles.subtle, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input id="calib-auto" type="checkbox" checked={autoCapture} onChange={e => setAutoCapture(e.target.checked)} /> Auto
                </label>
                <button id="calib-capture" type="button" onClick={manualCapture} disabled={!!result} style={styles.btn}><Camera size={14} /> Capture</button>
                <button id="calib-reset" type="button" onClick={resetSession} style={styles.btnGhost} title="Clear captured views"><RotateCcw size={14} /></button>
              </div>
            </section>

            <section style={styles.card}>
              <div style={styles.label}>3 · Solve</div>
              {!result && (
                <button id="calib-solve" type="button" disabled={viewCount < MIN_VIEWS || busy} onClick={() => runCalibration(false)}
                  style={{ ...styles.btnPrimary, opacity: viewCount < MIN_VIEWS || busy ? 0.45 : 1 }}>
                  {busy ? 'Solving…' : `Calibrate${viewCount < MIN_VIEWS ? ` (${MIN_VIEWS - viewCount} more)` : ''}`}
                </button>
              )}
              {result && grade && (
                <div>
                  <div style={{ color: grade.color, fontWeight: 700, marginBottom: 6 }}>{grade.label}</div>
                  {result.fx && (
                    <table style={styles.table}><tbody>
                      <tr><td>Reprojection RMS</td><td>{result.rms.toFixed(3)} px</td></tr>
                      <tr><td>Horizontal FOV</td><td>{result.hfovDeg.toFixed(1)}°</td></tr>
                      <tr><td>fx / fy</td><td>{result.fx.toFixed(1)} / {result.fy.toFixed(1)}</td></tr>
                      <tr><td>cx / cy</td><td>{result.cx.toFixed(1)} / {result.cy.toFixed(1)}</td></tr>
                      <tr><td>k1 / k2</td><td>{result.dist[0].toFixed(4)} / {result.dist[1].toFixed(4)}</td></tr>
                      <tr><td>Resolution</td><td>{result.width}×{result.height}</td></tr>
                    </tbody></table>
                  )}
                  {result.verdict.problems.map((p, i) => <div key={i} style={{ ...styles.subtle, color: '#fbbf24' }}>⚠ {p}</div>)}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    <button id="calib-save" type="button" disabled={!result.verdict.ok} onClick={save} style={{ ...styles.btnPrimary, opacity: result.verdict.ok ? 1 : 0.4 }}><Check size={14} /> Save</button>
                    {result.perViewErrors?.length > 0 && (
                      <button id="calib-drop-outliers" type="button" onClick={() => runCalibration(true)} style={styles.btn} title="Discard the worst views and re-solve">Drop outliers</button>
                    )}
                    <button id="calib-discard" type="button" onClick={() => setResult(null)} style={styles.btnGhost}>Add more views</button>
                  </div>
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>,
    document.body
  );
}

const styles = {
  backdrop: { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(2,6,23,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  panel: { width: 'min(1180px, 100%)', maxHeight: '100%', overflow: 'auto', background: 'linear-gradient(160deg, rgba(15,23,42,0.97), rgba(10,15,30,0.97))', border: '1px solid rgba(56,189,248,0.25)', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.5)', color: '#e2e8f0', fontSize: 13 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  title: { margin: 0, fontSize: 16, fontWeight: 700 },
  body: { display: 'flex', gap: 16, padding: 16, flexWrap: 'wrap' },
  previewWrap: { position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#000', borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' },
  preview: { width: '100%', height: '100%', objectFit: 'contain', display: 'block' },
  coverGrid: { position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: `repeat(${COVER_COLS}, 1fr)`, gridTemplateRows: `repeat(${COVER_ROWS}, 1fr)`, pointerEvents: 'none' },
  flash: { position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.35)', pointerEvents: 'none' },
  frozen: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 6, textAlign: 'center', background: 'rgba(0,0,0,0.6)', fontSize: 12, color: '#cbd5e1' },
  status: { marginTop: 8, fontSize: 13, fontWeight: 600, minHeight: 18 },
  side: { flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 280 },
  card: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: 12 },
  label: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#38bdf8', fontWeight: 700, marginBottom: 8 },
  subtle: { fontSize: 12, color: '#94a3b8' },
  seg: { flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', cursor: 'pointer' },
  segOn: { flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid #22d3ee', background: 'rgba(34,211,238,0.18)', color: '#67e8f9', cursor: 'pointer', fontWeight: 700 },
  btn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(56,189,248,0.4)', background: 'rgba(56,189,248,0.12)', color: '#7dd3fc', cursor: 'pointer' },
  btnPrimary: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 6, border: '1px solid #22c55e', background: 'linear-gradient(135deg, rgba(34,197,94,0.35), rgba(16,185,129,0.25))', color: '#bbf7d0', cursor: 'pointer', fontWeight: 700 },
  btnGhost: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#94a3b8', cursor: 'pointer' },
  iconBtn: { background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 },
  linkBtn: { marginLeft: 6, background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 3 },
  input: { width: 64, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(56,189,248,0.3)', borderRadius: 4, color: '#38bdf8', padding: '2px 4px', textAlign: 'center' },
  progressTrack: { height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  progressFill: { height: '100%', transition: 'width 200ms ease' },
  tips: { margin: '8px 0', paddingLeft: 18, color: '#cbd5e1', fontSize: 12, lineHeight: 1.5 },
  table: { width: '100%', fontSize: 12, borderCollapse: 'collapse', fontFamily: 'var(--font-mono, monospace)' }
};
