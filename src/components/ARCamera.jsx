import { useEffect, useRef, useState } from 'react';
import { Play, Square, Video, Sliders, Maximize2, Minimize2, Volume2, VolumeX, Compass, Settings, Cpu, Music, Camera, SwitchCamera, Activity, Copy, Check, X, Award } from 'lucide-react';
import { detectMarkers, DETECTOR_CONFIG } from '../utils/aruco_detector';
import {
  getNeckGeometry,
  getPerpAt,
  calculateFretAndStringFromGeometry,
  getFretPositionAndWidth,
  createCameraMats,
  solvePose,
  FRETS_FOR_DRAWING,
  FRET_ABSOLUTE_DISTANCES_FROM_NUT,
  ARUCO_MARKER_MAP
} from '../utils/guitar_math';
import { getStreamCameraInfo, getCalibrationFor, scaleCalibration, CALIBRATION_CHANGED_EVENT } from '../utils/camera_calibration';
import CameraCalibrationPanel from './CameraCalibrationPanel';
import { detectChordFromFingers, createChordSmoother } from '../utils/chord_detector';
import { guitarAudio, GUITAR_INSTRUMENTS } from '../utils/guitar_audio';
import { stereoTracker } from '../utils/stereo_tracker';
import SongHighway from './SongHighway';
import RecorderPanel from './RecorderPanel';
import { SessionRecorder, saveRecordingFiles, buildFrameRecord, round1, round3 } from '../utils/session_recorder';
import { songEngine, getPlayableChordObject, isChordCloseEnough } from '../utils/song_engine';

// Resolution presets for webcam capture
const RESOLUTION_PRESETS = {
  '720p':  { width: 1280, height: 720,  label: '720p HD' },
  '480p':  { width: 640,  height: 480,  label: '480p VGA' },
  '1080p': { width: 1920, height: 1080, label: '1080p FHD' }
};

// Detect if running on a mobile device/tablet (which physically has front and back cameras)
const isMobileDevice = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isTouchMac = /Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1; // iPad Pro
  return /Android|iPhone|iPad|iPod/i.test(ua) || isTouchMac;
};

// Configuration for all 5 fingers of the fretting hand
const FRET_FINGERS = [
  { id: 'thumb',  name: 'Thumb',  num: 'T', tipIdx: 4,  dipIdx: 3,  color: '#f59e0b', ringColor: 'rgba(245, 158, 11, 0.95)', path: [0, 1, 2, 3, 4] },
  { id: 'index',  name: 'Index',  num: '1', tipIdx: 8,  dipIdx: 7,  color: '#38bdf8', ringColor: 'rgba(56, 189, 248, 0.95)', path: [0, 5, 6, 7, 8] },
  { id: 'middle', name: 'Middle', num: '2', tipIdx: 12, dipIdx: 11, color: '#22c55e', ringColor: 'rgba(34, 197, 94, 0.95)', path: [0, 9, 10, 11, 12] },
  { id: 'ring',   name: 'Ring',   num: '3', tipIdx: 16, dipIdx: 15, color: '#a855f7', ringColor: 'rgba(168, 85, 247, 0.95)', path: [0, 13, 14, 15, 16] },
  { id: 'pinky',  name: 'Pinky',  num: '4', tipIdx: 20, dipIdx: 19, color: '#ec4899', ringColor: 'rgba(236, 72, 153, 0.95)', path: [0, 17, 18, 19, 20] }
];

