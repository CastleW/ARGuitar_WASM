/**
 * Song & Backing Audio Engine for AR Guitar Play-Along
 *
 * Features:
 * - Built-in interactive song progressions with authentic rhythmic strum patterns
 * - Lookahead Web Audio drum & bass synthesizer (Kick, Snare, Hi-Hat, Bassline, Metronome)
 * - Rock-solid sample-accurate clock sync via AudioContext.currentTime
 * - Real-time scoring, hit detection, and combo tracking
 */

import { guitarAudio } from './guitar_audio';

// Recommended fingerings for open and barre chords
// Finger numbers: 1 = Index, 2 = Middle, 3 = Ring, 4 = Pinky
export const CHORD_FINGERINGS = {
  'C': {
    name: 'C Major',
    short: 'C',
    frets: { 2: { fret: 1, finger: 1 }, 4: { fret: 2, finger: 2 }, 5: { fret: 3, finger: 3 } },
    open: [1, 3],
    muted: [6]
  },
  'G': {
    name: 'G Major',
    short: 'G',
    frets: { 5: { fret: 2, finger: 1 }, 6: { fret: 3, finger: 2 }, 1: { fret: 3, finger: 3 } },
    open: [2, 3, 4],
    muted: []
  },
  'D': {
    name: 'D Major',
    short: 'D',
    frets: { 3: { fret: 2, finger: 1 }, 1: { fret: 2, finger: 2 }, 2: { fret: 3, finger: 3 } },
    open: [4],
    muted: [5, 6]
  },
  'Em': {
    name: 'E Minor',
    short: 'Em',
    frets: { 5: { fret: 2, finger: 1 }, 4: { fret: 2, finger: 2 } },
    open: [1, 2, 3, 6],
    muted: []
  },
  'Am': {
    name: 'A Minor',
    short: 'Am',
    frets: { 2: { fret: 1, finger: 1 }, 4: { fret: 2, finger: 2 }, 3: { fret: 2, finger: 3 } },
    open: [1, 5],
    muted: [6]
  },
  'A': {
    name: 'A Major',
    short: 'A',
    frets: { 4: { fret: 2, finger: 1 }, 3: { fret: 2, finger: 2 }, 2: { fret: 2, finger: 3 } },
    open: [1, 5],
    muted: [6]
  },
  'E': {
    name: 'E Major',
    short: 'E',
    frets: { 3: { fret: 1, finger: 1 }, 5: { fret: 2, finger: 2 }, 4: { fret: 2, finger: 3 } },
    open: [1, 2, 6],
    muted: []
  },
  'F': {
    name: 'F Major',
    short: 'F',
    frets: { 1: { fret: 1, finger: 1 }, 2: { fret: 1, finger: 1 }, 3: { fret: 2, finger: 2 }, 4: { fret: 3, finger: 3 } },
    open: [],
    muted: [5, 6]
  },
  'F#m': {
    name: 'F# Minor',
    short: 'F#m',
    frets: { 1: { fret: 2, finger: 1 }, 2: { fret: 2, finger: 1 }, 3: { fret: 2, finger: 1 }, 4: { fret: 4, finger: 3 }, 5: { fret: 4, finger: 4 }, 6: { fret: 2, finger: 1 } },
    open: [],
    muted: []
  },
  'Dm': {
    name: 'D Minor',
    short: 'Dm',
    frets: { 1: { fret: 1, finger: 1 }, 3: { fret: 2, finger: 2 }, 2: { fret: 3, finger: 3 } },
    open: [4],
    muted: [5, 6]
  },
  'B7': {
    name: 'B Dominant 7',
    short: 'B7',
    frets: { 4: { fret: 1, finger: 1 }, 5: { fret: 2, finger: 2 }, 3: { fret: 2, finger: 3 }, 1: { fret: 2, finger: 4 } },
    open: [2],
    muted: [6]
  }
};

// Root note MIDI pitch for the backing bassline
const CHORD_ROOT_MIDI = {
  'C': 36,   // C2
  'G': 43,   // G2
  'D': 38,   // D2
  'Em': 40,  // E2
  'Am': 45,  // A2
  'A': 45,   // A2
  'E': 40,   // E2
  'F': 41,   // F2
  'F#m': 42, // F#2
  'Dm': 38,  // D2
  'B7': 47   // B2
};

