/**
 * Random Forest Strumming Detector
 * Port of strumming detection code from `track_player.py`
 */

import strumDetectorRF from '../assets/strum_detector_rf.json';
import strumDetector from '../assets/strum_detector.json';

/**
 * Evaluate a single decision tree recursively
 */
function evaluateTree(node, features) {
  if (node.f === -1) {
    return node.v; // Returns leaf class distribution [count_0, count_1]
  }
  const val = features[node.f];
  if (val <= node.t) {
    return evaluateTree(node.l, features);
  } else {
    return evaluateTree(node.r, features);
  }
}

/**
 * Predict class probabilities for the forest
 */
export function predictProbs(forest, features) {
  let sum0 = 0;
  let sum1 = 0;
  for (let i = 0; i < forest.length; i++) {
    const val = evaluateTree(forest[i], features);
    const sum = val[0] + val[1];
    if (sum > 0) {
      sum0 += val[0] / sum;
      sum1 += val[1] / sum;
    }
  }
  return [sum0 / forest.length, sum1 / forest.length];
}

/**
 * Predict binary class (0 or 1) using majority voting / average probability
 */
export function predict(forest, features) {
  const probs = predictProbs(forest, features);
  return probs[1] >= 0.5 ? 1 : 0;
}

/**
 * Compute the feature vector from two consecutive queue rows
 * Row format: [time_delta_sec, pinky_fret, pinky_string, ring_fret, ring_string,
 *              middle_fret, middle_string, index_fret, index_string, thumb_fret, thumb_string]
 */
export function computeFeatures(prevRow, currRow) {
  const timeDelta = currRow[0]; // Time delta in seconds
  if (timeDelta <= 0) return null;

  // Indices for string columns in the row array
  const pinkyStrCol = 2;
  const middleStrCol = 6;
  const indexStrCol = 8;
  const thumbStrCol = 10;

  // Calculate deltas
  const thumbDelta = currRow[thumbStrCol] - prevRow[thumbStrCol];
  const indexDelta = currRow[indexStrCol] - prevRow[indexStrCol];
  const middleDelta = currRow[middleStrCol] - prevRow[middleStrCol];
  const pinkyDelta = currRow[pinkyStrCol] - prevRow[pinkyStrCol];

  // Calculate velocities
  const thumbVelocity = thumbDelta / timeDelta;
  const indexVelocity = indexDelta / timeDelta;
  const middleVelocity = middleDelta / timeDelta;
  const pinkyVelocity = pinkyDelta / timeDelta;

  // Calculate accelerations
  const thumbAcceleration = thumbVelocity / timeDelta;
  const indexAcceleration = indexVelocity / timeDelta;
  const middleAcceleration = middleVelocity / timeDelta;
  const pinkyAcceleration = pinkyVelocity / timeDelta;

  // Return feature array in the exact order expected by the model:
  // ['time_delta_ms', 'thumb_delta', 'thumb_velocity', 'thumb_acceleration',
  //  'index_delta', 'index_velocity', 'index_acceleration', 'middle_delta',
  //  'middle_velocity', 'middle_acceleration', 'pinky_delta', 'pinky_velocity', 'pinky_acceleration']
  return [
    timeDelta,
    thumbDelta,
    thumbVelocity,
    thumbAcceleration,
    indexDelta,
    indexVelocity,
    indexAcceleration,
    middleDelta,
    middleVelocity,
    middleAcceleration,
    pinkyDelta,
    pinkyVelocity,
    pinkyAcceleration
  ];
}

/**
 * Detect a strum from a queue of history states.
 * @param {Array} queue - Array of rows, each row of size 11
 * @param {string} modelType - 'rf' (1000 estimators) or 'std' (100 estimators)
 * @param {boolean} checkAll - If true, checks all transitions. If false, mimics Python which only checks prediction[0].
 * @returns {boolean} True if strum detected
 */
export function detectStrum(queue, modelType = 'rf', checkAll = true) {
  if (queue.length < 2) return false;
  
  const forest = modelType === 'rf' ? strumDetectorRF : strumDetector;
  
  // Calculate predictions for each transition
  const predictions = [];
  for (let i = 1; i < queue.length; i++) {
    const prev = queue[i - 1];
    const curr = queue[i];
    
    // Clean Nones: if any string value is null, replace with 0
    const cleanPrev = prev.map(x => x === null || x === undefined ? 0 : x);
    const cleanCurr = curr.map(x => x === null || x === undefined ? 0 : x);
    
    const features = computeFeatures(cleanPrev, cleanCurr);
    if (features) {
      predictions.push(predict(forest, features));
    }
  }
  
  if (predictions.length === 0) return false;
  
  if (checkAll) {
    // Return true if the LATEST transition is predicted as a strum
    return predictions[predictions.length - 1] === 1;
  } else {
    // Mimic the Python code behavior which only checks the first (oldest) transition in the prediction array
    return predictions[0] === 1;
  }
}
