import { useEffect, useRef, useState } from 'react';
import { Play, Square, Video, Sliders, Maximize2, Minimize2, Volume2, VolumeX, Compass, Settings, Cpu } from 'lucide-react';
import { detectMarkers } from '../utils/aruco_detector';
import {
  getNeckGeometry,
  calculateFretAndStringFromGeometry,
  getFretPositionAndWidth,
  createCameraMats,
  solvePose,
  FRETS_FOR_DRAWING,
  FRET_ABSOLUTE_DISTANCES_FROM_NUT,
  ARUCO_MARKER_MAP
} from '../utils/guitar_math';
import { detectChordFromFingers, createChordSmoother } from '../utils/chord_detector';
import { guitarAudio } from '../utils/guitar_audio';
import SongHighway from './SongHighway';
import { songEngine } from '../utils/song_engine';

// Helper to draw text un-mirrored on a mirrored canvas context
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

  // Translate to the target coordinate
  ctx.translate(x, y);
  // Mirror horizontally
  ctx.scale(-1, 1);

  // Draw text at origin
  ctx.fillText(text, 0, 0);

  ctx.restore();
};

// Resolution presets for webcam capture
const RESOLUTION_PRESETS = {
  '720p':  { width: 1280, height: 720,  label: '720p HD' },
  '480p':  { width: 640,  height: 480,  label: '480p VGA' },
  '1080p': { width: 1920, height: 1080, label: '1080p FHD' }
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
  showSongStudio = false
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
  const [perfTimings, setPerfTimings] = useState({ aruco: '0', mp: '0', total: '0' });
  const perfTimingsRef = useRef({ aruco: '0', mp: '0', total: '0' });

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
    return saved ? parseFloat(saved) : 49.6;
  });
  const fretScaleLengthRef = useRef(fretScaleLength);
  useEffect(() => {
    fretScaleLengthRef.current = fretScaleLength;
    localStorage.setItem('arguitar_fret_scale', fretScaleLength.toString());
  }, [fretScaleLength]);

  const loopRef = useRef(null);
  const landmarkerRef = useRef(null);
  const loadingRef = useRef(false);
  const lastTimeRef = useRef(0);
  const lastLoggedIdsRef = useRef("");
  const lastDiagTimeRef = useRef(0);

  // Strumming and picking tracking refs
  const lastStrumStateRef = useRef({ time: 0, s: null, inZone: false });
  const vibratingStringsRef = useRef({});
  const pickTrailRef = useRef([]);
  const activeStrumDisplayRef = useRef({ text: '', time: 0, color: '#f59e0b' });

  // Chord detection refs
  const chordSmootherRef = useRef(createChordSmoother(5, 320));
  const activeChordRef = useRef(null);

  // Start webcam feed
  const startCamera = async (targetRes = captureResolutionRef.current) => {
    try {
      const resConfig = RESOLUTION_PRESETS[targetRes] || RESOLUTION_PRESETS['720p'];
      console.log(`Requesting webcam access (${resConfig.label}: ${resConfig.width}x${resConfig.height})...`);
      if (addLog) addLog(`Requesting webcam access (${resConfig.label})...`);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: resConfig.width },
          height: { ideal: resConfig.height },
          frameRate: { ideal: 30 }
        }
      });

      console.log(`Webcam access granted! (${resConfig.label})`);
      if (addLog) addLog(`Webcam access granted! (${resConfig.label})`);

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
      if (addLog) addLog("❌ Webcam Error: " + err.message);
      alert("Error accessing webcam: " + err.message);
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

  // Stop webcam feed
  const stopCamera = () => {
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

      if (addLog) addLog("Camera stopped.");
      if (onStatusUpdate) {
        onStatusUpdate('Camera offline. Press "Start Camera" to begin.', null);
      }
    }
  };

  // Initialize MediaPipe Hand Landmarker standalone async function
  const initMediaPipe = async () => {
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
      console.log("Loading MediaPipe Landmarker in ARCamera...");
      if (addLog) addLog("MediaPipe Init: Starting...");
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
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
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

    // Decouple ArUco OpenCV processing canvas from full display resolution
    // Downscaling to 640px max width eliminates mobile GPU readback stalls (~80ms -> <2ms)
    const MAX_PROC_WIDTH = 640;
    const procWidth = width > MAX_PROC_WIDTH ? MAX_PROC_WIDTH : width;
    const procHeight = width > MAX_PROC_WIDTH ? (Math.round((height / width) * MAX_PROC_WIDTH) & ~1) : height;
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

    // Draw current frame to hidden processing canvas at decoupled resolution
    const tArucoStart = performance.now();
    procCtx.drawImage(video, 0, 0, procWidth, procHeight);
    const imgData = procCtx.getImageData(0, 0, procWidth, procHeight);

    // Convert to OpenCV Mat
    let srcMat = cv.matFromImageData(imgData);

    // 1. Detect ArUco markers using our custom JS implementation
    let detectedMarkers = [];
    let diagnostics = null;
    try {
      const result = detectMarkers(cv, srcMat);
      detectedMarkers = result.markers || [];
      diagnostics = result.diagnostics;

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
    perfTimingsRef.current.aruco = (performance.now() - tArucoStart).toFixed(0);

    // Index markers by ID for fast lookup
    const markers = {};
    detectedMarkers.forEach(m => {
      markers[m.id] = m;
    });

    // Solve poses (3D positions) of markers for perspective correction (cached by resolution)
    const markerPoses = {};
    if (!cameraMatsRef.current.camMatrix || cameraMatsRef.current.width !== width || cameraMatsRef.current.height !== height) {
      if (cameraMatsRef.current.camMatrix) {
        cameraMatsRef.current.camMatrix.delete();
        cameraMatsRef.current.distCoef.delete();
      }
      const { camMatrix, distCoef } = createCameraMats(cv, width, height);
      cameraMatsRef.current = { width, height, camMatrix, distCoef };
    }
    const { camMatrix, distCoef } = cameraMatsRef.current;

    detectedMarkers.forEach(m => {
      if (ARUCO_MARKER_MAP[m.id] !== undefined) {
        try {
          const pose = solvePose(cv, m.corners, camMatrix, distCoef);
          if (pose) {
            markerPoses[m.id] = pose.tvec; // [x, y, z]
          }
        } catch (e) {
          console.error("Error solving pose for marker:", m.id, e);
        }
      }
    });

    // 2. Detect hands using MediaPipe directly from HTML5 video (zero-copy GPU path)
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
        console.error("Error in hand tracking:", err);
      }
    }
    perfTimingsRef.current.mp = (performance.now() - tMpStart).toFixed(0);

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

    // Calculate FPS
    const timeDelta = (timestamp - lastTimeRef.current) / 1000;
    lastTimeRef.current = timestamp;
    const currentFps = timeDelta > 0 ? Math.round(1 / timeDelta) : 0;

    // Throttle HUD FPS & latency update to ~2.5x/sec so numbers are readable and performant
    if (timestamp - lastFpsUpdateTimeRef.current >= 400) {
      lastFpsUpdateTimeRef.current = timestamp;
      setFps(currentFps);
      perfTimingsRef.current.total = (performance.now() - tFrameStart).toFixed(0);
      setPerfTimings({ ...perfTimingsRef.current });
    }

    // Clear display canvas
    ctx.clearRect(0, 0, width, height);

    // 2. Process Guitar Geometry
    const neckGeometry = getNeckGeometry(markers, neckWidthScaleRef.current, markerPoses, fretScaleLengthRef.current);

    if (neckGeometry) {
      // Draw guitar frets, strum zone, and extended vibrating strings
      drawGuitarOnCanvas(ctx, neckGeometry);
    }

    // 3. Separate Fretting Hand (Left) and Strumming Hand (Right)
    let fretHandLandmarks = null;
    let strumHandLandmarks = null;

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

    // 4. Calculate positions and fret/string for all 5 fingers of the fretting hand
    const trackedFingers = [];
    if (fretHandLandmarks) {
      FRET_FINGERS.forEach(cfg => {
        const tip = fretHandLandmarks[cfg.tipIdx];
        const dip = fretHandLandmarks[cfg.dipIdx] || tip;
        if (tip) {
          const pos = {
            x: (tip.x * 0.75 + dip.x * 0.25) * width,
            y: (tip.y * 0.75 + dip.y * 0.25) * height
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

          trackedFingers.push({
            ...cfg,
            pos,
            fret,
            string,
            fretLocator,
            isActive: fret > 0 && string > 0
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

      // Project pick position onto guitar axis
      const { start, dx, dy, len, perpX, perpY, nutNeckWidth, endNeckWidth } = neckGeometry;
      const tPick = ((pickX - start.x) * dx + (pickY - start.y) * dy) / (len * len);
      const cx = start.x + tPick * dx;
      const cy = start.y + tPick * dy;
      const lateralDist = (pickX - cx) * perpX + (pickY - cy) * perpY;
      const localWidth = nutNeckWidth + tPick * (endNeckWidth - nutNeckWidth);
      const stringSpread = localWidth * 0.88;
      const sPick = ((lateralDist / (stringSpread || 1)) + 0.5) * 5 + 1; // 1.0 (High E) to 6.0 (Low E)

      const inStrumZone = (tPick >= 0.88 && tPick <= 1.45 && sPick >= 0.2 && sPick <= 6.8);

      // 3D Depth & Proximity Gate relative to Marker 5 / Guitar Body
      let zGuitar = 70.0;
      if (markerPoses && markerPoses[5] && markerPoses[5][2] > 15) {
        zGuitar = markerPoses[5][2];
      } else if (markerPoses && markerPoses[4] && markerPoses[4][2] > 15) {
        zGuitar = markerPoses[4][2] * 1.08;
      } else if (neckGeometry.depthRatio) {
        zGuitar = 70.0 / (neckGeometry.depthRatio || 1.0);
      }

      // Hand apparent scale & depth from MediaPipe
      let zHand = zGuitar;
      let handSpanPx = 0;
      if (strumHandLandmarks && strumHandLandmarks[0] && strumHandLandmarks[9]) {
        const dxH = (strumHandLandmarks[9].x - strumHandLandmarks[0].x) * width;
        const dyH = (strumHandLandmarks[9].y - strumHandLandmarks[0].y) * height;
        handSpanPx = Math.hypot(dxH, dyH);
        if (handSpanPx > 10) {
          // Average adult wrist-to-middle MCP is ~9.5 cm. Camera focal length ~892px
          zHand = (892 * 9.5) / handSpanPx;
        }
      }

      // deltaZ > 0 means the hand is closer to camera than guitar body (lifted off strings)
      const deltaZ = zGuitar - zHand;

      // Optical scale ratio relative to Marker 5 pixel width if visible
      let opticalScaleRatio = 1.0;
      const m5 = markers[5];
      if (m5 && m5.corners && m5.corners.length >= 4 && handSpanPx > 10) {
        const m5Width = Math.hypot(m5.corners[1].x - m5.corners[0].x, m5.corners[1].y - m5.corners[0].y);
        if (m5Width > 15) {
          opticalScaleRatio = (handSpanPx / 9.5) / (m5Width / 8.0);
        }
      }

      // Hand is lifted if it is > 3.5 cm in front of the guitar body or optical scale expands by > 16%
      const isHandLifted = deltaZ > 3.5 || opticalScaleRatio > 1.16;
      const inStrikePlane = inStrumZone && !isHandLifted;

      // Draw Pick Cursor (with Depth & Lifted Air Indicator)
      ctx.save();
      if (inStrumZone && isHandLifted) {
        // Hand is lifted in air reset: draw subtle dashed ring
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.75)';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(pickX, pickY, 13, 0, 2 * Math.PI);
        ctx.stroke();

        ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
        ctx.beginPath();
        ctx.arc(pickX, pickY, 5, 0, 2 * Math.PI);
        ctx.fill();

        drawUnmirroredText(ctx, `↷ LIFTED (+${Math.max(0, deltaZ).toFixed(0)}cm)`, pickX, pickY - 18, {
          font: 'bold 10px monospace',
          fillStyle: 'rgba(148, 163, 184, 0.85)',
          align: 'center',
          baseline: 'bottom'
        });
      } else {
        // Hand is in strike plane (ready to strum)
        ctx.shadowColor = inStrikePlane ? '#f59e0b' : 'rgba(255,255,255,0.4)';
        ctx.shadowBlur = inStrikePlane ? 10 : 4;
        ctx.fillStyle = inStrikePlane ? 'rgba(245, 158, 11, 0.95)' : 'rgba(255, 255, 255, 0.7)';
        ctx.beginPath();
        ctx.arc(pickX, pickY, inStrikePlane ? 8 : 5, 0, 2 * Math.PI);
        ctx.fill();

        // Outer targeting crosshair
        ctx.strokeStyle = inStrikePlane ? '#f59e0b' : 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pickX, pickY, inStrikePlane ? 14 : 9, 0, 2 * Math.PI);
        ctx.stroke();

        const label = inStrikePlane ? '⚡ STRIKE' : 'R-HAND';
        drawUnmirroredText(ctx, label, pickX, pickY - 18, {
          font: 'bold 11px monospace',
          fillStyle: inStrikePlane ? '#f59e0b' : '#ffffff',
          align: 'center',
          baseline: 'bottom'
        });
      }
      ctx.restore();

      // Strumming / Crossing Detection
      const lastState = lastStrumStateRef.current;
      if (inStrumZone && lastState.inZone && lastState.s !== null) {
        const deltaS = sPick - lastState.s;
        const dt = (timestamp - lastState.time) / 1000;
        const velocity = dt > 0 ? deltaS / dt : 0; // strings per second

        if (Math.abs(deltaS) >= 0.35 && Math.abs(velocity) >= 3.0) {
          const sMin = Math.min(lastState.s, sPick);
          const sMax = Math.max(lastState.s, sPick);
          const crossed = [];
          for (let str = 1; str <= 6; str++) {
            if (str >= Math.floor(sMin + 0.1) && str <= Math.ceil(sMax - 0.1)) {
              crossed.push(str);
            }
          }

          if (crossed.length > 0) {
            // Guitar convention: String 6 = Low E (top), String 1 = High E (bottom)
            // Downstroke sweeps downwards from String 6 to String 1: deltaS < 0
            // Upstroke sweeps upwards from String 1 to String 6: deltaS > 0
            const isDown = deltaS < 0;
            const isUp = deltaS > 0;
            const dir = isDown ? 'DOWN ↓' : 'UP ↑';
            const displayCrossed = isDown ? [...crossed].sort((a, b) => b - a) : [...crossed].sort((a, b) => a - b);

            // Hybrid Depth Gate & Strum Mode Filter:
            let allowStrum = true;
            if (strumModeRef.current === 'down') {
              allowStrum = isDown; // 100% silent return strokes in down-only mode
            } else if (strumModeRef.current === 'smart') {
              // In smart mode: Downstrokes always play; Upstrokes only play if hand is in strike plane!
              if (isUp && isHandLifted) {
                allowStrum = false;
              }
            }

            if (allowStrum) {
              crossed.forEach(str => {
                vibratingStringsRef.current[str] = timestamp;
              });

              const chordPrefix = activeChord ? `${activeChord.name} ` : '';
              const strumDesc = crossed.length >= 3 ? `${chordPrefix}STRUM ${dir}` : `${chordPrefix}PICK S:${displayCrossed.join(',')}`;
              activeStrumDisplayRef.current = {
                text: `${strumDesc} [Strings ${displayCrossed.join(',')}]`,
                time: timestamp,
                color: activeChord ? (activeChord.quality === 'major' ? '#10b981' : '#a855f7') : '#f59e0b',
                chord: activeChord ? activeChord.name : null
              };

              // Real-Time Guitar Audio Pluck / Strum Synthesis
              if (audioEnabled) {
                const currentFretted = {};
                trackedFingers.forEach(f => {
                  if (f.isActive && f.string && f.fret) {
                    currentFretted[f.string] = f.fret;
                  }
                });

                const normalizedVelocity = Math.min(1.0, Math.max(0.35, Math.abs(velocity) / 9));

                if (activeChord && crossed.length >= 3) {
                  guitarAudio.strumChord(activeChord, dir, normalizedVelocity);
                  songEngine.evaluateStrum(activeChord.short || activeChord.name);
                } else {
                  guitarAudio.strumStrings(crossed, currentFretted, dir, normalizedVelocity);
                  if (crossed.length >= 2) {
                    songEngine.evaluateStrum(null);
                  }
                }
              }
            } else {
              // Strum suppressed (air return reset motion)
              activeStrumDisplayRef.current = {
                text: `↷ RESET (AIR) [Strings ${crossed.join(',')}]`,
                time: timestamp,
                color: 'rgba(148, 163, 184, 0.7)',
                chord: null
              };
            }
          }
        }
      }

      lastStrumStateRef.current = {
        time: timestamp,
        s: sPick,
        inZone: inStrumZone
      };

      if (inStrumZone) {
        strumStatusDesc = `Pick @ Str ${sPick.toFixed(1)} [${isHandLifted ? 'LIFTED' : 'STRIKE'}]`;
      }
    } else {
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
      // Draw AR Ghost Target Fingering for Active Play-Along Song (if enabled)
      if (showGhostFretsRef.current) {
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

              const { fx, fy, fWidth } = getFretPositionAndWidth(midFretDist, neckGeometry);
              const tString = ((str - 1) / 5 - 0.5) * 0.88;
              const targetX = fx + (tString * fWidth) * perpX;
              const targetY = fy + (tString * fWidth) * perpY;

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
            const { fx, fy, fWidth } = getFretPositionAndWidth(midFretDist, neckGeometry);
            const tString = ((f.string - 1) / 5 - 0.5) * 0.88;
            const nx = fx + (tString * fWidth) * neckGeometry.perpX;
            const ny = fy + (tString * fWidth) * neckGeometry.perpY;

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
      // Outer target ring
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
      ctx.save();
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur = 14;
      drawUnmirroredText(ctx, `⚡ ${activeStrumDisplayRef.current.text}`, width / 2, 45, {
        font: 'bold 15px monospace',
        fillStyle: `rgba(245, 158, 11, ${alpha})`,
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

    // 1. Draw Frets across the full neck width (perspective-correct)
    FRETS_FOR_DRAWING.forEach(fretDist => {
      const { fx, fy, fWidth } = getFretPositionAndWidth(fretDist, geometry);

      // Draw perpendicular fret line across the full neck
      const x1 = fx + (fWidth / 2) * perpX;
      const y1 = fy + (fWidth / 2) * perpY;
      const x2 = fx - (fWidth / 2) * perpX;
      const y2 = fy - (fWidth / 2) * perpY;

      ctx.lineWidth = fretDist === 0 ? 5 : 2; // Thicker line for nut (fret 0)
      ctx.strokeStyle = fretDist === 0 ? "rgba(6, 182, 212, 0.85)" : "rgba(34, 197, 94, 0.85)"; // High-visibility neon green
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // Draw Fret Number Label un-mirrored
      if (fretDist > 0) {
        const idx = FRET_ABSOLUTE_DISTANCES_FROM_NUT.indexOf(fretDist) + 1;
        drawUnmirroredText(ctx, idx.toString(), fx, fy - fWidth / 2 - 8, {
          font: '10px monospace',
          fillStyle: 'rgba(134, 239, 172, 0.9)',
          align: 'center',
          baseline: 'bottom'
        });
      }
    });

    // 2. Draw Strumming Zone over guitar body (t: 0.92 to 1.38)
    const tStrum1 = 0.92;
    const tStrum2 = 1.38;
    const wStrum1 = endNeckWidth * 1.12;
    const wStrum2 = endNeckWidth * 1.28;

    const sz1X = start.x + tStrum1 * dx + (wStrum1 / 2) * perpX;
    const sz1Y = start.y + tStrum1 * dy + (wStrum1 / 2) * perpY;
    const sz2X = start.x + tStrum1 * dx - (wStrum1 / 2) * perpX;
    const sz2Y = start.y + tStrum1 * dy - (wStrum1 / 2) * perpY;

    const sz3X = start.x + tStrum2 * dx - (wStrum2 / 2) * perpX;
    const sz3Y = start.y + tStrum2 * dy - (wStrum2 / 2) * perpY;
    const sz4X = start.x + tStrum2 * dx + (wStrum2 / 2) * perpX;
    const sz4Y = start.y + tStrum2 * dy + (wStrum2 / 2) * perpY;

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
    const szMidX = start.x + ((tStrum1 + tStrum2) / 2) * dx;
    const szMidY = start.y + ((tStrum1 + tStrum2) / 2) * dy;
    const labelOffset = (wStrum1 + wStrum2) / 4 + 10;
    drawUnmirroredText(ctx, '⚡ STRUM ZONE', szMidX + labelOffset * perpX, szMidY + labelOffset * perpY, {
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

    for (let s = 1; s <= 6; ++s) {
      const tString = ((s - 1) / 5 - 0.5) * 0.88;

      const x1 = start.x + (tString * nutNeckWidth) * perpX;
      const y1 = start.y + (tString * nutNeckWidth) * perpY;

      // Extend to the bridge across the strum zone
      const xBridge = start.x + tBridge * dx + (tString * bridgeNeckWidth) * perpX;
      const yBridge = start.y + tBridge * dy + (tString * bridgeNeckWidth) * perpY;

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
          className="camera-feed"
          playsInline
          muted
        />
        <canvas
          ref={canvasRef}
          className="overlay-canvas"
        />

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
              onClick={startCamera}
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


      {/* Streamlined Controls Overlay (Only visible once camera is active) */}
      {cameraActive && (
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
            <button className="btn-premium" style={{ background: 'linear-gradient(135deg, var(--accent-red) 0%, rgba(239, 68, 68, 0.7) 100%)' }} onClick={stopCamera}>
              <Square size={15} /> Stop Camera
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
              title="Click to cycle strum mode: Smart Depth -> Down Only -> Down & Up"
            >
              <Compass size={14} color={strumMode === 'smart' ? '#06b6d4' : (strumMode === 'down' ? '#f59e0b' : '#a855f7')} />
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {strumMode === 'smart' && '🎯 Smart Depth'}
                {strumMode === 'down' && '⬇️ Down Only'}
                {strumMode === 'both' && '⇅ Down & Up'}
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
      )}

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
          </div>

          {/* Real-time frame latency breakdown */}
          <div style={{
            fontSize: '10px',
            fontFamily: 'var(--font-mono)',
            background: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(6px)',
            padding: '3px 8px',
            borderRadius: '6px',
            color: '#94a3b8',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
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
