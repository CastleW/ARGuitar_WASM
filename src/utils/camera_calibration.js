/**
 * Per-camera intrinsic calibration (focal length, principal point, lens distortion).
 *
 * Why an ArUco board instead of a classic checkerboard?
 * The bundled opencv.js build does NOT include findChessboardCorners / cornerSubPix,
 * but it does include calibrateCameraExtended. We therefore use a printed grid of the
 * same ArUco markers the app already detects (IDs 0-5, a "GridBoard"), refine their
 * corners to sub-pixel accuracy here in JS, and feed them to calibrateCameraExtended.
 * This is the standard OpenCV ArUco-board calibration method and gives comparable accuracy.
 *
 * Calibrations are stored in localStorage per physical camera (deviceId, with label fallback)
 * at the resolution they were captured, and scaled to any other resolution with the same aspect ratio.
 */

import arucoDictionary from '../assets/aruco_dictionary.json';

// ---------------------------------------------------------------------------
// Board definition
// ---------------------------------------------------------------------------

export const CALIB_BOARD = {
  cols: 3,
  rows: 2,
  ids: [0, 1, 2, 3, 4, 5],   // row-major: top row 0,1,2 / bottom row 3,4,5
  defaultMarkerMm: 60,
  gapRatio: 1 / 3            // gap between markers = markerSide / 3 (20 mm for 60 mm markers)
};

export const MIN_VIEWS = 12;
export const RECOMMENDED_VIEWS = 20;
export const MIN_MARKERS_PER_VIEW = 4;

// NOTE: In this opencv.js build the exported CALIB_* constants are mislabeled
// (cv.CALIB_FIX_K3 === 64, which is really FIX_K2). Use the canonical OpenCV values directly.
const CALIB_USE_INTRINSIC_GUESS = 0x0001;
const CALIB_ZERO_TANGENT_DIST = 0x0008;
const CALIB_FIX_K3 = 0x0080;

/** Decode the 5x5 bit pattern of a marker ID (1 = white cell), matching the detector's packing. */
export function markerBits(id) {
  const bytes = arucoDictionary[id][0];
  const bits = [];
  for (let k = 0; k < 25; k++) {
    let bit;
    if (k < 24) {
      bit = (bytes[Math.floor(k / 8)] >> (7 - (k % 8))) & 1;
    } else {
      bit = bytes[3] & 1; // detector right-shifts the last byte by 7
    }
    bits.push(bit);
  }
  const grid = [];
  for (let r = 0; r < 5; r++) grid.push(bits.slice(r * 5, r * 5 + 5));
  return grid;
}

/**
 * 3D object points (cm, board plane z=0, x right, y down) of the 4 corners
 * [TL, TR, BR, BL] of each marker on the board.
 */
export function boardObjectPoints(markerMm) {
  const s = markerMm / 10;
  const step = s * (1 + CALIB_BOARD.gapRatio);
  const pts = {};
  CALIB_BOARD.ids.forEach((id, idx) => {
    const c = idx % CALIB_BOARD.cols;
    const r = Math.floor(idx / CALIB_BOARD.cols);
    const x = c * step;
    const y = r * step;
    pts[id] = [[x, y, 0], [x + s, y, 0], [x + s, y + s, 0], [x, y + s, 0]];
  });
  return pts;
}

/** Build a print-ready SVG (real millimetre units) of the calibration board. */
export function buildBoardSVG(markerMm = CALIB_BOARD.defaultMarkerMm) {
  const gap = markerMm * CALIB_BOARD.gapRatio;
  const margin = 12;
  const cell = markerMm / 7;
  const w = margin * 2 + CALIB_BOARD.cols * markerMm + (CALIB_BOARD.cols - 1) * gap;
  const h = margin * 2 + CALIB_BOARD.rows * markerMm + (CALIB_BOARD.rows - 1) * gap;
  let body = `<rect x="0" y="0" width="${w}" height="${h}" fill="#fff"/>`;
  CALIB_BOARD.ids.forEach((id, idx) => {
    const c = idx % CALIB_BOARD.cols;
    const r = Math.floor(idx / CALIB_BOARD.cols);
    const ox = margin + c * (markerMm + gap);
    const oy = margin + r * (markerMm + gap);
    body += `<rect x="${ox}" y="${oy}" width="${markerMm}" height="${markerMm}" fill="#000"/>`;
    const bits = markerBits(id);
    for (let br = 0; br < 5; br++) {
      for (let bc = 0; bc < 5; bc++) {
        if (bits[br][bc]) {
          // Slight overlap avoids hairline gaps between adjacent white cells in some PDF renderers
          body += `<rect x="${(ox + (bc + 1) * cell).toFixed(3)}" y="${(oy + (br + 1) * cell).toFixed(3)}" width="${(cell + 0.02).toFixed(3)}" height="${(cell + 0.02).toFixed(3)}" fill="#fff"/>`;
        }
      }
    }
  });
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">${body}</svg>`, widthMm: w, heightMm: h };
}

