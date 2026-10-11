/**
 * ArUco Session Recorder
 *
 * Captures the raw camera stream (for offline replay through the detector) together with a
 * per-frame JSONL metrics log describing exactly what the ArUco pipeline saw and decided.
 *
 * Output files (same base name):
 *   <name>.webm|.mp4          Raw, un-mirrored camera stream (high bitrate to preserve marker detail)
 *   <name>_overlay.webm|.mp4  Optional: camera + AR overlay composited (what the user saw, un-mirrored)
 *   <name>_metrics.jsonl      Line 1: {type:'session'} header, then {type:'frame'} / {type:'event'} lines,
 *                             final line: {type:'summary'}
 *   <name>_summary.json       Aggregate stats (same as the final JSONL line), handy for quick reading
 *
 * Timestamps: every frame/event carries `t` = ms since recording start (performance.now() based).
 * The header records `videoStartDelayMs` (when MediaRecorder actually fired 'start') so the replay
 * tool can align video time with `t` as: videoTimeMs ≈ t - videoStartDelayMs.
 */

const VIDEO_MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4;codecs=avc1',
  'video/mp4'
];

const TRACKED_IDS = [1, 2, 3, 4, 5];

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const mime of VIDEO_MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      // Ignore and try next candidate
    }
  }
  return '';
}