export const BUILT_IN_SONGS = [
  {
    id: 'four-chord-pop',
    title: '4-Chord Pop Anthem',
    subtitle: "Don't Stop Strumming",
    genre: 'Pop / Rock',
    bpm: 96,
    difficulty: 'Beginner',
    timeSignature: [4, 4],
    description: 'The legendary G - D - Em - C sequence heard in hundreds of global hits.',
    measures: [
      { chord: 'G',  beats: 4, strumGuide: ['D', null, 'D', 'U', null, 'U', 'D', 'U'] },
      { chord: 'D',  beats: 4, strumGuide: ['D', null, 'D', 'U', null, 'U', 'D', 'U'] },
      { chord: 'Em', beats: 4, strumGuide: ['D', null, 'D', 'U', null, 'U', 'D', 'U'] },
      { chord: 'C',  beats: 4, strumGuide: ['D', null, 'D', 'U', null, 'U', 'D', 'U'] }
    ]
  },
  {
    id: 'stand-by-me',
    title: 'Stand By Me',
    subtitle: 'Classic Soul Groove',
    genre: 'R&B / Soul',
    bpm: 110,
    difficulty: 'Intermediate',
    timeSignature: [4, 4],
    description: 'Iconic 50s/60s doo-wop progression: A - F#m - D - E.',
    measures: [
      { chord: 'A',   beats: 4, strumGuide: ['D', null, 'D', null, 'D', 'U', 'D', null] },
      { chord: 'A',   beats: 4, strumGuide: ['D', null, 'D', null, 'D', 'U', 'D', null] },
      { chord: 'F#m', beats: 4, strumGuide: ['D', null, 'D', null, 'D', 'U', 'D', null] },
      { chord: 'F#m', beats: 4, strumGuide: ['D', null, 'D', null, 'D', 'U', 'D', null] },
      { chord: 'D',   beats: 4, strumGuide: ['D', null, 'D', null, 'D', 'U', 'D', null] },
      { chord: 'E',   beats: 4, strumGuide: ['D', null, 'D', null, 'D', 'U', 'D', null] },
      { chord: 'A',   beats: 4, strumGuide: ['D', null, 'D', null, 'D', 'U', 'D', null] },
      { chord: 'A',   beats: 4, strumGuide: ['D', null, 'D', null, 'D', 'U', 'D', null] }
    ]
  },
  {
    id: 'knockin-heavens-door',
    title: "Knockin' on Heaven's Door",
    subtitle: 'Acoustic Folk Anthem',
    genre: 'Folk / Rock',
    bpm: 72,
    difficulty: 'Beginner',
    timeSignature: [4, 4],
    description: 'Soulful acoustic changes: G - D - Am / G - D - C.',
    measures: [
      { chord: 'G',  beats: 4, strumGuide: ['D', null, 'D', 'U', null, 'U', 'D', null] },
      { chord: 'D',  beats: 4, strumGuide: ['D', null, 'D', 'U', null, 'U', 'D', null] },
      { chord: 'Am', beats: 4, strumGuide: ['D', null, 'D', 'U', null, 'U', 'D', 'U'] },
      { chord: 'Am', beats: 4, strumGuide: ['D', null, 'D', 'U', null, 'U', 'D', 'U'] },
      { chord: 'G',  beats: 4, strumGuide: ['D', null, 'D', 'U', null, 'U', 'D', null] },
      { chord: 'D',  beats: 4, strumGuide: ['D', null, 'D', 'U', null, 'U', 'D', null] },
      { chord: 'C',  beats: 4, strumGuide: ['D', null, 'D', 'U', null, 'U', 'D', 'U'] },
      { chord: 'C',  beats: 4, strumGuide: ['D', null, 'D', 'U', null, 'U', 'D', 'U'] }
    ]
  },
  {
    id: 'twelve-bar-blues',
    title: '12-Bar Blues in E',
    subtitle: 'Chicago Shuffle',
    genre: 'Blues / Rock',
    bpm: 94,
    difficulty: 'Intermediate',
    timeSignature: [4, 4],
    description: 'Authentic 12-bar shuffle in E Major using E, A, and B7.',
    measures: [
      { chord: 'E',  beats: 4, strumGuide: ['D', null, 'D', null, 'D', null, 'D', null] },
      { chord: 'E',  beats: 4, strumGuide: ['D', null, 'D', null, 'D', null, 'D', null] },
      { chord: 'E',  beats: 4, strumGuide: ['D', null, 'D', null, 'D', null, 'D', null] },
      { chord: 'E',  beats: 4, strumGuide: ['D', null, 'D', null, 'D', null, 'D', null] },
      { chord: 'A',  beats: 4, strumGuide: ['D', null, 'D', null, 'D', null, 'D', null] },
      { chord: 'A',  beats: 4, strumGuide: ['D', null, 'D', null, 'D', null, 'D', null] },
      { chord: 'E',  beats: 4, strumGuide: ['D', null, 'D', null, 'D', null, 'D', null] },
      { chord: 'E',  beats: 4, strumGuide: ['D', null, 'D', null, 'D', null, 'D', null] },
      { chord: 'B7', beats: 4, strumGuide: ['D', null, 'D', null, 'D', null, 'D', null] },
      { chord: 'A',  beats: 4, strumGuide: ['D', null, 'D', null, 'D', null, 'D', null] },
      { chord: 'E',  beats: 4, strumGuide: ['D', null, 'D', null, 'D', null, 'D', null] },
      { chord: 'B7', beats: 4, strumGuide: ['D', null, 'D', null, 'D', null, 'D', null] }
    ]
  },
  {
    id: 'wonder-strum',
    title: 'Wonder Strum',
    subtitle: '90s Oasis Vibe',
    genre: 'Britpop / Acoustic',
    bpm: 86,
    difficulty: 'Beginner',
    timeSignature: [4, 4],
    description: 'Em - G - D - A driving acoustic rhythm with open resonant strings.',
    measures: [
      { chord: 'Em', beats: 4, strumGuide: ['D', null, 'D', 'U', 'D', 'U', 'D', 'U'] },
      { chord: 'G',  beats: 4, strumGuide: ['D', null, 'D', 'U', 'D', 'U', 'D', 'U'] },
      { chord: 'D',  beats: 4, strumGuide: ['D', null, 'D', 'U', 'D', 'U', 'D', 'U'] },
      { chord: 'A',  beats: 4, strumGuide: ['D', null, 'D', 'U', 'D', 'U', 'D', 'U'] }
    ]
  }
];

