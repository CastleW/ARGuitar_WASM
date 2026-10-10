/**
 * Guitar Geometry and Camera Pose Estimation Utilities
 * Port of `aruco_calculations.py`
 */

export const FRET_ABSOLUTE_DISTANCES_FROM_NUT = [
  3.64, 7.07, 10.31, 13.36, 16.25, 18.97,
  21.54, 23.97, 26.26, 28.42, 30.46,
  32.38, 34.2, 35.92, 37.54, 39.07,
  40.51,
  41.87, 43.16, 44.37, 45.51,
  46.59, 49.8
];

export const FRETS_FOR_DRAWING = [0.0, ...FRET_ABSOLUTE_DISTANCES_FROM_NUT];

export const TOTAL_FRET_LENGTH_IN_CM = 50.0; // Calibrated for Marker 5 placed on body past the 22nd fret (~19" fretboard)
export const NECK_WIDTH = 4.6; // cm
export const NUMBER_OF_STRINGS = 6;
export const ARUCO_MARKER_ABSOLUTE_POSITIONS = [0.0, 16.8, 28.5, 37.0, 50.0];

// Default camera matrix (derived from MultiMatrix.npz)
export const DEFAULT_CAM_MATRIX = [
  895.35076989, 0, 248.37585485,
  0, 892.32692372, 140.3891681,
  0, 0, 1.0
];

// Default distortion coefficients
export const DEFAULT_DIST_COEF = [
  0.03825588, 0.14136728, -0.01338866, -0.00669156, -1.08208082
];

/**
 * Initialize camera matrices in OpenCV.js, scaled proportionally to stream resolution
 */
export function createCameraMats(cv, width = 640, height = 480) {
  const sx = width / 640.0;
  const sy = height / 480.0;
  const scaledMatrix = [
    DEFAULT_CAM_MATRIX[0] * sx, 0, DEFAULT_CAM_MATRIX[2] * sx,
    0, DEFAULT_CAM_MATRIX[4] * sy, DEFAULT_CAM_MATRIX[5] * sy,
    0, 0, 1.0
  ];
  let camMatrix = cv.matFromArray(3, 3, cv.CV_64F, scaledMatrix);
  let distCoef = cv.matFromArray(1, 5, cv.CV_64F, DEFAULT_DIST_COEF);
  return { camMatrix, distCoef };
}

let cachedMarkerPoints = null;

/**
 * Solve camera pose (3D position/rotation) of a marker using solvePnP
 * @returns {object|null} { rvec, tvec } in camera space
 */
export function solvePose(cv, corners, camMatrix, distCoef) {
  if (!cachedMarkerPoints) {
    cachedMarkerPoints = cv.matFromArray(4, 3, cv.CV_32F, [
      -4.0, 4.0, 0.0,
      4.0, 4.0, 0.0,
      4.0, -4.0, 0.0,
      -4.0, -4.0, 0.0
    ]);
  }

  let imagePoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
    corners[0].x, corners[0].y,
    corners[1].x, corners[1].y,
    corners[2].x, corners[2].y,
    corners[3].x, corners[3].y
  ]);

  let rvec = new cv.Mat();
  let tvec = new cv.Mat();

  let method = cv.SOLVEPNP_IPPE_SQUARE !== undefined ? cv.SOLVEPNP_IPPE_SQUARE : (cv.SOLVEPNP_ITERATIVE || 0);

  let success = cv.solvePnP(cachedMarkerPoints, imagePoints, camMatrix, distCoef, rvec, tvec, false, method);

  imagePoints.delete();

  if (success) {
    let r = [rvec.doubleAt(0), rvec.doubleAt(1), rvec.doubleAt(2)];
    let t = [tvec.doubleAt(0), tvec.doubleAt(1), tvec.doubleAt(2)];
    rvec.delete();
    tvec.delete();
    return { rvec: r, tvec: t };
  } else {
    rvec.delete();
    tvec.delete();
    return null;
  }
}

