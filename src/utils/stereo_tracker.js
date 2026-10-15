/**
 * Dual-Camera Stereo Vision & 3D Depth Tracker
 * 
 * Provides:
 * 1. Marker-based automatic relative extrinsic calibration (Cam 1 <-> Cam 2)
 * 2. 3D Ray Triangulation for millimeter-accurate hand tracking
 * 3. Distance-to-guitar plane calculation for true air-hover vs string-contact gating
 * 4. Cross-camera marker projection for occlusion recovery
 */

import { ARUCO_MARKER_MAP, DEFAULT_DIST_COEF } from './guitar_math';

/**
 * Invert radial/tangential lens distortion for normalized pinhole coordinates.
 * distCoef must be the calibrated coefficients of the camera that produced the point
 * (see camera_calibration.js). With zero coefficients (uncalibrated) this is a no-op.
 */
export function undistortNormalizedPoint(xd, yd, distCoef = DEFAULT_DIST_COEF) {
  if (!distCoef || distCoef.length === 0 || distCoef.every(c => !c)) return { x: xd, y: yd };
  const k1 = distCoef[0] || 0;
  const k2 = distCoef[1] || 0;
  const p1 = distCoef[2] || 0;
  const p2 = distCoef[3] || 0;
  const k3 = distCoef[4] || 0;

  // Guard against non-physical coordinates outside lens FOV
  if (xd * xd + yd * yd > 4.0) return { x: xd, y: yd };

  let x = xd;
  let y = yd;
  for (let it = 0; it < 5; it++) {
    const r2 = x * x + y * y;
    const r4 = r2 * r2;
    const r6 = r4 * r2;
    const radial = 1.0 + k1 * r2 + k2 * r4 + k3 * r6;
    if (radial <= 0.1 || radial > 10.0) break;
    const dx = 2 * p1 * x * y + p2 * (r2 + 2 * x * x);
    const dy = p1 * (r2 + 2 * y * y) + 2 * p2 * x * y;
    x = (xd - dx) / radial;
    y = (yd - dy) / radial;
  }
  return { x, y };
}

/**
 * Convert Rodrigues rotation vector [rx, ry, rz] to 3x3 rotation matrix (row-major)
 */
export function rodriguesToMatrix(rvec) {
  const rx = rvec[0], ry = rvec[1], rz = rvec[2];
  const theta = Math.hypot(rx, ry, rz);
  if (theta < 1e-6) {
    return [
      1, 0, 0,
      0, 1, 0,
      0, 0, 1
    ];
  }
  const ux = rx / theta, uy = ry / theta, uz = rz / theta;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const c1 = 1 - c;

  return [
    c + ux * ux * c1,          ux * uy * c1 - uz * s,   ux * uz * c1 + uy * s,
    uy * ux * c1 + uz * s,   c + uy * uy * c1,          uy * uz * c1 - ux * s,
    uz * ux * c1 - uy * s,   uz * uy * c1 + ux * s,   c + uz * uz * c1
  ];
}

/**
 * Invert a rigid 3D transform [R | t]
 * X_inv = R^T * (X - t) = R^T * X - R^T * t
 */
export function invertTransform(R, t) {
  // Transpose of 3x3 matrix R (row-major)
  const R_inv = [
    R[0], R[3], R[6],
    R[1], R[4], R[7],
    R[2], R[5], R[8]
  ];
  // -R^T * t
  const t_inv = [
    -(R_inv[0] * t[0] + R_inv[1] * t[1] + R_inv[2] * t[2]),
    -(R_inv[3] * t[0] + R_inv[4] * t[1] + R_inv[5] * t[2]),
    -(R_inv[6] * t[0] + R_inv[7] * t[1] + R_inv[8] * t[2])
  ];
  return { R: R_inv, t: t_inv };
}

/**
 * Multiply two 3D rigid transforms: T_res = T_A * T_B
 * where T(X) = R * X + t
 */
