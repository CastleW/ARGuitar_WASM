import React, { useState } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { detectMarkers } from '../utils/aruco_detector';
import { 
  calculateGuitarFromMarkers, 
  calculateFretAndStringFromGuitarMarkers,
  createCameraMats,
  solvePose
} from '../utils/guitar_math';
import { CheckCircle2, XCircle, Play, AlertCircle, RefreshCw } from 'lucide-react';

export default function TestSuite({ openCvLoaded }) {
  const [running, setRunning] = useState(false);
  const [tests, setTests] = useState([]);
  const [results, setResults] = useState({ passed: 0, failed: 0, total: 0 });
  const [currentTestName, setCurrentTestName] = useState('');

  // Define test definitions based on python track_player_test.py
  const fretTests = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map(fret => ({
    name: `Fret ${fret} Accuracy Test`,
    type: 'fret',
    imageUrl: `/TestImages/fret${fret}.png`,
    expectedFret: fret,
    expectedString: null
  }));

  const stringTests = [];
  const frets = [1, 5, 11];
  const strings = [1, 2, 3, 4, 5, 6];
  
  frets.forEach(f => {
    strings.forEach(s => {
      stringTests.push({
        name: `Fret ${f} String ${s} Alignment Test`,
        type: 'string',
        imageUrl: `/TestImages/fret_${f}_string_${s}.png`,
        expectedFret: f,
        expectedString: s
      });
    });
  });

  const allTests = [...fretTests, ...stringTests];

  const runAllTests = async () => {
    if (!openCvLoaded) {
      alert("OpenCV.js must be fully loaded before running tests.");
      return;
    }

    setRunning(true);
    setResults({ passed: 0, failed: 0, total: allTests.length });
    setCurrentTestName('Initializing image landmarker...');

    let testLandmarker = null;
    try {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );
      testLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "/hand_landmarker.task",
          delegate: "GPU"
        },
        runningMode: "IMAGE",
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5
      });
    } catch (err) {
      console.error("Failed to load test HandLandmarker:", err);
      alert("Failed to initialize MediaPipe Hand Landmarker for tests: " + err.message);
      setRunning(false);
      return;
    }

    const runResults = [];
    let passedCount = 0;
    let failedCount = 0;

    for (let idx = 0; idx < allTests.length; idx++) {
      const test = allTests[idx];
      setCurrentTestName(`Running: ${test.name} (${idx + 1}/${allTests.length})`);
      
      try {
        const result = await executeSingleTest(test, testLandmarker);
        runResults.push(result);
        if (result.status === 'PASS') {
          passedCount++;
        } else {
          failedCount++;
        }
        setResults({ passed: passedCount, failed: failedCount, total: allTests.length });
        setTests([...runResults]);
      } catch (err) {
        console.error(`Error in test: ${test.name}`, err);
        runResults.push({
          ...test,
          status: 'FAIL',
          error: err.message,
          detectedFret: 'N/A',
          detectedString: 'N/A'
        });
        failedCount++;
        setResults({ passed: passedCount, failed: failedCount, total: allTests.length });
        setTests([...runResults]);
      }
      
      // Yield to main thread to keep UI responsive
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    try {
      testLandmarker.close();
    } catch (e) {}

    setRunning(false);
    setCurrentTestName('Verification completed.');
  };

  const executeSingleTest = (test, testLandmarker) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = test.imageUrl;
      img.crossOrigin = "anonymous";
      
      img.onload = () => {
        try {
          const cv = window.cv;
          
          // 1. Create a canvas to draw image and extract bits
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          
          const imgData = ctx.getImageData(0, 0, img.width, img.height);
          let srcMat = cv.matFromImageData(imgData);
          
          // 2. Detect ArUco Markers
          const detectedMarkers = detectMarkers(cv, srcMat);
          const markers = {};
          detectedMarkers.forEach(m => {
            markers[m.id] = m;
          });
          
          const markerPoses = {};
          const { camMatrix, distCoef } = createCameraMats(cv);
          
          detectedMarkers.forEach(m => {
            if (m.id === 1 || m.id === 5) {
              const pose = solvePose(cv, m.corners, camMatrix, distCoef);
              if (pose) {
                markerPoses[m.id] = pose.tvec;
              }
            }
          });
          
          camMatrix.delete();
          distCoef.delete();
          srcMat.delete();
          
          // 3. MediaPipe Hand tracking on static image
          const mpResults = testLandmarker.detect(img);
          
          if (!mpResults.handLandmarks || mpResults.handLandmarks.length === 0) {
            resolve({
              ...test,
              status: 'FAIL',
              error: 'MediaPipe: No hands detected in test image.',
              detectedFret: 'N/A',
              detectedString: 'N/A'
            });
            return;
          }
          
          // Find Left Hand (fretting hand)
          let fretHandLandmarks = null;
          mpResults.handLandmarks.forEach((hand, i) => {
            const handedness = mpResults.handedness[i][0];
            if (handedness.categoryName !== 'Right') {
              fretHandLandmarks = hand;
            }
          });
          
          if (!fretHandLandmarks) {
            // Fallback to first hand if handedness classification is inverted
            fretHandLandmarks = mpResults.handLandmarks[0];
          }
          
          // Get Index Finger Tip (landmark index 8)
          const indexTip = fretHandLandmarks[8];
          const indexTipPos = {
            x: indexTip.x * img.width,
            y: indexTip.y * img.height
          };
          
          // 4. Calculate guitar starting points
          const guitarStart = markers[1]?.center;
          const guitarEnd = markers[5]?.center;
          
          if (!guitarStart || !guitarEnd) {
            resolve({
              ...test,
              status: 'FAIL',
              error: `Guitar markers missing. Detected IDs: ${Object.keys(markers).join(', ') || 'none'}`,
              detectedFret: 'N/A',
              detectedString: 'N/A'
            });
            return;
          }
          
          // Calculate fret and string
          const fretInfo = calculateFretAndStringFromGuitarMarkers(guitarStart, guitarEnd, indexTipPos, true);
          const detectedFret = fretInfo[0];
          const detectedString = fretInfo[1];
          
          // 5. Evaluate pass criteria
          let passed = false;
          if (test.type === 'fret') {
            passed = (detectedFret === test.expectedFret);
          } else if (test.type === 'string') {
            passed = (detectedFret === test.expectedFret && detectedString === test.expectedString);
          }
          
          resolve({
            ...test,
            status: passed ? 'PASS' : 'FAIL',
            detectedFret,
            detectedString,
            error: passed ? null : `Expected: Fret ${test.expectedFret}${test.expectedString ? `, String ${test.expectedString}` : ''}. Got: Fret ${detectedFret}, String ${detectedString}`
          });
          
        } catch (err) {
          reject(err);
        }
      };
      
      img.onerror = () => {
        resolve({
          ...test,
          status: 'FAIL',
          error: 'Failed to load test image resource from server.',
          detectedFret: 'N/A',
          detectedString: 'N/A'
        });
      };
    });
  };

  return (
    <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>
        <div>
          <h2 style={{ fontSize: '20px' }}>Visual Test Suite</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Compare WebAssembly/JS tracking results with expected positions on original Python test images.
          </p>
        </div>
        
        <button 
          className="btn-premium" 
          disabled={running} 
          onClick={runAllTests}
        >
          {running ? <RefreshCw className="spin" size={16} /> : <Play size={16} />}
          {running ? 'Running Tests...' : 'Run Verification Tests'}
        </button>
      </div>

      {/* Progress Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        <div className="glass-panel" style={{ padding: '16px', textAlign: 'center', background: 'rgba(255,255,255,0.01)' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Passed</span>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--accent-green)' }}>{results.passed}</div>
        </div>
        <div className="glass-panel" style={{ padding: '16px', textAlign: 'center', background: 'rgba(255,255,255,0.01)' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Failed</span>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: results.failed > 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>{results.failed}</div>
        </div>
        <div className="glass-panel" style={{ padding: '16px', textAlign: 'center', background: 'rgba(255,255,255,0.01)' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Total Checked</span>
          <div style={{ fontSize: '28px', fontWeight: 'bold' }}>{tests.length} / {results.total}</div>
        </div>
      </div>

      {running && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', background: 'rgba(6, 182, 212, 0.1)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(6, 182, 212, 0.3)' }}>
          <AlertCircle size={16} className="spin" style={{ color: 'var(--accent-cyan)' }} />
          <span>{currentTestName}</span>
        </div>
      )}

      {/* Test Log Rows */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        maxHeight: '400px',
        overflowY: 'auto',
        paddingRight: '6px'
      }}>
        {tests.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
            No tests run yet. Click "Run Verification Tests" above to start.
          </div>
        ) : (
          tests.map((test, index) => (
            <div 
              key={index} 
              className="glass-panel" 
              style={{ 
                padding: '12px 16px', 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                borderLeft: `4px solid ${test.status === 'PASS' ? 'var(--accent-green)' : 'var(--text-muted)'}`,
                background: test.status === 'PASS' ? 'rgba(16, 185, 129, 0.02)' : 'rgba(239, 68, 68, 0.02)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <img 
                  src={test.imageUrl} 
                  alt={test.name} 
                  style={{ width: '48px', height: '36px', objectFit: 'cover', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.05)' }} 
                />
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '500' }}>{test.name}</div>
                  {test.error ? (
                    <div style={{ fontSize: '12px', color: 'var(--accent-red)', marginTop: '2px' }}>{test.error}</div>
                  ) : (
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      Detected Fret: {test.detectedFret} | String: {test.detectedString}
                    </div>
                  )}
                </div>
              </div>
              
              <div>
                {test.status === 'PASS' ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--accent-green)', fontSize: '13px', fontWeight: 'bold' }}>
                    <CheckCircle2 size={16} /> PASS
                  </span>
                ) : (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--accent-red)', fontSize: '13px', fontWeight: 'bold' }}>
                    <XCircle size={16} /> FAIL
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
