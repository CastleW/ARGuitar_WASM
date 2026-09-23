/**
 * Guitar Chord Detection Engine
 * Standard Guitar String Numbering (Standard International Musical Convention):
 *  - String 1: High E (thinnest string, E4, closest to floor)
 *  - String 2: B (B3)
 *  - String 3: G (G3)
 *  - String 4: D (D3)
 *  - String 5: A (A2)
 *  - String 6: Low E (thickest string, E2, closest to player's face)
 *
 * Supports:
 *  - Standard Open Chords (C, A, G, E, D, F, Am, Em, Dm, Bm, F#m, C#m)
 *  - Movable Barre Chords (E-shape Major/Minor & A-shape Major/Minor across all frets)
 *  - Harmonic Pitch-Class Triad Analysis
 *  - Temporal smoothing & hysteresis to prevent frame jitter
 */

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Open string base pitch classes for standard tuning:
// String 1 (High E): 4 (E)
// String 2 (B):     11 (B)
// String 3 (G):      7 (G)
// String 4 (D):      2 (D)
// String 5 (A):      9 (A)
// String 6 (Low E):  4 (E)
export const OPEN_STRING_PITCH_CLASSES = [4, 11, 7, 2, 9, 4];

/**
 * Standard Open Chord Templates (Standard Guitar String Numbering: 1 = High E, 6 = Low E)
 */