export default function ARCamera({
  openCvLoaded,
  onStatusUpdate,
  onMediaPipeLoaded,
  addLog,
  cameraSize = '1000',
  onCameraSizeChange,
  showSongStudio = false,
  onToggleSongStudio
}) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const processingCanvasRef = useRef(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [mediaPipeLoaded, setMediaPipeLoaded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);

  // Performance cache refs
  const cameraMatsRef = useRef({ width: 0, height: 0, camMatrix: null, distCoef: null });
  const lastStatusUpdateTimeRef = useRef(0);
  const lastFpsUpdateTimeRef = useRef(0);
  const [fps, setFps] = useState(60);

  // Hardware acceleration diagnostics
  const [mpDelegate, setMpDelegate] = useState('Detecting...');
  const [mpError, setMpError] = useState(null);
  const [mpDelegatePreference, setMpDelegatePreference] = useState(() => {
    return localStorage.getItem('arguitar_mp_delegate') || 'GPU';
  });
  const mpDelegatePreferenceRef = useRef(mpDelegatePreference);
  useEffect(() => {
    mpDelegatePreferenceRef.current = mpDelegatePreference;
    localStorage.setItem('arguitar_mp_delegate', mpDelegatePreference);
  }, [mpDelegatePreference]);
  const [gpuInfo] = useState(() => {
    try {
      const glCanvas = document.createElement('canvas');
      const gl = glCanvas.getContext('webgl2') || glCanvas.getContext('webgl');
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        return { supported: true, renderer: renderer || 'WebGL Active', isWebGL2: !!glCanvas.getContext('webgl2') };
      }
      return { supported: false, renderer: 'WebGL Unsupported' };
    } catch {
      return { supported: false, renderer: 'Unavailable' };
    }
  });
  const [showProfiler, setShowProfiler] = useState(() => {
    return localStorage.getItem('arguitar_show_profiler') === 'true';
  });
  const showProfilerRef = useRef(showProfiler);
  useEffect(() => {
    showProfilerRef.current = showProfiler;
    localStorage.setItem('arguitar_show_profiler', showProfiler ? 'true' : 'false');
  }, [showProfiler]);

  const [copiedReport, setCopiedReport] = useState(false);

  // ArUco session recorder (raw camera video + per-frame detection metrics for offline analysis)
  const [recorder] = useState(() => new SessionRecorder());
  const [recSupported] = useState(() => SessionRecorder.isSupported());
  const [showRecorder, setShowRecorder] = useState(false);
  const [recState, setRecState] = useState('idle'); // 'idle' | 'recording' | 'saving' | 'done'
  const [recLiveStats, setRecLiveStats] = useState(null);
  const [recResult, setRecResult] = useState(null);
  const [recError, setRecError] = useState(null);

  const [perfTimings, setPerfTimings] = useState({
    copy: '0',
    aruco: '0',
    mp: '0',
    math: '0',
    render: '0',
    total: '0',
    fps: 0,
    fpsAvg: 0,
    res: '',
    procRes: '',
    markers: 0,
    hands: 0
  });
  const perfTimingsRef = useRef({
    copy: '0',
    aruco: '0',
    mp: '0',
    math: '0',
    render: '0',
    total: '0',
    fps: 0,
    fpsAvg: 0,
    res: '',
    procRes: '',
    markers: 0,
    hands: 0
  });
  const perfSamplesRef = useRef({
    copy: [],
    aruco: [],
    mp: [],
    math: [],
    render: [],
    total: [],
    fps: []
  });

  const handleCopyReport = async () => {
    const totalMs = parseFloat(perfTimings.total) || 0;
    const target30Budget = 33.3;
    const headroom30 = (target30Budget - totalMs).toFixed(1);

    const report = [
      `### 🎸 ARGuitar Performance Benchmark Report`,
      `- **Device Platform**: ${navigator.userAgent}`,
      `- **Viewport**: ${window.innerWidth}x${window.innerHeight} (DPR: ${window.devicePixelRatio || 1})`,
      `- **CPU Cores**: ${navigator.hardwareConcurrency || 'N/A'}`,
      `- **GPU Renderer**: ${gpuInfo.renderer || 'Standard'}`,
      `- **MediaPipe Delegate**: ${mpDelegate}${mpError ? ` (${mpError})` : ''}`,
      `- **Webcam Stream**: ${perfTimings.res || captureResolution} (Processing: ${perfTimings.procRes || '640x360'})`,
      `- **Average FPS**: ${perfTimings.fpsAvg || fps} FPS (Live: ${fps} FPS)`,
      `- **Tracked**: ${perfTimings.markers} markers, ${perfTimings.hands} hand(s)`,
      ``,
      `#### Pipeline Latency Breakdown (Averaged over 30 frames):`,
      `- ⏱️ **Total Frame Time**: ${perfTimings.total} ms ${totalMs <= target30Budget ? `(✅ Within 30 FPS budget, ${headroom30}ms headroom)` : `(⚠️ Exceeds 30 FPS budget by ${Math.abs(headroom30)}ms)`}`,
      `  * 📸 **Video Copy & Pixel Read**: ${perfTimings.copy} ms`,
      `  * 🔍 **OpenCV ArUco (WASM)**: ${perfTimings.aruco} ms`,
      `  * 🤖 **MediaPipe Hand Inference**: ${perfTimings.mp} ms`,
      `  * 📐 **Neck Geometry & Chords**: ${perfTimings.math} ms`,
      `  * 🎨 **Canvas 2D Rendering**: ${perfTimings.render} ms`
    ].join('\n');

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(report);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = report;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 2500);
    } catch (e) {
      console.warn("Failed to copy report:", e);
    }
  };

  // Audio state (persisted in localStorage)
  const [audioEnabled, setAudioEnabled] = useState(() => {
    const saved = localStorage.getItem('arguitar_audio_enabled');
    return saved !== null ? saved === 'true' : true;
  });
  useEffect(() => {
    localStorage.setItem('arguitar_audio_enabled', audioEnabled.toString());
    guitarAudio.setMuted(!audioEnabled);
  }, [audioEnabled]);

  // Strum mode: 'smart' (Smart Depth Gate), 'down' (Downstrokes Only), 'both' (Alternating Down & Up)
  const [strumMode, setStrumMode] = useState(() => {
    return localStorage.getItem('arguitar_strum_mode') || 'smart';
  });
  const strumModeRef = useRef(strumMode);
  useEffect(() => {
    strumModeRef.current = strumMode;
    localStorage.setItem('arguitar_strum_mode', strumMode);
  }, [strumMode]);

  // Song Play-Along Level: 1 = Beginner (Auto-Chord), 2 = Intermediate (Assist / Close Enough), 3 = Pro (Realistic)
  const [playLevel, setPlayLevel] = useState(() => {
    return songEngine.playLevel || 1;
  });
  const playLevelRef = useRef(playLevel);
  useEffect(() => {
    playLevelRef.current = playLevel;
    songEngine.setPlayLevel(playLevel);
  }, [playLevel]);

  // Guitar Sound Instrument: 'acoustic', 'electric_clean', 'distortion'
  const [guitarInstrument, setGuitarInstrument] = useState(() => {
    return guitarAudio.currentInstrument || 'acoustic';
  });
  const handleInstrumentChange = async (instId) => {
    setGuitarInstrument(instId);
    await guitarAudio.setInstrument(instId);
  };

  // Palm Mute (tight staccato decay + dampening)
  const [isPalmMuted, setIsPalmMuted] = useState(() => guitarAudio.isPalmMuted);
  useEffect(() => {
    guitarAudio.onPalmMuteChange = (muted) => setIsPalmMuted(muted);
    return () => {
      guitarAudio.onPalmMuteChange = null;
    };
  }, []);

  // Sync playLevel and recommendedTone with external songEngine events
  useEffect(() => {
    const unsubscribe = songEngine.subscribe((eventType, payload) => {
      if (eventType === 'levelChange') {
        setPlayLevel(payload.level);
      } else if (eventType === 'songChange' && payload.song?.recommendedTone) {
        handleInstrumentChange(payload.song.recommendedTone);
      }
    });
    return () => unsubscribe();
  }, []);

  // Camera capture resolution: '720p' (default), '480p', '1080p'
  const [captureResolution, setCaptureResolution] = useState(() => {
    return localStorage.getItem('arguitar_capture_res') || '720p';
  });
  const captureResolutionRef = useRef(captureResolution);
  useEffect(() => {
    captureResolutionRef.current = captureResolution;
    localStorage.setItem('arguitar_capture_res', captureResolution);
  }, [captureResolution]);

  // AR Ghost Frets toggle
  const [showGhostFrets, setShowGhostFrets] = useState(() => {
    return localStorage.getItem('arguitar_ghost_frets') !== 'false';
  });
  const showGhostFretsRef = useRef(showGhostFrets);
  useEffect(() => {
    showGhostFretsRef.current = showGhostFrets;
    localStorage.setItem('arguitar_ghost_frets', showGhostFrets ? 'true' : 'false');
  }, [showGhostFrets]);

  // Live Marker Alignment & Ray Tracing Debugger toggle
  const [showMarkerDebug, setShowMarkerDebug] = useState(() => {
    return localStorage.getItem('arguitar_marker_debug') === 'true';
  });
  const showMarkerDebugRef = useRef(showMarkerDebug);
  useEffect(() => {
    showMarkerDebugRef.current = showMarkerDebug;
    localStorage.setItem('arguitar_marker_debug', showMarkerDebug ? 'true' : 'false');
  }, [showMarkerDebug]);

  // Camera facing mode ('user' for front/selfie, 'environment' for back) & device selection
  const [facingMode, setFacingMode] = useState(() => {
    const saved = localStorage.getItem('arguitar_facing_mode');
    if (saved) {
      // Desktop Mac/PC webcams do not have an 'environment' camera; auto-heal back to 'user'
      if (!isMobileDevice() && saved === 'environment') {
        localStorage.setItem('arguitar_facing_mode', 'user');
        return 'user';
      }
      return saved;
    }
    return 'user';
  });
  const facingModeRef = useRef(facingMode);
  useEffect(() => {
    facingModeRef.current = facingMode;
    localStorage.setItem('arguitar_facing_mode', facingMode);
  }, [facingMode]);

  const [selectedDeviceId, setSelectedDeviceId] = useState(() => {
    return localStorage.getItem('arguitar_camera_device_id') || '';
  });
  const selectedDeviceIdRef = useRef(selectedDeviceId);
  useEffect(() => {
    selectedDeviceIdRef.current = selectedDeviceId;
    if (selectedDeviceId) {
      localStorage.setItem('arguitar_camera_device_id', selectedDeviceId);
    } else {
      localStorage.removeItem('arguitar_camera_device_id');
    }
  }, [selectedDeviceId]);

  const [availableCameras, setAvailableCameras] = useState([]);

  // Stereo 3D (Dual-Camera) tracking
  const [stereoEnabled, setStereoEnabled] = useState(() => {
    return localStorage.getItem('arguitar_stereo_enabled') === 'true';
  });
  const stereoEnabledRef = useRef(stereoEnabled);
  useEffect(() => {
    stereoEnabledRef.current = stereoEnabled;
    localStorage.setItem('arguitar_stereo_enabled', stereoEnabled ? 'true' : 'false');
  }, [stereoEnabled]);

  const [secondaryDeviceId, setSecondaryDeviceId] = useState(() => {
    return localStorage.getItem('arguitar_secondary_cam') || '';
  });
  const secondaryDeviceIdRef = useRef(secondaryDeviceId);
  useEffect(() => {
    secondaryDeviceIdRef.current = secondaryDeviceId;
    if (secondaryDeviceId) {
      localStorage.setItem('arguitar_secondary_cam', secondaryDeviceId);
    } else {
      localStorage.removeItem('arguitar_secondary_cam');
    }
  }, [secondaryDeviceId]);

  const [stereoStatus, setStereoStatus] = useState({ calibrated: false, baseline: '0', angle: '0', liveClearance: null });
  const [strumOffset, setStrumOffset] = useState(() => stereoTracker.strumPlaneOffsetCm);
  const [showPip, setShowPip] = useState(true);

  // Per-camera intrinsic calibration
  const [showCalibration, setShowCalibration] = useState(false);
  const isCalibratingRef = useRef(false);
  const calibVersionRef = useRef(0);
  const [calibStatus, setCalibStatus] = useState({ cam1: false, cam2: false });
  useEffect(() => {
    isCalibratingRef.current = showCalibration;
  }, [showCalibration]);
  useEffect(() => {
    const onCalibChanged = () => {
      // Force camera matrices to be rebuilt and stereo extrinsics to be re-estimated with the new intrinsics
      calibVersionRef.current++;
      stereoTracker.reset();
    };
    window.addEventListener(CALIBRATION_CHANGED_EVENT, onCalibChanged);
    return () => window.removeEventListener(CALIBRATION_CHANGED_EVENT, onCalibChanged);
  }, []);

  /** Build OpenCV camera matrices for a stream, using that camera's stored calibration if available. */
  const buildCameraMats = (cv, videoEl, w, h) => {
    const info = getStreamCameraInfo(videoEl);
    const scaled = scaleCalibration(getCalibrationFor(info), w, h);
    const mats = createCameraMats(cv, w, h, scaled);
    return { width: w, height: h, calibVersion: calibVersionRef.current, ...mats };
  };
  const secondaryVideoRef = useRef(null);
  const secondaryCanvasRef = useRef(null);
  const pipCanvasRef = useRef(null);
  const secondaryCameraMatsRef = useRef({ width: 0, height: 0, camMatrix: null, distCoef: null });
  const fullMarkerPosesRef = useRef({});
  const lastStereoStatusUpdateRef = useRef(0);
  const secMarkerFrameCountRef = useRef(0);
  const cachedSecHandLandmarksRef = useRef(null);
  const lastSecDetectedMarkersRef = useRef([]);
  const lastLiveClearanceRef = useRef({ cm: null, time: 0 });

  const [isMirrored, setIsMirrored] = useState(facingMode !== 'environment');
  const isMirroredRef = useRef(isMirrored);
  useEffect(() => {
    isMirroredRef.current = isMirrored;
  }, [isMirrored]);

  const enumerateCameras = async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      setAvailableCameras(videoDevices);
    } catch (err) {
      console.warn("Could not enumerate video devices:", err);
    }
  };

  useEffect(() => {
    let active = true;
    if (navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then(devices => {
        if (active) {
          setAvailableCameras(devices.filter(d => d.kind === 'videoinput'));
        }
      }).catch(err => {
        console.warn("Could not enumerate video devices:", err);
      });

      const onDeviceChange = () => {
        navigator.mediaDevices.enumerateDevices().then(devices => {
          if (active) {
            setAvailableCameras(devices.filter(d => d.kind === 'videoinput'));
          }
        }).catch(err => {
          console.warn("Could not enumerate video devices:", err);
        });
      };

      navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
      return () => {
        active = false;
        navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
      };
    }
    return () => {
      active = false;
    };
  }, []);

  // Helper to draw text in readable orientation (cancels horizontal flip when mirrored)
  const drawUnmirroredText = (ctx, text, x, y, options = {}) => {
    const {
      font = '12px monospace',
      fillStyle = '#fff',
      align = 'center',
      baseline = 'middle'
    } = options;

    ctx.save();
    ctx.font = font;
    ctx.fillStyle = fillStyle;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;

    ctx.translate(x, y);
    if (isMirroredRef.current) {
      ctx.scale(-1, 1);
    }

    ctx.fillText(text, 0, 0);
    ctx.restore();
  };

  // Sync fullscreen state with browser events (handles Esc key too)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
      setIsFullscreen(isFull);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    const elem = containerRef.current;
    if (!elem) return;
    try {
      const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
      if (!isFull) {
        if (elem.requestFullscreen) {
          await elem.requestFullscreen();
        } else if (elem.webkitRequestFullscreen) {
          await elem.webkitRequestFullscreen();
        } else if (elem.msRequestFullscreen) {
          await elem.msRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
          await document.msExitFullscreen();
        }
      }
    } catch (err) {
      console.error("Fullscreen toggle error:", err);
    }
  };
  const [neckWidthScale, setNeckWidthScale] = useState(() => {
    const saved = localStorage.getItem('arguitar_neck_width');
    return saved ? parseFloat(saved) : 1.6;
  });
  const neckWidthScaleRef = useRef(neckWidthScale);
  useEffect(() => {
    neckWidthScaleRef.current = neckWidthScale;
    localStorage.setItem('arguitar_neck_width', neckWidthScale.toString());
  }, [neckWidthScale]);

  const [fretScaleLength, setFretScaleLength] = useState(() => {
    const saved = localStorage.getItem('arguitar_fret_scale');
    const val = saved ? parseFloat(saved) : 51.9;
    // Migrate previous uncalibrated 49.6cm to calibrated 51.9cm baseline
    return (val === 49.6 || !saved) ? 51.9 : val;
  });
  const fretScaleLengthRef = useRef(fretScaleLength);
  useEffect(() => {
    fretScaleLengthRef.current = fretScaleLength;
    localStorage.setItem('arguitar_fret_scale', fretScaleLength.toString());
  }, [fretScaleLength]);

  const loopRef = useRef(null);
  const landmarkerRef = useRef(null);
  const secLandmarkerRef = useRef(null);
  const loadingRef = useRef(false);
  const lastTimeRef = useRef(0);
  const lastLoggedIdsRef = useRef("");
  const lastDiagTimeRef = useRef(0);

  // Strumming and picking tracking refs
  const lastStrumStateRef = useRef({ time: 0, s: null, inZone: false });
  const strumEngineRef = useRef({
    lastTime: 0,
    lastS: null,
    lastT: null,
    lastX: null,
    lastY: null,
    inEnvelope: false,
    currentDirection: null,
    strokeStartTime: 0,
    strokeSoundedStrings: new Set(),
    lastStrokeCompleteTime: 0,
    lastDownT: null,
    lastDownTime: 0,
    lastUpTime: 0,
    isAirReset: false,
    smoothedInStrikePlane: true
  });
  const vibratingStringsRef = useRef({});
  const pickTrailRef = useRef([]);
  const activeStrumDisplayRef = useRef({ text: '', time: 0, color: '#f59e0b' });

  // Chord detection refs
  const chordSmootherRef = useRef(createChordSmoother(5, 320));
  const activeChordRef = useRef(null);

  // Mobile performance & temporal tracking cache refs
  const frameCountRef = useRef(0);
  const cachedMarkersRef = useRef([]);
  const cachedMarkersMapRef = useRef({});
  const cachedMarkerPosesRef = useRef({});
  const cachedNeckGeometryRef = useRef(null);
  const cachedDiagnosticsRef = useRef(null);
  const smoothedNeckRef = useRef(null);
  const coastFramesRef = useRef(0);

  // ---- ArUco Session Recorder handlers ----
  const handleStartRecording = async ({ label, recordOverlay, recordAudio = false, recordMic = false }) => {
    setRecError(null);
    const video = videoRef.current;
    const stream = video?.srcObject;
    if (!stream || !video.videoWidth) {
      setRecError('Camera is not running yet.');
      return;
    }
    const track = stream.getVideoTracks()[0];
    let trackSettings = {};
    try {
      trackSettings = track?.getSettings ? track.getSettings() : {};
    } catch {
      // Some browsers throw on getSettings for virtual cameras
    }
    const width = video.videoWidth;
    const height = video.videoHeight;
    const meta = {
      app: 'ARGuitar_WASM',
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio || 1,
      video: { width, height },
      track: { label: track?.label || '', settings: trackSettings },
      settings: {
        captureResolution: captureResolutionRef.current,
        neckWidthScale: neckWidthScaleRef.current,
        fretScaleLength: fretScaleLengthRef.current,
        mirroredDisplay: isMirroredRef.current,
        facingMode: facingModeRef.current,
        mpDelegate
      },
      calibration: {
        calibrated: !!cameraMatsRef.current.isCalibrated,
        camMatrix: cameraMatsRef.current.camMatrix ? Array.from(cameraMatsRef.current.camMatrix.data64F) : null,
        matrixResolution: { width: cameraMatsRef.current.width, height: cameraMatsRef.current.height },
        distCoef: cameraMatsRef.current.distArr || null,
        solvePoseMarkerSideCm: 3.1
      },
      markerMap: ARUCO_MARKER_MAP,
      fretDistancesFromNutCm: FRET_ABSOLUTE_DISTANCES_FROM_NUT,
      detector: DETECTOR_CONFIG,
      coordinateNotes: 'markers[].c, neck points and fingers are full-resolution video pixels (un-mirrored). cands[].c are processing-canvas pixels: multiply by proc.sx / proc.sy for video pixels.'
    };
    // Optional audio: app output (song + strummed notes) and/or microphone voice-over
    let audioHandle = null;
    let micNotice = null;
    if (recordAudio || recordMic) {
      let micStream = null;
      if (recordMic) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: false
          });
        } catch (e) {
          micNotice = `Microphone unavailable (${e.name || e.message}); recording without voice.`;
        }
      }
      try {
        audioHandle = await guitarAudio.startRecordingAudio(micStream, !!recordAudio);
      } catch (e) {
        micStream?.getTracks().forEach(t => t.stop());
        micNotice = `Audio capture failed (${e.message}); recording video only.`;
      }
    }

    try {
      recorder.start({
        stream, meta, label, recordOverlay, width, height,
        audioStream: audioHandle?.stream || null,
        onStopAudio: audioHandle?.stop || null,
        audioInfo: audioHandle ? { app: !!recordAudio, mic: !!recordMic && !micNotice } : null
      });
      setRecResult(null);
      setRecLiveStats(recorder.liveStats());
      setRecState('recording');
      if (micNotice) setRecError(micNotice);
      if (addLog) addLog(`⏺️ Recording started: ${recorder.name}${audioHandle ? ' (with audio)' : ''}`);
    } catch (e) {
      audioHandle?.stop();
      setRecError(e.message);
    }
  };

  const handleStopRecording = async () => {
    if (!recorder.isRecording) return;
    setRecState('saving');
    try {
      const result = await recorder.stop();
      if (!result) {
        setRecState('idle');
        return;
      }
      const save = await saveRecordingFiles(result.files);
      setRecResult({ name: result.name, summary: result.summary, save });
      setRecState('done');
      setShowRecorder(true);
      if (addLog) addLog(`💾 Recording saved (${save.mode === 'server' ? 'recordings/' : 'downloads'}): ${result.name}`);
    } catch (e) {
      setRecError(`Save failed: ${e.message}`);
      setRecState('idle');
    }
  };

  const handleMarkEvent = (note) => recorder.addEvent(note || 'mark');

  const handleResetRecorder = () => {
    // Release object URLs from the previous session's download links
    recResult?.save?.items?.forEach(item => item.url && URL.revokeObjectURL(item.url));
    setRecResult(null);
    setRecError(null);
    setRecState('idle');
  };

  // Keyboard shortcut: "M" marks an event while recording (ignored while typing in inputs)
  useEffect(() => {
    if (recState !== 'recording') return;
    const onKeyDown = (e) => {
      if (e.key !== 'm' && e.key !== 'M') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      const ev = recorder.addEvent('mark (M key)');
      if (ev && addLog) addLog(`🚩 Event marked at ${(ev.t / 1000).toFixed(1)}s`);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [recState, recorder, addLog]);

  // Stop any in-flight recording if the component unmounts
  useEffect(() => {
    return () => {
      if (recorder.isRecording) recorder.stop();
    };
  }, [recorder]);

  // Secondary camera stream management for Stereo 3D tracking
  const startSecondaryCamera = async (deviceId) => {
    try {
      if (!deviceId) return;
      console.log(`[Stereo] Requesting secondary camera (deviceId: ${deviceId})...`);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          aspectRatio: { ideal: 16 / 9 },
          frameRate: { ideal: 30 }
        }
      });
      if (secondaryVideoRef.current) {
        secondaryVideoRef.current.srcObject = stream;
        await secondaryVideoRef.current.play();
        console.log('[Stereo] Secondary camera stream started successfully');
        if (addLog) addLog("👓 Secondary camera feed active for Stereo 3D");
        ensureSecLandmarker();
      }
    } catch (e) {
      console.warn('[Stereo] Failed to start secondary camera:', e);
      if (addLog) addLog(`⚠️ Stereo secondary camera error: ${e.message}`);
    }
  };

  const ensureSecLandmarker = async () => {
    if (secLandmarkerRef.current) return;
    const { FilesetResolver, HandLandmarker } = window;
    if (!FilesetResolver || !HandLandmarker) return;
    try {
      console.log("[Stereo] Initializing dedicated HandLandmarker for Camera 2 (isolated CPU delegate)...");
      const vision = await FilesetResolver.forVisionTasks(window.location.origin + "/wasm");
      const resp = await fetch(window.location.origin + "/hand_landmarker.task");
      const buf = new Uint8Array(await resp.arrayBuffer());

      // Protect against Emscripten collisions
      const tempModule = window.Module;
      if (window.Module) {
        window.Module = undefined;
      }

      // CPU delegate ensures Camera 1 has 100% exclusive access to WebGL without texture or state conflicts
      secLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetBuffer: buf,
          delegate: "CPU"
        },
        runningMode: "VIDEO",
        numHands: 2, // Track both fretting and strumming hands so neither shadows the other
        minHandDetectionConfidence: 0.45,
        minHandPresenceConfidence: 0.45,
        minTrackingConfidence: 0.45
      });

      if (tempModule && !window.Module) {
        window.Module = tempModule;
      }

      console.log("[Stereo] Dedicated Camera 2 HandLandmarker READY on CPU!");
      if (addLog) addLog("👓 Cam 2 hand tracker ready (isolated CPU pipeline)");
    } catch (e) {
      console.warn("[Stereo] Error initializing Cam 2 landmarker:", e);
    }
  };

  const stopSecondaryCamera = () => {
    if (secondaryVideoRef.current?.srcObject) {
      secondaryVideoRef.current.srcObject.getTracks().forEach(t => t.stop());
      secondaryVideoRef.current.srcObject = null;
    }
    if (secLandmarkerRef.current) {
      try {
        secLandmarkerRef.current.close();
      } catch (e) {}
      secLandmarkerRef.current = null;
    }
    cachedSecHandLandmarksRef.current = null;
    lastSecDetectedMarkersRef.current = [];
    stereoTracker.reset();
    setStereoStatus({ calibrated: false, baseline: '0', angle: '0', liveClearance: null });
    lastLiveClearanceRef.current = { cm: null, time: 0 };
  };

  useEffect(() => {
    if (cameraActive && stereoEnabled && secondaryDeviceId) {
      startSecondaryCamera(secondaryDeviceId);
    } else {
      stopSecondaryCamera();
    }
    return () => {
      stopSecondaryCamera();
    };
  }, [cameraActive, stereoEnabled, secondaryDeviceId]);

  // Auto-select a 2nd camera when stereo is turned on if none is selected
  useEffect(() => {
    if (stereoEnabled && availableCameras.length >= 2 && !secondaryDeviceId) {
      const other = availableCameras.find(c => c.deviceId !== selectedDeviceId);
      if (other?.deviceId) {
        setSecondaryDeviceId(other.deviceId);
      }
    }
  }, [stereoEnabled, availableCameras, selectedDeviceId, secondaryDeviceId]);

  // Helper to obtain media stream with progressive multi-tier fallback
  // Prevents 'Requested device not found' on Mac Mini / external USB webcams that lack facingMode metadata
  const getCameraStream = async (resConfig, deviceId, facing) => {
    const isMobile = isMobileDevice();

    // Tier 1: If specific deviceId was selected, try that device first
    if (deviceId) {
      try {
        console.log(`[Camera] Tier 1: Requesting deviceId "${deviceId}" (${resConfig.label})...`);
        return await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { ideal: deviceId },
            width: { ideal: resConfig.width },
            height: { ideal: resConfig.height },
            frameRate: { ideal: 30 }
          }
        });
      } catch (e1) {
        console.warn(`[Camera] Tier 1 (deviceId) failed: ${e1.name}: ${e1.message}`);
      }
    }

    // Tier 2: Try facingMode on mobile or when facing is explicitly requested
    if (facing && (isMobile || facing === 'user')) {
      try {
        console.log(`[Camera] Tier 2: Requesting facingMode "${facing}" (${resConfig.label})...`);
        return await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: resConfig.width },
            height: { ideal: resConfig.height },
            frameRate: { ideal: 30 }
          }
        });
      } catch (e2) {
        console.warn(`[Camera] Tier 2 (facingMode) failed: ${e2.name}: ${e2.message}`);
      }
    }

    // Tier 3: Standard unconstrained resolution preset (works 100% on Mac Mini & desktop webcams)
    try {
      console.log(`[Camera] Tier 3: Requesting standard unconstrained resolution (${resConfig.label}: ${resConfig.width}x${resConfig.height})...`);
      return await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: resConfig.width },
          height: { ideal: resConfig.height },
          frameRate: { ideal: 30 }
        }
      });
    } catch (e3) {
      console.warn(`[Camera] Tier 3 (unconstrained) failed: ${e3.name}: ${e3.message}`);
    }

    // Tier 4: Absolute bare fallback (any available camera feed)
    console.log('[Camera] Tier 4: Bare video fallback { video: true }');
    return await navigator.mediaDevices.getUserMedia({ video: true });
  };

  // Start webcam feed with camera device & facing mode support
  const startCamera = async (
    targetRes = captureResolutionRef.current,
    targetDeviceId = selectedDeviceIdRef.current,
    targetFacing = facingModeRef.current
  ) => {
    try {
      const resKey = (typeof targetRes === 'string' && RESOLUTION_PRESETS[targetRes])
        ? targetRes
        : captureResolutionRef.current;
      const deviceId = (typeof targetDeviceId === 'string') ? targetDeviceId : selectedDeviceIdRef.current;
      const facing = (typeof targetFacing === 'string') ? targetFacing : facingModeRef.current;

      const resConfig = RESOLUTION_PRESETS[resKey] || RESOLUTION_PRESETS['720p'];
      console.log(`Requesting webcam access (${resConfig.label}: ${resConfig.width}x${resConfig.height})...`);
      if (addLog) addLog(`Requesting webcam access (${resConfig.label})...`);

      const stream = await getCameraStream(resConfig, deviceId, facing);

      console.log(`Webcam access granted! (${resConfig.label})`);
      if (addLog) addLog(`Webcam access granted! (${resConfig.label})`);

      // Determine active camera settings from the video track
      const track = stream.getVideoTracks()[0];
      if (track) {
        const settings = track.getSettings ? track.getSettings() : {};
        const activeFacing = settings.facingMode;
        if (activeFacing) {
          setFacingMode(activeFacing);
          facingModeRef.current = activeFacing;
          setIsMirrored(activeFacing !== 'environment');
        } else {
          // External/desktop webcam without facingMode metadata
          if (!isMobileDevice() && facingModeRef.current === 'environment') {
            setFacingMode('user');
            facingModeRef.current = 'user';
            localStorage.setItem('arguitar_facing_mode', 'user');
          }
          setIsMirrored(facingModeRef.current !== 'environment');
        }

        if (settings.deviceId) {
          setSelectedDeviceId(settings.deviceId);
          selectedDeviceIdRef.current = settings.deviceId;
        }
      }

      // Enumerate devices now that permission has unlocked camera labels
      await enumerateCameras();

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();

        // Prime Web Audio on user gesture
        if (audioEnabled) {
          guitarAudio.ensureAudioContext();
        }

        // Lazy-load MediaPipe HandLandmarker when webcam starts BEFORE starting the heavy frame processing loop
        await initMediaPipe();

        setCameraActive(true);
        if (onStatusUpdate) {
          onStatusUpdate(`Camera Active (${resConfig.label}) | Initializing tracking...`, null);
        }
      }
    } catch (err) {
      console.error("Error accessing webcam:", err);
      let userMsg = err.message;
      if (err.name === 'NotFoundError' || err.message?.toLowerCase().includes('not found')) {
        userMsg = "No webcam detected. Please ensure your camera is plugged in and recognized by your system.";
      } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        userMsg = "Webcam permission denied. Please allow camera access in your browser address bar or OS System Settings.";
      }
      if (addLog) addLog("❌ Webcam Error: " + userMsg);
      alert(userMsg);
    }
  };

  const handleResolutionChange = async (newRes) => {
    setCaptureResolution(newRes);
    if (cameraActive) {
      stopCamera();
      setTimeout(() => {
        startCamera(newRes);
      }, 160);
    }
  };

  const handleCameraChange = async (newDeviceIdOrFacing) => {
    const wasActive = cameraActive;
    if (wasActive) {
      stopCamera();
    }

    if (newDeviceIdOrFacing === 'user' || newDeviceIdOrFacing === 'environment') {
      setSelectedDeviceId('');
      selectedDeviceIdRef.current = '';
      setFacingMode(newDeviceIdOrFacing);
      facingModeRef.current = newDeviceIdOrFacing;
      const shouldMirror = newDeviceIdOrFacing !== 'environment';
      setIsMirrored(shouldMirror);
      localStorage.setItem('arguitar_facing_mode', newDeviceIdOrFacing);
      localStorage.removeItem('arguitar_camera_device_id');
      if (wasActive) {
        setTimeout(() => {
          startCamera(captureResolutionRef.current, '', newDeviceIdOrFacing);
        }, 160);
      }
    } else {
      setSelectedDeviceId(newDeviceIdOrFacing);
      selectedDeviceIdRef.current = newDeviceIdOrFacing;
      localStorage.setItem('arguitar_camera_device_id', newDeviceIdOrFacing);

      // Inspect selected camera label to determine front vs rear orientation
      const camObj = availableCameras.find(c => c.deviceId === newDeviceIdOrFacing);
      if (camObj && camObj.label) {
        const lbl = camObj.label.toLowerCase();
        if (lbl.includes('back') || lbl.includes('rear') || lbl.includes('environment')) {
          setFacingMode('environment');
          facingModeRef.current = 'environment';
          setIsMirrored(false);
        } else {
          setFacingMode('user');
          facingModeRef.current = 'user';
          setIsMirrored(true);
        }
      }

      if (wasActive) {
        setTimeout(() => {
          startCamera(captureResolutionRef.current, newDeviceIdOrFacing);
        }, 160);
      }
    }
  };

  const handleFlipCamera = async () => {
    const nextFacing = facingModeRef.current === 'user' ? 'environment' : 'user';
    await handleCameraChange(nextFacing);
  };

  // Stop webcam feed
  const stopCamera = () => {
    stopSecondaryCamera();
    // Finalise and save any in-progress recording before the camera tracks are torn down
    if (recorder.isRecording) {
      handleStopRecording();
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setCameraActive(false);

      if (loopRef.current) {
        cancelAnimationFrame(loopRef.current);
        loopRef.current = null;
      }

      chordSmootherRef.current.reset();
      activeChordRef.current = null;
      cachedMarkersRef.current = [];
      cachedMarkersMapRef.current = {};
      cachedMarkerPosesRef.current = {};
      cachedNeckGeometryRef.current = null;
      cachedDiagnosticsRef.current = null;
      smoothedNeckRef.current = null;
      coastFramesRef.current = 0;
      frameCountRef.current = 0;

      if (addLog) addLog("Camera stopped.");
      if (onStatusUpdate) {
        onStatusUpdate('Camera offline. Press "Start Camera" to begin.', null);
      }
    }
  };

  const handleToggleMpDelegate = async () => {
    const nextDelegate = mpDelegate === 'GPU' ? 'CPU' : 'GPU';
    setMpDelegatePreference(nextDelegate);
    mpDelegatePreferenceRef.current = nextDelegate;
    localStorage.setItem('arguitar_mp_delegate', nextDelegate);

    if (landmarkerRef.current) {
      try {
        landmarkerRef.current.close();
      } catch (e) {
        console.warn("Error closing landmarker:", e);
      }
      landmarkerRef.current = null;
      setMediaPipeLoaded(false);
      await initMediaPipe(nextDelegate);
    }
  };

  // Initialize MediaPipe Hand Landmarker standalone async function
  const initMediaPipe = async (requestedDelegate = mpDelegatePreferenceRef.current) => {
    const { FilesetResolver, HandLandmarker } = window;
    if (!FilesetResolver || !HandLandmarker) {
      console.error("MediaPipe is not loaded globally on window yet.");
      if (addLog) addLog("❌ MediaPipe Error: Library not ready on window.");
      return;
    }
    if (landmarkerRef.current) {
      console.log("MediaPipe HandLandmarker already loaded.");
      return;
    }
    if (loadingRef.current) {
      console.log("MediaPipe HandLandmarker loading in progress.");
      return;
    }
    loadingRef.current = true;
    try {
      console.log(`Loading MediaPipe Landmarker in ARCamera (preferred: ${requestedDelegate})...`);
      if (addLog) addLog(`MediaPipe Init: Starting (${requestedDelegate})...`);
      await new Promise(resolve => setTimeout(resolve, 500));

      console.log("MediaPipe Init: Resolving local assets via FilesetResolver...");
      if (addLog) addLog("MediaPipe Init: Resolving local assets...");
      const vision = await FilesetResolver.forVisionTasks(
        window.location.origin + "/wasm"
      );
      console.log("MediaPipe Init: Local assets resolved!", vision);
      if (addLog) addLog("MediaPipe Init: Local assets resolved!");
      await new Promise(resolve => setTimeout(resolve, 200));

      console.log("MediaPipe Init: Fetching model file...");
      if (addLog) addLog("MediaPipe Init: Fetching model file...");
      const response = await fetch(window.location.origin + "/hand_landmarker.task");
      if (!response.ok) throw new Error(`Failed to fetch model file: ${response.statusText}`);
      const modelBuffer = new Uint8Array(await response.arrayBuffer());
      console.log("MediaPipe Init: Model file fetched successfully!", modelBuffer.length);
      if (addLog) addLog(`MediaPipe Init: Model file fetched! (${(modelBuffer.length / 1024 / 1024).toFixed(1)} MB)`);
      await new Promise(resolve => setTimeout(resolve, 200));

      console.log("MediaPipe Init: Creating HandLandmarker instance...");
      if (addLog) addLog("MediaPipe Init: Creating HandLandmarker instance...");
      await new Promise(resolve => setTimeout(resolve, 200));

      // Temporarily hide window.Module if it exists to prevent Emscripten collision
      const tempModule = window.Module;
      if (window.Module) {
        window.Module = undefined;
      }

      let landmarker;
      try {
        if (requestedDelegate === 'CPU') {
          console.log("MediaPipe Init: Initializing CPU delegate (WASM XNNPACK SIMD)...");
          if (addLog) addLog("MediaPipe: CPU mode (XNNPACK SIMD)");
          landmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetBuffer: modelBuffer,
              delegate: "CPU"
            },
            runningMode: "VIDEO",
            numHands: 2,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5
          });
          setMpDelegate("CPU");
          setMpError(null);
        } else {
          try {
            landmarker = await HandLandmarker.createFromOptions(vision, {
              baseOptions: {
                modelAssetBuffer: modelBuffer,
                delegate: "GPU"
              },
              runningMode: "VIDEO",
              numHands: 2,
              minHandDetectionConfidence: 0.5,
              minHandPresenceConfidence: 0.5,
              minTrackingConfidence: 0.5
            });
            setMpDelegate("GPU");
            setMpError(null);
            console.log("MediaPipe Init: HandLandmarker instance created with GPU acceleration!");
            if (addLog) addLog("MediaPipe: Hardware GPU acceleration active");
          } catch (gpuErr) {
            console.warn("MediaPipe GPU delegate failed, falling back to CPU:", gpuErr);
            setMpDelegate("CPU");
            setMpError(gpuErr?.message || "GPU initialization failed");
            if (addLog) addLog("MediaPipe: GPU unavailable (" + (gpuErr?.message || "error") + "), falling back to CPU");
            landmarker = await HandLandmarker.createFromOptions(vision, {
              baseOptions: {
                modelAssetBuffer: modelBuffer,
                delegate: "CPU"
              },
              runningMode: "VIDEO",
              numHands: 2,
              minHandDetectionConfidence: 0.5,
              minHandPresenceConfidence: 0.5,
              minTrackingConfidence: 0.5
            });
          }
        }
      } finally {
        if (tempModule) {
          window.Module = tempModule;
        }
      }
      console.log("MediaPipe Init: HandLandmarker instance created!");
      if (addLog) addLog("MediaPipe Init: HandLandmarker instance created!");

      landmarkerRef.current = landmarker;
      setMediaPipeLoaded(true);
      if (onMediaPipeLoaded) onMediaPipeLoaded(true);
      console.log("MediaPipe Hand Landmarker loaded successfully!");
      if (addLog) addLog("MediaPipe: READY!");
    } catch (err) {
      console.error("Failed to load MediaPipe Landmarker:", err);
      if (addLog) addLog("❌ MediaPipe Error: " + err.message);
      if (onMediaPipeLoaded) onMediaPipeLoaded(false);
    } finally {
      loadingRef.current = false;
    }
  };


  // Frame processing loop
  /* eslint-disable react-hooks/purity */
  const processFrame = async (timestamp) => {
    if (!videoRef.current || !canvasRef.current || !processingCanvasRef.current) {
      loopRef.current = requestAnimationFrame(processFrame);
      return;
    }

    const video = videoRef.current;
    if (video.readyState !== video.HAVE_ENOUGH_DATA || isCalibratingRef.current) {
      // Paused while the calibration panel owns the CPU
      loopRef.current = requestAnimationFrame(processFrame);
      return;
    }

    const canvas = canvasRef.current;
    const procCanvas = processingCanvasRef.current;
    const cv = window.cv;
    if (!cv) {
      loopRef.current = requestAnimationFrame(processFrame);
      return;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    const isMobile = isMobileDevice();

    // Decouple ArUco OpenCV processing canvas from full display resolution.
    // On mobile, capping the longest dimension to 480px prevents mobile GPU-to-CPU readback stalls (~25ms -> ~5ms).
    // On desktop, 960px is used for sharp marker bit sampling under natural light.
    const MAX_PROC_DIM = isMobile ? 480 : 960;
    const maxDim = Math.max(width, height);
    let procWidth = width;
    let procHeight = height;
    if (maxDim > MAX_PROC_DIM) {
      const scale = MAX_PROC_DIM / maxDim;
      procWidth = (Math.round(width * scale)) & ~1;
      procHeight = (Math.round(height * scale)) & ~1;
    }
    const scaleX = width / procWidth;
    const scaleY = height / procHeight;

    // Set sizes (only if valid)
    if (width > 0 && height > 0) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      if (procCanvas.width !== procWidth || procCanvas.height !== procHeight) {
        procCanvas.width = procWidth;
        procCanvas.height = procHeight;
      }
    }

    const tFrameStart = performance.now();

    const ctx = canvas.getContext('2d');
    const procCtx = procCanvas.getContext('2d', { willReadFrequently: true });

    // Temporal frame staggering:
    // When guitar markers are already locked on, mobile devices only need to re-detect ArUco markers every 2nd frame (15-20 Hz).
    // Fingers & strumming still update at 100% full frame rate every single frame!
    const frameIndex = frameCountRef.current++;
    const hasTrackedGuitar = cachedMarkersRef.current.length >= 2;
    const shouldScanAruco = !isMobile || !hasTrackedGuitar || (frameIndex % 2 === 0);

    let dCopy = 0;
    let dAruco = 0;
    let detectedMarkers = cachedMarkersRef.current;
    let diagnostics = cachedDiagnosticsRef.current;
    let markerPoses = cachedMarkerPosesRef.current;
    let neckGeometry = cachedNeckGeometryRef.current;
    let markers = cachedMarkersMapRef.current;

    // Session recorder bookkeeping for this frame
    const isRecording = recorder.isRecording;
    let recCandidates = null;
    let recRawNeck = null;
    let recNeckMode = 'cached';

    if (shouldScanAruco) {
      // Step A: Draw to downscaled processing canvas & extract pixels for OpenCV WASM (only when scanning ArUco!)
      // Moving drawImage inside here avoids wasting 25ms on odd frames!
      const tCopyStart = performance.now();
      procCtx.drawImage(video, 0, 0, procWidth, procHeight);
      const imgData = procCtx.getImageData(0, 0, procWidth, procHeight);
      let srcMat = cv.matFromImageData(imgData);
      dCopy = performance.now() - tCopyStart;

      // Step B: Detect ArUco markers using custom JS implementation
      const tArucoStart = performance.now();
      try {
        // Detailed per-candidate diagnostics are only collected while recording (small extra cost)
        const result = detectMarkers(cv, srcMat, { collectDetails: isRecording });
        detectedMarkers = result.markers || [];
        diagnostics = result.diagnostics;
        recCandidates = result.candidateDetails;

        // Scale detected marker coordinates back to full video stream resolution
        if (scaleX !== 1 || scaleY !== 1) {
          for (let i = 0; i < detectedMarkers.length; i++) {
            const m = detectedMarkers[i];
            if (m.corners) {
              for (let c = 0; c < m.corners.length; c++) {
                m.corners[c].x *= scaleX;
                m.corners[c].y *= scaleY;
              }
            }
            if (m.center) {
              m.center.x *= scaleX;
              m.center.y *= scaleY;
            }
          }
        }
      } catch (e) {
        console.error("Error detecting markers:", e);
      }
      srcMat.delete();

      cachedMarkersRef.current = detectedMarkers;
      cachedDiagnosticsRef.current = diagnostics;

      // Index markers by ID for fast lookup
      markers = {};
      detectedMarkers.forEach(m => {
        markers[m.id] = m;
      });
      cachedMarkersMapRef.current = markers;

      // Solve poses (3D positions) of markers for perspective correction (cached by resolution)
      markerPoses = {};
      const fullPosesCam1 = {};
      if (!cameraMatsRef.current.camMatrix || cameraMatsRef.current.width !== width || cameraMatsRef.current.height !== height ||
          cameraMatsRef.current.calibVersion !== calibVersionRef.current) {
        if (cameraMatsRef.current.camMatrix) {
          cameraMatsRef.current.camMatrix.delete();
          cameraMatsRef.current.distCoef.delete();
        }
        cameraMatsRef.current = buildCameraMats(cv, video, width, height);
        setCalibStatus(prev => prev.cam1 === cameraMatsRef.current.isCalibrated ? prev : { ...prev, cam1: cameraMatsRef.current.isCalibrated });
      }
      const { camMatrix, distCoef } = cameraMatsRef.current;

      detectedMarkers.forEach(m => {
        if (ARUCO_MARKER_MAP[m.id] !== undefined) {
          try {
            const pose = solvePose(cv, m.corners, camMatrix, distCoef);
            if (pose) {
              markerPoses[m.id] = pose.tvec; // [x, y, z]
              fullPosesCam1[m.id] = pose;
            }
          } catch (e) {
            console.error("Error solving pose for marker:", m.id, e);
          }
        }
      });
      cachedMarkerPosesRef.current = markerPoses;
      fullMarkerPosesRef.current = fullPosesCam1;

      // Secondary Camera Stereo Vision Processing
      let secDetectedMarkers = [];
      const secVideo = secondaryVideoRef.current;
      if (stereoEnabledRef.current && secVideo && secVideo.readyState >= 2 && secVideo.videoWidth > 0) {
        secMarkerFrameCountRef.current++;
        const frameIdx = secMarkerFrameCountRef.current;

        // Throttling: While aligning, scan every 2 frames. Once calibrated, scan every 45 frames (~1.5s)
        const shouldDetectSecMarkers = !stereoTracker.calibrated
          ? (frameIdx % 2 === 0)
          : (frameIdx % 45 === 0 && Object.keys(fullPosesCam1).length > 0);

        const vW = secVideo.videoWidth || 640;
        const vH = secVideo.videoHeight || 360;
        const targetW = 640;
        const targetH = Math.round(targetW * (vH / vW));

        if (shouldDetectSecMarkers) {
          if (!secondaryCanvasRef.current || secondaryCanvasRef.current.width !== targetW || secondaryCanvasRef.current.height !== targetH) {
            if (!secondaryCanvasRef.current) {
              secondaryCanvasRef.current = document.createElement('canvas');
            }
            secondaryCanvasRef.current.width = targetW;
            secondaryCanvasRef.current.height = targetH;
          }
          const secCanvas = secondaryCanvasRef.current;
          const secCtx = secCanvas.getContext('2d');
          secCtx.drawImage(secVideo, 0, 0, targetW, targetH);

          try {
            const secImgData = secCtx.getImageData(0, 0, secCanvas.width, secCanvas.height);
            let secMat = cv.matFromImageData(secImgData);
            const secRes = detectMarkers(cv, secMat, { collectDetails: false });
            secDetectedMarkers = secRes.markers || [];
            lastSecDetectedMarkersRef.current = secDetectedMarkers;
            secMat.delete();
          } catch (secErr) {
            // ignore transient frame error
          }

          if (secDetectedMarkers.length > 0) {
            if (!secondaryCameraMatsRef.current.camMatrix || secondaryCameraMatsRef.current.width !== secCanvas.width ||
                secondaryCameraMatsRef.current.height !== secCanvas.height ||
                secondaryCameraMatsRef.current.calibVersion !== calibVersionRef.current) {
              if (secondaryCameraMatsRef.current.camMatrix) {
                secondaryCameraMatsRef.current.camMatrix.delete();
                secondaryCameraMatsRef.current.distCoef.delete();
              }
              secondaryCameraMatsRef.current = buildCameraMats(cv, secVideo, secCanvas.width, secCanvas.height);
              setCalibStatus(prev => prev.cam2 === secondaryCameraMatsRef.current.isCalibrated ? prev : { ...prev, cam2: secondaryCameraMatsRef.current.isCalibrated });
            }
            const { camMatrix: scm, distCoef: sdc } = secondaryCameraMatsRef.current;

            let fullPosesCam2 = {};
            secDetectedMarkers.forEach(sm => {
              const sp = solvePose(cv, sm.corners, scm, sdc);
              if (sp) fullPosesCam2[sm.id] = sp;
            });

            // Continuously update stereo relative extrinsic calibration
            stereoTracker.updateCalibrationFromMarkers(fullPosesCam1, fullPosesCam2);

            const now = performance.now();
            if (now - lastStereoStatusUpdateRef.current > 500) {
              lastStereoStatusUpdateRef.current = now;
              const hasRecent = (now - lastLiveClearanceRef.current.time) < 1500 && lastLiveClearanceRef.current.cm !== null;
              setStereoStatus({
                calibrated: stereoTracker.calibrated,
                baseline: stereoTracker.baselineCm.toFixed(1),
                angle: stereoTracker.convergenceDeg.toFixed(1),
                liveClearance: hasRecent ? lastLiveClearanceRef.current.cm.toFixed(1) : null
              });
            }
          }
        } else {
          secDetectedMarkers = lastSecDetectedMarkersRef.current || [];
        }

        // Draw PiP thumbnail if enabled (fast GPU drawImage from HTML5 video element)
        if (showPip && pipCanvasRef.current) {
          const pCanvas = pipCanvasRef.current;
          const pCtx = pCanvas.getContext('2d');
          if (pCanvas.width !== targetW || pCanvas.height !== targetH) {
            pCanvas.width = targetW;
            pCanvas.height = targetH;
          }
          pCtx.drawImage(secVideo, 0, 0, targetW, targetH);
          secDetectedMarkers.forEach(sm => {
            if (sm.corners && sm.corners.length >= 4) {
              pCtx.strokeStyle = '#38bdf8';
              pCtx.lineWidth = 3;
              pCtx.beginPath();
              pCtx.moveTo(sm.corners[0].x, sm.corners[0].y);
              for (let i = 1; i < 4; i++) pCtx.lineTo(sm.corners[i].x, sm.corners[i].y);
              pCtx.closePath();
              pCtx.stroke();
              drawUnmirroredText(pCtx, `M${sm.id}`, sm.corners[0].x + 4, sm.corners[0].y - 6, {
                font: 'bold 16px monospace',
                fillStyle: '#f59e0b',
                align: 'left',
                baseline: 'bottom'
              });
            }
          });
        }
      }

      // Solve raw neck geometry from detected markers
      const rawNeck = getNeckGeometry(markers, neckWidthScaleRef.current, markerPoses, fretScaleLengthRef.current);
      recRawNeck = rawNeck;

      if (rawNeck) {
        recNeckMode = 'raw';
        coastFramesRef.current = 0;

        if (!smoothedNeckRef.current) {
          // Initial lock-on: start with raw geometry
          smoothedNeckRef.current = { ...rawNeck };
        } else {
          // Adaptive 1-Euro style Exponential Moving Average (EMA) filter
          // When guitar is held steady, maxMove is small (< 2.5px): use heavy smoothing (alpha 0.18) to kill jitter
          // When guitar moves quickly, maxMove is large (> 16px): snap fast (alpha 0.85) for zero lag
          const prev = smoothedNeckRef.current;
          const currentFit = rawNeck.debug ? `${rawNeck.debug.firstId}-${rawNeck.debug.lastId}` : null;
          const fitChanged = prev.fit && currentFit && prev.fit !== currentFit;

          const dStart = Math.hypot(rawNeck.start.x - prev.start.x, rawNeck.start.y - prev.start.y);
          const dEnd = Math.hypot(rawNeck.end.x - prev.end.x, rawNeck.end.y - prev.end.y);
          const maxMove = Math.max(dStart, dEnd);

          let alpha = 0.20;
          if (maxMove > 16) {
            alpha = fitChanged ? 0.35 : 0.85; // Damp sudden jumps when switching marker baseline
          } else if (maxMove > 2.5) {
            alpha = 0.20 + ((maxMove - 2.5) / 13.5) * (fitChanged ? 0.25 : 0.65);
          }

          const smoothStart = {
            x: prev.start.x + (rawNeck.start.x - prev.start.x) * alpha,
            y: prev.start.y + (rawNeck.start.y - prev.start.y) * alpha
          };
          const smoothEnd = {
            x: prev.end.x + (rawNeck.end.x - prev.end.x) * alpha,
            y: prev.end.y + (rawNeck.end.y - prev.end.y) * alpha
          };

          const sDx = smoothEnd.x - smoothStart.x;
          const sDy = smoothEnd.y - smoothStart.y;
          const sLen = Math.hypot(sDx, sDy);
          const sPerpX = sLen > 0 ? -sDy / sLen : rawNeck.perpX;
          const sPerpY = sLen > 0 ? sDx / sLen : rawNeck.perpY;

          // Smooth local perspective tilt vectors (perpNut, perpEnd)
          let smoothPerpNut = rawNeck.perpNut;
          if (prev.perpNut && rawNeck.perpNut) {
            const pnx = prev.perpNut.x + (rawNeck.perpNut.x - prev.perpNut.x) * alpha;
            const pny = prev.perpNut.y + (rawNeck.perpNut.y - prev.perpNut.y) * alpha;
            const pnLen = Math.hypot(pnx, pny);
            smoothPerpNut = pnLen > 0 ? { x: pnx / pnLen, y: pny / pnLen } : rawNeck.perpNut;
          }

          let smoothPerpEnd = rawNeck.perpEnd;
          if (prev.perpEnd && rawNeck.perpEnd) {
            const pex = prev.perpEnd.x + (rawNeck.perpEnd.x - prev.perpEnd.x) * alpha;
            const pey = prev.perpEnd.y + (rawNeck.perpEnd.y - prev.perpEnd.y) * alpha;
            const peLen = Math.hypot(pex, pey);
            smoothPerpEnd = peLen > 0 ? { x: pex / peLen, y: pey / peLen } : rawNeck.perpEnd;
          }

          const smoothNutWidth = prev.nutNeckWidth + (rawNeck.nutNeckWidth - prev.nutNeckWidth) * alpha;
          const smoothEndWidth = prev.endNeckWidth + (rawNeck.endNeckWidth - prev.endNeckWidth) * alpha;
          // Adaptive depthRatio filtering: fast tracking when tilting, rock-solid when steady
          const drTarget = Math.max(0.40, Math.min(2.20, rawNeck.depthRatio || 0.93));
          const drPrev = prev.depthRatio || 0.93;
          const drDelta = drTarget - drPrev;
          // When guitar moves or tilts, adapt with high responsiveness (0.25-0.45); when steady, smooth gently (0.18)
          const drAlpha = Math.abs(drDelta) > 0.08 ? Math.max(0.25, alpha) : 0.18;
          const smoothDepthRatio = Math.abs(drDelta) > 0.005 ? drPrev + drDelta * drAlpha : drPrev;

          smoothedNeckRef.current = {
            ...rawNeck,
            start: smoothStart,
            end: smoothEnd,
            dx: sDx,
            dy: sDy,
            len: sLen,
            perpX: sPerpX,
            perpY: sPerpY,
            perpNut: smoothPerpNut,
            perpEnd: smoothPerpEnd,
            nutNeckWidth: smoothNutWidth,
            endNeckWidth: smoothEndWidth,
            depthRatio: smoothDepthRatio,
            fit: currentFit
          };
        }
        neckGeometry = smoothedNeckRef.current;
        cachedNeckGeometryRef.current = neckGeometry;
      } else {
        // Markers temporarily lost (hand sweep, motion blur, reflection)
        // Temporal Coasting: Hold last known valid geometry for up to 14 frames (~450ms)
        if (smoothedNeckRef.current && coastFramesRef.current < 14) {
          coastFramesRef.current++;
          const prev = smoothedNeckRef.current;

          // If at least 1 marker is still visible, translate the neck geometry with that marker!
          let shiftX = 0, shiftY = 0;
          let hasAnchor = false;
          if (detectedMarkers.length >= 1) {
            const anchorM = detectedMarkers[0];
            const oldM = cachedMarkersMapRef.current[anchorM.id];
            if (oldM && oldM.center) {
              shiftX = anchorM.center.x - oldM.center.x;
              shiftY = anchorM.center.y - oldM.center.y;
              if (Math.hypot(shiftX, shiftY) < 35) {
                hasAnchor = true;
              }
            }
          }

          if (hasAnchor) {
            smoothedNeckRef.current = {
              ...prev,
              start: { x: prev.start.x + shiftX, y: prev.start.y + shiftY },
              end: { x: prev.end.x + shiftX, y: prev.end.y + shiftY }
            };
          }

          recNeckMode = hasAnchor ? 'coast-anchor' : 'coast';
          neckGeometry = smoothedNeckRef.current;
          cachedNeckGeometryRef.current = neckGeometry;
        } else {
          recNeckMode = 'none';
          neckGeometry = null;
          smoothedNeckRef.current = null;
          cachedNeckGeometryRef.current = null;
        }
      }
      dAruco = performance.now() - tArucoStart;
    }

    // Step C: Detect hands using MediaPipe directly from HTML5 video (zero-copy hardware buffer)
    const tMpStart = performance.now();
    let handLandmarks = null;
    let handLandmarksResults = null;
    if (mediaPipeLoaded && landmarkerRef.current) {
      try {
        handLandmarksResults = landmarkerRef.current.detectForVideo(video, timestamp);
        if (handLandmarksResults && handLandmarksResults.landmarks) {
          handLandmarks = handLandmarksResults.landmarks;
        }
      } catch (err) {
        console.error("Error in hand tracking (Cam 1):", err);
      }
    }

    // Step C-2: Detect hands in Secondary Camera (Cam 2) using DEDICATED HandLandmarker instance
    let secHandLandmarks = null;
    const secVideo = secondaryVideoRef.current;
    if (stereoEnabledRef.current && secLandmarkerRef.current && secVideo && secVideo.readyState >= 2 && secVideo.videoWidth > 0) {
      if (handLandmarks && handLandmarks.length > 0) {
        try {
          const secHandRes = secLandmarkerRef.current.detectForVideo(secVideo, timestamp);
          if (secHandRes && secHandRes.landmarks && secHandRes.landmarks.length > 0) {
            secHandLandmarks = secHandRes.landmarks;
            cachedSecHandLandmarksRef.current = secHandLandmarks;
          } else if (cachedSecHandLandmarksRef.current) {
            secHandLandmarks = cachedSecHandLandmarksRef.current;
          }
        } catch (err2) {
          // Ignore minor timestamp jitter
        }
      } else {
        cachedSecHandLandmarksRef.current = null;
      }

      // Draw detected hands on PiP canvas for instant visual confirmation
      if (showPip && pipCanvasRef.current && secHandLandmarks && secHandLandmarks.length > 0) {
        const pCanvas = pipCanvasRef.current;
        const pCtx = pCanvas.getContext('2d');
        secHandLandmarks.forEach(sHand => {
          pCtx.fillStyle = '#38bdf8';
          sHand.forEach(lm => {
            pCtx.beginPath();
            pCtx.arc(lm.x * pCanvas.width, lm.y * pCanvas.height, 2.5, 0, 2 * Math.PI);
            pCtx.fill();
          });
        });
      }
    }
    const dMp = performance.now() - tMpStart;

    // Step D: Pose & Neck Geometry & Chords & Strumming Math
    const tMathStart = performance.now();

    // Update logged IDs if they changed to prevent console spam
    const currentIdsStr = detectedMarkers.map(m => m.id).sort().join(", ");
    if (currentIdsStr !== lastLoggedIdsRef.current) {
      lastLoggedIdsRef.current = currentIdsStr;
      if (addLog) {
        addLog(`Tracked Marker IDs: [${currentIdsStr || "none"}]`);
      }
    }

    // Log diagnostics every 3 seconds if there are failures
    const now = performance.now();
    if (now - lastDiagTimeRef.current > 3000) {
      lastDiagTimeRef.current = now;
      if (diagnostics && addLog) {
        const { borderRejected, dictRejected } = diagnostics;
        if (borderRejected > 0 || dictRejected > 0) {
          addLog(`[Diag] Unresolved shapes: ${borderRejected} failed border check, ${dictRejected} failed dictionary match. (See browser console for bits)`);
        }
      }
    }

    // Calculate instantaneous FPS
    const timeDelta = (timestamp - lastTimeRef.current) / 1000;
    lastTimeRef.current = timestamp;
    const currentFps = timeDelta > 0 ? Math.round(1 / timeDelta) : 0;

    // Step E: 2D Canvas Overlay Rendering
    const tMathEnd = performance.now();
    const dMath = tMathEnd - tMathStart;
    const tRenderStart = performance.now();

    // Clear display canvas
    ctx.clearRect(0, 0, width, height);

    // 2. Process Guitar Geometry
    if (neckGeometry) {
      // Draw guitar frets, strum zone, and extended vibrating strings
      drawGuitarOnCanvas(ctx, neckGeometry);
    }

    // 3. Separate Fretting Hand (Left) and Strumming Hand (Right)
    let fretHandLandmarks = null;
    let strumHandLandmarks = null;
    let recStrumMetrics = null;

    if (handLandmarks && handLandmarks.length > 0) {
      if (handLandmarks.length === 1) {
        // If 1 hand, classify by position along guitar axis if geometry is known
        if (neckGeometry && neckGeometry.len > 0) {
          const hx = handLandmarks[0][0].x * width;
          const hy = handLandmarks[0][0].y * height;
          const t = ((hx - neckGeometry.start.x) * neckGeometry.dx + (hy - neckGeometry.start.y) * neckGeometry.dy) / (neckGeometry.len * neckGeometry.len);
          if (t > 0.82) {
            strumHandLandmarks = handLandmarks[0];
          } else {
            fretHandLandmarks = handLandmarks[0];
          }
        } else {
          fretHandLandmarks = handLandmarks[0];
        }
      } else {
        // 2 hands: Sort along the guitar axis so hand closer to body is strum hand
        if (neckGeometry && neckGeometry.len > 0) {
          const t0 = (((handLandmarks[0][0].x * width) - neckGeometry.start.x) * neckGeometry.dx + ((handLandmarks[0][0].y * height) - neckGeometry.start.y) * neckGeometry.dy) / (neckGeometry.len * neckGeometry.len);
          const t1 = (((handLandmarks[1][0].x * width) - neckGeometry.start.x) * neckGeometry.dx + ((handLandmarks[1][0].y * height) - neckGeometry.start.y) * neckGeometry.dy) / (neckGeometry.len * neckGeometry.len);
          if (t0 < t1) {
            fretHandLandmarks = handLandmarks[0];
            strumHandLandmarks = handLandmarks[1];
          } else {
            fretHandLandmarks = handLandmarks[1];
            strumHandLandmarks = handLandmarks[0];
          }
        } else {
          handLandmarks.forEach((hand, idx) => {
            const cat = handLandmarksResults?.handednesses?.[idx]?.[0]?.categoryName;
            if (cat === 'Right') strumHandLandmarks = hand;
            else fretHandLandmarks = hand;
          });
        }
      }
    }

    // 4. Calculate positions and fret/string for all 5 fingers of the fretting hand (with 3D Stereo Touch Detection)
    const trackedFingers = [];
    if (fretHandLandmarks) {
      // Find matching fretting hand in Camera 2 for 3D depth triangulation
      let secFretHand = null;
      const { camMatrix } = cameraMatsRef.current;
      const { camMatrix: scm } = secondaryCameraMatsRef.current;
      let K1 = null, K2 = null;
      const sW = secondaryCanvasRef.current?.width || 640;
      const sH = secondaryCanvasRef.current?.height || 360;

      if (stereoTracker.calibrated && secHandLandmarks && secHandLandmarks.length > 0 && camMatrix && scm) {
        K1 = {
          fx: camMatrix.doubleAt(0),
          fy: camMatrix.doubleAt(4),
          cx: camMatrix.doubleAt(2),
          cy: camMatrix.doubleAt(5)
        };
        K2 = {
          fx: scm.doubleAt(0),
          fy: scm.doubleAt(4),
          cx: scm.doubleAt(2),
          cy: scm.doubleAt(5)
        };

        // In Cam 1, fretting hand palm center is Landmark 9 (middle MCP)
        const p1 = { x: fretHandLandmarks[9].x * width, y: fretHandLandmarks[9].y * height };
        let lowestFretMiss = Infinity;

        for (const sHand of secHandLandmarks) {
          if (!sHand[9]) continue;
          const p2 = { x: sHand[9].x * sW, y: sHand[9].y * sH };
          const testTri = stereoTracker.triangulate(p1, p2, K1, K2, cameraMatsRef.current.distArr, secondaryCameraMatsRef.current.distArr);
          if (testTri && testTri.missDist < 8.0) {
            if (testTri.missDist < lowestFretMiss) {
              lowestFretMiss = testTri.missDist;
              secFretHand = sHand;
            }
          }
        }
      }

      FRET_FINGERS.forEach(cfg => {
        const tip = fretHandLandmarks[cfg.tipIdx];
        const dip = fretHandLandmarks[cfg.dipIdx] || tip;
        if (tip) {
          // Project forward along the distal phalanx (DIP -> TIP) to the true anatomical apex.
          const dx = tip.x - dip.x;
          const dy = tip.y - dip.y;
          const apexFactor = 0.25;
          const pos = {
            x: (tip.x + dx * apexFactor) * width,
            y: (tip.y + dy * apexFactor) * height
          };

          let fret = 0;
          let string = 0;
          let fretLocator = 0;

          if (neckGeometry) {
            const fretInfo = calculateFretAndStringFromGeometry(neckGeometry, pos, true);
            fret = fretInfo[0];
            string = fretInfo[1];
            fretLocator = fretInfo[2];
          }

          // True 3D Stereo Touch vs Hover Detection
          let clearanceCm = null;
          let isPressed = true;
          let isHovering = false;

          if (secFretHand && K1 && K2 && fretLocator > 0) {
            const secTip = secFretHand[cfg.tipIdx];
            const secDip = secFretHand[cfg.dipIdx] || secTip;
            if (secTip) {
              const secDx = secTip.x - secDip.x;
              const secDy = secTip.y - secDip.y;
              const secPos = {
                x: (secTip.x + secDx * apexFactor) * sW,
                y: (secTip.y + secDy * apexFactor) * sH
              };
              const fingerTri = stereoTracker.triangulate(pos, secPos, K1, K2, cameraMatsRef.current.distArr, secondaryCameraMatsRef.current.distArr);
              if (fingerTri && fingerTri.missDist <= 7.0 && fingerTri.point) {
                clearanceCm = stereoTracker.calculateFingertipClearance(
                  fingerTri.point,
                  fretLocator,
                  fullMarkerPosesRef.current
                );
                if (clearanceCm !== null) {
                  // Touching string / pressed down against fretboard: <= 1.8 cm
                  // Hovering above fretboard: > 1.8 cm
                  if (clearanceCm <= 1.8 && clearanceCm >= -4.5) {
                    isPressed = true;
                    isHovering = false;
                  } else if (clearanceCm > 1.8 && clearanceCm <= 15.0) {
                    isPressed = false;
                    isHovering = true;
                  }
                }
              }
            }
          }

          trackedFingers.push({
            ...cfg,
            pos,
            fret,
            string,
            fretLocator,
            clearanceCm,
            isPressed,
            isHovering,
            isActive: fret > 0 && string > 0 && isPressed
          });
        }
      });
    }

    // 5. Detect Left-Hand Major / Minor Chord
    const rawChord = detectChordFromFingers(trackedFingers);
    const activeChord = chordSmootherRef.current.update(rawChord, timestamp);
    activeChordRef.current = activeChord;

    // 6. Track Strumming / Picking Hand (Right Hand)
    let strumStatusDesc = '';
    if (strumHandLandmarks && neckGeometry) {
      const thumbTip = strumHandLandmarks[4];
      const indexTip = strumHandLandmarks[8];
      let pickX = 0, pickY = 0;

      if (thumbTip && indexTip) {
        pickX = ((thumbTip.x + indexTip.x) / 2) * width;
        pickY = ((thumbTip.y + indexTip.y) / 2) * height;
      } else if (indexTip) {
        pickX = indexTip.x * width;
        pickY = indexTip.y * height;
      } else if (thumbTip) {
        pickX = thumbTip.x * width;
        pickY = thumbTip.y * height;
      }

      // Add to pick motion trail
      pickTrailRef.current.push({ x: pickX, y: pickY, time: timestamp });
      if (pickTrailRef.current.length > 8) {
        pickTrailRef.current.shift();
      }

      // Draw pick motion trail
      if (pickTrailRef.current.length > 1) {
        ctx.save();
        for (let i = 1; i < pickTrailRef.current.length; i++) {
          const pt1 = pickTrailRef.current[i - 1];
          const pt2 = pickTrailRef.current[i];
          const alpha = (i / pickTrailRef.current.length) * 0.7;
          ctx.strokeStyle = `rgba(245, 158, 11, ${alpha})`;
          ctx.lineWidth = i * 0.9;
          ctx.beginPath();
          ctx.moveTo(pt1.x, pt1.y);
          ctx.lineTo(pt2.x, pt2.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Project pick position onto guitar axis using perspective-aware perp vector
      const { start, dx, dy, len, nutNeckWidth, endNeckWidth } = neckGeometry;
      const tPick = ((pickX - start.x) * dx + (pickY - start.y) * dy) / (len * len);
      const cx = start.x + tPick * dx;
      const cy = start.y + tPick * dy;
      const vPerp = getPerpAt(tPick, neckGeometry);
      const lateralDist = (pickX - cx) * vPerp.x + (pickY - cy) * vPerp.y;
      const localWidth = nutNeckWidth + tPick * (endNeckWidth - nutNeckWidth);
      const stringSpread = localWidth * 0.88;
      const sPick = ((lateralDist / (stringSpread || 1)) + 0.5) * 5 + 1; // 1.0 (High E) to 6.0 (Low E)

      // Wide motion envelope: captures fast sweeps even when starting above String 6 or finishing below String 1
      const inEnvelope = (tPick >= 0.76 && tPick <= 1.58 && sPick >= -0.8 && sPick <= 7.8);
      // Core visual strum zone boundaries
      const inStrumZone = (tPick >= 0.88 && tPick <= 1.45 && sPick >= 0.2 && sPick <= 6.8);

      // Multi-Modal Depth & Hand Signals:
      // 1. Estimate 3D guitar body depth (Marker 5 or fallback)
      let zGuitar = 70.0;
      if (markerPoses && markerPoses[5] && markerPoses[5][2] > 15) {
        zGuitar = markerPoses[5][2];
      } else if (markerPoses && markerPoses[4] && markerPoses[4][2] > 15) {
        zGuitar = markerPoses[4][2] * 1.08;
      } else if (neckGeometry.depthRatio) {
        zGuitar = 70.0 / (neckGeometry.depthRatio || 1.0);
      }

      // 2. Hand apparent physical distance via scale
      let zHand = zGuitar;
      let handSpanPx = 0;
      if (strumHandLandmarks && strumHandLandmarks[0] && strumHandLandmarks[9]) {
        const dxH = (strumHandLandmarks[9].x - strumHandLandmarks[0].x) * width;
        const dyH = (strumHandLandmarks[9].y - strumHandLandmarks[0].y) * height;
        handSpanPx = Math.hypot(dxH, dyH);
        if (handSpanPx > 10) {
          // Average adult wrist-to-middle MCP is ~9.5 cm. Scale focal length to stream resolution:
          const focalPx = 895.35 * (width / 640.0);
          zHand = (focalPx * 9.5) / handSpanPx;
        }
      }
      const deltaZ = zGuitar - zHand;

      // 3. Optical scale ratio relative to Marker 5 pixel width if visible
      let opticalScaleRatio = 1.0;
      const m5 = markers[5];
      if (m5 && m5.corners && m5.corners.length >= 4 && handSpanPx > 10) {
        const m5Width = Math.hypot(m5.corners[1].x - m5.corners[0].x, m5.corners[1].y - m5.corners[0].y);
        if (m5Width > 15) {
          opticalScaleRatio = (handSpanPx / 9.5) / (m5Width / 3.1);
        }
      }

      // 4. MediaPipe 3D Landmark relative Z (tip vs knuckles)
      // Negative z relative to knuckles indicates fingertips curled/lifted toward camera away from guitar face
      const tipZ = (((strumHandLandmarks[8]?.z ?? 0) + (strumHandLandmarks[4]?.z ?? 0)) / 2);
      const mcpZ = (((strumHandLandmarks[5]?.z ?? 0) + (strumHandLandmarks[9]?.z ?? 0)) / 2);
      const relativeTipDepth = tipZ - mcpZ;

      // ---- Smart Strum Guard: Multi-Layer Posture, Angle & Proximity Verification ----
      // Layer 1: Wrist vector alignment along guitar neck (pointing from body towards headstock)
      let handVecX = 0, handVecY = 0;
      let cosWristAngle = 0.85;
      let isWristAngleValid = true;
      let isWristPositionValid = true;
      let tWrist = 1.0;
      let sWrist = 3.5;

      if (strumHandLandmarks && strumHandLandmarks[0] && strumHandLandmarks[9]) {
        const wristPt = strumHandLandmarks[0];
        const mcpPt = strumHandLandmarks[9];
        handVecX = (mcpPt.x - wristPt.x) * width;
        handVecY = (mcpPt.y - wristPt.y) * height;
        const handVecLen = Math.hypot(handVecX, handVecY) || 1;
        const handUnitX = handVecX / handVecLen;
        const handUnitY = handVecY / handVecLen;

        // Vector along the guitar axis from Body towards Nut/Headstock:
        const vBodyToNutX = -dx / len;
        const vBodyToNutY = -dy / len;
        // In natural guitar playing, the strumming forearm rests on the body and the hand points along the body toward the headstock:
        cosWristAngle = (handUnitX * vBodyToNutX + handUnitY * vBodyToNutY);
        // Valid strumming hand points along the guitar towards the headstock (cos >= 0.20):
        isWristAngleValid = (cosWristAngle >= 0.20);

        // Wrist anchor position in guitar space:
        const wristPx = wristPt.x * width;
        const wristPy = wristPt.y * height;
        tWrist = ((wristPx - start.x) * dx + (wristPy - start.y) * dy) / (len * len);
        const cxW = start.x + tWrist * dx;
        const cyW = start.y + tWrist * dy;
        const lateralDistW = (wristPx - cxW) * vPerp.x + (wristPy - cyW) * vPerp.y;
        sWrist = ((lateralDistW / (stringSpread || 1)) + 0.5) * 5 + 1;

        // In playing position, wrist is anchored over the body (t in [0.45, 2.30]):
        isWristPositionValid = (tWrist >= 0.45 && tWrist <= 2.30);
      }

      // Multi-Camera Stereo 3D Triangulation & Single-Camera Fallback:
      let isDistanceClose = true;
      let stereoClearanceCm = null;
      let isTriangulated = false;
      let triMissDist = null;

      let secPick = null;
      if (secHandLandmarks && secHandLandmarks.length > 0) {
        const sW = secondaryCanvasRef.current?.width || 640;
        const sH = secondaryCanvasRef.current?.height || 360;

        // If multiple hands are detected in Cam 2, pair with the hand that matches
        // Cam 1's strumming hand at guitar depth with minimal ray miss distance
        let bestCandidate = null;
        let lowestScore = Infinity;

        const { camMatrix } = cameraMatsRef.current;
        const { camMatrix: scm } = secondaryCameraMatsRef.current;

        const activeGuitarPose = fullMarkerPosesRef.current?.[5] || fullMarkerPosesRef.current?.[4] || (markerPoses[5] ? { tvec: markerPoses[5] } : null);
        const zGuitarPose = activeGuitarPose?.tvec?.[2] || activeGuitarPose?.[2] || 88.0;
        const expectedDepthCm = zGuitarPose * stereoTracker.scaleFactor;

        for (const sHand of secHandLandmarks) {
          const tTip = sHand[4];
          const iTip = sHand[8];
          let cand = null;
          if (tTip && iTip) {
            cand = { x: ((tTip.x + iTip.x) / 2) * sW, y: ((tTip.y + iTip.y) / 2) * sH };
          } else if (iTip) {
            cand = { x: iTip.x * sW, y: iTip.y * sH };
          }
          if (cand && stereoTracker.calibrated && camMatrix && scm) {
            const K1 = {
              fx: camMatrix.doubleAt(0),
              fy: camMatrix.doubleAt(4),
              cx: camMatrix.doubleAt(2),
              cy: camMatrix.doubleAt(5)
            };
            const K2 = {
              fx: scm.doubleAt(0),
              fy: scm.doubleAt(4),
              cx: scm.doubleAt(2),
              cy: scm.doubleAt(5)
            };
            const testTri = stereoTracker.triangulate({ x: pickX, y: pickY }, cand, K1, K2, cameraMatsRef.current.distArr, secondaryCameraMatsRef.current.distArr);
            if (testTri) {
              const depthDiff = Math.abs(testTri.depth - expectedDepthCm);
              // Reject false cross-hand intersections (e.g. fretting hand crossing strumming hand ray)
              if (depthDiff <= 22.0 && testTri.missDist <= 6.5) {
                const score = testTri.missDist + depthDiff * 0.35;
                if (score < lowestScore) {
                  lowestScore = score;
                  bestCandidate = { pick: cand, tri: testTri };
                }
              }
            }
          }
        }

        if (bestCandidate && bestCandidate.tri && bestCandidate.tri.point) {
          secPick = bestCandidate.pick;
          triMissDist = bestCandidate.tri.missDist;
          stereoClearanceCm = stereoTracker.calculateDistanceToGuitarPlane(
            bestCandidate.tri.point,
            activeGuitarPose
          );
          // Only accept triangulated depth if clearance is within physical playing envelope (-10cm to +25cm)
          if (stereoClearanceCm !== null && stereoClearanceCm >= -10.0 && stereoClearanceCm <= 25.0) {
            isTriangulated = true;
            lastLiveClearanceRef.current = { cm: stereoClearanceCm, time: performance.now() };
          } else {
            isTriangulated = false;
            stereoClearanceCm = null;
          }
        }
      }

      // Draw matched pick point on PiP canvas for instant visual feedback
      if (showPip && pipCanvasRef.current && secPick) {
        const pCanvas = pipCanvasRef.current;
        const pCtx = pCanvas.getContext('2d');
        pCtx.save();
        pCtx.strokeStyle = isTriangulated ? '#10b981' : '#f59e0b';
        pCtx.lineWidth = 2.5;
        pCtx.beginPath();
        pCtx.arc(secPick.x, secPick.y, 8, 0, 2 * Math.PI);
        pCtx.stroke();
        pCtx.fillStyle = isTriangulated ? 'rgba(16, 185, 129, 0.4)' : 'rgba(245, 158, 11, 0.4)';
        pCtx.fill();
        pCtx.restore();
      }

      if (isTriangulated) {
        // TRUE 2-Camera Stereo Depth Algorithm:
        // Physical clearance in centimeters to string plane (zeroed at string surface):
        // Active strum zone is between -4.0 cm (through strings) and +3.5 cm (touch/skim)
        // Air hover (> +3.5 cm) is cleanly gated out!
        isDistanceClose = (stereoClearanceCm <= 3.5 && stereoClearanceCm >= -4.0);
      } else {
        // Graceful 1-Camera Algorithm:
        // Monocular optical scale ratio relative to Marker 5
        isDistanceClose = (opticalScaleRatio <= 1.70);
      }

      const isStrumPostureValid = isWristAngleValid && isWristPositionValid;

      // Master flag: Is the hand physically away from the guitar or in an obvious non-playing posture?
      const isHandAway = (!isStrumPostureValid) || (!isDistanceClose);

      const se = strumEngineRef.current;
      const dt = se.lastTime > 0 ? Math.max(0.005, (timestamp - se.lastTime) / 1000) : 0.033;
      const deltaS = se.lastS !== null ? (sPick - se.lastS) : 0;
      const velocityS = deltaS / dt; // strings per second

      // Stroke direction:
      // String 6 = Low E (top), String 1 = High E (bottom)
      // Sweeping 6 -> 1 is downwards: deltaS < 0
      // Sweeping 1 -> 6 is upwards: deltaS > 0
      const isDownstroke = deltaS < 0;
      const isUpstroke = deltaS > 0;
      const dir = isDownstroke ? 'DOWN ↓' : 'UP ↑';

      // Update downstroke reference longitudinal position t when moving downward in playing posture
      if (isDownstroke && !isHandAway && Math.abs(deltaS) >= 0.15 && Math.abs(velocityS) >= 2.0) {
        se.lastDownT = tPick;
        se.lastDownTime = timestamp;
      }

      // Hybrid Strike Plane vs Air Reset Classifier:
      let arcScore = 0;
      let strikeScore = 0;

      // Signal A: 2D Elliptical Lateral/Longitudinal Hysteresis Arc (t offset relative to downstroke)
      if (se.lastDownT !== null && (timestamp - se.lastDownTime) < 1000) {
        const deltaT = tPick - se.lastDownT;
        if (deltaT >= 0.055) {
          arcScore += 1.4; // Hand arced toward bridge to bypass strings
        } else if (deltaT >= 0.035) {
          arcScore += 0.7;
        } else if (deltaT <= 0.020) {
          strikeScore += 1.2; // Hand tracked back along same string trajectory
        }
      }

      // Signal B: MediaPipe 3D Landmark Depth (fingertip lift relative to palm)
      if (relativeTipDepth < -0.040) {
        arcScore += 1.0;
      } else if (relativeTipDepth > -0.015) {
        strikeScore += 0.9;
      }

      // Signal C: Optical hand scale relative to Marker 5
      if (opticalScaleRatio > 1.35) {
        arcScore += 1.2;
      } else if (opticalScaleRatio < 1.15) {
        strikeScore += 1.0;
      }

      // Air Reset determination:
      // Only applicable on upstrokes (downstrokes are always active strikes unless hand is away)
      let isAirReset = false;
      if (isUpstroke) {
        isAirReset = (arcScore >= 1.2) && (arcScore > strikeScore + 0.3);
      }
      se.isAirReset = isAirReset;
      se.isHandAway = isHandAway;

      // Strike Plane: Only active when hand is in strum zone, NOT away, and NOT in air reset
      const inStrikePlane = inStrumZone && !isHandAway && !isAirReset;
      se.smoothedInStrikePlane = se.smoothedInStrikePlane * 0.4 + (inStrikePlane ? 1 : 0) * 0.6;
      const visualInStrikePlane = (se.smoothedInStrikePlane >= 0.5);

      // Draw Pick Cursor (with Depth, Angle & Air Reset Indicator)
      ctx.save();
      if (!visualInStrikePlane && inEnvelope) {
        // Hand is not in strike plane: draw dashed halo with specific reason tag
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(pickX, pickY, 14, 0, 2 * Math.PI);
        ctx.stroke();

        ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
        ctx.beginPath();
        ctx.arc(pickX, pickY, 5, 0, 2 * Math.PI);
        ctx.fill();

        let reasonLabel = '↷ AIR RESET';
        if (!isWristAngleValid) {
          reasonLabel = `↷ OFF-ANGLE (∡${cosWristAngle.toFixed(2)})`;
        } else if (!isWristPositionValid) {
          reasonLabel = `↷ OFF-BODY (t${tWrist.toFixed(2)})`;
        } else if (!isDistanceClose) {
          reasonLabel = (stereoClearanceCm !== null) ? `↷ AIR HOVER (${stereoClearanceCm >= 0 ? '+' : ''}${stereoClearanceCm.toFixed(1)}cm)` : `↷ AWAY (x${opticalScaleRatio.toFixed(1)})`;
        }
        drawUnmirroredText(ctx, reasonLabel, pickX, pickY - 18, {
          font: 'bold 10px monospace',
          fillStyle: 'rgba(56, 189, 248, 0.9)',
          align: 'center',
          baseline: 'bottom'
        });
      } else {
        // Strike plane: glowing target
        const isUpward = (velocityS > 1.5);
        const strikeColor = isUpward ? '#10b981' : (inStrumZone ? '#f59e0b' : 'rgba(255, 255, 255, 0.7)');
        const strikeShadow = isUpward ? '#10b981' : (inStrumZone ? '#f59e0b' : 'rgba(255, 255, 255, 0.4)');

        ctx.shadowColor = strikeShadow;
        ctx.shadowBlur = inEnvelope ? 10 : 4;
        ctx.fillStyle = strikeColor;
        ctx.beginPath();
        ctx.arc(pickX, pickY, inStrumZone ? 8 : 5, 0, 2 * Math.PI);
        ctx.fill();

        // Outer crosshair ring
        ctx.strokeStyle = strikeColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pickX, pickY, inStrumZone ? 15 : 9, 0, 2 * Math.PI);
        ctx.stroke();

        const label = isUpward ? '⚡ UP STRIKE' : (inStrumZone ? '⚡ DOWN STRIKE' : 'R-HAND');
        drawUnmirroredText(ctx, label, pickX, pickY - 18, {
          font: 'bold 11px monospace',
          fillStyle: strikeColor,
          align: 'center',
          baseline: 'bottom'
        });
      }
      ctx.restore();

      if (inEnvelope) {
        const telemetry = `Scale:${opticalScaleRatio.toFixed(2)} | ∡${cosWristAngle.toFixed(2)} | t:${tPick.toFixed(2)}`;
        drawUnmirroredText(ctx, telemetry, pickX, pickY + 16, {
          font: '9px monospace',
          fillStyle: 'rgba(255, 255, 255, 0.75)',
          align: 'center',
          baseline: 'top'
        });
      }

      recStrumMetrics = {
        tPick: round3(tPick),
        sPick: round3(sPick),
        deltaS: round3(deltaS),
        velS: round1(velocityS),
        dir,
        zGuitar: round1(zGuitar),
        zHand: round1(zHand),
        deltaZ: round1(deltaZ),
        scaleRatio: round3(opticalScaleRatio),
        cosWrist: round3(cosWristAngle),
        tWrist: round3(tWrist),
        sWrist: round3(sWrist),
        distOk: isDistanceClose,
        postureOk: isStrumPostureValid,
        handAway: isHandAway,
        airReset: isAirReset,
        mode: strumModeRef.current,
        isTriangulated,
        clearance: (stereoClearanceCm !== null) ? round1(stereoClearanceCm) : null,
        triMiss: (triMissDist !== null) ? round1(triMissDist) : null
      };

      // Continuous Sub-Frame Line Segment Crossing Detection
      if (se.lastS !== null && se.inEnvelope && inEnvelope) {
        const sFrom = se.lastS;
        const sTo = sPick;
        const tFrom = se.lastT;
        const tTo = tPick;
        const sMin = Math.min(sFrom, sTo);
        const sMax = Math.max(sFrom, sTo);

        // Direction reversal detection
        const currentStrokeDir = isDownstroke ? 'down' : 'up';
        if (se.currentDirection !== currentStrokeDir) {
          se.strokeSoundedStrings.clear();
          se.currentDirection = currentStrokeDir;
          se.strokeStartTime = timestamp;
        } else if (timestamp - se.strokeStartTime > 280) {
          se.strokeSoundedStrings.clear();
          se.strokeStartTime = timestamp;
        }

        // Detect all string lines crossed by segment (sFrom, tFrom) -> (sTo, tTo)
        const newlyCrossed = [];
        for (let str = 1; str <= 6; str++) {
          if (str >= Math.floor(sMin + 0.08) && str <= Math.ceil(sMax - 0.08)) {
            const u = Math.abs(sTo - sFrom) > 1e-4 ? (str - sFrom) / (sTo - sFrom) : 0.5;
            const tCross = tFrom + u * (tTo - tFrom);
            if (tCross >= 0.80 && tCross <= 1.55) {
              if (!se.strokeSoundedStrings.has(str)) {
                // Per-string debounce (35ms) allows 16th notes at 160 BPM (~94ms) while preventing micro-jitter
                const lastPluck = vibratingStringsRef.current[str] || 0;
                if (timestamp - lastPluck >= 35) {
                  newlyCrossed.push(str);
                }
              }
            }
          }
        }

        // Trigger strum if displacement and velocity qualify
        if (newlyCrossed.length > 0 && Math.abs(deltaS) >= 0.20 && (Math.abs(velocityS) >= 2.2 || newlyCrossed.length >= 2)) {
          newlyCrossed.forEach(str => se.strokeSoundedStrings.add(str));

          // Strum mode authorization
          let allowStrum = true;
          if (strumModeRef.current === 'down') {
            // Down-only mode: requires downstroke and hand in playing zone
            allowStrum = isDownstroke && !isHandAway;
          } else if (strumModeRef.current === 'smart') {
            // Smart Guard:
            // 1. Hand MUST NOT be far away from the guitar
            // 2. On upstrokes, hand MUST NOT be in air return reset
            if (isHandAway || (isUpstroke && isAirReset)) {
              allowStrum = false;
            }
          } else if (strumModeRef.current === 'both') {
            // Down & Up mode: requires hand in playing zone
            allowStrum = !isHandAway;
          }

          if (recStrumMetrics) {
            recStrumMetrics.allowStrum = allowStrum;
            recStrumMetrics.crossed = [...newlyCrossed];
          }

          const displayCrossed = isDownstroke ? [...newlyCrossed].sort((a, b) => b - a) : [...newlyCrossed].sort((a, b) => a - b);

          if (allowStrum) {
            newlyCrossed.forEach(str => {
              vibratingStringsRef.current[str] = timestamp;
            });

            const currentFretted = {};
            trackedFingers.forEach(f => {
              if (f.isActive && f.string && f.fret) {
                currentFretted[f.string] = f.fret;
              }
            });

            const normalizedVelocity = Math.min(1.0, Math.max(0.38, Math.abs(velocityS) / 10));

            // Difficulty Level Logic for Song Play-Along
            const isSongActive = songEngine.isPlaying;
            const targetChord = isSongActive ? songEngine.getTargetChord() : null;
            const targetPlayable = targetChord ? getPlayableChordObject(targetChord) : null;
            const currentLevel = playLevelRef.current || 1;

            let chordToPlay = null;
            let isAssistHit = false;
            let displayTitle = '';
            let displayColor = isDownstroke ? '#f59e0b' : '#06b6d4';

            if (isSongActive && targetPlayable) {
              if (currentLevel === 1) {
                // LEVEL 1: AUTO-CHORD (Beginner)
                // Always sound the target chord cleanly regardless of left-hand fretting!
                chordToPlay = targetPlayable;
                displayTitle = `⭐ ${targetPlayable.name} [L1 AUTO]`;
                displayColor = '#38bdf8'; // bright sky cyan
              } else if (currentLevel === 2) {
                // LEVEL 2: SMART ASSIST / CLOSE ENOUGH (Intermediate)
                const proximity = isChordCloseEnough(currentFretted, targetChord, activeChord);
                if (proximity.isClose) {
                  chordToPlay = targetPlayable;
                  isAssistHit = true;
                  displayTitle = `🎯 ${targetPlayable.name} [L2 ASSIST]`;
                  displayColor = '#10b981'; // emerald
                } else {
                  // Not close enough: play whatever is fretted
                  displayTitle = activeChord ? activeChord.name : `MISS (Need ${targetChord.short})`;
                  displayColor = '#f87171'; // soft red
                }
              } else {
                // LEVEL 3: PRO / REALISTIC
                if (activeChord && newlyCrossed.length >= 3) {
                  chordToPlay = activeChord;
                }
                displayTitle = activeChord ? `${activeChord.name} [L3 PRO]` : '';
                displayColor = activeChord ? (activeChord.quality === 'major' ? '#10b981' : '#a855f7') : (isDownstroke ? '#f59e0b' : '#06b6d4');
              }
            } else {
              // Free Play (no song playing): standard realistic or chord detection
              if (activeChord && newlyCrossed.length >= 3) {
                chordToPlay = activeChord;
                displayTitle = activeChord.name;
                displayColor = activeChord.quality === 'major' ? '#10b981' : '#a855f7';
              }
            }

            const chordPrefix = displayTitle ? `${displayTitle} ` : '';
            const strumDesc = (chordToPlay || newlyCrossed.length >= 3)
              ? `${chordPrefix}STRUM ${dir}`
              : `${chordPrefix}PICK S:${displayCrossed.join(',')}`;

            activeStrumDisplayRef.current = {
              text: `${strumDesc} [Strings ${displayCrossed.join(',')}]`,
              time: timestamp,
              color: displayColor,
              chord: chordToPlay ? chordToPlay.name : (activeChord ? activeChord.name : null),
              dir: dir,
              level: currentLevel,
              isAssist: isAssistHit
            };

            if (audioEnabled) {
              if (chordToPlay) {
                guitarAudio.strumChord(chordToPlay, dir, normalizedVelocity);
                if (isSongActive) {
                  songEngine.evaluateStrum(targetChord.short, isAssistHit);
                }
              } else {
                guitarAudio.strumStrings(newlyCrossed, currentFretted, dir, normalizedVelocity);
                if (isSongActive && newlyCrossed.length >= 2) {
                  songEngine.evaluateStrum(activeChord?.short || null, false);
                }
              }
            }
          } else {
            // Muted return stroke (air reset)
            activeStrumDisplayRef.current = {
              text: `↷ AIR RESET (Muted) [Strings ${displayCrossed.join(',')}]`,
              time: timestamp,
              color: 'rgba(148, 163, 184, 0.75)',
              chord: null,
              dir: 'AIR'
            };
          }
        }
      }

      // Update tracking state for next frame
      se.lastTime = timestamp;
      se.lastS = sPick;
      se.lastT = tPick;
      se.lastX = pickX;
      se.lastY = pickY;
      se.inEnvelope = inEnvelope;

      // Update legacy state ref
      lastStrumStateRef.current = {
        time: timestamp,
        s: sPick,
        inZone: inStrumZone
      };

      if (inEnvelope) {
        const modeBadge = strumModeRef.current === 'smart' ? 'SMART' : (strumModeRef.current === 'down' ? 'DOWN' : 'ALL');
        const planeState = isAirReset ? 'AIR' : (isDownstroke ? 'DOWN' : 'UP');
        strumStatusDesc = `Pick @ S${sPick.toFixed(1)} [${planeState}] (${modeBadge})`;
      }
    } else {
      const se = strumEngineRef.current;
      se.lastTime = timestamp;
      se.lastS = null;
      se.lastT = null;
      se.inEnvelope = false;
      se.strokeSoundedStrings.clear();
      lastStrumStateRef.current = { time: timestamp, s: null, inZone: false };
      pickTrailRef.current = [];
    }

    // Draw ArUco marker boundaries and IDs
    detectedMarkers.forEach(m => {
      ctx.strokeStyle = 'rgba(168, 85, 247, 0.7)'; // neon purple
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(m.corners[0].x, m.corners[0].y);
      ctx.lineTo(m.corners[1].x, m.corners[1].y);
      ctx.lineTo(m.corners[2].x, m.corners[2].y);
      ctx.lineTo(m.corners[3].x, m.corners[3].y);
      ctx.closePath();
      ctx.stroke();

      // Draw ID un-mirrored
      drawUnmirroredText(ctx, m.id.toString(), m.center.x, m.center.y, {
        font: '12px monospace',
        fillStyle: '#fff',
        align: 'center',
        baseline: 'middle'
      });
    });

    // Draw Hand skeletons (Left fretting in finger colors, Right strumming in amber)
    if (handLandmarks && handLandmarks.length > 0) {
      handLandmarks.forEach(hand => {
        const isStrumHand = (hand === strumHandLandmarks);

        // Draw joint circles
        ctx.fillStyle = isStrumHand ? 'rgba(254, 215, 170, 0.9)' : 'rgba(255, 255, 255, 0.8)';
        hand.forEach(lm => {
          ctx.beginPath();
          ctx.arc(lm.x * width, lm.y * height, isStrumHand ? 3.5 : 3, 0, 2 * Math.PI);
          ctx.fill();
        });

        const drawSegmentPath = (indices, strokeColor, lineWidth = 2.5) => {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = lineWidth;
          ctx.beginPath();
          ctx.moveTo(hand[indices[0]].x * width, hand[indices[0]].y * height);
          for (let i = 1; i < indices.length; ++i) {
            ctx.lineTo(hand[indices[i]].x * width, hand[indices[i]].y * height);
          }
          ctx.stroke();
        };

        // Draw palm/knuckle connectors
        drawSegmentPath([0, 5, 9, 13, 17, 0], isStrumHand ? 'rgba(245, 158, 11, 0.3)' : 'rgba(255, 255, 255, 0.25)', 1.5);
        drawSegmentPath([5, 9, 13, 17], isStrumHand ? 'rgba(245, 158, 11, 0.4)' : 'rgba(255, 255, 255, 0.35)', 2);

        // Draw finger bones
        FRET_FINGERS.forEach(f => {
          drawSegmentPath(f.path, isStrumHand ? 'rgba(245, 158, 11, 0.65)' : f.color, 2.5);
        });
      });
    }

    // Highlight fretted positions on the guitar neck for every active fretting finger
    if (neckGeometry) {
      // Draw AR Ghost Target Fingering for Active Play-Along Song (only when enabled AND a song is actively playing)
      if (showGhostFretsRef.current && songEngine.isPlaying) {
        const targetChord = songEngine.getTargetChord();
        if (targetChord && targetChord.frets) {
          const { start, dx, dy, len, perpX, perpY, nutNeckWidth } = neckGeometry;
          const nutMidX = start.x - 18 * (dx / len);
          const nutMidY = start.y - 18 * (dy / len);

          // 1. Nut indicators: Open ('O') or Muted ('✕')
          for (let s = 1; s <= 6; s++) {
            const tString = ((s - 1) / 5 - 0.5) * 0.88;
            const sx = nutMidX + (tString * nutNeckWidth) * perpX;
            const sy = nutMidY + (tString * nutNeckWidth) * perpY;

            if (targetChord.open && targetChord.open.includes(s)) {
              ctx.save();
              ctx.strokeStyle = '#22c55e';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.arc(sx, sy, 7, 0, 2 * Math.PI);
              ctx.stroke();
              drawUnmirroredText(ctx, 'O', sx, sy, {
                font: 'bold 9px monospace',
                fillStyle: '#22c55e',
                align: 'center',
                baseline: 'middle'
              });
              ctx.restore();
            } else if (targetChord.muted && targetChord.muted.includes(s)) {
              ctx.save();
              drawUnmirroredText(ctx, '✕', sx, sy, {
                font: 'bold 11px monospace',
                fillStyle: '#ef4444',
                align: 'center',
                baseline: 'middle'
              });
              ctx.restore();
            }
          }

          // 2. Fret targets
          const pulse = 0.5 + 0.5 * Math.sin(timestamp / 180);
          Object.entries(targetChord.frets).forEach(([strStr, target]) => {
            const str = parseInt(strStr, 10);
            const fret = target.fret;
            const fingerNum = target.finger || 1;

            if (fret > 0 && fret <= 22) {
              const curDist = FRET_ABSOLUTE_DISTANCES_FROM_NUT[fret - 1];
              const prevDist = fret === 1 ? 0.0 : FRET_ABSOLUTE_DISTANCES_FROM_NUT[fret - 2];
              const midFretDist = (curDist + prevDist) / 2;

              const { fx, fy, fWidth, perpX: fPerpX, perpY: fPerpY } = getFretPositionAndWidth(midFretDist, neckGeometry);
              const tString = ((str - 1) / 5 - 0.5) * 0.88;
              const px = fPerpX ?? perpX;
              const py = fPerpY ?? perpY;
              const targetX = fx + (tString * fWidth) * px;
              const targetY = fy + (tString * fWidth) * py;

              const isFrettedByPlayer = trackedFingers.some(
                f => f.isActive && f.string === str && f.fret === fret
              );

              ctx.save();
              if (isFrettedByPlayer) {
                // Correct finger placed: glowing emerald checkmark
                ctx.shadowColor = '#10b981';
                ctx.shadowBlur = 18;
                ctx.fillStyle = 'rgba(16, 185, 129, 0.95)';
                ctx.beginPath();
                ctx.arc(targetX, targetY, 11, 0, 2 * Math.PI);
                ctx.fill();

                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.stroke();

                drawUnmirroredText(ctx, '✓', targetX, targetY, {
                  font: 'bold 12px monospace',
                  fillStyle: '#ffffff',
                  align: 'center',
                  baseline: 'middle'
                });
              } else {
                // Target to press: pulsing cyan guide with finger number
                const radius = 9 + pulse * 2.5;
                ctx.shadowColor = '#06b6d4';
                ctx.shadowBlur = 14 * pulse;

                // Outer pulse ring
                ctx.strokeStyle = `rgba(6, 182, 212, ${0.4 + 0.5 * pulse})`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(targetX, targetY, radius + 3, 0, 2 * Math.PI);
                ctx.stroke();

                // Inner solid badge
                ctx.fillStyle = 'rgba(6, 182, 212, 0.88)';
                ctx.beginPath();
                ctx.arc(targetX, targetY, 10, 0, 2 * Math.PI);
                ctx.fill();

                drawUnmirroredText(ctx, fingerNum.toString(), targetX, targetY, {
                  font: 'bold 11px monospace',
                  fillStyle: '#ffffff',
                  align: 'center',
                  baseline: 'middle'
                });
              }
              ctx.restore();
            }
          });
        }
      }

      const activeFretPoints = [];

      trackedFingers.forEach(f => {
        if (f.isActive) {
          const fretDist = FRET_ABSOLUTE_DISTANCES_FROM_NUT[f.fret - 1];
          if (fretDist !== undefined) {
            const prevDist = f.fret > 1 ? FRET_ABSOLUTE_DISTANCES_FROM_NUT[f.fret - 2] : 0.0;
            const midFretDist = (fretDist + prevDist) / 2;
            const { fx, fy, fWidth, perpX: fPerpX, perpY: fPerpY } = getFretPositionAndWidth(midFretDist, neckGeometry);
            const tString = ((f.string - 1) / 5 - 0.5) * 0.88;
            const px = fPerpX ?? neckGeometry.perpX;
            const py = fPerpY ?? neckGeometry.perpY;
            const nx = fx + (tString * fWidth) * px;
            const ny = fy + (tString * fWidth) * py;

            activeFretPoints.push({ x: nx, y: ny, string: f.string, fret: f.fret, color: f.color });

            // Glowing note dot on fretboard matching finger color
            ctx.save();
            ctx.shadowColor = f.color;
            ctx.shadowBlur = 12;
            ctx.fillStyle = f.color;
            ctx.beginPath();
            ctx.arc(nx, ny, 7, 0, 2 * Math.PI);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.restore();
          }
        }
      });

      // Draw glowing AR Chord Constellation lines connecting active notes on fretboard
      if (activeChord && activeFretPoints.length >= 2) {
        ctx.save();
        const isMajor = activeChord.quality === 'major';
        ctx.strokeStyle = isMajor ? 'rgba(16, 185, 129, 0.75)' : 'rgba(168, 85, 247, 0.75)';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = isMajor ? '#10b981' : '#a855f7';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        activeFretPoints.sort((a, b) => a.string - b.string);
        activeFretPoints.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();
        ctx.restore();
      }
    }

    // Draw fingertip target rings and finger badges for all fretting fingers
    trackedFingers.forEach(f => {
      ctx.save();
      if (f.isHovering) {
        // Finger is hovering above fretboard in 3D: soft dashed hover ring
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(f.pos.x, f.pos.y, 11, 0, 2 * Math.PI);
        ctx.stroke();

        ctx.fillStyle = 'rgba(148, 163, 184, 0.25)';
        ctx.beginPath();
        ctx.arc(f.pos.x, f.pos.y, 4, 0, 2 * Math.PI);
        ctx.fill();

        drawUnmirroredText(ctx, f.num, f.pos.x, f.pos.y - 14, {
          font: 'bold 10px monospace',
          fillStyle: 'rgba(148, 163, 184, 0.85)',
          align: 'center',
          baseline: 'bottom'
        });

        // Hover clearance distance badge: e.g. "↷ 2.5cm"
        const hoverLabel = (f.clearanceCm !== null) ? `↷ ${f.clearanceCm.toFixed(1)}cm` : 'HOVER';
        drawUnmirroredText(ctx, hoverLabel, f.pos.x, f.pos.y + 13, {
          font: '9px monospace',
          fillStyle: 'rgba(56, 189, 248, 0.85)',
          align: 'center',
          baseline: 'top'
        });
      } else {
        // Finger is pressing strings against the fretboard (or 1-cam fallback):
        ctx.strokeStyle = f.ringColor;
        ctx.lineWidth = f.isActive ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.arc(f.pos.x, f.pos.y, f.isActive ? 13 : 9, 0, 2 * Math.PI);
        ctx.stroke();

        // Inner dot
        ctx.fillStyle = f.isActive ? f.color : 'rgba(15, 23, 42, 0.7)';
        ctx.beginPath();
        ctx.arc(f.pos.x, f.pos.y, f.isActive ? 6 : 4, 0, 2 * Math.PI);
        ctx.fill();

        // Finger number label: '1', '2', '3', '4', 'T' above fingertip
        drawUnmirroredText(ctx, f.num, f.pos.x, f.pos.y - 15, {
          font: 'bold 11px monospace',
          fillStyle: f.color,
          align: 'center',
          baseline: 'bottom'
        });

        // If active on fretboard: show Fret & String badge below fingertip
        if (f.isActive) {
          drawUnmirroredText(ctx, `F${f.fret}·S${f.string}`, f.pos.x, f.pos.y + 15, {
            font: 'bold 10px monospace',
            fillStyle: '#ffffff',
            align: 'center',
            baseline: 'top'
          });
        }
      }
      ctx.restore();
    });

    // Draw Real-time AR Chord Card or Strum Banner
    const timeSinceStrum = timestamp - activeStrumDisplayRef.current.time;

    if (activeChord) {
      const isMajor = activeChord.quality === 'major';
      const chordThemeColor = isMajor ? '#10b981' : '#a855f7';
      const cardW = 310;
      const cardH = 56;
      const cardX = width / 2;
      const cardY = 48;

      ctx.save();
      // Holographic card background & glowing border
      ctx.shadowColor = timeSinceStrum < 750 ? '#f59e0b' : chordThemeColor;
      ctx.shadowBlur = timeSinceStrum < 750 ? 14 : 8;
      ctx.fillStyle = 'rgba(8, 12, 22, 0.88)';
      ctx.strokeStyle = timeSinceStrum < 750 ? '#fbbf24' : chordThemeColor;
      ctx.lineWidth = timeSinceStrum < 750 ? 2.5 : 1.8;

      // Rounded rectangle card
      const r = 12;
      const left = cardX - cardW / 2;
      const top = cardY - cardH / 2;
      ctx.beginPath();
      ctx.moveTo(left + r, top);
      ctx.lineTo(left + cardW - r, top);
      ctx.quadraticCurveTo(left + cardW, top, left + cardW, top + r);
      ctx.lineTo(left + cardW, top + cardH - r);
      ctx.quadraticCurveTo(left + cardW, top + cardH, left + cardW - r, top + cardH);
      ctx.lineTo(left + r, top + cardH);
      ctx.quadraticCurveTo(left, top + cardH, left, top + cardH - r);
      ctx.lineTo(left, top + r);
      ctx.quadraticCurveTo(left, top, left + r, top);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Main Chord Title
      const strumBadge = timeSinceStrum < 750 ? ' ⚡ STRUMMED' : '';
      drawUnmirroredText(ctx, `🎸 ${activeChord.name.toUpperCase()}${strumBadge}`, cardX, cardY - 9, {
        font: 'bold 18px monospace',
        fillStyle: timeSinceStrum < 750 ? '#fbbf24' : '#ffffff',
        align: 'center',
        baseline: 'middle'
      });

      // Triad Notes + Shape Tag
      const subText = `Triad: ${activeChord.notes.join(' • ')}  |  ${activeChord.shape || 'Chord'} (${Math.round(activeChord.confidence * 100)}%)`;
      drawUnmirroredText(ctx, subText, cardX, cardY + 14, {
        font: 'bold 11px monospace',
        fillStyle: chordThemeColor,
        align: 'center',
        baseline: 'middle'
      });

      ctx.restore();
    } else if (timeSinceStrum < 750) {
      // Standalone Strum Banner if played without an identified chord
      const alpha = 1 - timeSinceStrum / 750;
      const bannerColor = activeStrumDisplayRef.current.color || '#f59e0b';
      ctx.save();
      ctx.shadowColor = bannerColor;
      ctx.shadowBlur = 14;
      drawUnmirroredText(ctx, `⚡ ${activeStrumDisplayRef.current.text}`, width / 2, 45, {
        font: 'bold 15px monospace',
        fillStyle: bannerColor,
        align: 'center',
        baseline: 'middle'
      });
      ctx.restore();
    }

    const activeFingers = trackedFingers.filter(f => f.isActive);

    // Optional status update callback
    if (onStatusUpdate && timestamp - lastStatusUpdateTimeRef.current >= 250) {
      lastStatusUpdateTimeRef.current = timestamp;
      const activeSummary = activeFingers.length > 0
        ? activeFingers.map(f => `${f.name}: F${f.fret}·S${f.string}`).join(', ')
        : 'None';

      const chordDesc = activeChord ? `${activeChord.name} (${Math.round(activeChord.confidence * 100)}%)` : 'None';
      let statusText = `FPS: ${currentFps} (${width}x${height}) | Chord: ${chordDesc} | Markers: ${detectedMarkers.length} | Fretting: ${activeSummary}`;
      if (strumStatusDesc) {
        statusText += ` | Strum: ${strumStatusDesc}`;
      }
      onStatusUpdate(statusText);
    }

    // 6. Draw Marker & Alignment Diagnostic Overlay (if enabled in Options)
    if (showMarkerDebugRef.current) {
      drawMarkerDebug(ctx, markers, neckGeometry);
    }

    const tFrameEnd = performance.now();
    const dRender = tFrameEnd - tRenderStart;
    const dTotal = tFrameEnd - tFrameStart;

    // Session recorder: log this frame's ArUco metrics (+ composite overlay video if enabled).
    // Done after timing so recorder overhead doesn't skew the recorded pipeline latencies.
    if (isRecording) {
      try {
        recorder.compositeOverlay(video, canvas);
        recorder.logFrame(buildFrameRecord({
          frameIndex,
          video,
          scanned: shouldScanAruco,
          fps: currentFps,
          timings: { copy: dCopy, aruco: dAruco, mp: dMp, math: dMath, render: dRender, total: dTotal },
          procWidth,
          procHeight,
          scaleX,
          scaleY,
          diagnostics,
          detectedMarkers,
          markerPoses,
          candidateDetails: recCandidates,
          neckMode: recNeckMode,
          coastFrames: coastFramesRef.current,
          rawNeck: recRawNeck,
          neckGeometry,
          handCount: handLandmarks ? handLandmarks.length : 0,
          trackedFingers,
          activeChord,
          strumMetrics: recStrumMetrics
        }));
      } catch (e) {
        console.warn('[Recorder] Failed to log frame:', e);
      }
    }

    // Collect sliding window samples (max 30 items)
    const samples = perfSamplesRef.current;
    const pushSample = (arr, val) => {
      arr.push(val);
      if (arr.length > 30) arr.shift();
    };
    pushSample(samples.copy, dCopy);
    pushSample(samples.aruco, dAruco);
    pushSample(samples.mp, dMp);
    pushSample(samples.math, dMath);
    pushSample(samples.render, dRender);
    pushSample(samples.total, dTotal);
    pushSample(samples.fps, currentFps);

    // Throttle HUD & Profiler state update to ~2.5x/sec so state updates don't hurt FPS
    if (timestamp - lastFpsUpdateTimeRef.current >= 400) {
      lastFpsUpdateTimeRef.current = timestamp;
      setFps(currentFps);

      const avg = (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : '0';
      const updated = {
        copy: avg(samples.copy),
        aruco: avg(samples.aruco),
        mp: avg(samples.mp),
        math: avg(samples.math),
        render: avg(samples.render),
        total: avg(samples.total),
        fps: currentFps,
        fpsAvg: Math.round(parseFloat(avg(samples.fps)) || currentFps),
        res: `${width}x${height}`,
        procRes: `${procWidth}x${procHeight}`,
        markers: detectedMarkers.length,
        hands: handLandmarks ? handLandmarks.length : 0
      };
      perfTimingsRef.current = updated;
      setPerfTimings(updated);
      if (isRecording) {
        setRecLiveStats(recorder.liveStats());
      }
    }

    loopRef.current = requestAnimationFrame(processFrame);
  };

  // Start processing loop when camera and OpenCV.js are ready
  useEffect(() => {
    if (cameraActive && openCvLoaded) {
      loopRef.current = requestAnimationFrame(processFrame);
    }
    return () => {
      if (loopRef.current) {
        cancelAnimationFrame(loopRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraActive, openCvLoaded]);

  // HTML5 Canvas 2D Fretboard Draw (Unified Geometry)
  const drawGuitarOnCanvas = (ctx, geometry) => {
    const { start, dx, dy, perpX, perpY, nutNeckWidth, endNeckWidth } = geometry;

    // 1. Draw Frets across the full neck width (perspective-correct trapezium)
    FRETS_FOR_DRAWING.forEach(fretDist => {
      const { fx, fy, fWidth, perpX: fPerpX, perpY: fPerpY } = getFretPositionAndWidth(fretDist, geometry);
      const px = fPerpX ?? perpX;
      const py = fPerpY ?? perpY;

      // Draw perpendicular fret line across the full neck
      const x1 = fx + (fWidth / 2) * px;
      const y1 = fy + (fWidth / 2) * py;
      const x2 = fx - (fWidth / 2) * px;
      const y2 = fy - (fWidth / 2) * py;

      ctx.lineWidth = fretDist === 0 ? 5 : 2; // Thicker line for nut (fret 0)
      ctx.strokeStyle = fretDist === 0 ? "rgba(6, 182, 212, 0.85)" : "rgba(34, 197, 94, 0.85)"; // High-visibility neon green
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    });

    // Draw Fret Number Labels centered between consecutive frets
    FRET_ABSOLUTE_DISTANCES_FROM_NUT.forEach((curDist, idx) => {
      const fretNum = idx + 1;
      const prevDist = idx === 0 ? 0.0 : FRET_ABSOLUTE_DISTANCES_FROM_NUT[idx - 1];
      const midDist = (prevDist + curDist) / 2;
      const { fx, fy, fWidth, perpX: mPerpX, perpY: mPerpY } = getFretPositionAndWidth(midDist, geometry);
      const px = mPerpX ?? perpX;
      const py = mPerpY ?? perpY;

      drawUnmirroredText(ctx, fretNum.toString(), fx - (fWidth / 2 + 8) * px, fy - (fWidth / 2 + 8) * py, {
        font: '10px monospace',
        fillStyle: 'rgba(134, 239, 172, 0.9)',
        align: 'center',
        baseline: 'middle'
      });
    });

    // 2. Draw Strumming Zone over guitar body (t: 0.92 to 1.38)
    const tStrum1 = 0.92;
    const tStrum2 = 1.38;
    const wStrum1 = endNeckWidth * 1.12;
    const wStrum2 = endNeckWidth * 1.28;
    const vStrum1 = getPerpAt(tStrum1, geometry);
    const vStrum2 = getPerpAt(tStrum2, geometry);

    const sz1X = start.x + tStrum1 * dx + (wStrum1 / 2) * vStrum1.x;
    const sz1Y = start.y + tStrum1 * dy + (wStrum1 / 2) * vStrum1.y;
    const sz2X = start.x + tStrum1 * dx - (wStrum1 / 2) * vStrum1.x;
    const sz2Y = start.y + tStrum1 * dy - (wStrum1 / 2) * vStrum1.y;

    const sz3X = start.x + tStrum2 * dx - (wStrum2 / 2) * vStrum2.x;
    const sz3Y = start.y + tStrum2 * dy - (wStrum2 / 2) * vStrum2.y;
    const sz4X = start.x + tStrum2 * dx + (wStrum2 / 2) * vStrum2.x;
    const sz4Y = start.y + tStrum2 * dy + (wStrum2 / 2) * vStrum2.y;

    ctx.save();
    // Glowing amber background fill
    ctx.fillStyle = 'rgba(245, 158, 11, 0.07)';
    ctx.beginPath();
    ctx.moveTo(sz1X, sz1Y);
    ctx.lineTo(sz2X, sz2Y);
    ctx.lineTo(sz3X, sz3Y);
    ctx.lineTo(sz4X, sz4Y);
    ctx.closePath();
    ctx.fill();

    // Subtle dashed amber border
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);

    // Strum Zone Label
    const tStrumMid = (tStrum1 + tStrum2) / 2;
    const szMidX = start.x + tStrumMid * dx;
    const szMidY = start.y + tStrumMid * dy;
    const vStrumMid = getPerpAt(tStrumMid, geometry);
    const labelOffset = (wStrum1 + wStrum2) / 4 + 10;
    drawUnmirroredText(ctx, '⚡ STRUM ZONE', szMidX + labelOffset * vStrumMid.x, szMidY + labelOffset * vStrumMid.y, {
      font: 'bold 10px monospace',
      fillStyle: 'rgba(245, 158, 11, 0.85)',
      align: 'center',
      baseline: 'middle'
    });
    ctx.restore();

    // 3. Draw Strings from Nut through Strum Zone to Bridge (with vibration animation)
    const tBridge = 1.38;
    const bridgeNeckWidth = endNeckWidth * 1.15;
    const nowTime = performance.now();
    const vNut = getPerpAt(0.0, geometry);
    const vBridge = getPerpAt(tBridge, geometry);

    for (let s = 1; s <= 6; ++s) {
      const tString = ((s - 1) / 5 - 0.5) * 0.88;

      const x1 = start.x + (tString * nutNeckWidth) * vNut.x;
      const y1 = start.y + (tString * nutNeckWidth) * vNut.y;

      // Extend to the bridge across the strum zone
      const xBridge = start.x + tBridge * dx + (tString * bridgeNeckWidth) * vBridge.x;
      const yBridge = start.y + tBridge * dy + (tString * bridgeNeckWidth) * vBridge.y;

      // Check if this string is currently vibrating from a recent pick/strum
      const lastStrumTime = vibratingStringsRef.current[s] || 0;
      const timeSinceStrum = nowTime - lastStrumTime;
      const isVibrating = timeSinceStrum < 350;

      ctx.save();
      if (isVibrating) {
        const vibFactor = 1 - timeSinceStrum / 350;
        ctx.shadowColor = '#f59e0b';
        ctx.shadowBlur = 14 * vibFactor;
        ctx.lineWidth = (1.5 + (s * 0.45)) + (4 * vibFactor);
        ctx.strokeStyle = `rgba(254, 215, 170, ${0.85 + 0.15 * vibFactor})`;
      } else {
        ctx.lineWidth = 1.2 + (s * 0.45);
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.45 + (s / 10)})`;
      }

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(xBridge, yBridge);
      ctx.stroke();
      ctx.restore();
    }
  };

  /**
   * Draw comprehensive real-time ArUco Alignment & Ray Tracing Diagnostics
   */
  const drawMarkerDebug = (ctx, markers, geometry) => {
    ctx.save();

    // 1. Draw each detected marker with corner boundaries and center tags
    const markerEntries = Object.entries(markers || {});
    markerEntries.forEach(([idStr, m]) => {
      const id = parseInt(idStr, 10);
      const isAnchor = geometry?.debug && (id === geometry.debug.firstId || id === geometry.debug.lastId);
      const posCm = ARUCO_MARKER_MAP[id];

      // Draw bounding box if corners exist
      if (m.corners && m.corners.length >= 4) {
        ctx.strokeStyle = isAnchor ? '#facc15' : '#38bdf8';
        ctx.lineWidth = isAnchor ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.moveTo(m.corners[0].x, m.corners[0].y);
        for (let i = 1; i < 4; i++) {
          ctx.lineTo(m.corners[i].x, m.corners[i].y);
        }
        ctx.closePath();
        ctx.stroke();

        // Highlight corners
        m.corners.forEach((c, cIdx) => {
          ctx.fillStyle = cIdx === 0 ? '#ef4444' : '#38bdf8';
          ctx.beginPath();
          ctx.arc(c.x, c.y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // Draw center crosshair & coordinate tag
      if (m.center) {
        const cx = m.center.x;
        const cy = m.center.y;
        ctx.strokeStyle = isAnchor ? '#facc15' : '#4ade80';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 8, cy);
        ctx.lineTo(cx + 8, cy);
        ctx.moveTo(cx, cy - 8);
        ctx.lineTo(cx, cy + 8);
        ctx.stroke();

        const tagText = `M${id} (${posCm !== undefined ? posCm + 'cm' : '?'})`;
        const tagSub = `[${Math.round(cx)}, ${Math.round(cy)}]`;
        drawUnmirroredText(ctx, tagText, cx, cy - 14, {
          font: 'bold 11px monospace',
          fillStyle: isAnchor ? '#fef08a' : '#86efac',
          align: 'center',
          baseline: 'bottom'
        });
        drawUnmirroredText(ctx, tagSub, cx, cy - 3, {
          font: '9px monospace',
          fillStyle: 'rgba(255, 255, 255, 0.75)',
          align: 'center',
          baseline: 'bottom'
        });
      }
    });

    // 2. Draw Baseline Ray and Extrapolated Endpoints if geometry available
    if (geometry && geometry.debug) {
      const { start, end, dx, dy, debug } = geometry;

      // Draw active anchor baseline segment (dashed gold)
      const firstMarker = markers[debug.firstId];
      const lastMarker = markers[debug.lastId];
      if (firstMarker?.center && lastMarker?.center) {
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(firstMarker.center.x, firstMarker.center.y);
        ctx.lineTo(lastMarker.center.x, lastMarker.center.y);
        ctx.stroke();
        ctx.restore();
      }

      // Extended full-axis ray from Nut (start) past Bridge (start + 1.4 * dx)
      ctx.save();
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = 'rgba(234, 179, 8, 0.6)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(start.x + 1.4 * dx, start.y + 1.4 * dy);
      ctx.stroke();
      ctx.restore();

      // Pulsing Nut Crosshair (S)
      const isNutPinned = debug.isPinnedNut;
      ctx.strokeStyle = isNutPinned ? '#06b6d4' : '#f97316';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(start.x, start.y, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(start.x - 16, start.y);
      ctx.lineTo(start.x + 16, start.y);
      ctx.moveTo(start.x, start.y - 16);
      ctx.lineTo(start.x, start.y + 16);
      ctx.stroke();

      const nutLabel = isNutPinned ? 'NUT (S) [M1]' : `NUT (S) [EXTRAP u=${debug.uNut.toFixed(2)}]`;
      drawUnmirroredText(ctx, nutLabel, start.x, start.y - 16, {
        font: 'bold 11px monospace',
        fillStyle: isNutPinned ? '#67e8f9' : '#fdba74',
        align: 'center',
        baseline: 'bottom'
      });

      // Pulsing End Crosshair (E)
      const isEndPinned = debug.isPinnedEnd;
      ctx.strokeStyle = isEndPinned ? '#a855f7' : '#ec4899';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(end.x, end.y, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(end.x - 16, end.y);
      ctx.lineTo(end.x + 16, end.y);
      ctx.moveTo(end.x, end.y - 16);
      ctx.lineTo(end.x, end.y + 16);
      ctx.stroke();

      const endLabel = isEndPinned ? 'END (E) [M5]' : `END (E) [EXTRAP u=${debug.uEnd.toFixed(2)}]`;
      drawUnmirroredText(ctx, endLabel, end.x, end.y + 18, {
        font: 'bold 11px monospace',
        fillStyle: isEndPinned ? '#d8b4fe' : '#f472b6',
        align: 'center',
        baseline: 'top'
      });
    }

    // 3. Render Live Telemetry HUD Card
    const hudX = 16;
    const hudY = 65;
    const hudW = 285;
    const hudH = geometry?.debug ? 152 : 75;

    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.strokeStyle = geometry?.debug?.spanCm < 20 ? '#ef4444' : 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(hudX, hudY, hudW, hudH, 8);
    } else {
      ctx.rect(hudX, hudY, hudW, hudH);
    }
    ctx.fill();
    ctx.stroke();

    // Card Header
    drawUnmirroredText(ctx, '🛠️ ARUCO ALIGNMENT DEBUGGER', hudX + 12, hudY + 14, {
      font: 'bold 11px monospace',
      fillStyle: '#38bdf8',
      align: 'left',
      baseline: 'top'
    });

    const detectedIds = Object.keys(markers || {}).map(Number).sort((a, b) => a - b);
    const hasM1 = detectedIds.includes(1);
    drawUnmirroredText(ctx, `Detected Markers: [${detectedIds.join(', ')}]`, hudX + 12, hudY + 30, {
      font: '10px monospace',
      fillStyle: detectedIds.length >= 2 ? '#4ade80' : '#f87171',
      align: 'left',
      baseline: 'top'
    });

    if (geometry?.debug) {
      const { debug } = geometry;
      const isShort = debug.spanCm < 20;
      const baselineText = `Baseline: M${debug.firstId} (${debug.firstCm}cm) -> M${debug.lastId} (${debug.lastCm}cm)`;
      drawUnmirroredText(ctx, baselineText, hudX + 12, hudY + 46, {
        font: '10px monospace',
        fillStyle: '#facc15',
        align: 'left',
        baseline: 'top'
      });

      const spanText = isShort
        ? `⚠️ Span: ${debug.spanCm.toFixed(1)}cm (SHORT - ${Math.round(50 / debug.spanCm)}x tilt magnif!)`
        : `Span: ${debug.spanCm.toFixed(1)}cm (Stable baseline)`;
      drawUnmirroredText(ctx, spanText, hudX + 12, hudY + 62, {
        font: isShort ? 'bold 10px monospace' : '10px monospace',
        fillStyle: isShort ? '#f87171' : '#86efac',
        align: 'left',
        baseline: 'top'
      });

      const nutStatus = hasM1 ? 'Nut: Pinned to M1' : `Nut: Extrap u=${debug.uNut.toFixed(2)} (k=${debug.kExtrap.toFixed(2)})`;
      drawUnmirroredText(ctx, nutStatus, hudX + 12, hudY + 78, {
        font: '10px monospace',
        fillStyle: hasM1 ? '#a7f3d0' : '#fdba74',
        align: 'left',
        baseline: 'top'
      });

      const endStatus = debug.isPinnedEnd ? 'End: Pinned to M5' : `End: Extrap u=${debug.uEnd.toFixed(2)}`;
      drawUnmirroredText(ctx, endStatus, hudX + 12, hudY + 94, {
        font: '10px monospace',
        fillStyle: debug.isPinnedEnd ? '#a7f3d0' : '#f472b6',
        align: 'left',
        baseline: 'top'
      });

      const deg = (Math.atan2(geometry.dy, geometry.dx) * 180 / Math.PI).toFixed(1);
      drawUnmirroredText(ctx, `Axis Angle: ${deg}° | Len: ${Math.round(geometry.len)}px`, hudX + 12, hudY + 110, {
        font: '10px monospace',
        fillStyle: 'rgba(255, 255, 255, 0.75)',
        align: 'left',
        baseline: 'top'
      });

      const se = strumEngineRef.current;
      const strumTelemetry = se.lastS !== null
        ? `Pick: S${se.lastS.toFixed(1)} (t=${se.lastT.toFixed(2)}) [${se.isAirReset ? 'AIR RESET ↷' : 'STRIKE ⚡'}]`
        : 'Pick: Hand outside zone';
      drawUnmirroredText(ctx, strumTelemetry, hudX + 12, hudY + 126, {
        font: '10px monospace',
        fillStyle: se.lastS !== null ? (se.isAirReset ? '#38bdf8' : '#f59e0b') : 'rgba(255, 255, 255, 0.55)',
        align: 'left',
        baseline: 'top'
      });
    } else {
      drawUnmirroredText(ctx, '⚠️ Need >= 2 markers to track guitar axis!', hudX + 12, hudY + 46, {
        font: 'bold 10px monospace',
        fillStyle: '#ef4444',
        align: 'left',
        baseline: 'top'
      });
    }

    ctx.restore();
  };

  // Cleanup on unmount
  useEffect(() => {
    const videoNode = videoRef.current;
    return () => {
      if (videoNode && videoNode.srcObject) {
        const tracks = videoNode.srcObject.getTracks();
        tracks.forEach(track => track.stop());
      }
      if (landmarkerRef.current) {
        landmarkerRef.current.close();
        landmarkerRef.current = null;
      }
      if (cameraMatsRef.current.camMatrix) {
        cameraMatsRef.current.camMatrix.delete();
        cameraMatsRef.current.distCoef.delete();
        cameraMatsRef.current = { width: 0, height: 0, camMatrix: null, distCoef: null };
      }
      if (onMediaPipeLoaded) onMediaPipeLoaded(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className={`camera-container glass-panel ${captureResolution === '480p' ? 'res-4-3' : 'res-16-9'} ${isFullscreen ? 'is-fullscreen' : ''}`}
      style={{
        width: '100%',
        minHeight: isFullscreen ? '0' : '480px',
        maxWidth: isFullscreen ? 'none' : (cameraSize === 'full' ? '100%' : `${cameraSize}px`),
        aspectRatio: isFullscreen ? 'auto' : (captureResolution === '480p' ? '4/3' : '16/9')
      }}
    >
      <div
        className="camera-viewport"
        style={isFullscreen ? {
          position: 'relative',
          width: captureResolution === '480p' ? 'min(100vw, calc(100vh * (4 / 3)))' : 'min(100vw, calc(100vh * (16 / 9)))',
          height: captureResolution === '480p' ? 'min(100vh, calc(100vw * (3 / 4)))' : 'min(100vh, calc(100vw * (9 / 16)))',
          maxWidth: '100vw',
          maxHeight: '100vh',
          aspectRatio: captureResolution === '480p' ? '4/3' : '16/9',
          minHeight: '0',
          margin: 'auto'
        } : {
          width: '100%',
          height: '100%',
          minHeight: '480px',
          aspectRatio: captureResolution === '480p' ? '4/3' : '16/9'
        }}
      >
        <video
          ref={videoRef}
          className={`camera-feed ${!isMirrored ? 'unmirrored' : ''}`}
          playsInline
          muted
        />
        <canvas
          ref={canvasRef}
          className={`overlay-canvas ${!isMirrored ? 'unmirrored' : ''}`}
        />

        {/* Secondary Camera Feed for Stereo 3D (Background / PiP) */}
        <video
          ref={secondaryVideoRef}
          playsInline
          muted
          style={{ display: 'none' }}
        />

        {/* Optional Picture-in-Picture for Secondary Camera */}
        {stereoEnabled && showPip && cameraActive && (
          <div style={{
            position: 'absolute',
            bottom: '16px',
            right: '16px',
            width: '240px',
            height: '150px',
            borderRadius: '10px',
            border: stereoStatus.calibrated ? '2px solid rgba(56, 189, 248, 0.7)' : '2px solid rgba(245, 158, 11, 0.7)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.7)',
            background: '#090d16',
            overflow: 'hidden',
            zIndex: 25,
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{
              background: 'rgba(15, 23, 42, 0.9)',
              padding: '4px 8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#38bdf8' }}>
                <Camera size={10} /> Cam 2 (Aux)
              </span>
              <span style={{ color: stereoStatus.calibrated ? '#4ade80' : '#f59e0b', fontWeight: 'bold' }}>
                {stereoStatus.calibrated ? `🟢 ${stereoStatus.baseline}cm` : '🟡 Aligning...'}
              </span>
            </div>
            <canvas
              ref={pipCanvasRef}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: isMirrored ? 'scaleX(-1)' : 'none'
              }}
            />
          </div>
        )}

        {/* Welcoming Interactive Hero Overlay when Camera is Inactive */}
        {!cameraActive && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'radial-gradient(ellipse at center, rgba(30, 41, 59, 0.75) 0%, rgba(10, 15, 29, 0.96) 100%)',
            backdropFilter: 'blur(10px)',
            zIndex: 15,
            padding: '24px',
            textAlign: 'center',
            color: '#fff',
            minHeight: '480px',
            boxSizing: 'border-box'
          }}>
            <div style={{
              width: '60px',
              height: '60px',
              borderRadius: '18px',
              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.25) 0%, rgba(168, 85, 247, 0.25) 100%)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '16px',
              boxShadow: '0 0 24px rgba(6, 182, 212, 0.25)'
            }}>
              <span style={{ fontSize: '28px' }}>🎸</span>
            </div>

            <h2 style={{ fontSize: '22px', fontWeight: 'bold', margin: '0 0 8px 0', letterSpacing: '-0.02em' }}>
              Welcome to <span className="title-gradient">AR Guitar</span>
            </h2>
            <p style={{
              fontSize: '13px',
              color: 'var(--text-secondary)',
              maxWidth: '440px',
              margin: '0 0 20px 0',
              lineHeight: 1.5
            }}>
              Play virtual guitar chords in real-time with computer vision. Hold your guitar fretboard up to the webcam and strum to play.
            </p>

            <button
              onClick={() => startCamera()}
              className="btn-premium"
              style={{
                fontSize: '15px',
                padding: '10px 24px',
                gap: '8px',
                boxShadow: '0 4px 20px rgba(6, 182, 212, 0.4)',
                cursor: 'pointer'
              }}
            >
              <Play size={16} fill="currentColor" /> Start Camera
            </button>

            {/* Quick 3-Step Guide */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '12px',
              maxWidth: '520px',
              width: '100%',
              marginTop: '28px'
            }}>
              <div style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '8px',
                padding: '10px',
                fontSize: '12px',
                textAlign: 'left'
              }}>
                <div style={{ color: 'var(--accent-cyan)', fontWeight: 'bold', marginBottom: '4px' }}>1. Start Camera</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '11px', lineHeight: 1.4 }}>
                  Enable webcam access to begin video feed.
                </div>
              </div>

              <div style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '8px',
                padding: '10px',
                fontSize: '12px',
                textAlign: 'left'
              }}>
                <div style={{ color: 'var(--accent-purple)', fontWeight: 'bold', marginBottom: '4px' }}>2. Hold Guitar</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '11px', lineHeight: 1.4 }}>
                  Ensure neck markers (0, 5, 7, 12) are visible.
                </div>
              </div>

              <div style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '8px',
                padding: '10px',
                fontSize: '12px',
                textAlign: 'left'
              }}>
                <div style={{ color: 'var(--accent-green)', fontWeight: 'bold', marginBottom: '4px' }}>3. Strum Chords</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '11px', lineHeight: 1.4 }}>
                  Fret chords with left hand, strum with right hand.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Interactive Play-Along Song Highway Overlay (Only active when Song Studio is toggled on) */}
        {cameraActive && showSongStudio && (
          <SongHighway
            showGhostFrets={showGhostFrets}
            onToggleGhostFrets={() => setShowGhostFrets(prev => !prev)}
          />
        )}
      </div>

      {/* Hidden processing canvas */}
      <canvas
        ref={processingCanvasRef}
        style={{ display: 'none' }}
      />

      {/* Quick Fullscreen Button in Top Right */}
      <button
        type="button"
        onClick={toggleFullscreen}
        style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          zIndex: 25,
          background: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.18)',
          borderRadius: '8px',
          color: '#fff',
          padding: '7px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          transition: 'all 0.2s ease'
        }}
        title={isFullscreen ? "Exit Fullscreen (Esc)" : "Enter Fullscreen"}
      >
        {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>


      {/* Streamlined Controls Overlay (Accessible in both windowed and fullscreen modes) */}
      <div style={{
          position: 'absolute',
          bottom: '16px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 20,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          maxWidth: 'calc(100% - 32px)'
        }}>
          {/* ArUco Session Recorder Panel (raw video + per-frame detection metrics) */}
          {showRecorder && (
            <RecorderPanel
              state={recState}
              supported={recSupported}
              cameraActive={cameraActive}
              liveStats={recLiveStats}
              result={recResult}
              error={recError}
              onStart={handleStartRecording}
              onStop={handleStopRecording}
              onMark={handleMarkEvent}
              onReset={handleResetRecorder}
              onClose={() => setShowRecorder(false)}
            />
          )}

          {/* Per-camera intrinsic calibration (pauses AR processing while open) */}
          {showCalibration && (
            <CameraCalibrationPanel
              videoRef={videoRef}
              secondaryVideoRef={secondaryVideoRef}
              stereoEnabled={stereoEnabled}
              mirrored={isMirrored}
              addLog={addLog}
              onClose={() => setShowCalibration(false)}
            />
          )}

          {/* Detailed Performance Profiler Dashboard (Toggled via Profiler button or HUD) */}
          {showProfiler && (
            <div style={{
              background: 'rgba(15, 23, 42, 0.96)',
              backdropFilter: 'blur(16px)',
              borderRadius: '12px',
              border: '1px solid rgba(6, 182, 212, 0.3)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6), 0 0 20px rgba(6, 182, 212, 0.15)',
              padding: '12px 16px',
              width: '100%',
              maxWidth: '520px',
              color: '#e2e8f0',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}>
              {/* Header with Title, Live FPS & Copy Button */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Activity size={14} style={{ color: 'var(--accent-cyan)' }} />
                  <span style={{ fontWeight: 'bold', fontSize: '12px', color: '#fff' }}>Performance Profiler</span>
                  <span style={{
                    fontSize: '10px',
                    padding: '1px 6px',
                    borderRadius: '999px',
                    background: cameraActive ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                    color: cameraActive ? '#86efac' : '#fca5a5',
                    border: cameraActive ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)'
                  }}>
                    {cameraActive ? `${fps} FPS` : 'Offline'}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={handleCopyReport}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '3px 8px',
                      fontSize: '11px',
                      borderRadius: '6px',
                      border: copiedReport ? '1px solid #22c55e' : '1px solid rgba(255, 255, 255, 0.18)',
                      background: copiedReport ? 'rgba(34, 197, 94, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                      color: copiedReport ? '#86efac' : '#cbd5e1',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                    title="Copy formatted benchmark report to clipboard"
                  >
                    {copiedReport ? <Check size={12} /> : <Copy size={12} />}
                    <span>{copiedReport ? 'Copied!' : 'Copy Stats'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowProfiler(false)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      padding: '2px',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                    title="Close Profiler"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Stage Breakdown Bars & Latencies */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {[
                  { label: 'MediaPipe Hands', time: perfTimings.mp, color: '#a855f7', desc: 'Hand landmarker inference (GPU/CPU)' },
                  { label: 'OpenCV ArUco', time: perfTimings.aruco, color: '#06b6d4', desc: 'Marker quad search & bit decoding' },
                  { label: 'Video Buffer Copy', time: perfTimings.copy, color: '#f59e0b', desc: 'Video to canvas & pixel extraction' },
                  { label: 'Neck & Chord Math', time: perfTimings.math, color: '#22c55e', desc: 'Pose solve, guitar raycast, chord smoother' },
                  { label: '2D Canvas Render', time: perfTimings.render, color: '#ec4899', desc: 'Frets, strings, bones, ghost fingering' }
                ].map((stage) => {
                  const t = parseFloat(stage.time) || 0;
                  const totalT = Math.max(parseFloat(perfTimings.total) || 1, 1);
                  const pct = Math.min(100, Math.round((t / totalT) * 100));
                  return (
                    <div key={stage.label} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }} title={stage.desc}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px' }}>
                        <span style={{ color: '#cbd5e1' }}>{stage.label}</span>
                        <span style={{ color: stage.color, fontWeight: 'bold' }}>
                          {stage.time}ms <span style={{ color: '#64748b', fontWeight: 'normal' }}>({pct}%)</span>
                        </span>
                      </div>
                      <div style={{
                        height: '4px',
                        borderRadius: '2px',
                        background: 'rgba(255, 255, 255, 0.08)',
                        overflow: 'hidden'
                      }}>
                        <div style={{
                          height: '100%',
                          width: `${pct}%`,
                          background: stage.color,
                          borderRadius: '2px',
                          transition: 'width 0.2s ease'
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Budget Bar comparison against 33.3ms (30fps) and 16.6ms (60fps) */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'rgba(0, 0, 0, 0.3)',
                padding: '4px 8px',
                borderRadius: '6px',
                fontSize: '10px'
              }}>
                <span style={{ color: '#94a3b8' }}>Total Frame: <strong style={{ color: parseFloat(perfTimings.total) <= 33.3 ? '#86efac' : '#f87171' }}>{perfTimings.total}ms</strong></span>
                <span style={{ color: '#64748b' }}>Target: 33.3ms (30 FPS) • 16.6ms (60 FPS)</span>
              </div>

              {/* Device Telemetry Badges */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                gap: '6px',
                fontSize: '9.5px',
                color: '#94a3b8',
                background: 'rgba(255, 255, 255, 0.03)',
                padding: '6px 8px',
                borderRadius: '6px',
                border: '1px solid rgba(255, 255, 255, 0.06)'
              }}>
                <div>GPU: <span style={{ color: '#cbd5e1' }}>{gpuInfo.renderer ? gpuInfo.renderer.split('(')[0].slice(0, 18) : 'Standard'}</span></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span>Engine:</span>
                  <button
                    type="button"
                    onClick={handleToggleMpDelegate}
                    style={{
                      background: mpDelegate === 'GPU' ? 'rgba(34, 197, 94, 0.25)' : 'rgba(245, 158, 11, 0.25)',
                      border: mpDelegate === 'GPU' ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(245, 158, 11, 0.4)',
                      borderRadius: '4px',
                      color: mpDelegate === 'GPU' ? '#86efac' : '#fbbf24',
                      padding: '1px 6px',
                      fontSize: '9px',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontWeight: 'bold'
                    }}
                    title="Click to toggle MediaPipe backend between WebGL GPU and multi-core CPU SIMD"
                  >
                    {mpDelegate === 'GPU' ? '⚡ GPU (tap for CPU)' : '🧠 CPU SIMD (tap for GPU)'}
                  </button>
                </div>
                <div>Resolution: <span style={{ color: '#cbd5e1' }}>{perfTimings.res || captureResolution} ({perfTimings.procRes || '640x360'})</span></div>
                <div>Cores: <span style={{ color: '#cbd5e1' }}>{navigator.hardwareConcurrency || 'N/A'}</span></div>
              </div>
            </div>
          )}

          {/* Secondary Tuning / Calibration Drawer (Toggled via Options button) */}
          {showAdvancedControls && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              background: 'rgba(15, 23, 42, 0.95)',
              backdropFilter: 'blur(12px)',
              padding: '8px 16px',
              borderRadius: '10px',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
              overflowX: 'auto',
              maxWidth: '100%'
            }}>
              {/* Camera Resolution Selector */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: 'var(--text-secondary)',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)'
              }}>
                <Video size={13} style={{ color: 'var(--accent-cyan)' }} />
                <select
                  value={captureResolution}
                  onChange={(e) => handleResolutionChange(e.target.value)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.18)',
                    borderRadius: '6px',
                    color: 'var(--text-primary)',
                    padding: '4px 6px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    cursor: 'pointer',
                    outline: 'none'
                  }}
                  title="Webcam Capture Resolution"
                >
                  <option value="720p" style={{ background: '#0f172a', color: '#fff' }}>720p HD</option>
                  <option value="480p" style={{ background: '#0f172a', color: '#fff' }}>480p VGA</option>
                  <option value="1080p" style={{ background: '#0f172a', color: '#fff' }}>1080p FHD</option>
                </select>
              </div>

              {/* Camera Device & Facing Mode Selector */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: 'var(--text-secondary)',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
                borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
                paddingLeft: '10px'
              }}>
                <Camera size={13} style={{ color: 'var(--accent-purple)' }} />
                <select
                  value={selectedDeviceId || facingMode}
                  onChange={(e) => handleCameraChange(e.target.value)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.18)',
                    borderRadius: '6px',
                    color: 'var(--text-primary)',
                    padding: '4px 6px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    cursor: 'pointer',
                    outline: 'none',
                    maxWidth: '160px'
                  }}
                  title="Select Camera Input"
                >
                  {(isMobileDevice() || availableCameras.length > 1) ? (
                    <>
                      <option value="user" style={{ background: '#0f172a', color: '#fff' }}>Front (Selfie)</option>
                      <option value="environment" style={{ background: '#0f172a', color: '#fff' }}>Back Camera</option>
                      {availableCameras.map((cam, idx) => (
                        <option key={cam.deviceId || idx} value={cam.deviceId} style={{ background: '#0f172a', color: '#fff' }}>
                          {cam.label || `Camera ${idx + 1}`}
                        </option>
                      ))}
                    </>
                  ) : (
                    <option value="user" style={{ background: '#0f172a', color: '#fff' }}>
                      {availableCameras[0]?.label || 'Default Webcam'}
                    </option>
                  )}
                </select>

                {/* Quick Flip Camera Button (shown on mobile or when multiple cameras are detected) */}
                {(isMobileDevice() || availableCameras.length > 1) && (
                  <button
                    type="button"
                    onClick={handleFlipCamera}
                    style={{
                      padding: '3px 6px',
                      fontSize: '11px',
                      borderRadius: '5px',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      background: 'rgba(255, 255, 255, 0.06)',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px'
                    }}
                    title={`Switch to ${facingMode === 'user' ? 'Back' : 'Front'} Camera`}
                  >
                    <SwitchCamera size={12} />
                    <span>Flip</span>
                  </button>
                )}

                {/* Lens / intrinsic calibration */}
                <button
                  id="open-camera-calibration"
                  type="button"
                  onClick={() => setShowCalibration(true)}
                  disabled={!cameraActive}
                  style={{
                    padding: '3px 8px',
                    fontSize: '11px',
                    borderRadius: '5px',
                    border: (calibStatus.cam1 && (!stereoEnabled || calibStatus.cam2)) ? '1px solid rgba(74, 222, 128, 0.5)' : '1px solid rgba(245, 158, 11, 0.5)',
                    background: (calibStatus.cam1 && (!stereoEnabled || calibStatus.cam2)) ? 'rgba(74, 222, 128, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                    color: (calibStatus.cam1 && (!stereoEnabled || calibStatus.cam2)) ? '#86efac' : '#fbbf24',
                    cursor: cameraActive ? 'pointer' : 'not-allowed',
                    opacity: cameraActive ? 1 : 0.5,
                    whiteSpace: 'nowrap'
                  }}
                  title="Calibrate camera lens (focal length & distortion) with a printed marker board"
                >
                  📐 Calibrate {calibStatus.cam1 ? '✓' : '·'}{stereoEnabled ? (calibStatus.cam2 ? '✓' : '·') : ''}
                </button>
                <a
                  href="/neck/index.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 8px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    borderRadius: '5px',
                    border: '1px solid rgba(56, 189, 248, 0.4)',
                    background: 'rgba(56, 189, 248, 0.1)',
                    color: '#38bdf8',
                    textDecoration: 'none',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                  title="Print your own physical AR Guitar practice neck (1:1 scale PDF / SVG template)"
                >
                  🎸 Print Neck
                </a>
              </div>

              {/* Guitar Tone / Instrument Selector */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: 'var(--text-secondary)',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
                borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
                paddingLeft: '10px'
              }}>
                <span style={{ whiteSpace: 'nowrap' }}>Tone:</span>
                <select
                  value={guitarInstrument}
                  onChange={(e) => handleInstrumentChange(e.target.value)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: `1px solid ${GUITAR_INSTRUMENTS[guitarInstrument]?.color || 'rgba(255, 255, 255, 0.2)'}`,
                    borderRadius: '6px',
                    color: GUITAR_INSTRUMENTS[guitarInstrument]?.color || 'var(--text-primary)',
                    padding: '4px 6px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    cursor: 'pointer',
                    outline: 'none',
                    fontWeight: 600
                  }}
                  title="Choose Guitar Sound (Acoustic vs Electric Clean vs Electric Rock)"
                >
                  {Object.entries(GUITAR_INSTRUMENTS).map(([key, inst]) => (
                    <option key={key} value={key} style={{ background: '#0f172a', color: inst.color }}>
                      {inst.icon} {inst.name}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => {
                    const next = guitarAudio.togglePalmMute();
                    setIsPalmMuted(next);
                  }}
                  style={{
                    padding: '3px 8px',
                    fontSize: '11px',
                    borderRadius: '5px',
                    border: isPalmMuted ? '1px solid #ef4444' : '1px solid rgba(255, 255, 255, 0.15)',
                    background: isPalmMuted ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255, 255, 255, 0.06)',
                    color: isPalmMuted ? '#f87171' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                  title="Palm Mute: Damps string vibrations for punchy staccato rhythm / rock chugging"
                >
                  <span>✋</span>
                  <span>{isPalmMuted ? 'Palm Mute ON' : 'Palm Mute'}</span>
                </button>
              </div>

              {/* Dual-Camera (Stereo 3D) Depth Mode Selector */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: 'var(--text-secondary)',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
                borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
                paddingLeft: '10px'
              }}>
                <button
                  type="button"
                  onClick={() => {
                    const next = !stereoEnabled;
                    setStereoEnabled(next);
                    localStorage.setItem('arguitar_stereo_enabled', next ? 'true' : 'false');
                    if (addLog) addLog(next ? "👓 Dual-Camera Stereo 3D enabled!" : "Single camera mode restored");
                  }}
                  style={{
                    padding: '3px 8px',
                    fontSize: '11px',
                    borderRadius: '5px',
                    border: stereoEnabled ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.15)',
                    background: stereoEnabled ? 'rgba(6, 182, 212, 0.25)' : 'rgba(255, 255, 255, 0.06)',
                    color: stereoEnabled ? '#38bdf8' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontWeight: stereoEnabled ? 'bold' : 'normal',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                  title="Enable Dual-Camera Stereo 3D Tracking for millimeter-accurate strumming depth and occlusion immunity"
                >
                  <span>👓 Stereo 3D</span>
                  <span style={{
                    fontSize: '9px',
                    padding: '1px 4px',
                    borderRadius: '3px',
                    background: stereoEnabled ? '#0284c7' : 'rgba(255, 255, 255, 0.1)',
                    color: '#fff'
                  }}>
                    {stereoEnabled ? 'ON' : 'OFF'}
                  </span>
                </button>

                {stereoEnabled && (
                  <>
                    <select
                      value={secondaryDeviceId}
                      onChange={(e) => {
                        setSecondaryDeviceId(e.target.value);
                        localStorage.setItem('arguitar_secondary_cam', e.target.value);
                      }}
                      style={{
                        background: 'rgba(255, 255, 255, 0.08)',
                        border: '1px solid rgba(56, 189, 248, 0.35)',
                        borderRadius: '6px',
                        color: '#38bdf8',
                        padding: '3px 6px',
                        fontSize: '11px',
                        fontFamily: 'var(--font-mono)',
                        cursor: 'pointer',
                        outline: 'none',
                        maxWidth: '140px'
                      }}
                      title="Select Secondary Camera (Cam 2)"
                    >
                      <option value="" style={{ background: '#0f172a', color: '#94a3b8' }}>Select 2nd Cam...</option>
                      {availableCameras
                        .filter(cam => cam.deviceId !== selectedDeviceId)
                        .map((cam, idx) => (
                          <option key={cam.deviceId || idx} value={cam.deviceId} style={{ background: '#0f172a', color: '#fff' }}>
                            {cam.label || `Camera ${idx + 2}`}
                          </option>
                        ))}
                    </select>

                    {/* PiP preview toggle */}
                    <button
                      type="button"
                      onClick={() => setShowPip(prev => !prev)}
                      style={{
                        padding: '2px 6px',
                        fontSize: '10px',
                        borderRadius: '4px',
                        border: showPip ? '1px solid #06b6d4' : '1px solid rgba(255, 255, 255, 0.15)',
                        background: showPip ? 'rgba(6, 182, 212, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                        color: showPip ? '#38bdf8' : 'var(--text-secondary)',
                        cursor: 'pointer'
                      }}
                      title="Toggle Cam 2 Picture-in-Picture window"
                    >
                      PiP
                    </button>

                    {/* Live calibration readout */}
                    <span style={{
                      fontSize: '10px',
                      color: stereoStatus.calibrated ? '#4ade80' : '#f59e0b',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                      whiteSpace: 'nowrap'
                    }}>
                      {stereoStatus.calibrated ? `🟢 ${stereoStatus.baseline}cm (${stereoStatus.angle}°)` : '🟡 Aligning...'}
                    </span>

                    {/* Physical Baseline Calibrator */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }} title="Physical distance between webcams in cm (measured 34 cm)">
                      <span style={{ fontSize: '10px', color: '#94a3b8' }}>Physical:</span>
                      <input
                        type="number"
                        min="10"
                        max="150"
                        step="0.5"
                        defaultValue="34.0"
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (val > 0) stereoTracker.setUserBaseline(val);
                        }}
                        style={{
                          width: '42px',
                          background: 'rgba(255, 255, 255, 0.08)',
                          border: '1px solid rgba(56, 189, 248, 0.3)',
                          borderRadius: '4px',
                          color: '#38bdf8',
                          padding: '1px 3px',
                          fontSize: '10px',
                          fontFamily: 'var(--font-mono)',
                          textAlign: 'center'
                        }}
                      />
                      <span style={{ fontSize: '10px', color: '#94a3b8' }}>cm</span>
                    </div>

                    {/* Zero Strum Button */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <button
                        type="button"
                        onClick={() => {
                          const now = performance.now();
                          const last = lastLiveClearanceRef.current;
                          if (last && last.cm !== null && (now - last.time) < 3000) {
                            const newOffset = stereoTracker.zeroStrumPlane(last.cm);
                            setStrumOffset(newOffset);
                            if (addLog) addLog(`🎯 Strum plane zeroed! (Offset: ${newOffset.toFixed(1)}cm)`);
                          } else {
                            if (addLog) addLog(`⚠️ Strum hand not detected in stereo. Rest pick/fingers on strings and try again.`);
                          }
                        }}
                        style={{
                          padding: '2px 7px',
                          fontSize: '10px',
                          borderRadius: '4px',
                          border: '1px solid rgba(245, 158, 11, 0.5)',
                          background: 'rgba(245, 158, 11, 0.15)',
                          color: '#fbbf24',
                          cursor: 'pointer',
                          fontWeight: 'bold',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '3px'
                        }}
                        title="Touch strings with pick/fingers and click to zero strum depth live (clears air-hover error)"
                      >
                        <span>🎯 Zero Strum</span>
                        {stereoStatus.liveClearance !== null && (
                          <span style={{ fontSize: '9px', opacity: 0.85 }}>
                            ({parseFloat(stereoStatus.liveClearance) >= 0 ? '+' : ''}{stereoStatus.liveClearance}cm)
                          </span>
                        )}
                      </button>

                      {/* Reset strum offset button */}
                      {Math.abs(strumOffset - 1.2) > 0.05 && (
                        <button
                          type="button"
                          onClick={() => {
                            const def = stereoTracker.resetStrumPlaneOffset();
                            setStrumOffset(def);
                            if (addLog) addLog(`Strum offset reset to default (${def.toFixed(1)}cm)`);
                          }}
                          style={{
                            padding: '1px 4px',
                            fontSize: '9px',
                            borderRadius: '3px',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            background: 'rgba(255, 255, 255, 0.05)',
                            color: '#94a3b8',
                            cursor: 'pointer'
                          }}
                          title="Reset strum offset to default (1.2cm)"
                        >
                          ↺
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Neck Width Calibrator */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: 'var(--text-secondary)',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
                borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
                paddingLeft: '10px'
              }}>
                <Sliders size={13} style={{ color: 'var(--accent-cyan)' }} />
                <span style={{ whiteSpace: 'nowrap' }}>Width:</span>
                <input
                  type="range"
                  min="1.0"
                  max="2.5"
                  step="0.05"
                  value={neckWidthScale}
                  onChange={(e) => setNeckWidthScale(parseFloat(e.target.value))}
                  style={{
                    width: '56px',
                    accentColor: 'var(--accent-cyan)',
                    cursor: 'pointer'
                  }}
                  title="Adjust visual string spacing across the neck"
                />
                <span style={{ color: 'var(--accent-cyan)', minWidth: '30px', fontWeight: 'bold', fontSize: '11px' }}>
                  {neckWidthScale.toFixed(2)}x
                </span>
              </div>

              {/* Fret Scale Calibrator */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: 'var(--text-secondary)',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
                borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
                paddingLeft: '10px'
              }}>
                <Sliders size={13} style={{ color: 'var(--accent-green)' }} />
                <span style={{ whiteSpace: 'nowrap' }}>Scale:</span>
                <input
                  type="range"
                  min="46.0"
                  max="58.0"
                  step="0.2"
                  value={fretScaleLength}
                  onChange={(e) => setFretScaleLength(parseFloat(e.target.value))}
                  style={{
                    width: '56px',
                    accentColor: 'var(--accent-green)',
                    cursor: 'pointer'
                  }}
                  title="Adjust 12th fret alignment along the neck"
                />
                <span style={{ color: 'var(--accent-green)', minWidth: '38px', fontWeight: 'bold', fontSize: '11px' }}>
                  {fretScaleLength.toFixed(1)}cm
                </span>
              </div>

              {/* Video Size Selector */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                color: 'var(--text-secondary)',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
                borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
                paddingLeft: '10px'
              }}>
                <span style={{ whiteSpace: 'nowrap', marginRight: '2px' }}>Size:</span>
                {[
                  { label: '800', value: '800' },
                  { label: '1000', value: '1000' },
                  { label: '1200', value: '1200' },
                  { label: 'Fit', value: 'full' }
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onCameraSizeChange && onCameraSizeChange(opt.value)}
                    style={{
                      padding: '2px 6px',
                      fontSize: '11px',
                      borderRadius: '5px',
                      border: cameraSize === opt.value ? '1px solid var(--accent-cyan)' : '1px solid rgba(255, 255, 255, 0.12)',
                      background: cameraSize === opt.value ? 'rgba(6, 182, 212, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                      color: cameraSize === opt.value ? '#38bdf8' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontWeight: cameraSize === opt.value ? 'bold' : 'normal',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Debug Marker & Alignment Diagnostics Toggle */}
              <button
                type="button"
                onClick={() => setShowMarkerDebug(prev => !prev)}
                style={{
                  padding: '3px 8px',
                  fontSize: '11px',
                  borderRadius: '6px',
                  border: showMarkerDebug ? '1px solid #f59e0b' : '1px solid rgba(255, 255, 255, 0.14)',
                  background: showMarkerDebug ? 'rgba(245, 158, 11, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                  color: showMarkerDebug ? '#fbbf24' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: showMarkerDebug ? 'bold' : 'normal',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  whiteSpace: 'nowrap',
                  borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
                  marginLeft: '4px',
                  transition: 'all 0.15s ease'
                }}
                title="Toggle live on-screen ArUco marker centers, baseline vector, and nut/bridge ray tracing"
              >
                🛠️ {showMarkerDebug ? 'Hide Debug' : 'Debug Rays'}
              </button>

              {/* MediaPipe Delegate Switcher (GPU vs Multi-core CPU) */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                color: 'var(--text-secondary)',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
                borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
                paddingLeft: '10px'
              }}>
                <Cpu size={13} style={{ color: mpDelegate === 'GPU' ? '#86efac' : '#f59e0b' }} />
                <button
                  type="button"
                  onClick={handleToggleMpDelegate}
                  style={{
                    padding: '3px 8px',
                    fontSize: '11px',
                    borderRadius: '5px',
                    border: '1px solid rgba(255, 255, 255, 0.18)',
                    background: mpDelegate === 'GPU' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                    color: mpDelegate === 'GPU' ? '#86efac' : '#fbbf24',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontFamily: 'var(--font-mono)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                  title="Switch MediaPipe backend between WebGL GPU and Multi-core CPU (XNNPACK SIMD)"
                >
                  {mpDelegate === 'GPU' ? '⚡ GPU' : '🧠 CPU (SIMD)'}
                </button>
              </div>

              {/* Performance Profiler Toggle */}
              <button
                type="button"
                onClick={() => setShowProfiler(prev => !prev)}
                style={{
                  padding: '3px 8px',
                  fontSize: '11px',
                  borderRadius: '6px',
                  border: showProfiler ? '1px solid #06b6d4' : '1px solid rgba(255, 255, 255, 0.14)',
                  background: showProfiler ? 'rgba(6, 182, 212, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                  color: showProfiler ? '#38bdf8' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: showProfiler ? 'bold' : 'normal',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  whiteSpace: 'nowrap',
                  borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
                  marginLeft: '4px',
                  transition: 'all 0.15s ease'
                }}
                title="Toggle live hardware execution profiler & telemetry"
              >
                <Activity size={12} color={showProfiler ? '#38bdf8' : 'var(--text-secondary)'} />
                <span>{showProfiler ? 'Hide Profiler' : '⚡ Profiler'}</span>
              </button>
            </div>
          )}

          {/* Primary Essential Controls Bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            background: 'rgba(15, 23, 42, 0.9)',
            backdropFilter: 'blur(10px)',
            padding: '8px 14px',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            overflowX: 'auto',
            maxWidth: '100%'
          }}>
            {/* Start / Stop Camera Button */}
            {cameraActive ? (
              <button
                className="btn-premium"
                style={{ background: 'linear-gradient(135deg, var(--accent-red) 0%, rgba(239, 68, 68, 0.7) 100%)' }}
                onClick={stopCamera}
              >
                <Square size={15} /> Stop Camera
              </button>
            ) : (
              <button
                className="btn-premium"
                style={{ background: 'linear-gradient(135deg, var(--accent-cyan) 0%, rgba(6, 182, 212, 0.8) 100%)' }}
                onClick={() => startCamera()}
              >
                <Play size={15} fill="currentColor" /> Start Camera
              </button>
            )}

            {/* Play-Along Songs Toggle Button */}
            <button
              type="button"
              className={`btn-secondary ${showSongStudio ? 'active' : ''}`}
              onClick={onToggleSongStudio}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                fontSize: '12px',
                borderColor: showSongStudio ? 'var(--accent-purple)' : 'rgba(255, 255, 255, 0.15)',
                background: showSongStudio ? 'rgba(168, 85, 247, 0.22)' : undefined,
                color: showSongStudio ? '#d8b4fe' : 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              title="Toggle interactive play-along song highway & track library"
            >
              <Music size={14} color={showSongStudio ? 'var(--accent-purple)' : 'var(--text-secondary)'} />
              <span style={{ fontFamily: 'var(--font-mono)' }}>Songs</span>
              <span style={{
                fontSize: '9px',
                padding: '1px 5px',
                borderRadius: '999px',
                background: showSongStudio ? 'rgba(168, 85, 247, 0.45)' : 'rgba(255, 255, 255, 0.1)',
                color: showSongStudio ? '#fff' : 'var(--text-muted)',
                fontWeight: 'bold'
              }}>
                {showSongStudio ? 'ON' : 'OFF'}
              </span>
            </button>

            {/* Real-time Audio Toggle Button */}
            <button
              type="button"
              className={`btn-secondary ${audioEnabled ? 'active' : ''}`}
              onClick={async () => {
                const next = !audioEnabled;
                setAudioEnabled(next);
                guitarAudio.setMuted(!next);
                if (next) await guitarAudio.ensureAudioContext();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                fontSize: '12px'
              }}
              title={audioEnabled ? "Guitar Sound ON (Click to Mute)" : "Guitar Sound Muted (Click to Unmute)"}
            >
              {audioEnabled ? <Volume2 size={15} color="var(--accent-cyan)" /> : <VolumeX size={15} color="var(--text-secondary)" />}
              <span style={{ fontFamily: 'var(--font-mono)' }}>{audioEnabled ? 'Sound ON' : 'Muted'}</span>
            </button>

            {/* Guitar Sound Model / Instrument Cycle Button */}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                const instKeys = Object.keys(GUITAR_INSTRUMENTS);
                const nextIdx = (instKeys.indexOf(guitarInstrument) + 1) % instKeys.length;
                handleInstrumentChange(instKeys[nextIdx]);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 10px',
                fontSize: '12px',
                borderColor: GUITAR_INSTRUMENTS[guitarInstrument]?.color || 'var(--accent-cyan)'
              }}
              title={`Guitar Tone: ${GUITAR_INSTRUMENTS[guitarInstrument]?.name} (Click to switch to Electric / Acoustic)`}
            >
              <span>{GUITAR_INSTRUMENTS[guitarInstrument]?.icon || '🎸'}</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: GUITAR_INSTRUMENTS[guitarInstrument]?.color }}>
                {GUITAR_INSTRUMENTS[guitarInstrument]?.badge || 'Acoustic'}
              </span>
            </button>

            {/* Palm Mute (Damping) Toggle */}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                const next = guitarAudio.togglePalmMute();
                setIsPalmMuted(next);
                if (addLog) addLog(next ? "✋ Palm Mute ON: Tight staccato chugging" : "✋ Palm Mute OFF: Open sustain");
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 10px',
                fontSize: '12px',
                background: isPalmMuted ? 'rgba(239, 68, 68, 0.22)' : 'rgba(255, 255, 255, 0.05)',
                borderColor: isPalmMuted ? '#ef4444' : 'rgba(255, 255, 255, 0.15)'
              }}
              title={isPalmMuted ? "Palm Mute ON (Click to play open sustain)" : "Palm Mute OFF (Click for tight staccato rock/metal chugging)"}
            >
              <span>✋</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: isPalmMuted ? '#f87171' : 'var(--text-secondary)' }}>
                {isPalmMuted ? 'Muted' : 'Open'}
              </span>
            </button>

            {/* Stereo 3D Status Indicator / Toggle */}
            {stereoEnabled && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setShowPip(prev => !prev);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 10px',
                  fontSize: '12px',
                  borderColor: stereoStatus.calibrated ? '#38bdf8' : '#f59e0b'
                }}
                title="Dual-Camera Stereo 3D active (Click to toggle Cam 2 Picture-in-Picture preview)"
              >
                <span>👓</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: stereoStatus.calibrated ? '#38bdf8' : '#fbbf24' }}>
                  {stereoStatus.calibrated ? `Stereo: ${stereoStatus.baseline}cm` : 'Stereo Aligning'}
                </span>
              </button>
            )}

            {/* Strum Mode Cycle Button */}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                const modes = ['smart', 'down', 'both'];
                const nextIdx = (modes.indexOf(strumMode) + 1) % modes.length;
                setStrumMode(modes[nextIdx]);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 10px',
                fontSize: '12px',
                borderColor: strumMode === 'smart' ? '#06b6d4' : (strumMode === 'down' ? '#f59e0b' : '#a855f7')
              }}
              title="Click to cycle strum mode: Smart Strum (Play upstrokes, mute air returns) -> Down Only -> Down & Up"
            >
              <Compass size={14} color={strumMode === 'smart' ? '#06b6d4' : (strumMode === 'down' ? '#f59e0b' : '#a855f7')} />
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {strumMode === 'smart' && '🎯 Smart Strum'}
                {strumMode === 'down' && '⬇️ Down Only'}
                {strumMode === 'both' && '⇅ Down & Up'}
              </span>
            </button>

            {/* Play-Along Song Difficulty Level Button */}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                const nextLevel = (playLevel % 3) + 1;
                setPlayLevel(nextLevel);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 10px',
                fontSize: '12px',
                borderColor: playLevel === 1 ? '#38bdf8' : (playLevel === 2 ? '#10b981' : '#f59e0b')
              }}
              title="Click to cycle song play difficulty: Level 1 (Auto-Chord) -> Level 2 (Assist / Close Enough) -> Level 3 (Pro / Realistic)"
            >
              <Award size={14} color={playLevel === 1 ? '#38bdf8' : (playLevel === 2 ? '#10b981' : '#f59e0b')} />
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {playLevel === 1 && '⭐ L1: Auto'}
                {playLevel === 2 && '🎯 L2: Assist'}
                {playLevel === 3 && '🔥 L3: Pro'}
              </span>
            </button>

            {/* Advanced Tuning / Calibrate Toggle */}
            <button
              type="button"
              className={`btn-secondary ${showAdvancedControls ? 'active' : ''}`}
              onClick={() => setShowAdvancedControls(prev => !prev)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 10px',
                fontSize: '12px',
                borderColor: showAdvancedControls ? 'var(--accent-cyan)' : 'rgba(255, 255, 255, 0.15)',
                background: showAdvancedControls ? 'rgba(6, 182, 212, 0.15)' : undefined
              }}
              title="Toggle Calibration & Resolution Options"
            >
              <Settings size={14} style={{ color: showAdvancedControls ? 'var(--accent-cyan)' : 'var(--text-secondary)' }} />
              <span style={{ fontFamily: 'var(--font-mono)' }}>Options</span>
            </button>

            {/* ArUco Session Recorder Toggle */}
            <button
              id="rec-toggle-btn"
              type="button"
              className={`btn-secondary ${showRecorder || recState === 'recording' ? 'active' : ''}`}
              onClick={() => setShowRecorder(prev => !prev)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 10px',
                fontSize: '12px',
                borderColor: recState === 'recording'
                  ? 'var(--accent-red)'
                  : (showRecorder ? 'rgba(239, 68, 68, 0.6)' : 'rgba(255, 255, 255, 0.15)'),
                background: recState === 'recording' ? 'rgba(239, 68, 68, 0.2)' : undefined
              }}
              title="Record camera video + ArUco detection metrics for offline analysis"
            >
              <span className={`rec-dot ${recState === 'recording' ? 'recording' : ''}`} />
              <span style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                {recState === 'recording'
                  ? `REC ${Math.floor((recLiveStats?.elapsedSec || 0) / 60)}:${String(Math.floor((recLiveStats?.elapsedSec || 0) % 60)).padStart(2, '0')}`
                  : 'Record'}
              </span>
            </button>

            {/* Fullscreen Button in Controls Bar */}
            <button
              type="button"
              onClick={toggleFullscreen}
              className="btn-secondary"
              style={{
                padding: '5px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '12px',
                borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
                cursor: 'pointer'
              }}
              title={isFullscreen ? "Exit Fullscreen (Esc)" : "Enter Fullscreen"}
            >
              {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              <span style={{ whiteSpace: 'nowrap' }}>{isFullscreen ? 'Exit' : 'Full'}</span>
            </button>
          </div>
        </div>

      {/* Clean HUD Live & FPS Label + Hardware Diagnostics (Only when active) */}
      {cameraActive && (
        <div style={{
          position: 'absolute',
          top: '16px',
          left: '16px',
          zIndex: 20,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '6px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span className="status-pill active" style={{ fontSize: '11px' }}>
              <Video size={12} /> Feed: LIVE
            </span>
            <span className="status-pill active" style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
              {fps} FPS
            </span>
            <span
              className="status-pill"
              title={mpError ? `Fallback Reason: ${mpError}` : (gpuInfo.renderer ? `GPU Renderer: ${gpuInfo.renderer}` : '')}
              style={{
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                background: mpDelegate === 'GPU' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                borderColor: mpDelegate === 'GPU' ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)',
                color: mpDelegate === 'GPU' ? '#86efac' : '#fca5a5'
              }}
            >
              <Cpu size={12} /> MP: {mpDelegate}
            </span>
            {recState === 'recording' && (
              <span
                className="status-pill"
                onClick={() => setShowRecorder(true)}
                style={{
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'rgba(239, 68, 68, 0.18)',
                  borderColor: 'rgba(239, 68, 68, 0.5)',
                  color: '#fca5a5',
                  cursor: 'pointer'
                }}
                title="Recording ArUco session — click to open the recorder"
              >
                <span className="rec-dot recording" /> REC
                {recLiveStats ? ` · ${recLiveStats.pctTwoPlusMarkers}% ≥2 markers` : ''}
              </span>
            )}
          </div>

          {/* Real-time frame latency breakdown */}
          <div
            onClick={() => setShowProfiler(prev => !prev)}
            style={{
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              background: 'rgba(15, 23, 42, 0.85)',
              backdropFilter: 'blur(6px)',
              padding: '3px 8px',
              borderRadius: '6px',
              color: '#94a3b8',
              border: showProfiler ? '1px solid #06b6d4' : '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer'
            }}
            title="Click to toggle detailed performance profiler"
          >
            <Activity size={10} color={showProfiler ? '#38bdf8' : '#64748b'} />
            <span>MP: <strong style={{ color: mpDelegate === 'GPU' ? '#86efac' : '#fca5a5' }}>{perfTimings.mp}ms</strong></span>
            <span style={{ opacity: 0.4 }}>•</span>
            <span>ArUco: <strong style={{ color: '#cbd5e1' }}>{perfTimings.aruco}ms</strong></span>
            <span style={{ opacity: 0.4 }}>•</span>
            <span>Total: <strong style={{ color: '#e2e8f0' }}>{perfTimings.total}ms</strong></span>
            {mpError && (
              <>
                <span style={{ opacity: 0.4 }}>•</span>
                <span style={{ color: '#f87171' }} title={mpError}>Fallback: {mpError.slice(0, 20)}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