export class SongEngine {
  constructor() {
    this.currentSong = BUILT_IN_SONGS[0];
    this.bpm = this.currentSong.bpm;
    this.tempoMultiplier = 1.0;
    this.isPlaying = false;
    this.isMetronomeEnabled = true;
    this.backingVolume = 0.65; // 0.0 to 1.0

    // Playback state
    this.currentMeasure = 0;
    this.currentBeat = 0; // 0..3 for 4/4
    this.totalBeatsPlayed = 0;

    // Scheduler refs
    this.nextBeatTime = 0;
    this.timerId = null;
    this.lookaheadMs = 25.0;
    this.scheduleAheadSec = 0.12;

    // Hit evaluation and scoring
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.lastHitRating = null; // 'PERFECT', 'GREAT', 'EARLY', 'LATE', 'MISS'
    this.lastHitTime = 0;

    // Listeners for UI state
    this.listeners = new Set();
  }

  get effectiveBpm() {
    return Math.round(this.bpm * this.tempoMultiplier);
  }

  get secondsPerBeat() {
    return 60.0 / this.effectiveBpm;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyListeners(eventType, payload) {
    this.listeners.forEach(fn => {
      try {
        fn(eventType, payload);
      } catch (err) {
        console.error('SongEngine listener error:', err);
      }
    });
  }

  setSong(songId) {
    const song = BUILT_IN_SONGS.find(s => s.id === songId) || BUILT_IN_SONGS[0];
    this.currentSong = song;
    this.bpm = song.bpm;
    this.resetPlayback();
    this.notifyListeners('songChange', { song });
  }

  setTempoMultiplier(mult) {
    this.tempoMultiplier = Math.max(0.5, Math.min(1.5, mult));
    this.notifyListeners('tempoChange', { bpm: this.effectiveBpm, mult: this.tempoMultiplier });
  }

  setBackingVolume(vol) {
    this.backingVolume = Math.max(0, Math.min(1.0, vol));
  }

  toggleMetronome() {
    this.isMetronomeEnabled = !this.isMetronomeEnabled;
    this.notifyListeners('metronomeChange', { enabled: this.isMetronomeEnabled });
  }

  async start() {
    if (this.isPlaying) return;
    await guitarAudio.ensureAudioContext();
    const ctx = guitarAudio.ctx;
    if (!ctx) return;

    this.isPlaying = true;
    this.nextBeatTime = ctx.currentTime + 0.15;
    this.scheduler();
    this.notifyListeners('playStateChange', { isPlaying: true });
  }

  stop() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.notifyListeners('playStateChange', { isPlaying: false });
  }