export const OPEN_CHORDS = [
  {
    name: 'C Major',
    short: 'C',
    quality: 'major',
    root: 'C',
    notes: ['C', 'E', 'G'],
    // x-3-2-0-1-0: S5@3, S4@2, S2@1
    requiredFrets: { 2: 1, 4: 2, 5: 3 },
    alternateFrets: [
      { 1: 3, 2: 1, 4: 2, 5: 3 },       // C with high G (S1@3)
      { 2: 1, 4: 2, 5: 3, 6: 3 },       // C/G (S6@3)
      { 2: 1, 4: 2, 5: 3, 6: 0 }        // C with low E open
    ],
    openStrings: [1, 3],
    mutedStrings: [6]
  },
  {
    name: 'A Major',
    short: 'A',
    quality: 'major',
    root: 'A',
    notes: ['A', 'C#', 'E'],
    // x-0-2-2-2-0: S4@2, S3@2, S2@2
    requiredFrets: { 2: 2, 3: 2, 4: 2 },
    alternateFrets: [
      { 1: 0, 2: 2, 3: 2, 4: 2 }
    ],
    openStrings: [1, 5],
    mutedStrings: [6]
  },
  {
    name: 'G Major',
    short: 'G',
    quality: 'major',
    root: 'G',
    notes: ['G', 'B', 'D'],
    // 3-2-0-0-0-3: S6@3, S5@2, S1@3
    requiredFrets: { 1: 3, 5: 2, 6: 3 },
    alternateFrets: [
      { 1: 3, 2: 3, 5: 2, 6: 3 },       // 4-finger rock G: S6@3, S5@2, S2@3, S1@3
      { 1: 3, 6: 3 }                    // Simple 2-finger G
    ],
    openStrings: [2, 3, 4],
    mutedStrings: []
  },
  {
    name: 'E Major',
    short: 'E',
    quality: 'major',
    root: 'E',
    notes: ['E', 'G#', 'B'],
    // 0-2-2-1-0-0: S5@2, S4@2, S3@1
    requiredFrets: { 3: 1, 4: 2, 5: 2 },
    openStrings: [1, 2, 6],
    mutedStrings: []
  },
  {
    name: 'D Major',
    short: 'D',
    quality: 'major',
    root: 'D',
    notes: ['D', 'F#', 'A'],
    // x-x-0-2-3-2: S3@2, S2@3, S1@2
    requiredFrets: { 1: 2, 2: 3, 3: 2 },
    openStrings: [4],
    mutedStrings: [5, 6]
  },
  {
    name: 'F Major',
    short: 'F',
    quality: 'major',
    root: 'F',
    notes: ['F', 'A', 'C'],
    // x-x-3-2-1-1: S1@1, S2@1, S3@2, S4@3
    requiredFrets: { 1: 1, 2: 1, 3: 2, 4: 3 },
    alternateFrets: [
      { 1: 1, 2: 1, 3: 2, 4: 3, 5: 3, 6: 1 }, // Full barre F
      { 2: 1, 3: 2, 4: 3 }                    // Easy 3-string F
    ],
    openStrings: [],
    mutedStrings: [5, 6]
  },
  {
    name: 'A Minor',
    short: 'Am',
    quality: 'minor',
    root: 'A',
    notes: ['A', 'C', 'E'],
    // x-0-2-2-1-0: S4@2, S3@2, S2@1
    requiredFrets: { 2: 1, 3: 2, 4: 2 },
    openStrings: [1, 5],
    mutedStrings: [6]
  },
  {
    name: 'E Minor',
    short: 'Em',
    quality: 'minor',
    root: 'E',
    notes: ['E', 'G', 'B'],
    // 0-2-2-0-0-0: S5@2, S4@2
    requiredFrets: { 4: 2, 5: 2 },
    openStrings: [1, 2, 3, 6],
    mutedStrings: []
  },
  {
    name: 'D Minor',
    short: 'Dm',
    quality: 'minor',
    root: 'D',
    notes: ['D', 'F', 'A'],
    // x-x-0-2-3-1: S3@2, S2@3, S1@1
    requiredFrets: { 1: 1, 2: 3, 3: 2 },
    openStrings: [4],
    mutedStrings: [5, 6]
  },
  {
    name: 'B Minor',
    short: 'Bm',
    quality: 'minor',
    root: 'B',
    notes: ['B', 'D', 'F#'],
    // x-2-4-4-3-2: S5@2, S4@4, S3@4, S2@3, S1@2
    requiredFrets: { 1: 2, 2: 3, 3: 4, 4: 4, 5: 2 },
    alternateFrets: [
      { 2: 3, 3: 4, 4: 4, 5: 2 },
      { 1: 2, 2: 3, 3: 4, 4: 4 }
    ],
    openStrings: [],
    mutedStrings: [6]
  },
  {
    name: 'F# Minor',
    short: 'F#m',
    quality: 'minor',
    root: 'F#',
    notes: ['F#', 'A', 'C#'],
    // 2-4-4-2-2-2: S6@2, S5@4, S4@4
    requiredFrets: { 4: 4, 5: 4, 6: 2 },
    alternateFrets: [
      { 1: 2, 2: 2, 3: 2, 4: 4, 5: 4, 6: 2 },
      { 3: 2, 4: 4, 5: 4 }
    ],
    openStrings: [],
    mutedStrings: []
  },
  {
    name: 'C# Minor',
    short: 'C#m',
    quality: 'minor',
    root: 'C#',
    notes: ['C#', 'E', 'G#'],
    // x-4-6-6-5-4: S5@4, S4@6, S3@6, S2@5, S1@4
    requiredFrets: { 2: 5, 3: 6, 4: 6, 5: 4 },
    alternateFrets: [
      { 1: 4, 2: 5, 3: 6, 4: 6, 5: 4 }
    ],
    openStrings: [],
    mutedStrings: [6]
  }
];

/**
 * Match active fretting configuration against standard open chords
 */