/** Open a printable page containing the board. */
export function openPrintableBoard(markerMm = CALIB_BOARD.defaultMarkerMm) {
  const { svg } = buildBoardSVG(markerMm);
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.write(`<!doctype html><html><head><title>ARGuitar Camera Calibration Board</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  body { font-family: system-ui, sans-serif; margin: 0; padding: 10mm; color: #111; }
  .note { font-size: 11pt; margin-bottom: 6mm; max-width: 250mm; }
  @media print { .note button { display: none; } }
</style></head><body>
<div class="note">
  <b>ARGuitar camera calibration board</b> &mdash; print at <b>100% / Actual size</b> (no "fit to page").
  Glue it flat onto card or a clipboard. Then <b>measure the black square side with a ruler</b>
  (designed as ${markerMm} mm) and enter the measured value in the app.
  <button onclick="window.print()">Print</button>
</div>
${svg}
</body></html>`);
  win.document.close();
  return true;
}

// ---------------------------------------------------------------------------
// Sub-pixel corner refinement (replacement for cv.cornerSubPix, which this build lacks)
// ---------------------------------------------------------------------------

/** Convert RGBA ImageData to a Float32 luma buffer. */
export function imageDataToGray(imgData) {
  const { data, width, height } = imgData;
  const g = new Float32Array(width * height);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    g[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  }
  return g;
}

function sampleBilinear(gray, w, h, x, y) {
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return NaN;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const i = y0 * w + x0;
  return (gray[i] * (1 - fx) + gray[i + 1] * fx) * (1 - fy) +
         (gray[i + w] * (1 - fx) + gray[i + w + 1] * fx) * fy;
}

/** Least-squares line through points: returns { px, py, dx, dy } (point + unit direction). */
function fitLine(points) {
  let mx = 0, my = 0;
  for (const p of points) { mx += p.x; my += p.y; }
  mx /= points.length; my /= points.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of points) {
    const dx = p.x - mx, dy = p.y - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { px: mx, py: my, dx: Math.cos(theta), dy: Math.sin(theta) };
}

function intersectLines(a, b) {
  const det = a.dx * (-b.dy) - a.dy * (-b.dx);
  if (Math.abs(det) < 1e-9) return null;
  const rx = b.px - a.px, ry = b.py - a.py;
  const t = (rx * (-b.dy) - ry * (-b.dx)) / det;
  return { x: a.px + t * a.dx, y: a.py + t * a.dy };
}

/**
 * Refine the 4 outer corners of a marker to sub-pixel accuracy by locating the
 * black-border/white-paper edge along each side and intersecting fitted lines.
 * Falls back to the coarse corners if refinement looks unreliable.
 */
