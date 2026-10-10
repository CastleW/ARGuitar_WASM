import arucoDictionary from '../assets/aruco_dictionary.json';

let lastLogTime = 0;

// Detector tuning constants (exported so session recordings can capture the exact config used)
export const DETECTOR_CONFIG = {
  windowSizes: [11, 25, 41],
  adaptiveC: 7,
  approxEpsilon: 0.03,
  minArea: 120,
  maxAreaFraction: 0.35,
  warpSize: 70,
  validIds: [0, 1, 2, 3, 4, 5],
  maxCandidateDetails: 80,
  maxHammingDistance: 1 // 1-bit error tolerance (guaranteed unique for IDs 0-5)
};

const NO_SCORE = 99;

function popcount8(v) {
  v = v - ((v >> 1) & 0x55);
  v = (v & 0x33) + ((v >> 2) & 0x33);
  return (v + (v >> 4)) & 0x0f;
}

/**
 * Find the closest valid guitar marker (IDs 0-5, all rotations) by Hamming distance.
 * Used for diagnostics only: tells us how many bits away a rejected candidate was.
 */
function bestHamming(bytes) {
  let best = NO_SCORE;
  let bestId = -1;
  for (let id = 0; id <= 5; ++id) {
    for (let rot = 0; rot < 4; ++rot) {
      const d = arucoDictionary[id][rot];
      const h = popcount8(bytes[0] ^ d[0]) + popcount8(bytes[1] ^ d[1]) +
                popcount8(bytes[2] ^ d[2]) + popcount8(bytes[3] ^ d[3]);
      if (h < best) {
        best = h;
        bestId = id;
      }
    }
  }
  return { ham: best, id: bestId };
}

/**
 * Detect ArUco markers in an image using OpenCV.js
 * @param {object} cv - The OpenCV.js instance
 * @param {object} src - The cv.Mat image source (RGBA or RGB)
 * @param {object} [options]
 * @param {boolean} [options.collectDetails=false] - Emit per-candidate diagnostics (used by the session recorder)
 * @returns {object} { markers, candidates, candidateDetails, diagnostics: { borderRejected, dictRejected, quads } }
 */
