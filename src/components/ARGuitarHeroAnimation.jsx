import { useEffect, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { guitarAudio } from '../utils/guitar_audio';

/**
 * Exact playable chord fingerings so the audio matches the chord bubble 100%
 */
const PLAYABLE_CHORDS = {
  G: {
    name: 'G Major',
    short: 'G',
    frettedStrings: { 5: 2, 6: 3, 1: 3 },
    mutedStrings: []
  },
  Em: {
    name: 'E Minor',
    short: 'Em',
    frettedStrings: { 5: 2, 4: 2 },
    mutedStrings: []
  },
  C: {
    name: 'C Major',
    short: 'C',
    frettedStrings: { 2: 1, 4: 2, 5: 3 },
    mutedStrings: [6]
  },
  D: {
    name: 'D Major',
    short: 'D',
    frettedStrings: { 3: 2, 1: 2, 2: 3 },
    mutedStrings: [5, 6]
  }
};

/**
 * ARGuitarHeroAnimation:
 * Pure AR Guitar Hero Showcase (without any human figure).
 * Features:
 * - Sleek electric AR Guitar with ArUco marker headstock tracking lock ([ID: 42 LOCKED]).
 * - 6 vibrating holographic laser strings.
 * - Groovy golden strum sweeps with pick, trailing ribbons, and explosive spark physics.
 * - Sweeping stage laser beams, floating musical notes, popping chord badges.
 * - Synchronous chord audio for G, Em, C, and D!
 */
export default function ARGuitarHeroAnimation() {
  const canvasRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);

  const animFrameRef = useRef(null);
  const startTimeRef = useRef(null);
  const pauseOffsetRef = useRef(0);
  const lastStrumTriggerRef = useRef(-1);
  const isAudioEnabledRef = useRef(isAudioEnabled);
  isAudioEnabledRef.current = isAudioEnabled;

  const particlesRef = useRef([]);
  const stringVibrationsRef = useRef([0, 0, 0, 0, 0, 0]);
  const activeChordBadgeRef = useRef(null);

  // 5.0s Loop Choreography
  const STRUM_EVENTS = [
    { time: 0.85, chord: 'G', name: 'G Major', dir: 'DOWN ↓', color: '#f59e0b', bonus: '+100 PERFECT!' },
    { time: 2.05, chord: 'Em', name: 'E Minor', dir: 'DOWN-UP ⤹', color: '#a855f7', bonus: 'GREAT GROOVE!' },
    { time: 3.15, chord: 'C', name: 'C Major', dir: 'DOWN ↓', color: '#06b6d4', bonus: '🔥 COMBO x8' },
    { time: 4.15, chord: 'D', name: 'D Major', dir: 'ROCKSTAR ⚡', color: '#fbbf24', bonus: '🏆 100% ROCKSTAR!' },
  ];

  const triggerStrum = (event, width, height, strumPoint) => {
    // 1. Play exact chord matching the bubble
    if (isAudioEnabledRef.current) {
      const chordObj = PLAYABLE_CHORDS[event.chord];
      if (chordObj) {
        guitarAudio.strumChord(
          chordObj,
          event.dir.includes('UP') ? 'UP ↑' : 'DOWN ↓',
          0.90
        ).catch(() => {});
      }
    }

    // 2. High-energy string vibration
    stringVibrationsRef.current = [6.0, 5.0, 5.5, 4.8, 4.2, 5.2];

    // 3. Golden spark & rainbow neon particle burst at strum contact
    const cx = strumPoint.x;
    const cy = strumPoint.y;
    const newParticles = [];
    const count = 36;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.45;
      const speed = 2.2 + Math.random() * 5.5;
      const palette = ['#fbbf24', '#f59e0b', '#00f5ff', '#ec4899', '#ffffff', '#a855f7'];
      const color = palette[Math.floor(Math.random() * palette.length)];
      newParticles.push({
        x: cx + (Math.random() - 0.5) * 14,
        y: cy + (Math.random() - 0.5) * 18,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.4,
        size: 1.8 + Math.random() * 3.2,
        alpha: 1.0,
        decay: 0.02 + Math.random() * 0.024,
        color,
        isStar: Math.random() > 0.5,
        rotation: Math.random() * Math.PI,
        rotSpeed: (Math.random() - 0.5) * 0.25
      });
    }
    particlesRef.current.push(...newParticles);

    // 4. Pop-up chord badge
    activeChordBadgeRef.current = {
      ...event,
      createdAt: performance.now()
    };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let running = true;

    // Helper to draw two-pass neon strokes
    const drawNeonPath = (drawFn, neonColor, coreColor = '#ffffff', lineWidth = 3.2, glowBlur = 10) => {
      ctx.save();
      ctx.strokeStyle = neonColor;
      ctx.shadowColor = neonColor;
      ctx.shadowBlur = glowBlur;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      drawFn();
      ctx.stroke();

      ctx.strokeStyle = coreColor;
      ctx.shadowBlur = Math.min(glowBlur * 0.35, 3);
      ctx.lineWidth = Math.max(1, lineWidth * 0.42);
      ctx.beginPath();
      drawFn();
      ctx.stroke();
      ctx.restore();
    };

    const render = (now) => {
      if (!running) return;

      if (!startTimeRef.current) {
        startTimeRef.current = now - pauseOffsetRef.current;
      }

      const elapsedMs = (now - startTimeRef.current) % 5000;
      const t = elapsedMs / 1000;
      setCurrentTimeSec(t);

      const dpr = Math.min(window.devicePixelRatio || 2, 2);
      const rect = canvas.getBoundingClientRect();
      const targetWidth = Math.round(rect.width * dpr);
      const targetHeight = Math.round(rect.height * dpr);

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      const W = canvas.width;
      const H = canvas.height;

      ctx.save();
      ctx.clearRect(0, 0, W, H);

      // ==========================================
      // 1. BACKGROUND: Concert Stage Laser Lighting & Spotlight
      // ==========================================
      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, '#040713');
      bgGrad.addColorStop(0.5, '#070b24');
      bgGrad.addColorStop(1, '#110b28');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // Sweeping Stage Laser Beams
      const laserPhase = t * 0.8;
      // Laser 1: Cyan
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 245, 255, 0.25)';
      ctx.lineWidth = 14 * dpr;
      ctx.shadowColor = '#00f5ff';
      ctx.shadowBlur = 24 * dpr;
      ctx.beginPath();
      ctx.moveTo(W * 0.10, 0);
      ctx.lineTo(W * 0.84 + Math.sin(laserPhase) * (25 * dpr), H);
      ctx.stroke();

      // Laser 2: Magenta
      ctx.strokeStyle = 'rgba(236, 72, 153, 0.25)';
      ctx.shadowColor = '#ec4899';
      ctx.beginPath();
      ctx.moveTo(W * 0.90, 0);
      ctx.lineTo(W * 0.18 - Math.cos(laserPhase) * (25 * dpr), H);
      ctx.stroke();

      // Laser 3: Golden Center Fan
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.16)';
      ctx.shadowColor = '#fbbf24';
      ctx.lineWidth = 8 * dpr;
      ctx.beginPath();
      ctx.moveTo(W * 0.5, 0);
      ctx.lineTo(W * 0.88, H * 0.75);
      ctx.stroke();
      ctx.restore();

      // Stage Spotlight Ambient Glow
      const spotGrad = ctx.createRadialGradient(W * 0.45, H * 0.54, 20 * dpr, W * 0.45, H * 0.54, W * 0.45);
      spotGrad.addColorStop(0, 'rgba(245, 158, 11, 0.22)');
      spotGrad.addColorStop(0.4, 'rgba(0, 245, 255, 0.12)');
      spotGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = spotGrad;
      ctx.fillRect(0, 0, W, H);

      // HUD Overlay
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
      ctx.lineWidth = 1.5 * dpr;
      const pad = 12 * dpr;
      ctx.beginPath();
      ctx.moveTo(pad, pad + 12 * dpr); ctx.lineTo(pad, pad); ctx.lineTo(pad + 12 * dpr, pad);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(W - pad - 12 * dpr, pad); ctx.lineTo(W - pad, pad); ctx.lineTo(W - pad, pad + 12 * dpr);
      ctx.stroke();

      ctx.fillStyle = '#00f5ff';
      ctx.beginPath();
      ctx.arc(pad + 18 * dpr, pad + 10 * dpr, 3.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `bold ${9 * dpr}px monospace`;
      ctx.fillText('AR VISION • 60 FPS', pad + 28 * dpr, pad + 13 * dpr);

      ctx.fillStyle = '#fbbf24';
      ctx.textAlign = 'right';
      ctx.fillText('⚡ LEVEL 1 AUTO-CHORD', W - pad - 8 * dpr, pad + 13 * dpr);
      ctx.textAlign = 'left';

      // ==========================================
      // 2. KINEMATICS & GROOVE
      // ==========================================
      const groovePhase = t * Math.PI * 4; // 120 BPM
      const floatBob = Math.sin(groovePhase) * (5 * dpr);
      const floatSway = Math.sin(t * Math.PI * 2) * (8 * dpr);

      // Strum detection
      let isStrumActive = false;
      let extraPulse = 0;
      for (const ev of STRUM_EVENTS) {
        const dt = t - ev.time;
        if (dt >= -0.15 && dt <= 0.4) {
          isStrumActive = true;
          extraPulse = Math.sin(((dt + 0.15) / 0.55) * Math.PI) * (4 * dpr);
          break;
        }
      }

      // ==========================================
      // 3. STANDALONE ELECTRIC AR GUITAR
      // Positioned prominently and beautifully angled across the stage (~28°)
      // ==========================================
      const guitarCenterX = W * 0.38 + floatSway;
      const guitarCenterY = H * 0.56 + floatBob - extraPulse;
      const guitarAngle = -0.48 + Math.sin(groovePhase) * 0.035;

      ctx.save();
      ctx.translate(guitarCenterX, guitarCenterY);
      ctx.rotate(guitarAngle);

      // Guitar Scale Factor
      const sc = 1.35 * dpr;

      // Dark Solid Guitar Silhouette
      ctx.fillStyle = '#060a1d';
      ctx.beginPath();
      // Double Cutaway Electric Body
      ctx.moveTo(-52 * sc, 16 * sc);
      ctx.bezierCurveTo(-62 * sc, -12 * sc, -48 * sc, -38 * sc, -18 * sc, -30 * sc); // Upper horn
      ctx.quadraticCurveTo(0, -18 * sc, 20 * sc, -28 * sc); // Neck joint
      ctx.lineTo(20 * sc, -8 * sc);
      ctx.bezierCurveTo(46 * sc, -14 * sc, 58 * sc, 15 * sc, 30 * sc, 36 * sc); // Lower horn
      ctx.bezierCurveTo(10 * sc, 48 * sc, -30 * sc, 44 * sc, -52 * sc, 16 * sc);
      ctx.closePath();
      ctx.fill();

      // Outer Neon Body Outline (Electric Magenta / Pink Bevel)
      drawNeonPath(() => {
        ctx.moveTo(-52 * sc, 16 * sc);
        ctx.bezierCurveTo(-62 * sc, -12 * sc, -48 * sc, -38 * sc, -18 * sc, -30 * sc);
        ctx.quadraticCurveTo(0, -18 * sc, 20 * sc, -28 * sc);
        ctx.lineTo(20 * sc, -8 * sc);
        ctx.bezierCurveTo(46 * sc, -14 * sc, 58 * sc, 15 * sc, 30 * sc, 36 * sc);
        ctx.bezierCurveTo(10 * sc, 48 * sc, -30 * sc, 44 * sc, -52 * sc, 16 * sc);
      }, '#ec4899', '#ffffff', 4.0 * dpr, 14 * dpr);

      // Inner Cream Pickguard
      drawNeonPath(() => {
        ctx.moveTo(-34 * sc, 12 * sc);
        ctx.quadraticCurveTo(-14 * sc, -15 * sc, 10 * sc, -18 * sc);
        ctx.lineTo(10 * sc, 10 * sc);
        ctx.quadraticCurveTo(-8 * sc, 26 * sc, -34 * sc, 12 * sc);
      }, '#f97316', '#fbbf24', 2.6 * dpr, 8 * dpr);

      // Pickups (3 Neon bars)
      drawNeonPath(() => {
        for (let p = 0; p < 3; p++) {
          const py = -10 * sc + p * (10 * sc);
          ctx.moveTo(-12 * sc, py);
          ctx.lineTo(8 * sc, py);
        }
      }, '#00f5ff', '#ffffff', 2.4 * dpr, 6 * dpr);

      // Volume / Tone Knobs
      drawNeonPath(() => {
        ctx.arc(-22 * sc, 20 * sc, 3 * sc, 0, Math.PI * 2);
        ctx.arc(-10 * sc, 26 * sc, 3 * sc, 0, Math.PI * 2);
      }, '#fbbf24', '#ffffff', 2.0 * dpr, 5 * dpr);

      // Guitar Neck (Extending upwards to right)
      const neckLen = 170 * sc;
      const neckW = 14 * sc;
      drawNeonPath(() => {
        ctx.moveTo(20 * sc, -20 * sc);
        ctx.lineTo(20 * sc + neckLen, -20 * sc);
        ctx.lineTo(20 * sc + neckLen, -20 * sc + neckW);
        ctx.lineTo(20 * sc, -20 * sc + neckW);
      }, '#f97316', '#fbbf24', 3.0 * dpr, 10 * dpr);

      // Frets (1 to 10)
      for (let f = 1; f <= 10; f++) {
        const fx = 20 * sc + f * (neckLen * 0.092);
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
        ctx.lineWidth = 1.2 * dpr;
        ctx.beginPath();
        ctx.moveTo(fx, -20 * sc);
        ctx.lineTo(fx, -20 * sc + neckW);
        ctx.stroke();
      }

      // Headstock with Tuning Pegs
      const hsX = 20 * sc + neckLen;
      const hsY = -20 * sc;
      drawNeonPath(() => {
        ctx.moveTo(hsX, hsY);
        ctx.lineTo(hsX + 24 * sc, hsY - 6 * sc);
        ctx.lineTo(hsX + 34 * sc, hsY + 6 * sc);
        ctx.lineTo(hsX, hsY + neckW);
        // Pegs
        ctx.moveTo(hsX + 6 * sc, hsY - 6 * sc); ctx.lineTo(hsX + 6 * sc, hsY - 14 * sc);
        ctx.moveTo(hsX + 15 * sc, hsY - 7 * sc); ctx.lineTo(hsX + 15 * sc, hsY - 15 * sc);
        ctx.moveTo(hsX + 24 * sc, hsY - 4 * sc); ctx.lineTo(hsX + 24 * sc, hsY - 12 * sc);
      }, '#ec4899', '#ffffff', 2.8 * dpr, 10 * dpr);

      // ArUco Marker on Headstock (AR Guitar Webcam Detection Target)
      const mSize = 16 * sc;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(hsX + 3 * sc, hsY - 3 * sc, mSize, mSize);
      ctx.fillStyle = '#000000';
      ctx.fillRect(hsX + 5 * sc, hsY - 1 * sc, 4 * sc, 4 * sc);
      ctx.fillRect(hsX + 11 * sc, hsY - 1 * sc, 4 * sc, 4 * sc);
      ctx.fillRect(hsX + 8 * sc, hsY + 4 * sc, 6 * sc, 4 * sc);
      ctx.fillRect(hsX + 5 * sc, hsY + 7 * sc, 5 * sc, 4 * sc);

      // Glowing Neon Tracking Reticle
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2.0 * dpr;
      ctx.shadowColor = '#10b981';
      ctx.shadowBlur = 10 * dpr;
      ctx.strokeRect(hsX + 1 * sc, hsY - 5 * sc, mSize + 4 * sc, mSize + 4 * sc);
      ctx.fillStyle = '#10b981';
      ctx.font = `bold ${8 * dpr}px monospace`;
      ctx.fillText('[ID:42 LOCKED]', hsX, hsY - 8 * sc);
      ctx.shadowBlur = 0;

      // ==========================================
      // 4. 6 HOLOGRAPHIC VIRTUAL STRINGS
      // Running from bridge to headstock with harmonic vibration
      // ==========================================
      for (let s = 0; s < 6; s++) {
        const sy = -19 * sc + s * (neckW / 5.2);
        const vibAmp = stringVibrationsRef.current[s] || 0;
        stringVibrationsRef.current[s] = Math.max(0, vibAmp - 0.22);

        ctx.beginPath();
        ctx.moveTo(-35 * sc, sy);

        const freq = 0.06;
        const phase = t * 35 + s;
        for (let x = -35 * sc; x <= hsX; x += 12 * sc) {
          const dy = vibAmp > 0.3 ? Math.sin(x * freq + phase) * (vibAmp * sc * 0.25) : 0;
          ctx.lineTo(x, sy + dy);
        }

        if (vibAmp > 0.8) {
          ctx.strokeStyle = '#ffffff';
          ctx.shadowColor = '#fbbf24';
          ctx.shadowBlur = 12 * dpr;
          ctx.lineWidth = 2.4 * dpr;
        } else {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.shadowColor = '#00f5ff';
          ctx.shadowBlur = 5 * dpr;
          ctx.lineWidth = 1.2 * dpr;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // ==========================================
      // 5. GOLDEN STRUM SWEEPS OVER PICKUPS
      // ==========================================
      const strumZoneX = -4 * sc;
      let strumZoneY = 0;

      if (isStrumActive) {
        const ev = STRUM_EVENTS.find(e => Math.abs(t - e.time) <= 0.3) || STRUM_EVENTS[0];
        const dt = t - ev.time;
        const p = Math.max(0, Math.min(1, (dt + 0.15) / 0.45));
        if (ev.dir.includes('UP')) {
          strumZoneY = 16 * sc - p * (32 * sc);
        } else {
          strumZoneY = -16 * sc + p * (32 * sc);
        }
      } else {
        strumZoneY = Math.sin(groovePhase) * (5 * sc);
      }

      // Check strum trigger at exact instant
      for (let i = 0; i < STRUM_EVENTS.length; i++) {
        const ev = STRUM_EVENTS[i];
        if (t >= ev.time && t < ev.time + 0.12 && lastStrumTriggerRef.current !== i) {
          lastStrumTriggerRef.current = i;
          const m = ctx.getTransform();
          const globalStrumX = m.a * strumZoneX + m.c * strumZoneY + m.e;
          const globalStrumY = m.b * strumZoneX + m.d * strumZoneY + m.f;
          triggerStrum(ev, W, H, { x: globalStrumX, y: globalStrumY });
          break;
        }
      }
      if (t < 0.2) lastStrumTriggerRef.current = -1;

      // Golden Strum Ribbon Arc
      if (isStrumActive) {
        ctx.save();
        const ribbonGrad = ctx.createLinearGradient(
          strumZoneX - 22 * sc, strumZoneY - 22 * sc,
          strumZoneX + 16 * sc, strumZoneY + 16 * sc
        );
        ribbonGrad.addColorStop(0, 'rgba(251, 191, 36, 0)');
        ribbonGrad.addColorStop(0.5, 'rgba(245, 158, 11, 0.7)');
        ribbonGrad.addColorStop(1, 'rgba(255, 255, 255, 0.98)');

        ctx.strokeStyle = ribbonGrad;
        ctx.lineWidth = 14 * dpr;
        ctx.lineCap = 'round';
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 20 * dpr;
        ctx.beginPath();
        ctx.arc(-4 * sc, 0, 26 * sc, -0.7, 1.7);
        ctx.stroke();
        ctx.restore();
      }

      // Golden Guitar Pick
      ctx.fillStyle = '#fbbf24';
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur = 10 * dpr;
      ctx.beginPath();
      ctx.moveTo(strumZoneX - 4 * sc, strumZoneY - 3 * sc);
      ctx.lineTo(strumZoneX + 9 * sc, strumZoneY + 8 * sc);
      ctx.lineTo(strumZoneX - 2 * sc, strumZoneY + 11 * sc);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.restore(); // end guitar

      // ==========================================
      // 6. GOLDEN PARTICLES & NOTES
      // ==========================================
      const keptParticles = [];
      for (const p of particlesRef.current) {
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= p.decay;
        p.rotation += p.rotSpeed;

        if (p.alpha > 0.04) {
          ctx.save();
          ctx.globalAlpha = p.alpha;
          ctx.fillStyle = p.color;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 8 * dpr;

          if (p.isStar) {
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);
            ctx.beginPath();
            ctx.moveTo(0, -p.size * 2 * dpr);
            ctx.quadraticCurveTo(0, 0, p.size * 2 * dpr, 0);
            ctx.quadraticCurveTo(0, 0, 0, p.size * 2 * dpr);
            ctx.quadraticCurveTo(0, 0, -p.size * 2 * dpr, 0);
            ctx.quadraticCurveTo(0, 0, 0, -p.size * 2 * dpr);
            ctx.fill();
          } else {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * dpr, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
          keptParticles.push(p);
        }
      }
      particlesRef.current = keptParticles;

      // Floating Neon Music Notes
      const notes = ['♪', '♫', '♬'];
      for (let n = 0; n < 3; n++) {
        const noteProgress = ((t * 0.45 + n * 0.33) % 1.0);
        const noteX = W * 0.65 + Math.sin(noteProgress * Math.PI * 4 + n) * (24 * dpr);
        const noteY = H * 0.65 - noteProgress * (H * 0.50);
        const noteAlpha = Math.sin(noteProgress * Math.PI) * 0.85;

        ctx.save();
        ctx.globalAlpha = noteAlpha;
        ctx.fillStyle = n === 0 ? '#fbbf24' : (n === 1 ? '#00f5ff' : '#ec4899');
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 12 * dpr;
        ctx.font = `bold ${18 * dpr}px sans-serif`;
        ctx.fillText(notes[n], noteX, noteY);
        ctx.restore();
      }

      // ==========================================
      // 7. CHORD BADGE POPUP OVERLAY
      // ==========================================
      if (activeChordBadgeRef.current) {
        const badge = activeChordBadgeRef.current;
        const age = (now - badge.createdAt) / 1000;
        if (age < 1.1) {
          const badgeAlpha = age < 0.8 ? 1.0 : (1.1 - age) / 0.3;
          const bounceScale = Math.max(1.0, 1.25 - age * 0.6);

          ctx.save();
          ctx.globalAlpha = badgeAlpha;
          ctx.translate(W * 0.78, H * 0.36);
          ctx.scale(bounceScale, bounceScale);

          // Dark Neon Container
          ctx.fillStyle = 'rgba(10, 15, 30, 0.9)';
          ctx.strokeStyle = badge.color;
          ctx.lineWidth = 2.2 * dpr;
          ctx.shadowColor = badge.color;
          ctx.shadowBlur = 16 * dpr;
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(-62 * dpr, -24 * dpr, 124 * dpr, 48 * dpr, 12 * dpr);
          } else {
            ctx.rect(-62 * dpr, -24 * dpr, 124 * dpr, 48 * dpr);
          }
          ctx.fill();
          ctx.stroke();

          // Chord Name
          ctx.fillStyle = '#ffffff';
          ctx.font = `bold ${16 * dpr}px monospace`;
          ctx.textAlign = 'center';
          ctx.fillText(badge.name, 0, -4 * dpr);

          // Sub-bonus
          ctx.fillStyle = badge.color;
          ctx.font = `bold ${10 * dpr}px sans-serif`;
          ctx.fillText(badge.bonus, 0, 14 * dpr);

          ctx.restore();
        } else {
          activeChordBadgeRef.current = null;
        }
      }

      ctx.restore(); // Final restore

      if (running) {
        animFrameRef.current = requestAnimationFrame(render);
      }
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      running = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  const togglePlay = () => {
    if (isPlaying) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      pauseOffsetRef.current = (performance.now() - (startTimeRef.current || performance.now())) % 5000;
      setIsPlaying(false);
    } else {
      startTimeRef.current = performance.now() - pauseOffsetRef.current;
      setIsPlaying(true);
    }
  };

  const handleReplay = () => {
    startTimeRef.current = performance.now();
    pauseOffsetRef.current = 0;
    lastStrumTriggerRef.current = -1;
    particlesRef.current = [];
    if (!isPlaying) setIsPlaying(true);
  };

  const toggleAudio = async () => {
    if (!isAudioEnabled) {
      try {
        await guitarAudio.ensureAudioContext();
        if (guitarAudio.isMuted) guitarAudio.setMuted(false);
        if (guitarAudio.volume < 0.2) guitarAudio.setVolume(0.85);
        await guitarAudio.loadInstrumentSoundfont('acoustic');
      } catch {}
      setIsAudioEnabled(true);
    } else {
      setIsAudioEnabled(false);
    }
  };

  return (
    <div style={{
      position: 'relative',
      borderRadius: '16px',
      overflow: 'hidden',
      background: 'rgba(6, 8, 20, 0.98)',
      border: '1px solid rgba(0, 245, 255, 0.35)',
      boxShadow: '0 10px 40px rgba(0, 0, 0, 0.65), 0 0 30px rgba(0, 245, 255, 0.15)',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* 270px Height Canvas Viewport */}
      <div style={{ position: 'relative', width: '100%', height: '270px', overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            cursor: 'pointer'
          }}
          onClick={togglePlay}
          title="Click to pause or play animation"
        />

        {/* Floating Quick Action Overlay */}
        <div style={{
          position: 'absolute',
          bottom: '12px',
          right: '12px',
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          background: 'rgba(10, 15, 30, 0.85)',
          backdropFilter: 'blur(8px)',
          padding: '4px 8px',
          borderRadius: '8px',
          border: '1px solid rgba(0, 245, 255, 0.25)'
        }}>
          {/* Audio Strum Toggle */}
          <button
            type="button"
            onClick={toggleAudio}
            style={{
              background: isAudioEnabled ? 'rgba(245, 158, 11, 0.25)' : 'rgba(255, 255, 255, 0.05)',
              border: `1px solid ${isAudioEnabled ? '#f59e0b' : 'rgba(255, 255, 255, 0.1)'}`,
              borderRadius: '6px',
              padding: '4px 8px',
              color: isAudioEnabled ? '#fbbf24' : 'var(--text-secondary)',
              fontSize: '11px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontWeight: 600,
              transition: 'all 0.15s ease'
            }}
            title={isAudioEnabled ? 'Mute Strum Audio' : 'Unmute Real Guitar Strum Audio'}
          >
            {isAudioEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
            <span>{isAudioEnabled ? 'Sound ON' : 'Sound OFF'}</span>
          </button>

          {/* Replay */}
          <button
            type="button"
            onClick={handleReplay}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '6px',
              padding: '4px 6px',
              color: '#ffffff',
              fontSize: '11px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Replay from start (0.0s)"
          >
            <RotateCcw size={12} />
          </button>

          {/* Play/Pause */}
          <button
            type="button"
            onClick={togglePlay}
            style={{
              background: 'rgba(0, 245, 255, 0.15)',
              border: '1px solid rgba(0, 245, 255, 0.4)',
              borderRadius: '6px',
              padding: '4px 6px',
              color: '#00f5ff',
              fontSize: '11px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={12} /> : <Play size={12} />}
          </button>
        </div>

        {/* 5-Second Looping Progress Indicator Bar */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '3px',
          background: 'rgba(255, 255, 255, 0.1)'
        }}>
          <div style={{
            height: '100%',
            width: `${(currentTimeSec / 5.0) * 100}%`,
            background: 'linear-gradient(90deg, #00f5ff, #ec4899, #fbbf24)',
            boxShadow: '0 0 10px #00f5ff'
          }} />
        </div>
      </div>

      {/* Sub-banner: Customer Value Hook */}
      <div style={{
        padding: '10px 16px',
        background: 'rgba(10, 15, 30, 0.75)',
        borderTop: '1px solid rgba(0, 245, 255, 0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '15px' }}>⚡</span>
          <span style={{ fontSize: '12px', color: '#e2e8f0', fontWeight: 500 }}>
            <strong style={{ color: '#00f5ff' }}>Webcam + Paper = Instant Guitar Rockstar.</strong> Level 1 auto-plays chords as you strum along!
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{
            fontSize: '10px',
            fontFamily: 'var(--font-mono)',
            color: '#00f5ff',
            background: 'rgba(0, 245, 255, 0.12)',
            border: '1px solid rgba(0, 245, 255, 0.35)',
            borderRadius: '4px',
            padding: '2px 6px'
          }}>
            {currentTimeSec.toFixed(1)}s / 5.0s Loop
          </span>
        </div>
      </div>
    </div>
  );
}