export function refineMarkerCorners(gray, w, h, corners) {
  const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
  const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
  const lines = [];

  for (let e = 0; e < 4; e++) {
    const a = corners[e];
    const b = corners[(e + 1) % 4];
    const ex = b.x - a.x, ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 14) return corners;
    const ux = ex / len, uy = ey / len;
    // Outward normal (away from marker centre)
    let nx = -uy, ny = ux;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }

    // Stay well clear of the inner bit cells (border is 1/7 of the side)
    const R = Math.max(1.5, Math.min(4, (len / 7) * 0.45));
    const step = 0.25;
    const nSamples = Math.max(8, Math.min(40, Math.round(len / 3)));
    const edgePts = [];

    for (let s = 0; s < nSamples; s++) {
      const t = 0.15 + 0.7 * (s / (nSamples - 1));
      const px = a.x + ex * t, py = a.y + ey * t;
      const prof = [];
      for (let d = -R; d <= R + 1e-6; d += step) {
        prof.push(sampleBilinear(gray, w, h, px + nx * d, py + ny * d));
      }
      if (prof.some(Number.isNaN)) continue;
      // Outward: dark border -> white paper, so look for the max positive derivative
      let best = -Infinity, bi = -1;
      for (let i = 1; i < prof.length - 1; i++) {
        const dv = prof[i + 1] - prof[i - 1];
        if (dv > best) { best = dv; bi = i; }
      }
      if (bi <= 1 || bi >= prof.length - 2 || best < 8) continue;
      const dl = prof[bi] - prof[bi - 2];
      const dr = prof[bi + 2] - prof[bi];
      const denom = dl - 2 * best + dr;
      const off = Math.abs(denom) > 1e-6 ? 0.5 * (dl - dr) / denom : 0;
      const d = -R + (bi + Math.max(-1, Math.min(1, off))) * step;
      edgePts.push({ x: px + nx * d, y: py + ny * d });
    }
    if (edgePts.length < 5) return corners;

    let line = fitLine(edgePts);
    // One round of outlier rejection
    const inliers = edgePts.filter(p => Math.abs((p.x - line.px) * (-line.dy) + (p.y - line.py) * line.dx) < 0.8);
    if (inliers.length >= 5) line = fitLine(inliers);
    lines.push(line);
  }

  const refined = [];
  for (let i = 0; i < 4; i++) {
    // corner i is shared by edge (i-1) and edge i
    const p = intersectLines(lines[(i + 3) % 4], lines[i]);
    if (!p || Math.hypot(p.x - corners[i].x, p.y - corners[i].y) > 3.5) return corners;
    refined.push(p);
  }
  return refined;
}

// ---------------------------------------------------------------------------
// View collection
// ---------------------------------------------------------------------------

/**
 * Keep only markers whose corners are consistent with a single planar board pose.
 * Fits a board-plane -> image homography with RANSAC; markers with any corner far from it are rejected.
 * This catches misread IDs, guitar markers in view (same IDs) and wrong corner ordering.
 */
function filterByHomography(cv, valid, boardPts) {
  const src = [], dst = [];
  for (const m of valid) {
    for (let i = 0; i < 4; i++) {
      src.push(boardPts[m.id][i][0], boardPts[m.id][i][1]);
      dst.push(m.corners[i].x, m.corners[i].y);
    }
  }
  // Tolerance: lens distortion bends straight lines a few px, wrong correspondences are off by a marker pitch
  let meanSide = 0;
  for (const m of valid) meanSide += Math.hypot(m.corners[1].x - m.corners[0].x, m.corners[1].y - m.corners[0].y);
  meanSide /= valid.length;
  const tol = Math.max(4, meanSide * 0.06);

  const srcMat = cv.matFromArray(src.length / 2, 1, cv.CV_32FC2, src);
  const dstMat = cv.matFromArray(dst.length / 2, 1, cv.CV_32FC2, dst);
  const mask = new cv.Mat();
  let H = null;
  try {
    H = cv.findHomography(srcMat, dstMat, cv.RANSAC, tol, mask);
    if (!H || H.empty()) return { inliers: [], rejected: valid.map(m => m.id) };
    const h = H.data64F;
    const inliers = [], rejected = [];
    for (const m of valid) {
      let worst = 0;
      for (let i = 0; i < 4; i++) {
        const [X, Y] = boardPts[m.id][i];
        const w = h[6] * X + h[7] * Y + h[8];
        const u = (h[0] * X + h[1] * Y + h[2]) / w;
        const v = (h[3] * X + h[4] * Y + h[5]) / w;
        worst = Math.max(worst, Math.hypot(u - m.corners[i].x, v - m.corners[i].y));
      }
      (worst <= tol ? inliers : rejected).push(worst <= tol ? m : m.id);
    }
    return { inliers, rejected };
  } catch {
    return { inliers: valid, rejected: [] };
  } finally {
    srcMat.delete(); dstMat.delete(); mask.delete();
    if (H) H.delete();
  }
}

/**
 * Build a calibration view from detected (and refined) markers.
 * @param {Array} markers - detected markers with refined corners
 * @param {number} markerMm - measured printed marker side
 * @param {number} w - image width
 * @param {number} h - image height
 * @param {object} [cv] - OpenCV instance; enables the planar consistency check (recommended)
 * @returns {{ view: object|null, rejected: number[] }} view = { obj, img, ids, features }
 */
