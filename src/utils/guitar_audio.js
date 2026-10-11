/**
 * Studio-Grade Real-Time Acoustic Guitar Audio Engine
 * Combines:
 *  1. Studio Sampled Acoustic Guitar (FluidR3 GM Acoustic Steel Guitar)
 *     Real, rich, resonance-recorded acoustic guitar samples for every fret & string.
 *  2. Warm Physical Modeling Synthesizer (Instant Fallback)
 *  3. Dynamic Strumming & Micro-Arpeggiation (Downstroke vs Upstroke timing)
 *  4. Velocity-Sensitive Dynamics
 */

export const OPEN_STRING_MIDI = {
  1: 64, // E4 (High E)
  2: 59, // B3
  3: 55, // G3
  4: 50, // D3
  5: 45, // A2
  6: 40  // E2 (Low E)
};

const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export function midiToNoteName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  const note = NOTE_NAMES_FLAT[midi % 12];
  return `${note}${octave}`;
}

export function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Convert base64 data URI to ArrayBuffer for Web Audio decoding
function dataURIToArrayBuffer(dataURI) {
  const base64 = dataURI.split(',')[1];
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export const GUITAR_INSTRUMENTS = {
  acoustic: {
    id: 'acoustic',
    name: 'Acoustic Steel',
    icon: '🎸',
    file: 'acoustic_guitar_steel-mp3.js',
    key: 'acoustic_guitar_steel',
    badge: 'Acoustic Steel',
    color: '#f59e0b',
    eq: { lowFreq: 140, lowGain: 3.5, midFreq: 1200, midGain: 1.5, highFreq: 6500, highGain: -3.0 }
  },
  electric_clean: {
    id: 'electric_clean',
    name: 'Electric Clean',
    icon: '⚡',
    file: 'electric_guitar_clean-mp3.js',
    key: 'electric_guitar_clean',
    badge: 'Electric Clean',
    color: '#06b6d4',
    eq: { lowFreq: 110, lowGain: 1.5, midFreq: 2600, midGain: 3.5, highFreq: 7500, highGain: 1.0 }
  },
  distortion: {
    id: 'distortion',
    name: 'Electric Rock',
    icon: '🔥',
    file: 'distortion_guitar-mp3.js',
    key: 'distortion_guitar',
    badge: 'Electric Rock',
    color: '#ef4444',
    eq: { lowFreq: 180, lowGain: 4.0, midFreq: 1600, midGain: 4.5, highFreq: 5000, highGain: -4.0 }
  }
};

class GuitarAudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.bodyLow = null;
    this.bodyMid = null;
    this.bodyHigh = null;
    this.reverbNode = null;
    this.isMuted = false;
    this.volume = 0.85;

    let savedInst = 'acoustic';
    try {
      savedInst = localStorage.getItem('arguitar_instrument') || 'acoustic';
    } catch {
      // ignore
    }
    this.currentInstrument = GUITAR_INSTRUMENTS[savedInst] ? savedInst : 'acoustic';

    this.sampleCaches = {
      acoustic: new Map(),
      electric_clean: new Map(),
      distortion: new Map()
    };
    this.loadedInstruments = new Set();
    this.loadingInstruments = new Set();
    this.loadingPromises = new Map();
    this.onInstrumentChange = null;
  }

  /**
   * Initialize or resume browser AudioContext & load current soundfont
   */
  async ensureAudioContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        console.warn('Web Audio API is not supported in this browser.');
        return false;
      }
      this.ctx = new AudioCtx();

      // Master output gain
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);

      // Body Resonance & Amp EQ Chain:
      this.bodyLow = this.ctx.createBiquadFilter();
      this.bodyLow.type = 'peaking';
      this.bodyLow.Q.setValueAtTime(1.4, this.ctx.currentTime);

      this.bodyMid = this.ctx.createBiquadFilter();
      this.bodyMid.type = 'peaking';
      this.bodyMid.Q.setValueAtTime(1.0, this.ctx.currentTime);

      this.bodyHigh = this.ctx.createBiquadFilter();
      this.bodyHigh.type = 'highshelf';

      this.applyInstrumentEQ(this.currentInstrument);

      // Connect EQ chain: masterGain -> bodyLow -> bodyMid -> bodyHigh -> destination
      this.masterGain.connect(this.bodyLow);
      this.bodyLow.connect(this.bodyMid);
      this.bodyMid.connect(this.bodyHigh);
      this.bodyHigh.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (err) {
        console.warn('Could not resume AudioContext:', err);
      }
    }

    // Trigger loading of current instrument soundfont in background
    if (!this.loadedInstruments.has(this.currentInstrument)) {
      this.loadInstrumentSoundfont(this.currentInstrument);
    }

    return this.ctx.state === 'running';
  }

  /**
   * Apply instrument-specific frequency shaping and tone profile
   */
  applyInstrumentEQ(instrumentId) {
    if (!this.ctx || !this.bodyLow || !this.bodyMid || !this.bodyHigh) return;
    const inst = GUITAR_INSTRUMENTS[instrumentId] || GUITAR_INSTRUMENTS.acoustic;
    const eq = inst.eq;
    const now = this.ctx.currentTime;
    this.bodyLow.frequency.setTargetAtTime(eq.lowFreq, now, 0.05);
    this.bodyLow.gain.setTargetAtTime(eq.lowGain, now, 0.05);
    this.bodyMid.frequency.setTargetAtTime(eq.midFreq, now, 0.05);
    this.bodyMid.gain.setTargetAtTime(eq.midGain, now, 0.05);
    this.bodyHigh.frequency.setTargetAtTime(eq.highFreq, now, 0.05);
    this.bodyHigh.gain.setTargetAtTime(eq.highGain, now, 0.05);
  }

  /**
   * Switch the active guitar instrument (acoustic, electric_clean, distortion)
   */
  async setInstrument(instrumentId) {
    if (!GUITAR_INSTRUMENTS[instrumentId]) return;
    this.currentInstrument = instrumentId;
    try {
      localStorage.setItem('arguitar_instrument', instrumentId);
    } catch {
      // ignore
    }
    this.applyInstrumentEQ(instrumentId);
    await this.ensureAudioContext();
    await this.loadInstrumentSoundfont(instrumentId);
    if (this.onInstrumentChange) {
      this.onInstrumentChange(instrumentId);
    }
  }

  /**
   * Load local studio soundfont for specified instrument from /soundfonts/
   */
  async loadInstrumentSoundfont(instrumentId) {
    const inst = GUITAR_INSTRUMENTS[instrumentId] || GUITAR_INSTRUMENTS.acoustic;
    if (this.loadedInstruments.has(inst.id)) return;
    if (this.loadingInstruments.has(inst.id)) return this.loadingPromises.get(inst.id);

    this.loadingInstruments.add(inst.id);
    const loadPromise = (async () => {
      try {
        if (!window.MIDI?.Soundfont?.[inst.key]) {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `/soundfonts/${inst.file}`;
            script.async = true;
            script.onload = () => resolve();
            script.onerror = (e) => reject(e);
            document.head.appendChild(script);
          });
        }

        if (window.MIDI?.Soundfont?.[inst.key]) {
          this.loadedInstruments.add(inst.id);
          console.log(`🎸 ${inst.name} SoundFont Loaded Successfully!`);
          await this.preloadCommonNotes(inst.id);
        }
      } catch (err) {
        console.warn(`Soundfont load fallback for ${inst.name}:`, err);
      } finally {
        this.loadingInstruments.delete(inst.id);
      }
    })();

    this.loadingPromises.set(inst.id, loadPromise);
    await loadPromise;
  }

  /**
   * Pre-decode common guitar notes so first plucks have 0ms latency
   */
  async preloadCommonNotes(instrumentId) {
    const inst = GUITAR_INSTRUMENTS[instrumentId] || GUITAR_INSTRUMENTS.acoustic;
    const sfData = window.MIDI?.Soundfont?.[inst.key];
    if (!sfData || !this.ctx) return;
    const cache = this.sampleCaches[inst.id] || (this.sampleCaches[inst.id] = new Map());

    const priorityMidis = [
      40, 41, 43, // E2, F2, G2 (Low E string)
      45, 47, 48, // A2, B2, C3 (A string)
      50, 52, 53, // D3, E3, F3 (D string)
      55, 57,     // G3, A3     (G string)
      59, 60, 62, // B3, C4, D4 (B string)
      64, 65, 67  // E4, F4, G4 (High E string)
    ];

    for (const midi of priorityMidis) {
      const noteName = midiToNoteName(midi);
      if (!cache.has(noteName) && sfData[noteName]) {
        try {
          const buffer = await this.decodeSoundfontNote(inst.id, noteName, sfData[noteName]);
          if (buffer) {
            cache.set(noteName, buffer);
          }
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Decode an mp3 base64 note from soundfont into an AudioBuffer
   */
  async decodeSoundfontNote(instrumentId, noteName, dataUri) {
    const cache = this.sampleCaches[instrumentId] || (this.sampleCaches[instrumentId] = new Map());
    if (cache.has(noteName)) {
      return cache.get(noteName);
    }
    if (!dataUri || !this.ctx) return null;

    try {
      const arrayBuffer = dataURIToArrayBuffer(dataUri);
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      cache.set(noteName, audioBuffer);
      return audioBuffer;
    } catch (err) {
      console.warn(`Failed to decode note ${noteName}:`, err);
      return null;
    }
  }

  setMuted(muted) {
    this.isMuted = !!muted;
    if (this.masterGain && this.ctx) {
      const targetGain = this.isMuted ? 0 : this.volume;
      this.masterGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.02);
    }
  }

  toggleMute() {
    this.setMuted(!this.isMuted);
    return this.isMuted;
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1.0, vol));
    if (this.masterGain && this.ctx && !this.isMuted) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
  }

  /**
   * Play a real studio-recorded guitar sample
   */
  playSampleNote(audioBuffer, velocity, now, instrumentId = 'acoustic') {
    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;

    const voiceGain = this.ctx.createGain();
    const clampedVelocity = Math.max(0.25, Math.min(1.0, velocity));

    // Dynamic curve tuned per guitar sound
    let peakVolume = clampedVelocity * 0.95;
    if (instrumentId === 'electric_clean') {
      peakVolume = clampedVelocity * 1.05;
    } else if (instrumentId === 'distortion') {
      peakVolume = clampedVelocity * 0.85; // higher harmonic density, lower peak to avoid clipping
    }

    voiceGain.gain.setValueAtTime(peakVolume, now);

    source.connect(voiceGain);
    voiceGain.connect(this.masterGain);

    source.start(now);
    return voiceGain;
  }

  /**
   * High-quality warm physical modeling synthesis (instant fallback)
   */
  playSynthesizedNote(freq, velocity, now, stringNum) {
    const sampleRate = this.ctx.sampleRate;
    const periodSamples = Math.round(sampleRate / freq);
    const burstDuration = Math.max(0.004, (periodSamples / sampleRate) * 1.5);

    // Warm pluck excitation: band-limited low-pass filtered impulse rather than white noise
    const noiseBuffer = this.ctx.createBuffer(1, Math.round(sampleRate * burstDuration), sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let prev = 0;
    for (let i = 0; i < output.length; i++) {
      const white = Math.random() * 2 - 1;
      // One-pole smoothing to eliminate harsh digital "tinny" frequencies
      const smoothed = prev * 0.65 + white * 0.35;
      prev = smoothed;
      output[i] = smoothed * Math.exp(-i / (output.length * 0.35));
    }

    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const delayNode = this.ctx.createDelay(1.0);
    delayNode.delayTime.setValueAtTime(1 / freq, now);

    // Damping filter inside the feedback loop
    const dampingFilter = this.ctx.createBiquadFilter();
    dampingFilter.type = 'lowpass';
    const cutoff = 1600 + (7 - stringNum) * 450;
    dampingFilter.frequency.setValueAtTime(cutoff, now);
    dampingFilter.Q.setValueAtTime(1.2, now);

    const feedbackGain = this.ctx.createGain();
    feedbackGain.gain.setValueAtTime(0.988, now);

    const voiceGain = this.ctx.createGain();
    const peakVolume = Math.max(0.2, Math.min(1.0, velocity)) * 0.8;
    voiceGain.gain.setValueAtTime(0, now);
    voiceGain.gain.linearRampToValueAtTime(peakVolume, now + 0.003);
    voiceGain.gain.exponentialRampToValueAtTime(0.001, now + 2.5);

    noiseSource.connect(voiceGain);
    voiceGain.connect(this.masterGain);

    voiceGain.connect(dampingFilter);
    dampingFilter.connect(delayNode);
    delayNode.connect(feedbackGain);
    feedbackGain.connect(voiceGain);

    noiseSource.start(now);
    noiseSource.stop(now + burstDuration);

    return voiceGain;
  }

  /**
   * Pluck a string (Studio Sample with Physical Synthesis Fallback)
   * @param {number} stringNum - 1 to 6 (1 = High E, 6 = Low E)
   * @param {number} fretNum - Fret number 0..22
   * @param {number} velocity - 0.25 to 1.0
   * @param {number} startTimeOffsetSec - Strum delay
   */
  async pluckString(stringNum, fretNum = 0, velocity = 0.8, startTimeOffsetSec = 0) {
    if (this.isMuted) return;
    await this.ensureAudioContext();
    if (!this.ctx || this.ctx.state !== 'running') return;

    const baseMidi = OPEN_STRING_MIDI[stringNum] || 64;
    const noteMidi = baseMidi + Math.max(0, fretNum);
    const noteName = midiToNoteName(noteMidi);
    const freq = midiToFrequency(noteMidi);
    const now = this.ctx.currentTime + startTimeOffsetSec;

    const instId = this.currentInstrument;
    const inst = GUITAR_INSTRUMENTS[instId] || GUITAR_INSTRUMENTS.acoustic;
    const cache = this.sampleCaches[instId] || (this.sampleCaches[instId] = new Map());

    // Check if we already have the real studio sample in cache for this instrument
    let audioBuffer = cache.get(noteName);

    if (!audioBuffer) {
      const sfData = window.MIDI?.Soundfont?.[inst.key];
      if (sfData && sfData[noteName]) {
        // Decode asynchronously and cache
        audioBuffer = await this.decodeSoundfontNote(instId, noteName, sfData[noteName]);
      }
    }

    if (audioBuffer) {
      // Play real studio-recorded guitar note
      this.playSampleNote(audioBuffer, velocity, now, instId);
    } else {
      // Warm physical modeling fallback
      this.playSynthesizedNote(freq, velocity, now, stringNum);
    }
  }

  /**
   * Strum multiple strings with natural micro-delay arpeggiation
   * @param {Array<number>} stringNumbers - [6, 5, 4, 3, 2, 1]
   * @param {Object} frettedMap - { 5: 3, 4: 2, 2: 1 }
   * @param {string} direction - 'DOWN ↓' or 'UP ↑'
   * @param {number} velocity - Strum speed / intensity
   */
  async strumStrings(stringNumbers, frettedMap = {}, direction = 'DOWN ↓', velocity = 0.8) {
    if (this.isMuted || !stringNumbers || stringNumbers.length === 0) return;
    await this.ensureAudioContext();

    // Natural strum speed: 18ms to 24ms per string
    const baseStagger = 0.021;
    const isDown = direction.includes('DOWN') || direction === 'down';

    // Order strings in pick sequence:
    // Downstroke: String 6 -> 5 -> 4 -> 3 -> 2 -> 1
    // Upstroke:   String 1 -> 2 -> 3 -> 4 -> 5 -> 6
    const orderedStrings = [...stringNumbers].sort((a, b) => isDown ? (b - a) : (a - b));

    orderedStrings.forEach((strNum, idx) => {
      const fret = frettedMap[strNum] !== undefined ? frettedMap[strNum] : 0;
      const staggerTime = idx * baseStagger;
      const dynamicVelocity = velocity * (0.88 + Math.random() * 0.2);
      this.pluckString(strNum, fret, dynamicVelocity, staggerTime);
    });
  }

  /**
   * Strum a recognized chord with full acoustic voicing
   */
  async strumChord(chord, direction = 'DOWN ↓', velocity = 0.85) {
    if (!chord) return;
    const frettedMap = chord.frettedStrings || {};
    const muted = new Set(chord.mutedStrings || []);

    const soundingStrings = [];
    for (let s = 1; s <= 6; s++) {
      if (!muted.has(s)) {
        soundingStrings.push(s);
      }
    }

    await this.strumStrings(soundingStrings, frettedMap, direction, velocity);
  }
}

// Global audio engine singleton
export const guitarAudio = new GuitarAudioEngine();
