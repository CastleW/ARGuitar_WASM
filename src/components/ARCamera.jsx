import React, { useEffect, useRef, useState } from 'react';
import { Play, Square, Video } from 'lucide-react';
import { detectMarkers } from '../utils/aruco_detector';
import { 
  calculateGuitarFromMarkers, 
  createCameraMats,
  solvePose,
  FRETS_FOR_DRAWING,
  FRET_ABSOLUTE_DISTANCES_FROM_NUT,
  TOTAL_FRET_LENGTH_IN_CM
} from '../utils/guitar_math';

export default function ARCamera({
  openCvLoaded,
  onStatusUpdate,
  addLog
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const processingCanvasRef = useRef(null);
  
  const [cameraActive, setCameraActive] = useState(false);
  
  const loopRef = useRef(null);
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
      
      if (addLog) addLog("Camera stopped.");
      if (onStatusUpdate) {
        onStatusUpdate('Camera offline. Press "Start Camera" to begin.', null);
      }
    }
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
  }, [cameraActive, openCvLoaded]);

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
    
    // Set sizes
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      procCanvas.width = width;
      procCanvas.height = height;
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
    
    // Clear display canvas
    ctx.clearRect(0, 0, width, height);
    
    // Draw candidate boundaries in thin orange
    candidates.forEach(corners => {
      ctx.strokeStyle = 'rgba(249, 115, 22, 0.4)'; // thin translucent orange
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      ctx.lineTo(corners[1].x, corners[1].y);
      ctx.lineTo(corners[2].x, corners[2].y);
      ctx.lineTo(corners[3].x, corners[3].y);
      ctx.closePath();
      ctx.stroke();
    });
    
    // 3. Process Guitar Geometry & Intersections
    const guitar = calculateGuitarFromMarkers(markers, markerPoses);
    
    if (guitar) {
      // Draw guitar overlay
      drawGuitarOnCanvas(ctx, guitar);
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
      
      // Draw ID
      ctx.fillStyle = '#fff';
      ctx.font = '12px monospace';
      ctx.fillText(m.id, m.center.x - 4, m.center.y + 4);
    });
    
    // Update status label
    const statusText = `FPS: ${currentFps} | Markers Tracked: ${detectedMarkers.length} | Mode: OpenCV Tracking`;
    onStatusUpdate(statusText);
    
    loopRef.current = requestAnimationFrame(processFrame);
  };

  // HTML5 Canvas 2D Fretboard Draw
  const drawGuitarOnCanvas = (ctx, guitar) => {
    const { start, end, poseStart, poseEnd } = guitar;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    if (len === 0) return;
    
    const perpX = -dy / len;
    const perpY = dx / len;
    
    const baseFretWidth = 80;
    const referenceZ = 40.0;
    
    // 1. Draw Frets
    ctx.strokeStyle = "rgba(168, 85, 247, 0.6)"; // Neon Purple Fret lines
    
    FRETS_FOR_DRAWING.forEach(fretDist => {
      const fretLocator = fretDist / TOTAL_FRET_LENGTH_IN_CM;
      let fx, fy, fWidth;
      
      if (poseStart && poseEnd) {
        const zStart = poseStart[2];
        const zEnd = poseEnd[2];
        const zFret = zStart + fretLocator * (zEnd - zStart);
        
        const scaleStart = referenceZ / zStart;
        const scaleEnd = referenceZ / zEnd;
        const scaleFret = referenceZ / zFret;
        
        let perspectiveLocator;
        if (scaleStart !== scaleEnd) {
          perspectiveLocator = (scaleFret - scaleStart) / (scaleEnd - scaleStart);
          perspectiveLocator = Math.max(0.0, Math.min(1.0, perspectiveLocator));
        } else {
          perspectiveLocator = fretLocator;
        }
        
        fx = start.x + perspectiveLocator * dx;
        fy = start.y + perspectiveLocator * dy;
        fWidth = baseFretWidth * scaleFret;
      } else {
        fx = start.x + fretLocator * dx;
        fy = start.y + fretLocator * dy;
        fWidth = baseFretWidth;
      }
      
      // Draw perpendicular fret line
      const x1 = fx + (fWidth / 2) * perpX;
      const y1 = fy + (fWidth / 2) * perpY;
      const x2 = fx - (fWidth / 2) * perpX;
      const y2 = fy - (fWidth / 2) * perpY;
      
      ctx.lineWidth = fretDist === 0 ? 5 : 2; // Thicker line for nut (fret 0)
      ctx.strokeStyle = fretDist === 0 ? "rgba(6, 182, 212, 0.8)" : "rgba(168, 85, 247, 0.6)";
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      
      // Draw Fret Number Label
      if (fretDist > 0) {
        ctx.fillStyle = "rgba(156, 163, 175, 0.8)";
        ctx.font = "9px monospace";
        const idx = FRET_ABSOLUTE_DISTANCES_FROM_NUT.indexOf(fretDist) + 1;
        ctx.fillText(idx.toString(), fx - 4, fy - fWidth / 2 - 4);
      }
    });
    
    // 2. Draw Strings
    for (let s = 1; s <= 6; ++s) {
      const adjString = (s - 1 - 2.5); // ranges from -2.5 to +2.5
      
      let x1, y1, x2, y2;
      
      if (poseStart && poseEnd) {
        const zStart = poseStart[2];
        const zEnd = poseEnd[2];
        const scaleStart = referenceZ / zStart;
        const scaleEnd = referenceZ / zEnd;
        
        const fWidthStart = baseFretWidth * scaleStart;
        const fWidthEnd = baseFretWidth * scaleEnd;
        
        x1 = start.x + (adjString * fWidthStart / 5) * perpX;
        y1 = start.y + (adjString * fWidthStart / 5) * perpY;
        
        x2 = end.x + (adjString * fWidthEnd / 5) * perpX;
        y2 = end.y + (adjString * fWidthEnd / 5) * perpY;
      } else {
        x1 = start.x + (adjString * baseFretWidth / 5) * perpX;
        y1 = start.y + (adjString * baseFretWidth / 5) * perpY;
        x2 = end.x + (adjString * baseFretWidth / 5) * perpX;
        y2 = end.y + (adjString * baseFretWidth / 5) * perpY;
      }
      
      ctx.lineWidth = 1 + (s * 0.4); // String thickness gradient
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 + (s/10)})`;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = videoRef.current.srcObject.getTracks();
        tracks.forEach(track => track.stop());
      }
    };
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
      
      {/* Controls Overlay */}
      <div style={{
        position: 'absolute',
        bottom: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        display: 'flex',
        gap: '12px'
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