export function buildView(markers, markerMm, w, h, cv = null) {
  const boardPts = boardObjectPoints(markerMm);
  let valid = markers.filter(m => boardPts[m.id] && m.corners && m.corners.length === 4);
  let rejected = [];
  if (valid.length < MIN_MARKERS_PER_VIEW) return { view: null, rejected };
  if (cv && cv.findHomography) {
    const res = filterByHomography(cv, valid, boardPts);
    valid = res.inliers;
    rejected = res.rejected;
    if (valid.length < MIN_MARKERS_PER_VIEW) return { view: null, rejected };
  }

  const obj = [], img = [];
  let sx = 0, sy = 0, tiltX = 0, tiltY = 0, area = 0;
  for (const m of valid) {
    const c = m.corners;
    for (let i = 0; i < 4; i++) {
      obj.push(boardPts[m.id][i]);
      img.push([c[i].x, c[i].y]);
      sx += c[i].x; sy += c[i].y;
    }
    const top = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y);
    const bot = Math.hypot(c[2].x - c[3].x, c[2].y - c[3].y);
    const left = Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y);
    const right = Math.hypot(c[2].x - c[1].x, c[2].y - c[1].y);
    tiltY += (top - bot) / (top + bot);
    tiltX += (right - left) / (right + left);
    area += 0.5 * Math.abs(
      (c[0].x * c[1].y - c[1].x * c[0].y) + (c[1].x * c[2].y - c[2].x * c[1].y) +
      (c[2].x * c[3].y - c[3].x * c[2].y) + (c[3].x * c[0].y - c[0].x * c[3].y)
    );
  }
  const n = img.length;
  const features = {
    cx: sx / n / w,
    cy: sy / n / h,
    scale: Math.sqrt(area / valid.length) / Math.min(w, h),
    tiltX: (tiltX / valid.length) * 6, // amplify: perspective ratios are small numbers
    tiltY: (tiltY / valid.length) * 6
  };
  return { view: { obj, img, ids: valid.map(m => m.id), features }, rejected };
}

/** How different a view is from all previously captured views (0 = identical). */
export function viewNovelty(view, views) {
  if (views.length === 0) return Infinity;
  let minD = Infinity;
  for (const v of views) {
    const a = view.features, b = v.features;
    const d = Math.hypot(a.cx - b.cx, a.cy - b.cy, (a.scale - b.scale) * 2, a.tiltX - b.tiltX, a.tiltY - b.tiltY);
    if (d < minD) minD = d;
  }
  return minD;
}

/** Mean corner motion (px) between two consecutive detections, for stillness detection. */
export function cornerMotion(prevMarkers, markers) {
  if (!prevMarkers || !markers) return Infinity;
  const prev = {};
  prevMarkers.forEach(m => { prev[m.id] = m; });
  let sum = 0, n = 0;
  for (const m of markers) {
    const p = prev[m.id];
    if (!p) continue;
    for (let i = 0; i < 4; i++) {
      sum += Math.hypot(m.corners[i].x - p.corners[i].x, m.corners[i].y - p.corners[i].y);
      n++;
    }
  }
  return n > 0 ? sum / n : Infinity;
}

// ---------------------------------------------------------------------------
// Calibration solve
// ---------------------------------------------------------------------------

/**
 * Run OpenCV intrinsic calibration over collected views.
 * Model: fx, fy, cx, cy, k1, k2 (tangential and k3 fixed at zero - the stable choice for webcams).
 */
export function calibrateFromViews(cv, views, w, h) {
  const objVec = new cv.MatVector();
  const imgVec = new cv.MatVector();
  const mats = [];
  // Initial guess: ~70 deg horizontal FOV, centred principal point
  const f0 = (w / 2) / Math.tan((70 * Math.PI / 180) / 2);
  const K = cv.matFromArray(3, 3, cv.CV_64F, [f0, 0, w / 2, 0, f0, h / 2, 0, 0, 1]);
  const D = cv.Mat.zeros(1, 5, cv.CV_64F);
  const rvecs = new cv.MatVector();
  const tvecs = new cv.MatVector();
  const sdInt = new cv.Mat();
  const sdExt = new cv.Mat();
  const perView = new cv.Mat();
  try {
    for (const v of views) {
      const o = cv.matFromArray(v.obj.length, 1, cv.CV_32FC3, v.obj.flat());
      const i = cv.matFromArray(v.img.length, 1, cv.CV_32FC2, v.img.flat());
      objVec.push_back(o);
      imgVec.push_back(i);
      mats.push(o, i);
    }
    const flags = CALIB_USE_INTRINSIC_GUESS | CALIB_ZERO_TANGENT_DIST | CALIB_FIX_K3;
    const criteria = new cv.TermCriteria(cv.TermCriteria_COUNT + cv.TermCriteria_EPS, 100, 1e-9);
    const rms = cv.calibrateCameraExtended(objVec, imgVec, new cv.Size(w, h), K, D, rvecs, tvecs, sdInt, sdExt, perView, flags, criteria);
    const k = Array.from(K.data64F);
    const dist = Array.from(D.data64F).slice(0, 5);
    const perViewErrors = Array.from(perView.data64F || []);
    const result = {
      width: w,
      height: h,
      fx: k[0], fy: k[4], cx: k[2], cy: k[5],
      dist,
      rms,
      perViewErrors,
      views: views.length,
      hfovDeg: 2 * Math.atan((w / 2) / k[0]) * 180 / Math.PI,
      date: new Date().toISOString()
    };
    result.verdict = assessCalibration(result);
    return result;
  } finally {
    mats.forEach(m => m.delete());
    objVec.delete(); imgVec.delete(); K.delete(); D.delete();
    rvecs.delete(); tvecs.delete(); sdInt.delete(); sdExt.delete(); perView.delete();
  }
}

