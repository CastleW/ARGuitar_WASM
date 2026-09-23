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

export function getStringFrequency(stringNum, fretNum = 0) {
  const baseMidi = OPEN_STRING_MIDI[stringNum] || 64;
  const noteMidi = baseMidi + Math.max(0, fretNum);
  return midiToFrequency(noteMidi);
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

class GuitarAudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.reverbNode = null;
    this.isMuted = false;
    this.volume = 0.85;

    this.soundfontLoaded = false;
    this.soundfontLoading = false;
    this.soundfontData = null;
    this.sampleCache = new Map(); // noteName -> AudioBuffer
    this.activeVoices = new Map(); // stringNum -> active nodes
    this.audioInitPromise = null;
  }

  /**
   * Initialize or resume browser AudioContext & load soundfont
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

      // Acoustic Body Resonance EQ:
      // Low warmth around 140Hz
      const bodyLow = this.ctx.createBiquadFilter();
      bodyLow.type = 'peaking';
      bodyLow.frequency.setValueAtTime(140, this.ctx.currentTime);
      bodyLow.Q.setValueAtTime(1.4, this.ctx.currentTime);
      bodyLow.gain.setValueAtTime(3.5, this.ctx.currentTime);

      // Mid presence around 1200Hz
      const bodyMid = this.ctx.createBiquadFilter();
      bodyMid.type = 'peaking';
      bodyMid.frequency.setValueAtTime(1200, this.ctx.currentTime);
      bodyMid.Q.setValueAtTime(1.0, this.ctx.currentTime);
      bodyMid.gain.setValueAtTime(1.5, this.ctx.currentTime);

      // Gentle high-shelf to soften harsh digital transients
      const bodyHigh = this.ctx.createBiquadFilter();
      bodyHigh.type = 'highshelf';
      bodyHigh.frequency.setValueAtTime(6500, this.ctx.currentTime);
      bodyHigh.gain.setValueAtTime(-3.0, this.ctx.currentTime);

      // Connect EQ chain: masterGain -> bodyLow -> bodyMid -> bodyHigh -> destination
      this.masterGain.connect(bodyLow);
      bodyLow.connect(bodyMid);
      bodyMid.connect(bodyHigh);
      bodyHigh.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (err) {
        console.warn('Could not resume AudioContext:', err);
      }
    }

    // Trigger Soundfont loading in background
    if (!this.soundfontLoaded && !this.soundfontLoading) {
      this.loadSoundfont();
    }

    return this.ctx.state === 'running';
  }

  /**
   * Load local studio acoustic guitar soundfont from /soundfonts/
   */
  async loadSoundfont() {
    if (this.soundfontLoaded || this.soundfontLoading) return;
    this.soundfontLoading = true;

    try {
      // Check if global soundfont is already loaded on window
      if (window.MIDI && window.MIDI.Soundfont && window.MIDI.Soundfont.acoustic_guitar_steel) {
        this.soundfontData = window.MIDI.Soundfont.acoustic_guitar_steel;
        this.soundfontLoaded = true;
        this.preloadCommonGuitarNotes();
        return;
      }

      // Load soundfont script dynamically from /soundfonts/
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/soundfonts/acoustic_guitar_steel-mp3.js';
        script.async = true;
        script.onload = () => resolve();
        script.onerror = (e) => reject(e);
        document.head.appendChild(script);
      });

      if (window.MIDI && window.MIDI.Soundfont && window.MIDI.Soundfont.acoustic_guitar_steel) {
        this.soundfontData = window.MIDI.Soundfont.acoustic_guitar_steel;
        this.soundfontLoaded = true;
        console.log('🎸 Studio Acoustic Guitar SoundFont Loaded Successfully!');
        this.preloadCommonGuitarNotes();
      }
    } catch (err) {
      console.warn('Soundfont load fallback to physical model:', err);
    } finally {
      this.soundfontLoading = false;
    }
  }

  /**
   * Pre-decode common guitar notes so first plucks have 0ms latency
   */
  async preloadCommonGuitarNotes() {
    if (!this.soundfontData || !this.ctx) return;
    // Common open and fretted notes for open chords (E2 to G4)
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
      if (!this.sampleCache.has(noteName) && this.soundfontData[noteName]) {
        try {
          const buffer = await this.decodeSoundfontNote(noteName);
          if (buffer) {
            this.sampleCache.set(noteName, buffer);
          }
        } catch (e) {
          // ignore
        }
      }
    }
  }

  /**
   * Decode an mp3 base64 note from the soundfont into an AudioBuffer
   */
  async decodeSoundfontNote(noteName) {
    if (this.sampleCache.has(noteName)) {
      return this.sampleCache.get(noteName);
    }
    if (!this.soundfontData || !this.soundfontData[noteName] || !this.ctx) {
      return null;
    }

    try {
      const arrayBuffer = dataURIToArrayBuffer(this.soundfontData[noteName]);
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      this.sampleCache.set(noteName, audioBuffer);
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
   * Play a real studio-recorded acoustic guitar note
   */
  playSampleNote(audioBuffer, velocity, now) {
    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;

    const voiceGain = this.ctx.createGain();
    const clampedVelocity = Math.max(0.25, Math.min(1.0, velocity));
    // Warm, dynamic acoustic guitar curve
    const peakVolume = clampedVelocity * 0.95;
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

    // Check if we already have the real studio sample in cache
    let audioBuffer = this.sampleCache.get(noteName);

    if (!audioBuffer && this.soundfontData && this.soundfontData[noteName]) {
      // Decode asynchronously and cache
      audioBuffer = await this.decodeSoundfontNote(noteName);
    }

    if (audioBuffer) {
      // Play real studio-recorded acoustic guitar note
      this.playSampleNote(audioBuffer, velocity, now);
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
