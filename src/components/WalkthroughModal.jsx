import { useState } from 'react';
import { X, ChevronRight, ChevronLeft, Award, Music, Sparkles, Download, CheckCircle, Volume2, HelpCircle } from 'lucide-react';
import { guitarAudio } from '../utils/guitar_audio';
import ARGuitarHeroAnimation from './ARGuitarHeroAnimation';

const CHAPTERS = [
  {
    id: 'overview',
    badge: '1. The Setup',
    title: 'Play Guitar Anywhere With Just Your Webcam & Paper',
    subtitle: 'Zero expensive guitar gear required. Perfect for complete beginners learning their first songs.',
    color: '#38bdf8',
    icon: Sparkles,
    content: {
      highlights: [
        'Print our free 1:1 practice neck on standard A4 paper or cardboard.',
        'Hold it up to your laptop or phone camera — our 3D vision solver anchors 6 virtual strings in real time.',
        'Strum with your right hand and fret with your left hand, hearing authentic acoustic & electric guitar tones.'
      ],
      tip: 'Tip: You can use standard lighting. Turn on "✨ Smooth" in the toolbar for rock-steady hand tracking without jitter.',
      actionText: 'Next: How Level 1 Makes Playing Easy ➔'
    }
  },
  {
    id: 'level1',
    badge: '2. Beginner Auto-Chord',
    title: 'Level 1: Strum In Time — Chords Play Automatically!',
    subtitle: 'Never played a guitar before? No problem. Focus 100% on strumming rhythm while you learn.',
    color: '#fbbf24',
    icon: Award,
    content: {
      highlights: [
        '⭐ Level 1 (Auto-Chord) is designed specifically for brand-new learners.',
        'The app automatically plays the correct song chords for you as you play along.',
        'All you have to do is hold your strumming hand up and sweep across the strings in time with the song highway.',
        'Every strum sounds rich, clean, and in key, training your musical ear and right-hand timing.'
      ],
      tip: 'Tip: Try strumming downwards on beat 1 and 3, or follow the moving strum arrows on the highway.',
      actionText: 'Next: The Song Highway ➔'
    }
  },
  {
    id: 'highway',
    badge: '3. Song Highway',
    title: 'Guitar Hero-Style Play-Along Highway & Backing Tracks',
    subtitle: 'Interactive scrolling chords with synchronized live drums and bass backing tracks.',
    color: '#a855f7',
    icon: Music,
    content: {
      highlights: [
        'Open the Song Studio to choose from classic hits (4-Chord Pop, Folk Anthems, Rock Riffs, and Blues).',
        'Chords stream smoothly down the 3D track toward the golden strum line.',
        'Real drum and bass audio syncs to the tempo, giving you a full band backing you up.',
        'Score points, build combos, and get real-time feedback on your timing!'
      ],
      tip: 'Tip: Use the tempo slider (BPM) in Song Studio to slow down challenging songs while you practice.',
      actionText: 'Next: Level 2 & 3 Progression ➔'
    }
  },
  {
    id: 'progression',
    badge: '4. Progressive Mastery',
    title: 'Level 2 (Assist) & Level 3 (Pro Realism)',
    subtitle: 'Gradually learn real chord fingerings at your own pace without frustration.',
    color: '#22c55e',
    icon: CheckCircle,
    content: {
      highlights: [
        '🎯 Level 2 (Assist): Ready to use your left hand? Place your fingers near the target fret/string. If you are close enough (within ±1 fret or adjacent string), the app awards you the chord!',
        '🔥 Level 3 (Pro Realism): Full physical guitar simulation. Every individual string vibrates only if your fingers press the exact fret.',
        'Switch between levels at any time with a single click on the ⭐ Level button.'
      ],
      tip: 'Tip: Color-coded rings highlight your fingers: Index (Cyan), Middle (Green), Ring (Purple), Pinky (Pink).',
      actionText: 'Next: Print Your Practice Neck ➔'
    }
  },
  {
    id: 'neck',
    badge: '5. Practice Neck',
    title: 'Get Your Physical Practice Neck (PDF / SVG)',
    subtitle: 'Cut, fold, and play in under 2 minutes.',
    color: '#ec4899',
    icon: Download,
    content: {
      highlights: [
        'The practice neck has calibrated ArUco markers that let our computer vision solver calculate guitar 3D position.',
        'Printed at 100% scale on A4 or Letter paper.',
        'Glue it to a cereal box or cardboard strip for rigidity so it feels like a real guitar neck in your hands.',
        'Play silently with headphones or let your speakers rock out!'
      ],
      tip: 'Tip: Click "Print Practice Neck" below to open the printable 1:1 scale template immediately.',
      actionText: 'Ready! Start Playing 🚀'
    }
  }
];