function matchOpenChord(fretted) {
  let best = null;
  let highestScore = 0;

  for (const chord of OPEN_CHORDS) {
    const patterns = [chord.requiredFrets, ...(chord.alternateFrets || [])];
    for (const pat of patterns) {
      let matchedCount = 0;
      const totalPat = Object.keys(pat).length;
      let extraCount = 0;

      for (const [strStr, reqFret] of Object.entries(pat)) {
        const s = parseInt(strStr, 10);
        if (fretted[s] === reqFret) {
          matchedCount++;
        }
      }

      for (const [strStr, f] of Object.entries(fretted)) {
        const s = parseInt(strStr, 10);
        if (pat[s] !== f) {
          extraCount++;
        }
      }

      // Exact full match
      if (matchedCount === totalPat && extraCount === 0) {
        return {
          chord,
          score: 1.0,
          shape: chord.short,
          matchedFrets: pat
        };
      }

      // High-confidence partial match (e.g. 1 finger transition or resting extra finger)
      if (matchedCount >= 2 && matchedCount >= totalPat - 1) {
        const score = 0.50 + 0.50 * (matchedCount / totalPat) - (extraCount * 0.15);
        if (score > highestScore) {
          highestScore = score;
          best = {
            chord,
            score: Math.max(0.60, Math.min(0.95, score)),
            shape: chord.short,
            matchedFrets: pat
          };
        }
      }
    }
  }

  return best && highestScore >= 0.65 ? best : null;
}

/**
 * Match active fretting against movable barre chord shapes across all frets
 * (Standard String numbering: 1 = High E, 6 = Low E)
 */
function matchMovableBarre(fretted) {
  const frets = Object.values(fretted);
  if (frets.length < 2) return null;

  const minFret = Math.min(...frets);
  if (minFret < 1 || minFret > 14) return null;

  const rel = {};
  for (const [s, f] of Object.entries(fretted)) {
    rel[parseInt(s, 10)] = f - minFret;
  }

  // 1. E-shape Major at minFret (Root on String 6 Low E)
  // Strings: S5: +2, S4: +2, S3: +1, (S6, S2, S1 barred at 0)
  if (rel[5] === 2 && rel[4] === 2 && (rel[3] === 1 || rel[3] === undefined)) {
    const rootPitch = (OPEN_STRING_PITCH_CLASSES[5] + minFret) % 12; // String 6 (Low E)
    const root = NOTE_NAMES[rootPitch];
    return {
      chord: {
        name: `${root} Major`,
        short: root,
        quality: 'major',
        root,
        notes: [root, NOTE_NAMES[(rootPitch + 4) % 12], NOTE_NAMES[(rootPitch + 7) % 12]]
      },
      score: 0.92,
      shape: `E-shape Maj (Fret ${minFret})`,
      matchedFrets: fretted
    };
  }

  // 2. E-shape Minor at minFret (Root on String 6 Low E)
  // Strings: S5: +2, S4: +2, S3: 0
  if (rel[5] === 2 && rel[4] === 2 && (rel[3] === 0 || rel[3] === undefined)) {
    const rootPitch = (OPEN_STRING_PITCH_CLASSES[5] + minFret) % 12; // String 6 (Low E)
    const root = NOTE_NAMES[rootPitch];
    return {
      chord: {
        name: `${root} Minor`,
        short: `${root}m`,
        quality: 'minor',
        root,
        notes: [root, NOTE_NAMES[(rootPitch + 3) % 12], NOTE_NAMES[(rootPitch + 7) % 12]]
      },
      score: 0.92,
      shape: `E-shape Min (Fret ${minFret})`,
      matchedFrets: fretted
    };
  }

  // 3. A-shape Major at minFret (Root on String 5 A string)
  // Strings: S4: +2, S3: +2, S2: +2 (S5 at 0)
  if (rel[4] === 2 && rel[3] === 2 && rel[2] === 2) {
    const rootPitch = (OPEN_STRING_PITCH_CLASSES[4] + minFret) % 12; // String 5 (A)
    const root = NOTE_NAMES[rootPitch];
    return {
      chord: {
        name: `${root} Major`,
        short: root,
        quality: 'major',
        root,
        notes: [root, NOTE_NAMES[(rootPitch + 4) % 12], NOTE_NAMES[(rootPitch + 7) % 12]]
      },
      score: 0.92,
      shape: `A-shape Maj (Fret ${minFret})`,
      matchedFrets: fretted
    };
  }

  // 4. A-shape Minor at minFret (Root on String 5 A string)
  // Strings: S4: +2, S3: +2, S2: +1 (S5 at 0)
  if (rel[4] === 2 && rel[3] === 2 && rel[2] === 1) {
    const rootPitch = (OPEN_STRING_PITCH_CLASSES[4] + minFret) % 12; // String 5 (A)
    const root = NOTE_NAMES[rootPitch];
    return {
      chord: {
        name: `${root} Minor`,
        short: `${root}m`,
        quality: 'minor',
        root,
        notes: [root, NOTE_NAMES[(rootPitch + 3) % 12], NOTE_NAMES[(rootPitch + 7) % 12]]
      },
      score: 0.92,
      shape: `A-shape Min (Fret ${minFret})`,
      matchedFrets: fretted
    };
  }

  return null;
}