/**
 * Calculate the perpendicular intersection of point p3 onto line p1-p2
 */
export function perpendicularIntersection(p1x, p1y, p2x, p2y, p3x, p3y) {
  const a = p2y - p1y;
  const a_c = a * a;
  const b = p1x - p2x;
  const b_c = b * b;
  const c = p2x * p1y - p1x * p2y;
  const denom = a_c + b_c;
  if (denom === 0) return { x: p1x, y: p1y };

  const x = ((b_c * p3x) - (a * b * p3y) - (a * c)) / denom;
  const y = ((a_c * p3y) - (a * b * p3x) - (b * c)) / denom;
  return { x, y };
}

/**
 * Calculate string number from lateral offset (rounded)
 * String index goes from 1 to 6 (Low E to High E)
 */
export function calculateStringRounded(offset) {
  const normalized = ((offset + NECK_WIDTH / 2.0) * (NUMBER_OF_STRINGS - 1)) / NECK_WIDTH;
  const stringNumber = Math.round(normalized);
  // Allow slight margin outside outermost strings before treating as off-neck
  if (normalized < -0.8 || normalized > (NUMBER_OF_STRINGS - 1) + 0.8) {
    return 0;
  }
  const clamped = Math.max(0, Math.min(NUMBER_OF_STRINGS - 1, stringNumber));
  return clamped + 1;
}

/**
 * Calculate string number from lateral offset (floating point)
 */
export function calculateStringUnrounded(offset) {
  const stringNumber = ((offset + NECK_WIDTH / 2.0) * (NUMBER_OF_STRINGS - 1)) / NECK_WIDTH;
  if (0 <= stringNumber && stringNumber < NUMBER_OF_STRINGS) {
    return stringNumber + 1.0;
  }
  return 0;
}

/**
 * Binary search helper (np.searchsorted equivalent)
 */
