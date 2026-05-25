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

export const TOTAL_FRET_LENGTH_IN_CM = 48.0;
export const NECK_WIDTH = 4.6; // cm
export const NUMBER_OF_STRINGS = 6;
export const ARUCO_MARKER_ABSOLUTE_POSITIONS = [0.0, 12.7, 28.0, 34.5, 48.0];

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
 * Initialize camera matrices in OpenCV.js
 */
export function createCameraMats(cv) {
  let camMatrix = cv.matFromArray(3, 3, cv.CV_64F, DEFAULT_CAM_MATRIX);
  let distCoef = cv.matFromArray(1, 5, cv.CV_64F, DEFAULT_DIST_COEF);
  return { camMatrix, distCoef };
}

/**
 * Solve camera pose (3D position/rotation) of a marker using solvePnP
 * @returns {object|null} { rvec, tvec } in camera space
 */
export function solvePose(cv, corners, camMatrix, distCoef) {
  let markerPoints = cv.matFromArray(4, 3, cv.CV_32F, [
    -4.0, 4.0, 0.0,
    4.0, 4.0, 0.0,
    4.0, -4.0, 0.0,
    -4.0, -4.0, 0.0
  ]);
  
  let imagePoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
    corners[0].x, corners[0].y,
    corners[1].x, corners[1].y,
    corners[2].x, corners[2].y,
    corners[3].x, corners[3].y
  ]);
  
  let rvec = new cv.Mat();
  let tvec = new cv.Mat();
  
  let method = cv.SOLVEPNP_IPPE_SQUARE !== undefined ? cv.SOLVEPNP_IPPE_SQUARE : (cv.SOLVEPNP_ITERATIVE || 0);
  
  let success = cv.solvePnP(markerPoints, imagePoints, camMatrix, distCoef, rvec, tvec, false, method);
  
  markerPoints.delete();
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
  const stringNumber = Math.round(((offset + NECK_WIDTH / 2.0) * (NUMBER_OF_STRINGS - 1)) / NECK_WIDTH);
  if (0 <= stringNumber && stringNumber < NUMBER_OF_STRINGS) {
    return stringNumber + 1;
  }
  return 0;
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
 */
export function calculateFretAndStringFromGuitarMarkers(guitarStart, guitarEnd, fingerPos, roundString = true) {
  const p1x = guitarStart.x, p1y = guitarStart.y;
  const p2x = guitarEnd.x, p2y = guitarEnd.y;
  const p3x = fingerPos.x, p3y = fingerPos.y;
  
  const intersection = perpendicularIntersection(p1x, p1y, p2x, p2y, p3x, p3y);
  
  const distFromStart2 = (intersection.x - p1x) ** 2 + (intersection.y - p1y) ** 2;
  const intersectionFromGuitarStart = Math.sqrt(Math.abs(distFromStart2));
  
  const guitarLength = Math.sqrt(Math.abs((p2x - p1x) ** 2 + (p2y - p1y) ** 2));
  if (guitarLength === 0) return [0, 0];
  
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
  
  return [fretIdx + 1, stringNumber];
}

/**
 * Extract guitar end-points from marker coordinates mapping
 */
export function calculateGuitarFromMarkers(markers, markerPoses = null) {
  const m1 = markers[1];
  const m5 = markers[5];
  if (m1 && m5) {
    if (markerPoses && markerPoses[1] && markerPoses[5]) {
      return {
        start: m1.center,
        end: m5.center,
        poseStart: markerPoses[1],
        poseEnd: markerPoses[5]
      };
    }
    return {
      start: m1.center,
      end: m5.center,
      poseStart: null,
      poseEnd: null
    };
  }
  return null;
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
  const m1 = markers[1];
  const m5 = markers[5];
  if (m1 && m5) {
    return calculateTargetFingerPosition(m1.center, m5.center, targetFret, targetString);
  }
  
  const m4 = markers[4];
  const m2 = markers[2];
  
  if (m1 && m4) {
    const deltaX = m4.center.x - m1.center.x;
    const deltaY = m4.center.y - m1.center.y;
    const scale = ARUCO_MARKER_ABSOLUTE_POSITIONS[4] / ARUCO_MARKER_ABSOLUTE_POSITIONS[3];
    const fifthMarker = {
      x: m1.center.x + deltaX * scale,
      y: m1.center.y + deltaY * scale
    };
    return calculateTargetFingerPosition(m1.center, fifthMarker, targetFret, targetString);
  }
  
  if (m2 && m5) {
    const deltaX = m5.center.x - m2.center.x;
    const deltaY = m5.center.y - m2.center.y;
    const scale = (ARUCO_MARKER_ABSOLUTE_POSITIONS[4] - ARUCO_MARKER_ABSOLUTE_POSITIONS[0]) /
                  (ARUCO_MARKER_ABSOLUTE_POSITIONS[4] - ARUCO_MARKER_ABSOLUTE_POSITIONS[1]);
    const firstMarker = {
      x: m5.center.x - deltaX * scale,
      y: m5.center.y - deltaY * scale
    };
    return calculateTargetFingerPosition(firstMarker, m5.center, targetFret, targetString);
  }
  
  return null;
}