export function detectMarkers(cv, src, options = {}) {
  const collectDetails = !!options.collectDetails;
  const candidateDetails = collectDetails ? [] : null;
  let borderRejected = 0;
  let dictRejected = 0;
  let quadCount = 0;
  let shouldLog = false;
  const now = Date.now();
  if (now - lastLogTime > 3000) {
    shouldLog = true;
    lastLogTime = now;
  }

  let gray = new cv.Mat();
  if (src.channels() === 4) {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  } else if (src.channels() === 3) {
    cv.cvtColor(src, gray, cv.COLOR_RGB2GRAY);
  } else {
    src.copyTo(gray);
  }
  
  let detectedMarkers = [];
  let detectedIds = new Set();
  let candidates = [];
  
  // Try adaptive threshold window sizes ordered by efficacy.
  // [11, 25, 41] covers fine markers, mid-range distances, and wide angles.
  const windowSizes = [11, 25, 41];
  
  for (let w = 0; w < windowSizes.length; w++) {
    const blockSize = windowSizes[w];
    let thresh = new cv.Mat();
    let contours = null;
    let hierarchy = null;
    
    try {
      cv.adaptiveThreshold(gray, thresh, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, blockSize, 7);
      
      contours = new cv.MatVector();
      hierarchy = new cv.Mat();
      cv.findContours(thresh, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      
      const maxMarkerArea = src.rows * src.cols * 0.35;
      
      for (let i = 0; i < contours.size(); ++i) {
        let cnt = contours.get(i);
        let approx = new cv.Mat();
        
        try {
          let perimeter = cv.arcLength(cnt, true);
          cv.approxPolyDP(cnt, approx, 0.03 * perimeter, true);
          
          // Check if it is a convex 4-corner polygon (quadrilateral)
          if (approx.rows === 4 && cv.isContourConvex(approx)) {
            let area = cv.contourArea(approx);
            if (area > 120 && area < maxMarkerArea) { // Filter out sub-pixel noise and screen-sized borders
              // Extract 4 corners
              let c0 = { x: approx.data32S[0], y: approx.data32S[1] };
              let c1 = { x: approx.data32S[2], y: approx.data32S[3] };
              let c2 = { x: approx.data32S[4], y: approx.data32S[5] };
              let c3 = { x: approx.data32S[6], y: approx.data32S[7] };
              
              let sorted = sortCorners([c0, c1, c2, c3]);
              candidates.push(sorted);
              quadCount++;

              let detail = null;
              if (collectDetails && candidateDetails.length < DETECTOR_CONFIG.maxCandidateDetails) {
                detail = {
                  c: sorted.map(p => [p.x, p.y]),
                  area: Math.round(area),
                  side: Math.round(Math.sqrt(area) * 10) / 10,
                  win: blockSize,
                  res: 'pending',
                  bw: NO_SCORE,
                  ham: NO_SCORE,
                  hamId: -1,
                  hamAll: NO_SCORE,
                  hamAllId: -1
                };
                candidateDetails.push(detail);
              }

              // Skip redundant bit-extraction if center is within 14px of an already-decoded marker
              const candCx = (sorted[0].x + sorted[2].x) / 2;
              const candCy = (sorted[0].y + sorted[2].y) / 2;
              const alreadyDecoded = detectedMarkers.some(m => {
                const distSq = (m.center.x - candCx) ** 2 + (m.center.y - candCy) ** 2;
                return distSq < 196; // 14px radius
              });
              if (alreadyDecoded) {
                if (detail) detail.res = 'dup';
                continue;
              }
              
              let warped = null;
              let srcTri = null;
              let dstTri = null;
              let M = null;
              let warpedThresh = null;
              
              try {
                warped = new cv.Mat();
                let dsize = new cv.Size(70, 70);
                srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
                  sorted[0].x, sorted[0].y,
                  sorted[1].x, sorted[1].y,
                  sorted[2].x, sorted[2].y,
                  sorted[3].x, sorted[3].y
                ]);
                dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
                  0, 0,
                  70, 0,
                  70, 70,
                  0, 70
                ]);
                M = cv.getPerspectiveTransform(srcTri, dstTri);
                cv.warpPerspective(gray, warped, M, dsize, cv.INTER_NEAREST);
                
                let matchedId = -1;
                let matchedRot = -1;
                let actualCorners = null;
                let cx = 0, cy = 0;
                let selectedMethod = '';
                let anyBorderOk = false;
                
                // Try multiple thresholding strategies to handle glare/uneven lighting
                const strategies = [
                  { name: 'otsu', type: 'global' },
                  { name: 'adaptive21', type: 'adaptive', blockSize: 21, C: 4 },
                  { name: 'adaptive31', type: 'adaptive', blockSize: 31, C: 4 }
                ];
                
                for (let sIdx = 0; sIdx < strategies.length; ++sIdx) {
                  const strategy = strategies[sIdx];
                  warpedThresh = new cv.Mat();
                  
                  try {
                    if (strategy.type === 'global') {
                      cv.threshold(warped, warpedThresh, 125, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
                    } else {
                      cv.adaptiveThreshold(warped, warpedThresh, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY, strategy.blockSize, strategy.C);
                    }
                    
                    // Extract 7x7 grid
                    let grid = [];
                    for (let r = 0; r < 7; ++r) {
                      grid[r] = [];
                      for (let c = 0; c < 7; ++c) {
                        let whiteCount = 0;
                        for (let y = r * 10 + 3; y < r * 10 + 7; ++y) {
                          for (let x = c * 10 + 3; x < c * 10 + 7; ++x) {
                            if (warpedThresh.ucharAt(y, x) === 255) {
                              whiteCount++;
                            }
                          }
                        }
                        grid[r][c] = whiteCount > 8 ? 1 : 0;
                      }
                    }
                    
                    // Verify outer border is mostly black (allow up to 2 white cells for Otsu, up to 4 for adaptive due to glare)
                    let borderWhiteCount = 0;
                    for (let j = 0; j < 7; ++j) {
                      if (grid[0][j] === 1) borderWhiteCount++;
                      if (grid[6][j] === 1) borderWhiteCount++;
                    }
                    for (let r = 1; r < 6; ++r) {
                      if (grid[r][0] === 1) borderWhiteCount++;
                      if (grid[r][6] === 1) borderWhiteCount++;
                    }
                    
                    const maxBorderWhite = strategy.type === 'global' ? 2 : 4;
                    const borderOk = borderWhiteCount <= maxBorderWhite;

                    // Extract inner 5x5 bits
                    let bits = [];
                    for (let r = 1; r <= 5; ++r) {
                      for (let c = 1; c <= 5; ++c) {
                        bits.push(grid[r][c]);
                      }
                    }

                    // Convert to bytes
                    let bytes = [0, 0, 0, 0];
                    for (let k = 0; k < 25; ++k) {
                      let byteIdx = Math.floor(k / 8);
                      let bitIdx = 7 - (k % 8);
                      if (bits[k] === 1) {
                        bytes[byteIdx] |= (1 << bitIdx);
                      }
                    }
                    // Right-shift the last byte by 7 to align with OpenCV's dictionary packing behavior
                    bytes[3] >>= 7;

                    if (detail) {
                      const score = bestHamming(bytes);
                      if (borderWhiteCount < detail.bw) detail.bw = borderWhiteCount;
                      if (score.ham < detail.hamAll) {
                        detail.hamAll = score.ham;
                        detail.hamAllId = score.id;
                      }
                      if (borderOk && score.ham < detail.ham) {
                        detail.ham = score.ham;
                        detail.hamId = score.id;
                      }
                    }

                    // Allow slight glare on border if bits match exactly (bestHam === 0)
                    const borderOkGlary = borderWhiteCount <= maxBorderWhite + 2;

                    // Match bytes in dictionary (Restricted to IDs 0-5 for guitar tracking)
                    // Uses minimum Hamming distance for robust decoding with 1-bit error correction
                    let bestHam = 99;
                    let secondHam = 99;
                    let bestId = -1;
                    let bestRot = -1;

                    for (let id = 0; id <= 5; ++id) {
                      for (let rot = 0; rot < 4; ++rot) {
                        let dictBytes = arucoDictionary[id][rot];
                        let h = popcount8(bytes[0] ^ dictBytes[0]) +
                                popcount8(bytes[1] ^ dictBytes[1]) +
                                popcount8(bytes[2] ^ dictBytes[2]) +
                                popcount8(bytes[3] ^ dictBytes[3]);
                        if (h < bestHam) {
                          secondHam = bestHam;
                          bestHam = h;
                          bestId = id;
                          bestRot = rot;
                        } else if (h < secondHam) {
                          secondHam = h;
                        }
                      }
                    }

                    if (borderOk) {
                      anyBorderOk = true;
                    }

                    // Decode condition:
                    // 1) Clean border + exact match (0 error)
                    // 2) Clean border + 1-bit error correction (min distance between distinct IDs is 3, so 1 bit is 100% unambiguous)
                    // 3) Slightly glary border + exact match (0 error)
                    const maxHam = options.maxHammingDistance !== undefined ? options.maxHammingDistance : DETECTOR_CONFIG.maxHammingDistance;
                    const canDecode = (borderOk && (bestHam === 0 || (bestHam <= maxHam && secondHam >= 3))) ||
                                      (borderOkGlary && bestHam === 0);

                    if (canDecode) {
                      matchedId = bestId;
                      matchedRot = bestRot;
                      actualCorners = [
                        sorted[matchedRot],
                        sorted[(matchedRot + 1) % 4],
                        sorted[(matchedRot + 2) % 4],
                        sorted[(matchedRot + 3) % 4]
                      ];
                      cx = (actualCorners[0].x + actualCorners[2].x) / 2;
                      cy = (actualCorners[0].y + actualCorners[2].y) / 2;
                      selectedMethod = strategy.name;
                      break; // Decoded successfully, stop trying other strategies
                    } else {
                      if (shouldLog && borderOk) {
                        console.log(`[ArUco Debug] Strategy ${strategy.name}: Candidate failed dictionary match. Best ham: ${bestHam} (ID ${bestId}), 2nd: ${secondHam}`);
                      }
                    }
                  } finally {
                    if (warpedThresh) {
                      warpedThresh.delete();
                      warpedThresh = null;
                    }
                  }
                }

                if (matchedId !== -1) {
                  if (detail) {
                    detail.res = 'ok';
                    detail.id = matchedId;
                    detail.strat = selectedMethod;
                  }
                  if (!detectedIds.has(matchedId)) {
                    detectedIds.add(matchedId);
                    detectedMarkers.push({
                      id: matchedId,
                      corners: actualCorners,
                      center: { x: cx, y: cy },
                      strategy: selectedMethod,
                      blockSize
                    });
                    if (shouldLog) {
                      console.log(`[ArUco Debug] Success! Decoded ID ${matchedId} using strategy ${selectedMethod}`);
                    }
                  }
                } else if (anyBorderOk) {
                  // At least one strategy produced a clean border but the bits matched no guitar ID
                  dictRejected++;
                  if (detail) detail.res = 'dict';
                } else {
                  // No strategy produced a clean black border (glare, blur, or not a marker at all)
                  borderRejected++;
                  if (detail) detail.res = 'border';
                }
              } catch (innerErr) {
                console.error("Error in bit extraction:", innerErr);
              } finally {
                if (srcTri) srcTri.delete();
                if (dstTri) dstTri.delete();
                if (M) M.delete();
                if (warped) warped.delete();
                if (warpedThresh) warpedThresh.delete();
              }
            }
          }
        } catch (innerErr2) {
          console.error("Error processing contour geometry:", innerErr2);
        } finally {
          approx.delete();
          cnt.delete(); // Delete local contour reference to prevent WebAssembly memory leak
        }
      }
    } catch (e) {
      console.error("Error in adaptive threshold iteration:", e);
    } finally {
      if (contours) contours.delete();
      if (hierarchy) hierarchy.delete();
      thresh.delete();
    }

    // Early-Exit: If >= 2 markers are already detected, the guitar neck axis is fully defined.
    // Skipping subsequent window sizes saves up to 66% of OpenCV compute per frame!
    if (detectedMarkers.length >= 2) {
      break;
    }
  }
  
  gray.delete();

  if (candidateDetails) {
    // Normalise sentinel scores to null for compact JSON
    for (let i = 0; i < candidateDetails.length; i++) {
      const d = candidateDetails[i];
      if (d.bw === NO_SCORE) d.bw = null;
      if (d.ham === NO_SCORE) { d.ham = null; delete d.hamId; }
      if (d.hamAll === NO_SCORE) { d.hamAll = null; delete d.hamAllId; }
      if (d.res === 'dup') { delete d.bw; delete d.ham; delete d.hamAll; delete d.hamId; delete d.hamAllId; }
    }
  }

  return {
    markers: detectedMarkers,
    candidates,
    candidateDetails,
    diagnostics: { borderRejected, dictRejected, quads: quadCount }
  };
}