/**
 * General Harmonic Pitch-Class Triad Analyzer
 * Matches sounding notes against all 12 Major and 12 Minor triads
 */
function matchHarmonicTriad(fretted) {
  const activeStrings = Object.keys(fretted).map(s => parseInt(s, 10));
  if (activeStrings.length < 2) return null;

  // Compute sounding pitch classes
  const pitchClasses = new Set();
  activeStrings.forEach(s => {
    const f = fretted[s];
    if (f > 0) {
      const pc = (OPEN_STRING_PITCH_CLASSES[s - 1] + f) % 12;
      pitchClasses.add(pc);
    }
  });

  if (pitchClasses.size < 2) return null;

  let bestChord = null;
  let bestScore = 0;

  for (let root = 0; root < 12; ++root) {
    const rootName = NOTE_NAMES[root];

    // Major Triad: { root, root + 4, root + 7 }
    const majPcs = new Set([root, (root + 4) % 12, (root + 7) % 12]);
    let majMatches = 0;
    let majClashes = 0;
    pitchClasses.forEach(pc => {
      if (majPcs.has(pc)) majMatches++;
      else majClashes++;
    });

    if (majMatches >= 2 && majClashes === 0) {
      const score = majMatches === 3 ? 0.88 : 0.72;
      if (score > bestScore) {
        bestScore = score;
        bestChord = {
          name: `${rootName} Major`,
          short: rootName,
          quality: 'major',
          root: rootName,
          notes: [rootName, NOTE_NAMES[(root + 4) % 12], NOTE_NAMES[(root + 7) % 12]]
        };
      }
    }

    // Minor Triad: { root, root + 3, root + 7 }
    const minPcs = new Set([root, (root + 3) % 12, (root + 7) % 12]);
    let minMatches = 0;
    let minClashes = 0;
    pitchClasses.forEach(pc => {
      if (minPcs.has(pc)) minMatches++;
      else minClashes++;
    });

    if (minMatches >= 2 && minClashes === 0) {
      const score = minMatches === 3 ? 0.88 : 0.72;
      if (score > bestScore) {
        bestScore = score;
        bestChord = {
          name: `${rootName} Minor`,
          short: `${rootName}m`,
          quality: 'minor',
          root: rootName,
          notes: [rootName, NOTE_NAMES[(root + 3) % 12], NOTE_NAMES[(root + 7) % 12]]
        };
      }
    }
  }

  if (bestChord && bestScore >= 0.70) {
    return {
      chord: bestChord,
      score: bestScore,
      shape: 'Harmonic Triad',
      matchedFrets: fretted
    };
  }

  return null;
}

/**
 * Detect guitar chord from tracked fingers
 * @param {Array} trackedFingers - Array of finger objects { num, name, fret, string, isActive }
 * @returns {object|null} Detected chord info or null
 */