function extForMime(mime) {
  return mime && mime.includes('mp4') ? 'mp4' : 'webm';
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function round1(v) {
  return typeof v === 'number' && isFinite(v) ? Math.round(v * 10) / 10 : null;
}

export function round3(v) {
  return typeof v === 'number' && isFinite(v) ? Math.round(v * 1000) / 1000 : null;
}

const pt = (p) => (p ? [round1(p.x), round1(p.y)] : null);

/**
 * Build a compact per-frame JSON record from the AR frame loop state.
 * Coordinates: markers / neck / fingers are in full video pixels (un-mirrored);
 * candidate quads are in processing-canvas pixels (multiply by proc.sx / proc.sy).
 */
export function buildFrameRecord({
  frameIndex,
  video,
  scanned,
  fps,
  timings,
  procWidth,
  procHeight,
  scaleX,
  scaleY,
  diagnostics,
  detectedMarkers,
  markerPoses,
  candidateDetails,
  neckMode,
  coastFrames,
  rawNeck,
  neckGeometry,
  handCount,
  trackedFingers,
  activeChord,
  strumMetrics
}) {
  const rec = {
    type: 'frame',
    i: frameIndex,
    vt: round3(video?.currentTime),
    scanned,
    fps,
    ms: {
      copy: round1(timings.copy),
      aruco: round1(timings.aruco),
      mp: round1(timings.mp),
      math: round1(timings.math),
      render: round1(timings.render),
      total: round1(timings.total)
    },
    hands: handCount
  };

  if (scanned) {
    rec.proc = { w: procWidth, h: procHeight, sx: round3(scaleX), sy: round3(scaleY) };
    rec.diag = diagnostics || null;

    rec.markers = (detectedMarkers || []).map(m => {
      const c = m.corners || [];
      let side = 0;
      for (let k = 0; k < c.length; k++) {
        const a = c[k];
        const b = c[(k + 1) % c.length];
        side += Math.hypot(b.x - a.x, b.y - a.y);
      }
      side = c.length ? side / c.length : 0;
      const tvec = markerPoses && markerPoses[m.id];
      return {
        id: m.id,
        c: c.map(pt),
        side: round1(side),
        strategy: m.strategy,
        win: m.blockSize,
        tvec: tvec ? tvec.map(round1) : null
      };
    });

    rec.cands = (candidateDetails || []).map(d => ({
      ...d,
      c: d.c.map(p => [round1(p[0]), round1(p[1])])
    }));

    rec.neck = { mode: neckMode, coast: coastFrames };
    if (rawNeck) {
      const dbg = rawNeck.debug || {};
      rec.neck.fit = `${dbg.firstId}-${dbg.lastId}`;
      rec.neck.ids = dbg.detectedIds;
      rec.neck.k = round3(dbg.k);
      rec.neck.kExtrap = round3(dbg.kExtrap);
      rec.neck.raw = { s: pt(rawNeck.start), e: pt(rawNeck.end) };
      rec.neck.depthRatio = round3(rawNeck.depthRatio);
      rec.neck.nutW = round1(rawNeck.nutNeckWidth);
      rec.neck.endW = round1(rawNeck.endNeckWidth);
    }
    if (neckGeometry) {
      rec.neck.smooth = {
        s: pt(neckGeometry.start),
        e: pt(neckGeometry.end),
        depthRatio: round3(neckGeometry.depthRatio)
      };
    }
  }

  if (trackedFingers && trackedFingers.length) {
    rec.fingers = trackedFingers.map(f => ({
      id: f.id,
      x: round1(f.pos.x),
      y: round1(f.pos.y),
      fret: f.fret,
      string: f.string,
      loc: round1(f.fretLocator)
    }));
  }
  if (activeChord) rec.chord = activeChord.name;
  if (strumMetrics) rec.strum = strumMetrics;

  return rec;
}

/**
 * Running aggregate statistics, cheap enough to update every frame and render live.
 */
class SessionStats {
  constructor() {
    this.frames = 0;
    this.scanned = 0;
    this.idHits = Object.fromEntries(TRACKED_IDS.map(id => [id, 0]));
    this.idSideSum = Object.fromEntries(TRACKED_IDS.map(id => [id, 0]));
    this.idSideMin = Object.fromEntries(TRACKED_IDS.map(id => [id, null]));
    this.markerCountHist = [0, 0, 0, 0, 0, 0];
    this.has1and5 = 0;
    this.neckModes = { raw: 0, coast: 0, none: 0 };
    this.fitPaths = {};
    this.cands = { quads: 0, ok: 0, dup: 0, border: 0, dict: 0 };
    this.dictHamHist = {};   // Hamming distance of dict-rejected candidates (border OK, bits wrong)
    this.borderHamHist = {}; // Hamming distance of border-rejected candidates (would they decode if border relaxed?)
    this.strategyHits = {};
    this.windowHits = {};
    this.arucoMsSum = 0;
    this.dropoutRun = 0;
    this.longestDropout = 0;
    this.dropouts = 0;
    this.events = 0;
  }

  addFrame(rec) {
    this.frames++;
    if (!rec.scanned) return;
    this.scanned++;

    const markers = rec.markers || [];
    const n = Math.min(markers.length, 5);
    this.markerCountHist[n]++;
    const ids = new Set();
    for (const m of markers) {
      ids.add(m.id);
      if (this.idHits[m.id] !== undefined) {
        this.idHits[m.id]++;
        this.idSideSum[m.id] += m.side || 0;
        if (this.idSideMin[m.id] === null || m.side < this.idSideMin[m.id]) {
          this.idSideMin[m.id] = m.side;
        }
      }
      if (m.strategy) this.strategyHits[m.strategy] = (this.strategyHits[m.strategy] || 0) + 1;
      if (m.win) this.windowHits[m.win] = (this.windowHits[m.win] || 0) + 1;
    }
    if (ids.has(1) && ids.has(5)) this.has1and5++;

    const mode = rec.neck?.mode || 'none';
    const modeKey = mode.startsWith('coast') ? 'coast' : mode;
    this.neckModes[modeKey] = (this.neckModes[modeKey] || 0) + 1;
    if (rec.neck?.fit) {
      this.fitPaths[rec.neck.fit] = (this.fitPaths[rec.neck.fit] || 0) + 1;
    }

    if (modeKey === 'raw') {
      if (this.dropoutRun > 0) this.dropouts++;
      this.dropoutRun = 0;
    } else {
      this.dropoutRun++;
      if (this.dropoutRun > this.longestDropout) this.longestDropout = this.dropoutRun;
    }

    if (rec.diag) this.cands.quads += rec.diag.quads || 0;
    for (const c of rec.cands || []) {
      this.cands[c.res] = (this.cands[c.res] || 0) + 1;
      if (c.res === 'dict' && c.ham !== null && c.ham !== undefined) {
        this.dictHamHist[c.ham] = (this.dictHamHist[c.ham] || 0) + 1;
      } else if (c.res === 'border' && c.hamAll !== null && c.hamAll !== undefined) {
        this.borderHamHist[c.hamAll] = (this.borderHamHist[c.hamAll] || 0) + 1;
      }
    }

    this.arucoMsSum += rec.ms?.aruco || 0;
  }

  pct(count, total = this.scanned) {
    return total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
  }

  snapshot(elapsedMs = 0) {
    const perId = {};
    for (const id of TRACKED_IDS) {
      const hits = this.idHits[id];
      perId[id] = {
        pct: this.pct(hits),
        hits,
        avgSidePx: hits > 0 ? round1(this.idSideSum[id] / hits) : null,
        minSidePx: this.idSideMin[id] !== null ? round1(this.idSideMin[id]) : null
      };
    }
    const twoPlus = this.markerCountHist.slice(2).reduce((a, b) => a + b, 0);
    return {
      elapsedSec: Math.round(elapsedMs / 100) / 10,
      frames: this.frames,
      scannedFrames: this.scanned,
      events: this.events,
      pctTwoPlusMarkers: this.pct(twoPlus),
      pctMarkers1and5: this.pct(this.has1and5),
      markerCountHist: this.markerCountHist,
      neck: {
        rawPct: this.pct(this.neckModes.raw || 0),
        coastPct: this.pct(this.neckModes.coast || 0),
        nonePct: this.pct(this.neckModes.none || 0),
        dropouts: this.dropouts,
        longestDropoutFrames: this.longestDropout,
        fitPaths: this.fitPaths
      },
      perId,
      candidates: {
        ...this.cands,
        dictRejectHammingHist: this.dictHamHist,
        borderRejectHammingHist: this.borderHamHist
      },
      decodeStrategyHits: this.strategyHits,
      decodeWindowHits: this.windowHits,
      avgArucoMs: this.scanned > 0 ? round1(this.arucoMsSum / this.scanned) : 0
    };
  }
}

export class SessionRecorder {
  constructor() {
    this.state = 'idle';
    this.reset();
  }

  reset() {
    this.lines = [];
    this.stats = new SessionStats();
    this.rawRecorder = null;
    this.rawChunks = [];
    this.overlayRecorder = null;
    this.overlayChunks = [];
    this.overlayCanvas = null;
    this.overlayCtx = null;
    this.overlayStream = null;
    this.t0 = 0;
    this.videoStartDelayMs = null;
    this.name = '';
    this.mimeType = '';
    this.meta = null;
  }

  get isRecording() {
    return this.state === 'recording';
  }

  static isSupported() {
    return typeof MediaRecorder !== 'undefined' && pickMimeType() !== null;
  }

  now() {
    return performance.now() - this.t0;
  }

  /**
   * Begin recording.
   * @param {object} opts
   * @param {MediaStream} opts.stream - Live camera stream (video.srcObject)
   * @param {object} opts.meta - Session metadata to write into the header line
   * @param {string} [opts.label] - Free-text scenario label (lighting, distance...)
   * @param {boolean} [opts.recordOverlay] - Also record a composited camera+overlay video
   * @param {number} [opts.width] / [opts.height] - Video dimensions (for the overlay compositor)
   */
  start({ stream, meta, label = '', recordOverlay = false, width = 1280, height = 720 }) {
    if (this.state !== 'idle') throw new Error(`Recorder busy (${this.state})`);
    if (!stream) throw new Error('No camera stream to record');
    const mime = pickMimeType();
    if (mime === null) throw new Error('MediaRecorder is not supported in this browser');

    this.reset();
    this.mimeType = mime;
    const d = new Date();
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const slug = slugify(label);
    this.name = `arguitar_${stamp}${slug ? '_' + slug : ''}`;

    // High bitrate: compression artefacts would blur marker bits and bias offline replay results
    const pixels = width * height;
    const videoBitsPerSecond = pixels >= 1920 * 1080 ? 16_000_000 : 10_000_000;
    const recOpts = mime ? { mimeType: mime, videoBitsPerSecond } : { videoBitsPerSecond };

    this.rawRecorder = new MediaRecorder(stream, recOpts);
    this.rawRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.rawChunks.push(e.data);
    };

    if (recordOverlay) {
      this.overlayCanvas = document.createElement('canvas');
      this.overlayCanvas.width = width;
      this.overlayCanvas.height = height;
      this.overlayCtx = this.overlayCanvas.getContext('2d');
      this.overlayStream = this.overlayCanvas.captureStream(30);
      this.overlayRecorder = new MediaRecorder(
        this.overlayStream,
        mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : { videoBitsPerSecond: 6_000_000 }
      );
      this.overlayRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.overlayChunks.push(e.data);
      };
    }

    this.meta = {
      type: 'session',
      version: 1,
      name: this.name,
      label,
      startedAt: d.toISOString(),
      mimeType: mime || 'browser-default',
      videoFile: `${this.name}.${extForMime(mime)}`,
      overlayFile: recordOverlay ? `${this.name}_overlay.${extForMime(mime)}` : null,
      videoBitsPerSecond,
      ...meta
    };

    this.t0 = performance.now();
    this.rawRecorder.onstart = () => {
      this.videoStartDelayMs = round1(this.now());
    };
    this.rawRecorder.start(1000);
    if (this.overlayRecorder) this.overlayRecorder.start(1000);
    this.state = 'recording';
  }

  /** Append a per-frame record. `t` (ms since start) is stamped here. */
  logFrame(rec) {
    if (this.state !== 'recording') return;
    rec.t = round1(this.now());
    this.lines.push(JSON.stringify(rec));
    this.stats.addFrame(rec);
  }

  /** Composite current camera frame + overlay canvas into the overlay recording. */
  compositeOverlay(video, overlayCanvas) {
    if (this.state !== 'recording' || !this.overlayCtx) return;
    const c = this.overlayCanvas;
    if (video.videoWidth && (c.width !== video.videoWidth || c.height !== video.videoHeight)) {
      c.width = video.videoWidth;
      c.height = video.videoHeight;
    }
    this.overlayCtx.drawImage(video, 0, 0, c.width, c.height);
    if (overlayCanvas) this.overlayCtx.drawImage(overlayCanvas, 0, 0, c.width, c.height);
  }

  /** Log a user-marked event (e.g. "holding G chord at fret 3", "glare starts"). */
  addEvent(note = '', extra = {}) {
    if (this.state !== 'recording') return null;
    const ev = { type: 'event', t: round1(this.now()), note, ...extra };
    this.lines.push(JSON.stringify(ev));
    this.stats.events++;
    return ev;
  }

  liveStats() {
    return this.stats.snapshot(this.state === 'recording' ? this.now() : 0);
  }

  /**
   * Stop recording and assemble output files.
   * @returns {Promise<{ name, files: Array<{name, blob}>, summary }>}
   */
  async stop() {
    if (this.state !== 'recording') return null;
    this.state = 'stopping';
    const durationMs = this.now();

    const stopRecorder = (rec) => new Promise((resolve) => {
      if (!rec || rec.state === 'inactive') return resolve();
      rec.onstop = () => resolve();
      try {
        rec.stop();
      } catch {
        resolve();
      }
    });

    await Promise.all([stopRecorder(this.rawRecorder), stopRecorder(this.overlayRecorder)]);
    if (this.overlayStream) {
      this.overlayStream.getTracks().forEach(t => t.stop());
    }

    const summary = {
      type: 'summary',
      durationMs: round1(durationMs),
      videoStartDelayMs: this.videoStartDelayMs,
      ...this.stats.snapshot(durationMs)
    };
    const header = { ...this.meta, videoStartDelayMs: this.videoStartDelayMs };

    const ext = extForMime(this.mimeType);
    const blobType = this.mimeType ? this.mimeType.split(';')[0] : `video/${ext}`;
    const jsonl = [JSON.stringify(header), ...this.lines, JSON.stringify(summary)].join('\n') + '\n';

    const files = [
      { name: `${this.name}.${ext}`, blob: new Blob(this.rawChunks, { type: blobType }) },
      { name: `${this.name}_metrics.jsonl`, blob: new Blob([jsonl], { type: 'application/x-ndjson' }) },
      { name: `${this.name}_summary.json`, blob: new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' }) }
    ];
    if (this.overlayChunks.length > 0) {
      files.splice(1, 0, { name: `${this.name}_overlay.${ext}`, blob: new Blob(this.overlayChunks, { type: blobType }) });
    }

    const result = { name: this.name, files, summary };
    this.state = 'idle';
    // Release large buffers (result holds the blobs)
    this.lines = [];
    this.rawChunks = [];
    this.overlayChunks = [];
    return result;
  }
}

/**
 * Persist recorded files. Tries the dev-server endpoint first (writes into ./recordings/ in the
 * project so they can be analysed directly); falls back to browser download links.
 * @returns {Promise<{ mode: 'server'|'download', items: Array<{name, size, path?, url?}> }>}
 */
export async function saveRecordingFiles(files) {
  const items = [];
  let serverOk = true;
  for (const f of files) {
    if (!serverOk) break;
    try {
      const res = await fetch(`/__recordings/save?file=${encodeURIComponent(f.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: f.blob
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      items.push({ name: f.name, size: f.blob.size, path: data.path });
    } catch (e) {
      console.warn('[Recorder] Dev-server save unavailable, falling back to downloads:', e);
      serverOk = false;
    }
  }
  if (serverOk) return { mode: 'server', items };

  return {
    mode: 'download',
    items: files.map(f => ({ name: f.name, size: f.blob.size, url: URL.createObjectURL(f.blob) }))
  };
}