  resetPlayback() {
    const wasPlaying = this.isPlaying;
    this.stop();
    this.currentMeasure = 0;
    this.currentBeat = 0;
    this.totalBeatsPlayed = 0;
    this.score = 0;
    this.combo = 0;
    this.lastHitRating = null;
    this.notifyListeners('seek', {
      measure: 0,
      beat: 0,
      targetChord: this.getTargetChord()
    });
    if (wasPlaying) {
      this.start();
    }
  }

  getTargetChord() {
    if (!this.currentSong || !this.currentSong.measures.length) return null;
    const measure = this.currentSong.measures[this.currentMeasure % this.currentSong.measures.length];
    const chordShort = measure.chord;
    return CHORD_FINGERINGS[chordShort] || {
      name: `${chordShort} Chord`,
      short: chordShort,
      frets: {},
      open: [1, 2, 3, 4, 5, 6],
      muted: []
    };
  }

  getUpcomingChords(count = 3) {
    if (!this.currentSong) return [];
    const measures = this.currentSong.measures;
    const upcoming = [];
    for (let i = 1; i <= count; i++) {
      const idx = (this.currentMeasure + i) % measures.length;
      const m = measures[idx];
      upcoming.push({
        measureIndex: this.currentMeasure + i,
        chord: m.chord,
        info: CHORD_FINGERINGS[m.chord] || { short: m.chord, name: m.chord }
      });
    }
    return upcoming;
  }

  scheduler() {
    if (!this.isPlaying) return;
    const ctx = guitarAudio.ctx;
    if (!ctx) return;

    // Schedule any beats falling within the lookahead window
    while (this.nextBeatTime < ctx.currentTime + this.scheduleAheadSec) {
      this.scheduleBeat(this.currentMeasure, this.currentBeat, this.nextBeatTime);
      this.advanceBeat();
    }

    this.timerId = setTimeout(() => this.scheduler(), this.lookaheadMs);
  }

  advanceBeat() {
    const spb = this.secondsPerBeat;
    this.nextBeatTime += spb;
    this.currentBeat++;
    this.totalBeatsPlayed++;

    const measureLength = this.currentSong.measures[this.currentMeasure % this.currentSong.measures.length].beats || 4;
    if (this.currentBeat >= measureLength) {
      this.currentBeat = 0;
      this.currentMeasure = (this.currentMeasure + 1) % this.currentSong.measures.length;
    }

    this.notifyListeners('beat', {
      measure: this.currentMeasure,
      beat: this.currentBeat,
      targetChord: this.getTargetChord(),
      nextChords: this.getUpcomingChords(3),
      effectiveBpm: this.effectiveBpm
    });
  }