export function detectChordFromFingers(trackedFingers) {
  if (!trackedFingers || trackedFingers.length === 0) {
    return null;
  }

  // 1. Collect fretted strings from active fingers
  // If multiple fingers are placed on the same string, select the clearest/lower fret
  const fretted = {};
  trackedFingers.forEach(f => {
    if (f.isActive && f.fret > 0 && f.string >= 1 && f.string <= 6) {
      if (!fretted[f.string] || f.fret < fretted[f.string]) {
        fretted[f.string] = f.fret;
      }
    }
  });

  const numFretted = Object.keys(fretted).length;
  if (numFretted < 2) {
    return null;
  }

  // 2. Try Open Chord Matching First
  const openMatch = matchOpenChord(fretted);
  if (openMatch && openMatch.score >= 0.75) {
    return {
      name: openMatch.chord.name,
      shortName: openMatch.chord.short,
      quality: openMatch.chord.quality,
      root: openMatch.chord.root,
      notes: openMatch.chord.notes,
      confidence: openMatch.score,
      shape: openMatch.shape,
      frettedStrings: fretted
    };
  }

  // 3. Try Movable Barre Matching (E-shape & A-shape across all frets)
  const barreMatch = matchMovableBarre(fretted);
  if (barreMatch && barreMatch.score >= 0.75) {
    return {
      name: barreMatch.chord.name,
      shortName: barreMatch.chord.short,
      quality: barreMatch.chord.quality,
      root: barreMatch.chord.root,
      notes: barreMatch.chord.notes,
      confidence: barreMatch.score,
      shape: barreMatch.shape,
      frettedStrings: fretted
    };
  }

  // 4. Fallback to Open Match if lower threshold (0.65)
  if (openMatch) {
    return {
      name: openMatch.chord.name,
      shortName: openMatch.chord.short,
      quality: openMatch.chord.quality,
      root: openMatch.chord.root,
      notes: openMatch.chord.notes,
      confidence: openMatch.score,
      shape: openMatch.shape,
      frettedStrings: fretted
    };
  }

  // 5. Try General Harmonic Triad Analysis
  const harmonicMatch = matchHarmonicTriad(fretted);
  if (harmonicMatch) {
    return {
      name: harmonicMatch.chord.name,
      shortName: harmonicMatch.chord.short,
      quality: harmonicMatch.chord.quality,
      root: harmonicMatch.chord.root,
      notes: harmonicMatch.chord.notes,
      confidence: harmonicMatch.score,
      shape: harmonicMatch.shape,
      frettedStrings: fretted
    };
  }

  return null;
}

/**
 * Creates a stateful Chord Smoother to prevent single-frame flickering
 */
export function createChordSmoother(historySize = 5, holdTimeMs = 320) {
  let recentChords = [];
  let currentStableChord = null;
  let lastSeenTimestamp = 0;

  return {
    update(chord, timestamp) {
      if (chord) {
        recentChords.push({ chord, time: timestamp });
        if (recentChords.length > historySize) {
          recentChords.shift();
        }

        const counts = {};
        recentChords.forEach(c => {
          const k = c.chord.name;
          counts[k] = (counts[k] || 0) + 1;
        });

        let bestName = null;
        let bestCount = 0;
        for (const [name, cnt] of Object.entries(counts)) {
          if (cnt > bestCount) {
            bestCount = cnt;
            bestName = name;
          }
        }

        if (bestCount >= 2) {
          const matched = recentChords.find(c => c.chord.name === bestName);
          currentStableChord = matched.chord;
          lastSeenTimestamp = timestamp;
        }
      } else {
        if (recentChords.length > 0) {
          recentChords.shift();
        }
        if (currentStableChord && (timestamp - lastSeenTimestamp > holdTimeMs)) {
          currentStableChord = null;
        }
      }

      return currentStableChord;
    },

    reset() {
      recentChords = [];
      currentStableChord = null;
      lastSeenTimestamp = 0;
    }
  };
}