export function multiplyTransforms(RA, tA, RB, tB) {
  // R = RA * RB
  const R = [
    RA[0]*RB[0] + RA[1]*RB[3] + RA[2]*RB[6],  RA[0]*RB[1] + RA[1]*RB[4] + RA[2]*RB[7],  RA[0]*RB[2] + RA[1]*RB[5] + RA[2]*RB[8],
    RA[3]*RB[0] + RA[4]*RB[3] + RA[5]*RB[6],  RA[3]*RB[1] + RA[4]*RB[4] + RA[5]*RB[7],  RA[3]*RB[2] + RA[4]*RB[5] + RA[5]*RB[8],
    RA[6]*RB[0] + RA[7]*RB[3] + RA[8]*RB[6],  RA[6]*RB[1] + RA[7]*RB[4] + RA[8]*RB[7],  RA[6]*RB[2] + RA[7]*RB[5] + RA[8]*RB[8]
  ];
  // t = RA * tB + tA
  const t = [
    RA[0]*tB[0] + RA[1]*tB[1] + RA[2]*tB[2] + tA[0],
    RA[3]*tB[0] + RA[4]*tB[1] + RA[5]*tB[2] + tA[1],
    RA[6]*tB[0] + RA[7]*tB[1] + RA[8]*tB[2] + tA[2]
  ];
  return { R, t };
}

/**
 * Transform a 3D point: P' = R * P + t
 */
export function transformPoint(R, t, P) {
  return [
    R[0]*P[0] + R[1]*P[1] + R[2]*P[2] + t[0],
    R[3]*P[0] + R[4]*P[1] + R[5]*P[2] + t[1],
    R[6]*P[0] + R[7]*P[1] + R[8]*P[2] + t[2]
  ];
}

/**
 * Triangulate a 3D point in Camera 1's reference frame given:
 * - Ray 1: from (0,0,0) in Cam 1 along direction d1
 * - Ray 2: from origin O2 in Cam 1 along direction d2 (where O2 = -R12^T * t12 and d2 = R12^T * d2_cam2)
 * Uses midpoint of closest approach between two 3D skew lines.
 */
export function triangulateRayMidpoint(p1, d1, p2, d2) {
  // Normalize directions
  const len1 = Math.hypot(d1[0], d1[1], d1[2]);
  const len2 = Math.hypot(d2[0], d2[1], d2[2]);
  if (len1 < 1e-6 || len2 < 1e-6) return null;

  const u1 = [d1[0] / len1, d1[1] / len1, d1[2] / len1];
  const u2 = [d2[0] / len2, d2[1] / len2, d2[2] / len2];

  const w0 = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]];
  const a = u1[0]*u1[0] + u1[1]*u1[1] + u1[2]*u1[2]; // = 1
  const b = u1[0]*u2[0] + u1[1]*u2[1] + u1[2]*u2[2];
  const c = u2[0]*u2[0] + u2[1]*u2[1] + u2[2]*u2[2]; // = 1
  const d = u1[0]*w0[0] + u1[1]*w0[1] + u1[2]*w0[2];
  const e = u2[0]*w0[0] + u2[1]*w0[1] + u2[2]*w0[2];

  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-5) {
    // Parallel or nearly parallel rays
    return null;
  }

  const s = (b * e - c * d) / denom;
  const t = (a * e - b * d) / denom;

  // Closest points on ray 1 and ray 2
  const pt1 = [p1[0] + s * u1[0], p1[1] + s * u1[1], p1[2] + s * u1[2]];
  const pt2 = [p2[0] + t * u2[0], p2[1] + t * u2[1], p2[2] + t * u2[2]];

  // Ray miss distance (quality metric)
  const missDist = Math.hypot(pt1[0] - pt2[0], pt1[1] - pt2[1], pt1[2] - pt2[2]);

  // Midpoint
  return {
    point: [
      (pt1[0] + pt2[0]) / 2,
      (pt1[1] + pt2[1]) / 2,
      (pt1[2] + pt2[2]) / 2
    ],
    depth: (pt1[2] + pt2[2]) / 2,
    missDist,
    s,
    t
  };
}

