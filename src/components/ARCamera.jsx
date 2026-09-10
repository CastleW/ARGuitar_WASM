import { useEffect, useRef, useState } from 'react';
import { Play, Square, Video, Sliders } from 'lucide-react';
import { detectMarkers } from '../utils/aruco_detector';
import {
  calculateGuitarFromMarkers,
  getNeckGeometry,
  calculateFretAndStringFromGeometry,
  calculateFretAndStringFromGuitarMarkers,
  getFretPositionAndWidth,
  createCameraMats,
  solvePose,
  FRETS_FOR_DRAWING,
  FRET_ABSOLUTE_DISTANCES_FROM_NUT,
  TOTAL_FRET_LENGTH_IN_CM,
  ARUCO_MARKER_MAP
} from '../utils/guitar_math';

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

export default function ARCamera({
  openCvLoaded,
  onStatusUpdate,
  onMediaPipeLoaded,
  addLog
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const processingCanvasRef = useRef(null);
  const hudRef = useRef(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [mediaPipeLoaded, setMediaPipeLoaded] = useState(false);
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
    return saved ? parseFloat(saved) : 52.0;
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

  // Start webcam feed
  const startCamera = async () => {
    try {
      console.log("Requesting webcam access...");
      if (addLog) addLog("Requesting webcam access...");

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, frameRate: { ideal: 30 } }
      });

      console.log("Webcam access granted!");
      if (addLog) addLog("Webcam access granted!");

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();

        // Lazy-load MediaPipe HandLandmarker when webcam starts BEFORE starting the heavy frame processing loop
        await initMediaPipe();

        setCameraActive(true);
        if (onStatusUpdate) {
          onStatusUpdate("Camera Active | Initializing tracking...", null);
        }
      }
    } catch (err) {
      console.error("Error accessing webcam:", err);
      if (addLog) addLog("❌ Webcam Error: " + err.message);
      alert("Error accessing webcam: " + err.message);
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

      // Clear HUD
      if (hudRef.current) {
        hudRef.current.style.display = 'none';
      }

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

    // Set sizes (only if valid)
    if (width > 0 && height > 0) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        procCanvas.width = width;
        procCanvas.height = height;
      }
    }

    const ctx = canvas.getContext('2d');
    const procCtx = procCanvas.getContext('2d');

    // Draw current frame to hidden processing canvas
    procCtx.drawImage(video, 0, 0, width, height);
    const imgData = procCtx.getImageData(0, 0, width, height);

    // Convert to OpenCV Mat
    let srcMat = cv.matFromImageData(imgData);

    // 1. Detect ArUco markers using our custom JS implementation
    let detectedMarkers = [];
    let candidates = [];
    let diagnostics = null;
    try {
      const result = detectMarkers(cv, srcMat);
      detectedMarkers = result.markers;
      candidates = result.candidates;
      diagnostics = result.diagnostics;
    } catch (e) {
      console.error("Error detecting markers:", e);
    }

    // Index markers by ID for fast lookup
    const markers = {};
    detectedMarkers.forEach(m => {
      markers[m.id] = m;
    });

    // Solve poses (3D positions) of markers for perspective correction
    const markerPoses = {};
    const { camMatrix, distCoef } = createCameraMats(cv);

    detectedMarkers.forEach(m => {
      if (m.id === 1 || m.id === 5) {
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

    camMatrix.delete();
    distCoef.delete();
    srcMat.delete();

    // 2. Detect hands using MediaPipe
    let handLandmarks = null;
    let handLandmarksResults = null;
    if (mediaPipeLoaded && landmarkerRef.current) {
      try {
        handLandmarksResults = landmarkerRef.current.detectForVideo(procCanvas, timestamp);
        if (handLandmarksResults && handLandmarksResults.landmarks) {
          handLandmarks = handLandmarksResults.landmarks;
        }
      } catch (err) {
        console.error("Error in hand tracking:", err);
      }
    }

    // Update logged IDs if they changed to prevent console spam
    const currentIdsStr = detectedMarkers.map(m => m.id).sort().join(", ");
    if (currentIdsStr !== lastLoggedIdsRef.current) {
      lastLoggedIdsRef.current = currentIdsStr;
      if (addLog) {
        addLog(`Tracked Marker IDs: [${currentIdsStr || "none"}]`);
      }
    }

    // Log diagnostics every 3 seconds if there are failures
    // eslint-disable-next-line react-hooks/purity
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

    // Clear display canvas
    ctx.clearRect(0, 0, width, height);

    // Find fretting hand tip (landmark index 8 is index finger tip)
    let fretHandLandmarks = null;
    let indexTipPos = null;
    if (handLandmarks && handLandmarks.length > 0) {
      handLandmarks.forEach((hand, idx) => {
        const handedness = handLandmarksResults.handednesses[idx]?.[0];
        if (handedness && handedness.categoryName !== 'Right') {
          fretHandLandmarks = hand;
        }
      });
      if (!fretHandLandmarks) {
        fretHandLandmarks = handLandmarks[0]; // Fallback to first hand
      }

      if (fretHandLandmarks) {
        const tip = fretHandLandmarks[8];
        const dip = fretHandLandmarks[7] || tip;
        indexTipPos = {
          x: (tip.x * 0.75 + dip.x * 0.25) * width,
          y: (tip.y * 0.75 + dip.y * 0.25) * height
        };
      }
    }

    // 3. Process Guitar Geometry & Intersections (Unified Geometry)
    const neckGeometry = getNeckGeometry(markers, neckWidthScaleRef.current, markerPoses, fretScaleLengthRef.current);

    let activeFret = 0;
    let activeString = 0;

    if (neckGeometry) {
      // Draw guitar overlay using unified geometry
      drawGuitarOnCanvas(ctx, neckGeometry);

      // Calculate active fret/string using the exact same unified geometry
      if (indexTipPos) {
        const fretInfo = calculateFretAndStringFromGeometry(neckGeometry, indexTipPos, true);
        activeFret = fretInfo[0];
        activeString = fretInfo[1];
      }
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

    // Draw Hand skeleton and landmarks
    if (handLandmarks && handLandmarks.length > 0) {
      ctx.fillStyle = 'rgba(6, 182, 212, 0.9)'; // neon cyan joints
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.4)'; // bones
      ctx.lineWidth = 3;

      handLandmarks.forEach(hand => {
        hand.forEach(lm => {
          ctx.beginPath();
          ctx.arc(lm.x * width, lm.y * height, 4, 0, 2 * Math.PI);
          ctx.fill();
        });

        const drawPath = (indices) => {
          ctx.beginPath();
          ctx.moveTo(hand[indices[0]].x * width, hand[indices[0]].y * height);
          for (let i = 1; i < indices.length; ++i) {
            ctx.lineTo(hand[indices[i]].x * width, hand[indices[i]].y * height);
          }
          ctx.stroke();
        };

        drawPath([0, 1, 2, 3, 4]);     // Thumb
        drawPath([0, 5, 6, 7, 8]);     // Index
        drawPath([0, 9, 10, 11, 12]);  // Middle
        drawPath([0, 13, 14, 15, 16]); // Ring
        drawPath([0, 17, 18, 19, 20]); // Pinky
        drawPath([5, 9, 13, 17]);      // Knuckles
      });
    }

    // Draw index finger tip target ring if found
    if (indexTipPos) {
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(indexTipPos.x, indexTipPos.y, 12, 0, 2 * Math.PI);
      ctx.stroke();

      ctx.fillStyle = 'rgba(6, 182, 212, 0.3)';
      ctx.beginPath();
      ctx.arc(indexTipPos.x, indexTipPos.y, 6, 0, 2 * Math.PI);
      ctx.fill();
    }

    // Update Fretboard overlay info text in the DOM HUD
    if (activeFret > 0 && activeString > 0) {
      if (hudRef.current) {
        hudRef.current.textContent = `FRET: ${activeFret} | STRING: ${activeString}`;
        hudRef.current.style.display = 'block';
      }
    } else {
      if (hudRef.current) {
        hudRef.current.style.display = 'none';
      }
    }

    // Update status label and keep it the same length each time
    let statusText = `FPS: ${currentFps} | Markers Tracked: ${detectedMarkers.length} | Hand Tracker: ${mediaPipeLoaded ? 'Active' : 'Offline'}`;
    statusText += ` | Active Fret: ${activeFret}, String: ${activeString}`;

    onStatusUpdate(statusText);

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
    const { start, end, dx, dy, perpX, perpY, nutNeckWidth, endNeckWidth } = geometry;

    // 1. Draw Frets across the full neck width (perspective-correct)
    FRETS_FOR_DRAWING.forEach(fretDist => {
      const { fx, fy, fWidth } = getFretPositionAndWidth(fretDist, geometry);

      // Draw perpendicular fret line across the full neck
      const x1 = fx + (fWidth / 2) * perpX;
      const y1 = fy + (fWidth / 2) * perpY;
      const x2 = fx - (fWidth / 2) * perpX;
      const y2 = fy - (fWidth / 2) * perpY;

      ctx.lineWidth = fretDist === 0 ? 5 : 2; // Thicker line for nut (fret 0)
      ctx.strokeStyle = fretDist === 0 ? "rgba(6, 182, 212, 0.85)" : "rgba(168, 85, 247, 0.65)";
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // Draw Fret Number Label un-mirrored
      if (fretDist > 0) {
        const idx = FRET_ABSOLUTE_DISTANCES_FROM_NUT.indexOf(fretDist) + 1;
        drawUnmirroredText(ctx, idx.toString(), fx, fy - fWidth / 2 - 8, {
          font: '10px monospace',
          fillStyle: 'rgba(156, 163, 175, 0.85)',
          align: 'center',
          baseline: 'bottom'
        });
      }
    });

    // 2. Draw Strings spanning the full width of the guitar neck
    for (let s = 1; s <= 6; ++s) {
      // s=1 (Low E) to s=6 (High E)
      // Normalized offset from -0.5 to +0.5, with 0.88 margin from the fretboard edges
      const tString = ((s - 1) / 5 - 0.5) * 0.88;

      const x1 = start.x + (tString * nutNeckWidth) * perpX;
      const y1 = start.y + (tString * nutNeckWidth) * perpY;

      const x2 = end.x + (tString * endNeckWidth) * perpX;
      const y2 = end.y + (tString * endNeckWidth) * perpY;

      ctx.lineWidth = 1.2 + (s * 0.45); // String thickness gradient (Low E thicker)
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.45 + (s / 10)})`;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
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
      if (onMediaPipeLoaded) onMediaPipeLoaded(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="camera-container glass-panel">
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
      {/* Hidden processing canvas */}
      <canvas
        ref={processingCanvasRef}
        style={{ display: 'none' }}
      />

      {/* Active Fret/String HUD Overlay */}
      <div
        ref={hudRef}
        style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          zIndex: 20,
          background: 'rgba(8, 9, 15, 0.85)',
          backdropFilter: 'blur(4px)',
          border: '1px solid var(--accent-cyan)',
          borderRadius: '8px',
          padding: '6px 12px',
          fontFamily: 'var(--font-mono)',
          fontSize: '14px',
          fontWeight: 'bold',
          color: 'var(--accent-cyan)',
          boxShadow: '0 0 10px rgba(6, 182, 212, 0.3)',
          display: 'none'
        }}
      />

      {/* Controls Overlay */}
      <div style={{
        position: 'absolute',
        bottom: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        background: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(10px)',
        padding: '8px 18px',
        borderRadius: '12px',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
      }}>
        {!cameraActive ? (
          <button className="btn-premium" onClick={startCamera}>
            <Play size={16} /> Start Camera
          </button>
        ) : (
          <button className="btn-premium" style={{ background: 'linear-gradient(135deg, var(--accent-red) 0%, rgba(239, 68, 68, 0.7) 100%)' }} onClick={stopCamera}>
            <Square size={16} /> Stop Camera
          </button>
        )}

        {/* Neck Width Calibrator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          color: 'var(--text-secondary)',
          fontSize: '12px',
          fontFamily: 'var(--font-mono)'
        }}>
          <Sliders size={14} style={{ color: 'var(--accent-cyan)' }} />
          <span style={{ whiteSpace: 'nowrap' }}>Neck Width:</span>
          <input
            type="range"
            min="1.0"
            max="2.5"
            step="0.05"
            value={neckWidthScale}
            onChange={(e) => setNeckWidthScale(parseFloat(e.target.value))}
            style={{
              width: '70px',
              accentColor: 'var(--accent-cyan)',
              cursor: 'pointer'
            }}
            title="Adjust visual string spacing across the neck"
          />
          <span style={{ color: 'var(--accent-cyan)', minWidth: '36px', fontWeight: 'bold' }}>
            {neckWidthScale.toFixed(2)}x
          </span>
        </div>

        {/* Fret Scale Calibrator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          color: 'var(--text-secondary)',
          fontSize: '12px',
          fontFamily: 'var(--font-mono)',
          borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
          paddingLeft: '12px'
        }}>
          <Sliders size={14} style={{ color: 'var(--accent-purple)' }} />
          <span style={{ whiteSpace: 'nowrap' }}>Fret Scale:</span>
          <input
            type="range"
            min="46.0"
            max="58.0"
            step="0.2"
            value={fretScaleLength}
            onChange={(e) => setFretScaleLength(parseFloat(e.target.value))}
            style={{
              width: '70px',
              accentColor: 'var(--accent-purple)',
              cursor: 'pointer'
            }}
            title="Adjust 12th fret alignment along the neck"
          />
          <span style={{ color: 'var(--accent-purple)', minWidth: '46px', fontWeight: 'bold' }}>
            {fretScaleLength.toFixed(1)}cm
          </span>
        </div>
      </div>

      {/* HUD Info Labels */}
      <div style={{
        position: 'absolute',
        top: '16px',
        left: '16px',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
      }}>
        <span className={`status-pill ${cameraActive ? 'active' : 'inactive'}`}>
          <Video size={12} /> Feed: {cameraActive ? 'LIVE' : 'OFFLINE'}
        </span>
        <span className={`status-pill ${openCvLoaded ? 'active' : 'inactive'}`}>
          <Video size={12} /> OpenCV: {openCvLoaded ? 'READY' : 'LOADING'}
        </span>
      </div>
    </div>
  );
}