/** Sanity-check and grade a calibration result. */
export function assessCalibration(r) {
  const problems = [];
  if (!Number.isFinite(r.rms)) problems.push('Solver did not converge');
  if (!(r.hfovDeg > 35 && r.hfovDeg < 120)) problems.push(`Implausible field of view (${r.hfovDeg?.toFixed(1)}°)`);
  if (Math.abs(r.fx - r.fy) / r.fx > 0.08) problems.push('fx and fy differ by more than 8% (pixels should be square)');
  if (Math.abs(r.cx - r.width / 2) > r.width * 0.15 || Math.abs(r.cy - r.height / 2) > r.height * 0.15) problems.push('Principal point is far from the image centre');
  if (Math.abs(r.dist[0]) > 0.8 || Math.abs(r.dist[1]) > 2.0) problems.push('Distortion coefficients are implausibly large');
  if (problems.length) return { ok: false, grade: 'failed', problems };
  if (r.rms < 0.5) return { ok: true, grade: 'excellent', problems };
  if (r.rms < 1.0) return { ok: true, grade: 'good', problems };
  return { ok: true, grade: 'poor', problems: ['Reprojection error is high: check the board is flat and the marker size is measured correctly'] };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'arguitar_camera_calibrations_v1';
export const CALIBRATION_CHANGED_EVENT = 'arguitar-calibration-changed';

function loadAll() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function saveAll(all) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  window.dispatchEvent(new Event(CALIBRATION_CHANGED_EVENT));
}

/** Identify the physical camera behind a <video> element's stream. */
export function getStreamCameraInfo(videoEl) {
  const track = videoEl?.srcObject?.getVideoTracks?.()[0];
  if (!track) return null;
  let deviceId = '';
  try { deviceId = track.getSettings().deviceId || ''; } catch { /* ignore */ }
  return { deviceId, label: track.label || '' };
}

/** Find the stored calibration for a camera (by deviceId, falling back to a unique label match). */
export function getCalibrationFor(info) {
  if (!info) return null;
  const all = loadAll();
  if (info.deviceId && all[info.deviceId]) return all[info.deviceId];
  if (info.label) {
    const matches = Object.values(all).filter(c => c.label === info.label);
    if (matches.length === 1) return matches[0];
  }
  return null;
}

export function saveCalibration(info, result) {
  const key = info.deviceId || info.label;
  if (!key) throw new Error('Cannot identify camera to store calibration');
  const all = loadAll();
  all[key] = { ...result, deviceId: info.deviceId, label: info.label };
  saveAll(all);
}

export function deleteCalibration(info) {
  const all = loadAll();
  const existing = getCalibrationFor(info);
  if (!existing) return;
  const key = existing.deviceId || existing.label;
  delete all[key];
  saveAll(all);
}

/**
 * Scale a stored calibration to the resolution currently being processed.
 * Returns null if the aspect ratio differs (the sensor crop would differ, so it is invalid).
 */
export function scaleCalibration(calib, w, h) {
  if (!calib || !calib.width || !calib.height) return null;
  const arCalib = calib.width / calib.height;
  const arNow = w / h;
  if (Math.abs(arCalib - arNow) / arNow > 0.02) return null;
  const sx = w / calib.width;
  const sy = h / calib.height;
  return {
    fx: calib.fx * sx,
    fy: calib.fy * sy,
    cx: calib.cx * sx,
    cy: calib.cy * sy,
    dist: calib.dist.slice(0, 5)
  };
}