  /**
   * Schedule synthesized audio accompaniment for a specific beat
   */
  scheduleBeat(measureIdx, beatIdx, time) {
    const ctx = guitarAudio.ctx;
    if (!ctx) return;

    const measure = this.currentSong.measures[measureIdx % this.currentSong.measures.length];
    const chordShort = measure.chord;
    const isDownbeat = (beatIdx === 0);

    // 1. Metronome Click (if enabled)
    if (this.isMetronomeEnabled) {
      this.synthesizeClick(time, isDownbeat);
    }

    // 2. Rhythm Section (Kick, Snare, Hi-Hat, Bass)
    if (this.backingVolume > 0.05) {
      const vol = this.backingVolume;

      // Kick Drum on Beats 1 and 3 (in 4/4)
      if (beatIdx === 0 || beatIdx === 2) {
        this.synthesizeKick(time, vol);
      }

      // Snare on Beats 2 and 4 (backbeat)
      if (beatIdx === 1 || beatIdx === 3) {
        this.synthesizeSnare(time, vol * 0.9);
      }

      // Hi-Hat on all quarter notes + subtle upbeat eighth notes
      this.synthesizeHiHat(time, vol * (isDownbeat ? 0.6 : 0.45));
      const spb = this.secondsPerBeat;
      this.synthesizeHiHat(time + spb * 0.5, vol * 0.3);

      // Acoustic Bass Line playing root notes locked to beat 1 and 3
      if (beatIdx === 0 || beatIdx === 2) {
        const rootMidi = CHORD_ROOT_MIDI[chordShort] || 40;
        this.synthesizeBass(rootMidi, time, spb * 0.9, vol * 0.7);
      }
    }
  }

  synthesizeClick(time, isDownbeat) {
    const ctx = guitarAudio.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(isDownbeat ? 1200 : 800, time);

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(isDownbeat ? 0.35 : 0.2, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);

    osc.connect(gain);
    gain.connect(guitarAudio.masterGain);

    osc.start(time);
    osc.stop(time + 0.05);
  }

  synthesizeKick(time, masterVol) {
    const ctx = guitarAudio.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.09);

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.7 * masterVol, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.28);

    osc.connect(gain);
    gain.connect(guitarAudio.masterGain);

    osc.start(time);
    osc.stop(time + 0.3);
  }

  synthesizeSnare(time, masterVol) {
    const ctx = guitarAudio.ctx;
    // White noise burst for the snare rattle
    const bufferSize = Math.round(ctx.sampleRate * 0.15);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.25));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(800, time);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55 * masterVol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(guitarAudio.masterGain);

    // Body punch tone
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190, time);
    osc.frequency.exponentialRampToValueAtTime(80, time + 0.06);

    oscGain.gain.setValueAtTime(0.4 * masterVol, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);

    osc.connect(oscGain);
    oscGain.connect(guitarAudio.masterGain);

    noise.start(time);
    noise.stop(time + 0.19);
    osc.start(time);
    osc.stop(time + 0.09);
  }

  synthesizeHiHat(time, masterVol) {
    const ctx = guitarAudio.ctx;
    const bufferSize = Math.round(ctx.sampleRate * 0.05);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.18));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(7000, time);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.35 * masterVol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.048);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(guitarAudio.masterGain);

    noise.start(time);
    noise.stop(time + 0.05);
  }

  synthesizeBass(midiNote, time, duration, masterVol) {
    const ctx = guitarAudio.ctx;
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(260, time);
    filter.Q.setValueAtTime(2.0, time);

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.45 * masterVol, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(guitarAudio.masterGain);

    osc.start(time);
    osc.stop(time + duration);
  }

  /**
   * Evaluate player's live strum against the target chord and timing
   */
  evaluateStrum(playedChordName) {
    if (!this.isPlaying) return null;
    const target = this.getTargetChord();
    if (!target) return null;

    const isMatch = (playedChordName && (
      playedChordName === target.short ||
      playedChordName.startsWith(target.short + ' ') ||
      playedChordName === target.name
    ));

    const now = performance.now();
    let rating;
    let points;

    if (isMatch) {
      this.combo++;
      if (this.combo > this.maxCombo) {
        this.maxCombo = this.combo;
      }
      rating = 'PERFECT!';
      points = 100 + Math.min(200, this.combo * 15);
      this.score += points;
    } else {
      // Partial credit or miss
      if (this.combo > 2) {
        this.combo = 0;
      }
      rating = 'TRY ' + target.short;
      points = 0;
    }

    this.lastHitRating = { rating, points, time: now, isMatch, target: target.short };
    this.notifyListeners('hit', this.lastHitRating);

    return this.lastHitRating;
  }
}

// Global Song Engine singleton
export const songEngine = new SongEngine();