/**
 * StereoEngine manages calibration and stereo 3D tracking
 */
export class StereoEngine {
  constructor() {
    this.calibrated = false;
    this.R12 = [1, 0, 0,  0, 1, 0,  0, 0, 1]; // Rotation from Cam1 to Cam2
    this.t12 = [0, 0, 0];                     // Translation from Cam1 to Cam2 (in cm)
    this.baselineCm = 0;                      // Calibrated physical distance between the two webcams
    this.rawBaselineCm = 0;                   // Unscaled optical baseline
    this.userBaselineCm = 34.0;               // Ground truth physical baseline (default 34cm)
    this.scaleFactor = 1.0;                   // Metric scale correction factor
    this.convergenceDeg = 0;                  // Angle between optical axes
    this.confidence = 0;                      // 0 to 1
    this.lastCalibrationTime = 0;
    this.samplesCount = 0;

    // Physical elevation of strings above Marker 5 body wood (in cm).
    // Physical strings are elevated ~1.2cm by the bridge. User can zero live with 1 click.
    this.strumPlaneOffsetCm = 1.2;
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('arguitar_strum_plane_offset');
      if (saved !== null) {
        const val = parseFloat(saved);
        if (!isNaN(val) && val >= -10.0 && val <= 15.0) {
          this.strumPlaneOffsetCm = val;
        }
      }
    }
  }

  setStrumPlaneOffset(cm) {
    if (typeof cm === 'number' && !isNaN(cm)) {
      this.strumPlaneOffsetCm = cm;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('arguitar_strum_plane_offset', cm.toFixed(2));
      }
    }
  }

  zeroStrumPlane(liveClearanceCm) {
    if (typeof liveClearanceCm === 'number' && !isNaN(liveClearanceCm)) {
      // liveClearanceCm is currently (rawClearance - this.strumPlaneOffsetCm).
      // Adding liveClearanceCm shifts the reference plane so current hand position becomes 0.0cm:
      this.strumPlaneOffsetCm += liveClearanceCm;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('arguitar_strum_plane_offset', this.strumPlaneOffsetCm.toFixed(2));
      }
    }
    return this.strumPlaneOffsetCm;
  }

  resetStrumPlaneOffset() {
    this.strumPlaneOffsetCm = 1.2;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('arguitar_strum_plane_offset', '1.2');
    }
    return this.strumPlaneOffsetCm;
  }

  setUserBaseline(cm) {
    if (cm > 0 && cm < 200) {
      this.userBaselineCm = cm;
      if (this.rawBaselineCm > 0) {
        this.scaleFactor = cm / this.rawBaselineCm;
        this.baselineCm = cm;
      }
    }
  }

  /**
   * Reset calibration
   */
  reset() {
    this.calibrated = false;
    this.R12 = [1, 0, 0,  0, 1, 0,  0, 0, 1];
    this.t12 = [0, 0, 0];
    this.baselineCm = 0;
    this.rawBaselineCm = 0;
    this.convergenceDeg = 0;
    this.confidence = 0;
    this.samplesCount = 0;
  }

  /**
   * Automatically update relative camera extrinsics using co-observed ArUco markers
   * @param {Object} posesCam1 Map of marker ID to { rvec, tvec } in Cam 1
   * @param {Object} posesCam2 Map of marker ID to { rvec, tvec } in Cam 2
   * @returns {Boolean} true if updated
   */
  updateCalibrationFromMarkers(posesCam1, posesCam2) {
    if (!posesCam1 || !posesCam2) return false;

    const commonIds = Object.keys(posesCam1).filter(id => posesCam2[id]);
    if (commonIds.length === 0) return false;

    let candidateTransforms = [];

    for (const id of commonIds) {
      const p1 = posesCam1[id];
      const p2 = posesCam2[id];
      if (!p1 || !p2 || !p1.rvec || !p1.tvec || !p2.rvec || !p2.tvec) continue;

      const R1 = rodriguesToMatrix(p1.rvec);
      const t1 = p1.tvec;
      const R2 = rodriguesToMatrix(p2.rvec);
      const t2 = p2.tvec;

      // T_1to2 = T_2 * T_1^-1
      const invT1 = invertTransform(R1, t1);
      const T12 = multiplyTransforms(R2, t2, invT1.R, invT1.t);

      const baseline = Math.hypot(T12.t[0], T12.t[1], T12.t[2]);
      // Sanity check: baseline between 5 cm and 120 cm (desk monitor setup)
      if (baseline >= 5 && baseline <= 120) {
        candidateTransforms.push({ ...T12, baseline, id });
      }
    }

    if (candidateTransforms.length === 0) return false;

    // Use the best candidate or average (prioritize Marker 5 or Marker 1)
    const best = candidateTransforms.find(c => c.id === '5') || candidateTransforms[0];

    // Compute convergence angle: angle between optical axes (Z-axis in Cam 1 vs Cam 2)
    const cosAngle = Math.max(-1, Math.min(1, best.R[8]));
    const angleDeg = Math.acos(cosAngle) * (180 / Math.PI);

    this.rawBaselineCm = best.baseline;
    // Ground truth metric scale correction:
    if (this.userBaselineCm > 0 && this.rawBaselineCm > 0) {
      this.scaleFactor = this.userBaselineCm / this.rawBaselineCm;
    } else {
      this.scaleFactor = 1.0;
    }

    const scaledT = [
      best.t[0] * this.scaleFactor,
      best.t[1] * this.scaleFactor,
      best.t[2] * this.scaleFactor
    ];
    const targetBaseline = this.userBaselineCm > 0 ? this.userBaselineCm : best.baseline;

    // Exponential Moving Average (EMA) smoothing for stability
    const alpha = this.calibrated ? 0.08 : 0.40;

    if (!this.calibrated) {
      this.R12 = [...best.R];
      this.t12 = [...scaledT];
      this.baselineCm = targetBaseline;
      this.convergenceDeg = angleDeg;
      this.calibrated = true;
      this.confidence = 0.5;
    } else {
      for (let i = 0; i < 9; i++) {
        this.R12[i] = this.R12[i] * (1 - alpha) + best.R[i] * alpha;
      }
      for (let i = 0; i < 3; i++) {
        this.t12[i] = this.t12[i] * (1 - alpha) + scaledT[i] * alpha;
      }
      this.baselineCm = this.baselineCm * (1 - alpha) + targetBaseline * alpha;
      this.convergenceDeg = this.convergenceDeg * (1 - alpha) + angleDeg * alpha;
      this.confidence = Math.min(1.0, this.confidence + 0.05);
    }

    this.lastCalibrationTime = performance.now();
    this.samplesCount++;
    return true;
  }

  /**
   * Triangulate 2D pixel observations from both cameras into 3D (Cam 1 space)
   * Automatically undistorts 2D landmark coordinates using camera lens distortion profiles.
   * @param {Object} pt1 { x, y } in Cam 1 pixels
   * @param {Object} pt2 { x, y } in Cam 2 pixels
   * @param {Object} K1 { fx, fy, cx, cy } for Cam 1
   * @param {Object} K2 { fx, fy, cx, cy } for Cam 2
   * @param {Array} [dist1] 5-element distortion coefficients for Cam 1
   * @param {Array} [dist2] 5-element distortion coefficients for Cam 2
   */
  triangulate(pt1, pt2, K1, K2, dist1 = DEFAULT_DIST_COEF, dist2 = DEFAULT_DIST_COEF) {
    if (!this.calibrated) return null;

    // Distorted normalized pinhole coordinates for Cam 1:
    const xd1 = (pt1.x - K1.cx) / K1.fx;
    const yd1 = (pt1.y - K1.cy) / K1.fy;
    const u1 = undistortNormalizedPoint(xd1, yd1, dist1);

    // Undistorted Ray 1 direction in Cam 1 frame
    const ray1_dir = [u1.x, u1.y, 1.0];
    const ray1_origin = [0, 0, 0];

    // Ray 2 in Cam 2 frame:
    const xd2 = (pt2.x - K2.cx) / K2.fx;
    const yd2 = (pt2.y - K2.cy) / K2.fy;
    const u2 = undistortNormalizedPoint(xd2, yd2, dist2);

    // Transform Ray 2 into Cam 1 frame:
    // P_cam2 = R12 * P_cam1 + t12  =>  P_cam1 = R12^T * (P_cam2 - t12)
    // Origin of Cam 2 in Cam 1 frame: O2 = -R12^T * t12
    const inv12 = invertTransform(this.R12, this.t12);
    const ray2_origin = inv12.t;

    const dir2_cam2 = [u2.x, u2.y, 1.0];
    // Direction vector in Cam 1 frame: dir2_cam1 = R12^T * dir2_cam2
    const ray2_dir = [
      inv12.R[0]*dir2_cam2[0] + inv12.R[1]*dir2_cam2[1] + inv12.R[2]*dir2_cam2[2],
      inv12.R[3]*dir2_cam2[0] + inv12.R[4]*dir2_cam2[1] + inv12.R[5]*dir2_cam2[2],
      inv12.R[6]*dir2_cam2[0] + inv12.R[7]*dir2_cam2[1] + inv12.R[8]*dir2_cam2[2]
    ];

    return triangulateRayMidpoint(ray1_origin, ray1_dir, ray2_origin, ray2_dir);
  }

  /**
   * Calculate true metric distance (in cm) from a triangulated 3D hand point
   * to the guitar string plane defined by Marker 5 pose and string bridge elevation.
   * @param {Array} hand3D [x, y, z] in Cam 1 (in calibrated cm)
   * @param {Object} m5Pose { rvec, tvec } or tvec in Cam 1
   * @returns {Number|null} Signed perpendicular distance in cm (positive = hovering above strings, 0 = touching strings, negative = behind)
   */
  calculateDistanceToGuitarPlane(hand3D, m5Pose) {
    if (!hand3D) return null;
    let planePoint = [0, 0, 70 * this.scaleFactor];
    let normal = [0, 0, -1]; // Facing towards camera along optical axis

    if (m5Pose) {
      if (m5Pose.tvec) {
        planePoint = [
          m5Pose.tvec[0] * this.scaleFactor,
          m5Pose.tvec[1] * this.scaleFactor,
          m5Pose.tvec[2] * this.scaleFactor
        ];
        if (m5Pose.rvec) {
          const R = rodriguesToMatrix(m5Pose.rvec);
          let n = [R[2], R[5], R[8]];
          // Ensure normal points towards camera (negative Z direction)
          if (n[2] > 0) {
            n = [-n[0], -n[1], -n[2]];
          }
          normal = n;
        }
      } else if (Array.isArray(m5Pose)) {
        planePoint = [
          m5Pose[0] * this.scaleFactor,
          m5Pose[1] * this.scaleFactor,
          m5Pose[2] * this.scaleFactor
        ];
      }
    }

    // Vector from plane point to hand in calibrated centimeters:
    const vh = [
      hand3D[0] - planePoint[0],
      hand3D[1] - planePoint[1],
      hand3D[2] - planePoint[2]
    ];

    // Dot product with normal gives signed perpendicular clearance:
    // Positive = in front of guitar (air hover)
    // Negative = behind guitar strings
    const dotClearance = vh[0] * normal[0] + vh[1] * normal[1] + vh[2] * normal[2];

    // Direct optical depth delta (planePoint.z - hand.z):
    // In camera space, hand closer to camera means hand3D[2] < planePoint[2], so deltaZ > 0 (in front)
    const deltaZ = planePoint[2] - hand3D[2];

    // Anchor to deltaZ if marker orientation has solvePnP tilt noise:
    let clearanceCm = dotClearance;
    if (Math.abs(dotClearance - deltaZ) > 7.0) {
      clearanceCm = deltaZ;
    }

    // Subtract string elevation offset so 0.0cm represents direct string contact
    return clearanceCm - this.strumPlaneOffsetCm;
  }

  /**
   * Interpolate 3D position and surface normal of the fretboard at physical position uCm from nut
   * @param {number} uCm - Physical distance from nut along the neck (cm)
   * @param {object} markerPoses - Map of marker poses { [id]: { rvec, tvec } }
   * @returns {object|null} { point: [x, y, z], normal: [nx, ny, nz] } in Cam 1 space (scaled cm)
   */
  calculateFretboard3DPoint(uCm, markerPoses) {
    if (!markerPoses) return null;
    const detected = [];
    for (const [id, pos] of Object.entries(ARUCO_MARKER_MAP)) {
      const p = markerPoses[id];
      if (p) {
        const tvec = p.tvec || (Array.isArray(p) ? p : null);
        if (tvec) {
          detected.push({
            id,
            cm: pos,
            tvec: [tvec[0] * this.scaleFactor, tvec[1] * this.scaleFactor, tvec[2] * this.scaleFactor],
            rvec: p.rvec || null
          });
        }
      }
    }
    detected.sort((a, b) => a.cm - b.cm);
    if (detected.length === 0) return null;

    let pt = null;
    let rvec = detected[0].rvec;
    if (detected.length === 1) {
      pt = detected[0].tvec;
    } else {
      let segIdx = 0;
      for (let i = 0; i < detected.length - 1; i++) {
        if (uCm >= detected[i].cm && uCm <= detected[i+1].cm) {
          segIdx = i;
          break;
        }
        if (uCm > detected[i+1].cm) segIdx = i;
      }
      const mA = detected[segIdx];
      const mB = detected[segIdx + 1];
      const span = mB.cm - mA.cm;
      const frac = span > 0.01 ? (uCm - mA.cm) / span : 0;
      pt = [
        mA.tvec[0] + frac * (mB.tvec[0] - mA.tvec[0]),
        mA.tvec[1] + frac * (mB.tvec[1] - mA.tvec[1]),
        mA.tvec[2] + frac * (mB.tvec[2] - mA.tvec[2])
      ];
      rvec = frac < 0.5 ? (mA.rvec || mB.rvec) : (mB.rvec || mA.rvec);
    }

    let normal = [0, 0, -1];
    if (rvec) {
      const R = rodriguesToMatrix(rvec);
      let n = [R[2], R[5], R[8]];
      if (n[2] > 0) n = [-n[0], -n[1], -n[2]];
      normal = n;
    }
    return { point: pt, normal };
  }

  /**
   * Calculate perpendicular distance in cm from a 3D fingertip to the fretboard surface at uCm
   * @param {Array} finger3D - [x, y, z] in Cam 1 space (scaled cm)
   * @param {number} uCm - Physical distance along the neck from nut (cm)
   * @param {object} markerPoses - Map of marker poses
   * @returns {number|null} Signed clearance in cm (positive = hovering above fretboard, <= 1.8cm = pressed against strings)
   */
  calculateFingertipClearance(finger3D, uCm, markerPoses) {
    if (!finger3D) return null;
    const fretboard = this.calculateFretboard3DPoint(uCm, markerPoses);
    if (!fretboard || !fretboard.point) return null;

    const vh = [
      finger3D[0] - fretboard.point[0],
      finger3D[1] - fretboard.point[1],
      finger3D[2] - fretboard.point[2]
    ];
    const dotClearance = vh[0] * fretboard.normal[0] + vh[1] * fretboard.normal[1] + vh[2] * fretboard.normal[2];
    const deltaZ = fretboard.point[2] - finger3D[2];

    let clearanceCm = dotClearance;
    if (Math.abs(dotClearance - deltaZ) > 6.0) {
      clearanceCm = deltaZ;
    }
    return clearanceCm;
  }
}

export const stereoTracker = new StereoEngine();