/**
 * Sort corners of a quadrilateral clockwise: [top-left, top-right, bottom-right, bottom-left]
 * Uses centroid angles and bounding-box reference to ensure absolute rotation invariance.
 */
function sortCorners(corners) {
  // 1. Calculate centroid
  let cx = 0, cy = 0;
  corners.forEach(p => { cx += p.x; cy += p.y; });
  cx /= 4;
  cy /= 4;
  
  // 2. Calculate angles relative to centroid
  const sorted = corners.map(p => ({
    x: p.x,
    y: p.y,
    angle: Math.atan2(p.y - cy, p.x - cx)
  })).sort((a, b) => a.angle - b.angle);
  
  // 3. Find the corner closest to the actual top-left of the bounding box
  const minX = Math.min(...corners.map(p => p.x));
  const minY = Math.min(...corners.map(p => p.y));
  
  let bestIdx = 0;
  let minDist = Infinity;
  for (let i = 0; i < 4; i++) {
    const dist = (sorted[i].x - minX) ** 2 + (sorted[i].y - minY) ** 2;
    if (dist < minDist) {
      minDist = dist;
      bestIdx = i;
    }
  }
  
  // 4. Rotate array to start with the top-left corner
  const result = [];
  for (let i = 0; i < 4; i++) {
    result.push(sorted[(bestIdx + i) % 4]);
  }
  return result;
}