function searchSorted(arr, val) {
  let low = 0, high = arr.length;
  while (low < high) {
    let mid = (low + high) >>> 1;
    if (arr[mid] < val) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Calculate fret and string from start and end points of guitar and finger position
 * @returns {Array} [fret_number, string_number]
 * This is centre to centre on each square marker
 */
/*
export const ARUCO_MARKER_MAP = {
  1: 0.0,
  2: 12.7,
  3: 28.0,
  4: 34.5,
  5: 52.0
};
*/

export const ARUCO_MARKER_MAP = {
  1: -6.8, // Calibrated: Marker 1 on headstock (4.6cm nut-to-edge + 2.2cm to center)
  2: 16.8,
  3: 28.5,
  4: 37.0,
  5: 50.0 // Fretboard end
};

/**
 * Calculate fret and string using piecewise interpolation between all detected markers
 * This eliminates perspective foreshortening distortion along the neck.
 * @param {object} markers - Map of detected markers { [id]: marker }
 * @param {object} fingerPos - { x, y } coordinates of finger tip
 * @param {boolean} roundString - Whether to round string index
 * @returns {Array} [fret_number, string_number, fretLocator]
 */
export function calculateFretAndStringPiecewise(markers, fingerPos, roundString = true) {
  if (!markers || !fingerPos) return [0, 0, 0];

  // 1. Gather all recognized markers on the neck and sort by physical cm
  const detected = [];
  for (const [idStr, posCm] of Object.entries(ARUCO_MARKER_MAP)) {
    const id = parseInt(idStr, 10);
    const m = markers[id];
    if (m) {
      const center = m.center || m;
      if (center && center.x !== undefined && center.y !== undefined) {
        detected.push({
          id,
          x: center.x,
          y: center.y,
          cm: posCm
        });
      }
    }
  }

  detected.sort((a, b) => a.cm - b.cm);

  // If fewer than 2 markers detected, fallback or fail
  if (detected.length < 2) {
    return [0, 0, 0];
  }

  const p3x = fingerPos.x, p3y = fingerPos.y;
  const numSegments = detected.length - 1;

  // 2. Project finger onto each segment to find the closest segment
  let chosenSeg = 0;
  let chosenT = 0;
  let minDistance = Infinity;

  for (let i = 0; i < numSegments; i++) {
    const mA = detected[i];
    const mB = detected[i + 1];
    const dx = mB.x - mA.x;
    const dy = mB.y - mA.y;
    const segLen2 = dx * dx + dy * dy;
    if (segLen2 === 0) continue;

    // Unclamped parameter t along the infinite line of this segment
    const t = ((p3x - mA.x) * dx + (p3y - mA.y) * dy) / segLen2;

    // Clamped point on the actual segment
    const tClamped = Math.max(0, Math.min(1, t));
    const closestX = mA.x + tClamped * dx;
    const closestY = mA.y + tClamped * dy;
    const dist = Math.sqrt((p3x - closestX) ** 2 + (p3y - closestY) ** 2);

    if (dist < minDistance) {
      minDistance = dist;
      chosenSeg = i;
      chosenT = t;
    }
  }

  // 3. Compute physical distance (fretLocator) using the chosen segment
  const mA = detected[chosenSeg];
  const mB = detected[chosenSeg + 1];
  const segDx = mB.x - mA.x;
  const segDy = mB.y - mA.y;
  const segPixelLen = Math.sqrt(segDx * segDx + segDy * segDy);
  const segCmLlen = mB.cm - mA.cm;

  let fretLocator = mA.cm + chosenT * segCmLlen;
  if (fretLocator < 0) fretLocator = 0;

  // 4. Compute string lateral distance using local segment scale
  const localScale = segCmLlen / (segPixelLen || 1);
  const perpX = mA.x + chosenT * segDx;
  const perpY = mA.y + chosenT * segDy;
  let stringDistance = Math.sqrt((p3x - perpX) ** 2 + (p3y - perpY) ** 2) * localScale;

  // Overall guitar axis direction for string side sign (from first to last marker)
  const firstM = detected[0];
  const lastM = detected[detected.length - 1];
  const vecAx = firstM.x - lastM.x;
  const vecAy = firstM.y - lastM.y;
  const vecBx = p3x - lastM.x;
  const vecBy = p3y - lastM.y;
  const zComponent = vecAx * vecBy - vecAy * vecBx;
  if (zComponent < 0) {
    stringDistance = -stringDistance;
  }

  const stringNumber = roundString ? calculateStringRounded(stringDistance) : calculateStringUnrounded(stringDistance);
  const fretIdx = searchSorted(FRET_ABSOLUTE_DISTANCES_FROM_NUT, fretLocator);

  return [fretIdx + 1, stringNumber, fretLocator];
}

/**
 * Compute unified 2D neck geometry from detected markers and user scale
 * Single source of truth for both drawing and hit-testing
 */
export function getNeckGeometry(markers, neckWidthScale = 1.6, markerPoses = null, totalFretLength = 52.0) {
  if (!markers) return null;

  const guitar = calculateGuitarFromMarkers(markers, markerPoses);
  if (!guitar || !guitar.start || !guitar.end) return null;

  const { start, end } = guitar;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return null;

  const perpX = -dy / len;
  const perpY = dx / len;

  // Helper: cross-neck width of a marker projected across (perpX, perpY)
  const getCrossWidth = (m) => {
    if (!m || !m.corners || m.corners.length < 4) return null;
    const projs = m.corners.map(c => c.x * perpX + c.y * perpY);
    const w = Math.max(...projs) - Math.min(...projs);
    return w > 6 ? w : null;
  };

  const detected = [];
  for (const [idStr, posCm] of Object.entries(ARUCO_MARKER_MAP)) {
    const id = parseInt(idStr, 10);
    const m = markers[id];
    if (m && (m.center || m.corners)) {
      const cw = getCrossWidth(m);
      detected.push({ id, cm: posCm, crossWidth: cw, center: m.center });
    }
  }
  detected.sort((a, b) => a.cm - b.cm);

  let markerWidthNut = null;
  let markerWidthEnd = null;

  for (let i = 0; i < detected.length; i++) {
    if (detected[i].crossWidth) {
      markerWidthNut = detected[i].crossWidth;
      break;
    }
  }
  for (let i = detected.length - 1; i >= 0; i--) {
    if (detected[i].crossWidth) {
      markerWidthEnd = detected[i].crossWidth;
      break;
    }
  }

  if (markerWidthNut && !markerWidthEnd) markerWidthEnd = markerWidthNut * 1.15;
  if (!markerWidthNut && markerWidthEnd) markerWidthNut = markerWidthEnd * 0.88;

  const effectiveTotalLength = totalFretLength || TOTAL_FRET_LENGTH_IN_CM;
  const defaultNutWidth = (len / effectiveTotalLength) * 4.3;
  const defaultEndWidth = (len / effectiveTotalLength) * 5.6;

  const nutNeckWidth = (markerWidthNut ? markerWidthNut * neckWidthScale * 0.92 : defaultNutWidth * neckWidthScale);
  const endNeckWidth = (markerWidthEnd ? markerWidthEnd * neckWidthScale * 1.15 : defaultEndWidth * neckWidthScale);

  // Compute depth ratio r = invZNut / invZEnd = ZEnd / ZNut
  // r > 1: Nut is closer to camera than body (frets near nut expand)
  // r < 1: Body is closer to camera than nut (frets near nut compress)
  // r = 1: Parallel to camera (uniform physical scale)
  let depthRatio = 1.0;

  // 1. Check 3D pose depth from solvePnP if available
  let rFromPose = null;
  if (markerPoses) {
    if (markerPoses[1] && markerPoses[5]) {
      const zNut = markerPoses[1][2];
      const zEnd = markerPoses[5][2];
      if (zNut > 10 && zEnd > 10) {
        rFromPose = zEnd / zNut;
      }
    } else {
      // Find any pair with poses to estimate depth ratio - require wide baseline (>= 28cm)
      const posesWithCm = [];
      for (const [idStr, posCm] of Object.entries(ARUCO_MARKER_MAP)) {
        const id = parseInt(idStr, 10);
        if (markerPoses[id] && markerPoses[id][2] > 10) {
          posesWithCm.push({ id, cm: posCm, z: markerPoses[id][2] });
        }
      }
      if (posesWithCm.length >= 2) {
        posesWithCm.sort((a, b) => a.cm - b.cm);
        const pFirst = posesWithCm[0];
        const pLast = posesWithCm[posesWithCm.length - 1];
        const span = pLast.cm - pFirst.cm;
        // Require wide span (>= 28cm, e.g. Marker 2 to 5 = 33.2cm) to avoid extrapolating noise across short baselines (e.g. 3-4 = 8.5cm)
        if (span >= 28.0) {
          const wFirst = 1 / pFirst.z;
          const wLast = 1 / pLast.z;
          const nutCm = 0.0; // The nut is ALWAYS at 0.0 cm
          const endCm = ARUCO_MARKER_MAP[5] !== undefined ? ARUCO_MARKER_MAP[5] : (totalFretLength || TOTAL_FRET_LENGTH_IN_CM);
          const wNut = wFirst - ((wLast - wFirst) / span) * (pFirst.cm - nutCm);
          const wEnd = wLast + ((wLast - wFirst) / span) * (endCm - pLast.cm);
          if (wNut > 0 && wEnd > 0) {
            rFromPose = wNut / wEnd;
          }
        }
      }
    }
  }

  // 2. Optical scale from marker cross-widths if both exist
  let rFromMarkers = null;
  if (markerWidthNut && markerWidthEnd && markerWidthNut > 8 && markerWidthEnd > 8) {
    rFromMarkers = markerWidthNut / markerWidthEnd;
  }

  // 3. Optical scale from calibrated neck widths
  const invZNut = nutNeckWidth / 4.3;
  const invZEnd = endNeckWidth / 5.6;
  const rFromWidth = (invZEnd > 0) ? (invZNut / invZEnd) : 1.0;

  if (rFromPose && rFromPose > 0.70 && rFromPose < 1.40) {
    depthRatio = rFromPose;
  } else if (rFromMarkers && rFromMarkers > 0.70 && rFromMarkers < 1.40) {
    depthRatio = rFromMarkers;
  } else if (rFromWidth > 0.70 && rFromWidth < 1.40) {
    depthRatio = rFromWidth;
  }

  // Clamp to realistic physical range (guitar normal to webcam rarely exceeds 0.75..1.30)
  depthRatio = Math.max(0.75, Math.min(1.30, depthRatio));

  return {
    start,
    end,
    dx,
    dy,
    len,
    perpX,
    perpY,
    nutNeckWidth,
    endNeckWidth,
    depthRatio,
    totalFretLength: effectiveTotalLength,
    detectedMarkers: detected,
    neckWidthScale,
    debug: guitar.debug
  };
}

/**
 * Calculate fret and string directly from unified neck geometry
 * Uses the exact same coordinates and boundaries as the visual string rendering
 */
export function calculateFretAndStringFromGeometry(geometry, fingerPos, roundString = true) {
  if (!geometry || !fingerPos) return [0, 0, 0];

  const { start, dx, dy, len, perpX, perpY, nutNeckWidth, endNeckWidth, depthRatio, totalFretLength } = geometry;
  const p3x = fingerPos.x;
  const p3y = fingerPos.y;
  const r = depthRatio || 1.0;
  const length = totalFretLength || TOTAL_FRET_LENGTH_IN_CM;

  // 1. Screen fraction along the centerline
  const tScreen = Math.max(0, Math.min(1.1, ((p3x - start.x) * dx + (p3y - start.y) * dy) / (len * len)));

  // Invert projective perspective to physical fraction uPhys:
  // tScreen = (u * r) / ((1 - u) + u * r)
  // => uPhys = tScreen / ((1 - tScreen) * r + tScreen)
  const denom = (1 - tScreen) * r + tScreen;
  const uPhys = denom > 0 ? tScreen / denom : tScreen;
  const fretLocator = Math.max(0, uPhys * length);

  const fretIdx = searchSorted(FRET_ABSOLUTE_DISTANCES_FROM_NUT, fretLocator);
  const fretNumber = fretIdx + 1;

  // 2. String Hit-Testing: Exact mathematical match to drawn strings
  const cx = start.x + tScreen * dx;
  const cy = start.y + tScreen * dy;

  // Lateral distance across the neck in pixels along (perpX, perpY)
  const lateralDistPx = (p3x - cx) * perpX + (p3y - cy) * perpY;

  // Local string spread matches the 0.88 margin used in drawGuitarOnCanvas
  const localNeckWidth = nutNeckWidth + tScreen * (endNeckWidth - nutNeckWidth);
  const localStringSpread = localNeckWidth * 0.88;

  // Normalized string position (-0.5 on String 1, +0.5 on String 6)
  const normalizedStringPos = lateralDistPx / (localStringSpread || 1);

  let stringNumber = 0;
  if (normalizedStringPos >= -0.65 && normalizedStringPos <= 0.65) {
    const rawString = (normalizedStringPos + 0.5) * (NUMBER_OF_STRINGS - 1) + 1;
    if (roundString) {
      stringNumber = Math.max(1, Math.min(NUMBER_OF_STRINGS, Math.round(rawString)));
    } else {
      stringNumber = Math.max(1.0, Math.min(NUMBER_OF_STRINGS * 1.0, rawString));
    }
  }

  return [fretNumber, stringNumber, fretLocator];
}

/**
 * Calculate the perspective-correct screen position and width of a fret
 * Single closed-form projective model unified with strings and finger tracking
 */
export function getFretPositionAndWidth(fretDist, geometry) {
  const { start, dx, dy, nutNeckWidth, endNeckWidth, depthRatio, totalFretLength } = geometry;
  const r = depthRatio || 1.0;
  const length = totalFretLength || TOTAL_FRET_LENGTH_IN_CM;

  // Physical fraction u along the neck to Marker 5
  const u = Math.max(0, Math.min(1.05, fretDist / length));

  // Projective perspective fraction tScreen:
  // When nut is closer (r > 1), closer frets expand (tScreen > u)
  // When body is closer (r < 1), closer frets compress (tScreen < u)
  const denom = (1 - u) + u * r;
  const tScreen = denom > 0 ? (u * r) / denom : u;

  const fx = start.x + tScreen * dx;
  const fy = start.y + tScreen * dy;
  const fWidth = Math.max(10, nutNeckWidth + tScreen * (endNeckWidth - nutNeckWidth));

  return { fx, fy, fWidth };
}

/**
 * Calculate fret and string from start and end points of guitar and finger position
 * Supports both unified geometry markers object or legacy two-point coordinates.
 * @returns {Array} [fret_number, string_number, fretLocator]
 */
export function calculateFretAndStringFromGuitarMarkers(guitarStartOrMarkers, guitarEnd, fingerPos, roundString = true, neckWidthScale = 1.6, markerPoses = null) {
  // Check if first argument is a markers map containing detected markers
  if (guitarStartOrMarkers && (guitarStartOrMarkers[1] || guitarStartOrMarkers[5] || guitarStartOrMarkers[2] || guitarStartOrMarkers[3] || guitarStartOrMarkers[4])) {
    const actualFinger = (guitarEnd && guitarEnd.x !== undefined) ? (fingerPos || guitarEnd) : (fingerPos || guitarEnd);
    const geometry = getNeckGeometry(guitarStartOrMarkers, neckWidthScale, markerPoses);
    if (geometry) {
      return calculateFretAndStringFromGeometry(geometry, actualFinger, roundString);
    }
    return calculateFretAndStringPiecewise(guitarStartOrMarkers, actualFinger, roundString);
  }

  // Fallback to legacy two-point interpolation
  const guitarStart = guitarStartOrMarkers;
  if (!guitarStart || !guitarEnd || !fingerPos) return [0, 0, 0];

  const p1x = guitarStart.x, p1y = guitarStart.y;
  const p2x = guitarEnd.x, p2y = guitarEnd.y;
  const p3x = fingerPos.x, p3y = fingerPos.y;

  const intersection = perpendicularIntersection(p1x, p1y, p2x, p2y, p3x, p3y);

  const distFromStart2 = (intersection.x - p1x) ** 2 + (intersection.y - p1y) ** 2;
  const intersectionFromGuitarStart = Math.sqrt(Math.abs(distFromStart2));

  const guitarLength = Math.sqrt(Math.abs((p2x - p1x) ** 2 + (p2y - p1y) ** 2));
  if (guitarLength === 0) return [0, 0, 0];

  const fretLocator = intersectionFromGuitarStart * TOTAL_FRET_LENGTH_IN_CM / guitarLength;

  let stringDistance = Math.sqrt(Math.abs((intersection.x - p3x) ** 2 + (intersection.y - p3y) ** 2)) * TOTAL_FRET_LENGTH_IN_CM / guitarLength;

  // Sign of stringDistance based on cross product
  const vecAx = p1x - p2x;
  const vecAy = p1y - p2y;
  const vecBx = p3x - p2x;
  const vecBy = p3y - p2y;
  const zComponent = vecAx * vecBy - vecAy * vecBx;
  if (zComponent < 0) {
    stringDistance = -stringDistance;
  }

  const stringNumber = roundString ? calculateStringRounded(stringDistance) : calculateStringUnrounded(stringDistance);
  const fretIdx = searchSorted(FRET_ABSOLUTE_DISTANCES_FROM_NUT, fretLocator);

  return [fretIdx + 1, stringNumber, fretLocator];
}

/**
 * Extract guitar end-points from marker coordinates mapping
 * Supports ANY detected pair or combination of markers (1, 2, 3, 4, 5)
 */
export function calculateGuitarFromMarkers(markers, markerPoses = null) {
  if (!markers) return null;

  // 1. Gather all recognized markers on the neck
  const detected = [];
  for (const [idStr, posCm] of Object.entries(ARUCO_MARKER_MAP)) {
    const id = parseInt(idStr, 10);
    const m = markers[id];
    if (m) {
      const center = m.center || m;
      if (center && typeof center.x === 'number' && typeof center.y === 'number') {
        detected.push({
          id,
          center,
          cm: posCm,
          pose: (markerPoses && markerPoses[id]) || null
        });
      }
    }
  }

  // Need at least 2 markers to determine guitar direction and position
  if (detected.length < 2) {
    return null;
  }

  detected.sort((a, b) => a.cm - b.cm);

  const nutCm = 0.0; // The nut is ALWAYS at 0.0 cm (origin of frets and strings)
  const endCm = ARUCO_MARKER_MAP[5] !== undefined ? ARUCO_MARKER_MAP[5] : TOTAL_FRET_LENGTH_IN_CM;

  // Universal Fallback: Use the two detected markers with largest physical baseline
  const first = detected[0];
  const last = detected[detected.length - 1];
  const spanCm = last.cm - first.cm;

  if (spanCm <= 0) {
    return null;
  }

  const dx = last.center.x - first.center.x;
  const dy = last.center.y - first.center.y;
  const distSq = dx * dx + dy * dy;

  // Determine perspective depth ratio k = Z_last / Z_first
  // k > 1 means the 'last' marker is further from the camera than 'first' (causes foreshortening towards last)
  let k = 1.0;

  // 1. Try from 3D solvePose depths if both first and last have valid poses
  if (first.pose && last.pose && first.pose[2] > 10 && last.pose[2] > 10) {
    const kPose = last.pose[2] / first.pose[2];
    if (kPose > 0.4 && kPose < 2.5) {
      k = kPose;
    }
  }

  // 2. Or from intermediate marker(s) using 1D projective invariant (cross-ratio)
  if (detected.length >= 3 && distSq > 0) {
    // Pick the middle marker closest to the center of the baseline
    const midTargetCm = (first.cm + last.cm) / 2;
    let bestMid = detected[1];
    let bestDiff = Math.abs(bestMid.cm - midTargetCm);
    for (let i = 2; i < detected.length - 1; i++) {
      const diff = Math.abs(detected[i].cm - midTargetCm);
      if (diff < bestDiff) {
        bestMid = detected[i];
        bestDiff = diff;
      }
    }

    const uPhys = (bestMid.cm - first.cm) / spanCm;
    const midDx = bestMid.center.x - first.center.x;
    const midDy = bestMid.center.y - first.center.y;
    const tScreen = (midDx * dx + midDy * dy) / distSq;

    if (uPhys > 0.05 && uPhys < 0.95 && tScreen > 0.05 && tScreen < 0.95) {
      // Cross-ratio odds: k = (tScreen / (1 - tScreen)) / (uPhys / (1 - uPhys))
      const kFrom2D = (tScreen / (1 - tScreen)) / (uPhys / (1 - uPhys));
      if (kFrom2D > 0.45 && kFrom2D < 2.2) {
        k = kFrom2D;
      }
    }
  }

  // Bounded depth ratio for safe extrapolation outside the marker span (prevents homography singularity)
  // When baseline span is small (< 25cm), nonlinear perspective depth estimation is ill-conditioned.
  // Clamp kExtrap to 1.0 (pure linear extrapolation) to prevent explosive stretching/shrinking.
  const kExtrap = spanCm >= 25.0 ? Math.max(0.85, Math.min(1.25, k)) : 1.0;

  // Helper: Project physical fraction u (where first is u=0, last is u=1) to 2D image coordinates
  // Accounts for perspective compression:
  // - For 0 <= u <= 1: standard projective homography (u * k) / ((1 - u) + u * k)
  // - For u < 0 (extrapolating to nut): linear projective derivative u * kExtrap (prevents singularity explosion!)
  // - For u > 1 (extrapolating to bridge): linear projective derivative 1 + (u - 1) / kExtrap
  const projectPoint = (u) => {
    let projFraction;
    if (u >= 0 && u <= 1) {
      const denom = (1 - u) + u * k;
      projFraction = denom > 0.05 ? (u * k) / denom : u;
    } else if (u < 0) {
      // Extrapolating backward towards nut: clamp to realistic physical perspective expansion
      projFraction = u * kExtrap;
    } else {
      // Extrapolating forward towards bridge
      projFraction = 1.0 + (u - 1.0) / kExtrap;
    }
    return {
      x: first.center.x + dx * projFraction,
      y: first.center.y + dy * projFraction
    };
  };

  let start = first.center;
  let end = last.center;
  let uNut = 0;
  let uEnd = 1;

  // Project Nut (0.0 cm) from the detected marker span
  if (Math.abs(first.cm - nutCm) > 0.05) {
    uNut = (nutCm - first.cm) / spanCm; // e.g. (0 - (-6.8)) / 56.8 = 0.1197
    start = projectPoint(uNut);
  }

  // Project End (50.0 cm) from the detected marker span
  if (Math.abs(last.cm - endCm) > 0.05) {
    uEnd = (endCm - first.cm) / spanCm; // > 1
    end = projectPoint(uEnd);
  }

  const m1 = detected.find(m => m.id === 1);
  const m5 = detected.find(m => m.id === 5);

  return {
    start,
    end,
    poseStart: (m1 && m1.pose) || null,
    poseEnd: (m5 && m5.pose) || null,
    debug: {
      detectedIds: detected.map(m => m.id),
      firstId: first.id,
      lastId: last.id,
      firstCm: first.cm,
      lastCm: last.cm,
      spanCm,
      k,
      kExtrap,
      uNut,
      uEnd,
      isPinnedNut: first.id === 1 && Math.abs(first.cm - nutCm) <= 0.05,
      isPinnedEnd: last.id === 5 && Math.abs(last.cm - endCm) <= 0.05,
      allDetected: detected
    }
  };
}

/**
 * Calculate 2D screen coordinate for a given target fret and string
 */
export function calculateTargetFingerPosition(guitarStart, guitarEnd, targetFret, targetString) {
  const p1x = guitarStart.x, p1y = guitarStart.y;
  const p2x = guitarEnd.x, p2y = guitarEnd.y;

  const guitarLength = Math.sqrt(Math.abs((p2x - p1x) ** 2 + (p2y - p1y) ** 2));
  if (guitarLength === 0) return { x: 0, y: 0 };

  const distanceFromNut = FRET_ABSOLUTE_DISTANCES_FROM_NUT[targetFret - 1] || 0;
  const fretLocator = distanceFromNut * guitarLength / TOTAL_FRET_LENGTH_IN_CM;

  const guitarSlope = -1;
  const fretSlope = -1 / guitarSlope; // equals 1

  const fretCentreX = p1x + (fretLocator * (p2x - p1x) / guitarLength);
  const fretCentreY = p1y + (fretLocator * (p2y - p1y) / guitarLength);

  const scaleToAr = guitarLength / TOTAL_FRET_LENGTH_IN_CM;

  const adjustedTargetString = (targetString - 1 - ((NUMBER_OF_STRINGS - 1) / 2));
  const stringY = fretCentreY + (adjustedTargetString * scaleToAr);
  const stringX = fretCentreX + ((stringY - fretCentreY) / fretSlope);

  return { x: stringX, y: stringY };
}

/**
 * Calculate target finger position using fallback logic if some markers are missing
 */
export function calculateTargetFingerPositionFromMarkers(markers, targetFret, targetString) {
  const guitar = calculateGuitarFromMarkers(markers);
  if (!guitar || !guitar.start || !guitar.end) return null;
  return calculateTargetFingerPosition(guitar.start, guitar.end, targetFret, targetString);
}