export default function WalkthroughModal({ isOpen, onClose, onStartCamera, onOpenSongStudio }) {
  const [currentStep, setCurrentStep] = useState(0);
  const chapter = CHAPTERS[currentStep];

  if (!isOpen) return null;

  const handleNext = () => {
    if (currentStep < CHAPTERS.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      onClose();
      if (onStartCamera) onStartCamera();
      if (onOpenSongStudio) onOpenSongStudio();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const DEMO_CHORDS = {
    G: {
      name: 'G Major',
      short: 'G',
      quality: 'major',
      frettedStrings: { 1: 3, 5: 2, 6: 3 },
      mutedStrings: []
    },
    Em: {
      name: 'E Minor',
      short: 'Em',
      quality: 'minor',
      frettedStrings: { 4: 2, 5: 2 },
      mutedStrings: []
    }
  };

  const playDemoChord = async (chordName = 'G') => {
    try {
      await guitarAudio.ensureAudioContext();
      if (guitarAudio.isMuted) {
        guitarAudio.setMuted(false);
      }
      if (guitarAudio.volume < 0.2) {
        guitarAudio.setVolume(0.85);
      }
      const chordObj = DEMO_CHORDS[chordName];
      if (chordObj) {
        await guitarAudio.strumChord(chordObj, 'DOWN ↓', 0.88);
      }
    } catch (err) {
      console.error('Error playing demo chord:', err);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(5, 7, 15, 0.85)',
      backdropFilter: 'blur(10px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '16px'
    }}>
      <div style={{
        background: '#0d1322',
        border: '1px solid rgba(255, 255, 255, 0.16)',
        borderRadius: '16px',
        width: '100%',
        maxWidth: '740px',
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 40px rgba(56, 189, 248, 0.15)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        maxHeight: '90vh'
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(15, 23, 42, 0.7)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{
              background: 'linear-gradient(135deg, #38bdf8, #818cf8)',
              padding: '6px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff'
            }}>
              <HelpCircle size={18} />
            </span>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>
                Beginner Play-Along Guide
              </h3>
              <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-secondary)' }}>
                Learn how to play songs with AR Guitar in under 60 seconds
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: 'none',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
              cursor: 'pointer'
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Progress Navigation Bar */}
        <div style={{
          display: 'flex',
          padding: '8px 16px',
          gap: '6px',
          background: 'rgba(15, 23, 42, 0.4)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          overflowX: 'auto'
        }}>
          {CHAPTERS.map((ch, idx) => {
            const isActive = idx === currentStep;
            return (
              <button
                key={ch.id}
                onClick={() => setCurrentStep(idx)}
                style={{
                  flex: 1,
                  minWidth: '95px',
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: isActive ? `1px solid ${ch.color}` : '1px solid rgba(255, 255, 255, 0.08)',
                  background: isActive ? `${ch.color}22` : 'rgba(255, 255, 255, 0.03)',
                  color: isActive ? ch.color : 'var(--text-secondary)',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease'
                }}
              >
                <span>{ch.badge.split('.')[0]}.</span>
                <span>{ch.badge.split(' ')[1]}</span>
              </button>
            );
          })}
        </div>

        {/* Chapter Body */}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' }}>
          {/* 5-Second Groovy Cartoon AR Guitar Hero Animation */}
          <ARGuitarHeroAnimation />

          <div>
            <span style={{
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              color: chapter.color,
              background: `${chapter.color}20`,
              padding: '3px 8px',
              borderRadius: '4px',
              fontWeight: 'bold',
              textTransform: 'uppercase'
            }}>
              {chapter.badge}
            </span>
            <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#fff', margin: '8px 0 4px 0' }}>
              {chapter.title}
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
              {chapter.subtitle}
            </p>
          </div>

          {/* Highlights Box */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '10px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}>
            {chapter.content.highlights.map((h, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '13px', color: '#e2e8f0', lineHeight: 1.5 }}>
                <span style={{ color: chapter.color, marginTop: '2px', flexShrink: 0 }}>•</span>
                <span>{h}</span>
              </div>
            ))}
          </div>

          {/* Interactive Audio Preview */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.8), rgba(30, 41, 59, 0.6))',
            border: `1px solid ${chapter.color}40`,
            borderRadius: '10px',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px'
          }}>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>
              <span style={{ fontWeight: 'bold', color: chapter.color }}>Audio Preview:</span> Strum acoustic G & Em chords right now
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => playDemoChord('G')}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  border: '1px solid rgba(245, 158, 11, 0.5)',
                  background: 'rgba(245, 158, 11, 0.15)',
                  color: '#fbbf24',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <Volume2 size={12} /> Strum G Major
              </button>
              <button
                type="button"
                onClick={() => playDemoChord('Em')}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  border: '1px solid rgba(56, 189, 248, 0.5)',
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <Volume2 size={12} /> Strum E Minor
              </button>
            </div>
          </div>

          {/* Pro Tip Callout */}
          <div style={{
            fontSize: '12px',
            color: '#94a3b8',
            fontStyle: 'italic',
            borderLeft: `2px solid ${chapter.color}`,
            paddingLeft: '10px'
          }}>
            {chapter.content.tip}
          </div>
        </div>

        {/* Footer Navigation */}
        <div style={{
          padding: '16px 20px',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          background: 'rgba(15, 23, 42, 0.7)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <a
              href="/neck/index.html"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '7px 12px',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
                borderRadius: '6px',
                border: '1px solid rgba(236, 72, 153, 0.4)',
                background: 'rgba(236, 72, 153, 0.12)',
                color: '#f472b6',
                textDecoration: 'none',
                cursor: 'pointer'
              }}
              title="Print your 1:1 physical guitar practice neck template"
            >
              <Download size={13} />
              <span>Print Practice Neck (PDF)</span>
            </a>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {currentStep > 0 && (
              <button
                type="button"
                onClick={handlePrev}
                style={{
                  padding: '7px 14px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: 'var(--text-secondary)',
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <ChevronLeft size={14} /> Back
              </button>
            )}

            <button
              type="button"
              onClick={handleNext}
              className="btn-premium"
              style={{
                padding: '7px 18px',
                fontSize: '12px',
                gap: '6px',
                cursor: 'pointer'
              }}
            >
              <span>{chapter.content.actionText}</span>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
