import React, { useState } from 'react';
import { X, Focus, Lock, Unlock, Sun, AlertTriangle, CheckCircle2, Info, ChevronDown, ChevronUp, Sliders } from 'lucide-react';

export default function CameraDiagnosticsModal({
  isOpen,
  onClose,
  diagnostics,
  onLockFocus,
  onContinuousFocus,
  isMobile
}) {
  const [showRawDetails, setShowRawDetails] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionStatus, setActionStatus] = useState(null);

  if (!isOpen) return null;

  const handleLock = async () => {
    setActionBusy(true);
    setActionStatus(null);
    try {
      await onLockFocus();
      setActionStatus({ type: 'success', msg: 'Focus lock requested! Lens should hold current distance.' });
    } catch (e) {
      setActionStatus({ type: 'error', msg: `Focus lock failed: ${e.message}` });
    } finally {
      setActionBusy(false);
    }
  };

  const handleContinuous = async () => {
    setActionBusy(true);
    setActionStatus(null);
    try {
      await onContinuousFocus();
      setActionStatus({ type: 'success', msg: 'Continuous autofocus enabled.' });
    } catch (e) {
      setActionStatus({ type: 'error', msg: `Autofocus request failed: ${e.message}` });
    } finally {
      setActionBusy(false);
    }
  };

  const isLocked = diagnostics?.isFocusLocked || diagnostics?.currentFocusMode === 'manual';
  const isContinuous = diagnostics?.currentFocusMode === 'continuous';
  const supportsSoftwareFocus = diagnostics?.supportsSoftwareFocus;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(2, 6, 23, 0.85)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
      padding: '16px'
    }}>
      <div style={{
        background: '#0f172a',
        border: '1px solid rgba(56, 189, 248, 0.3)',
        borderRadius: '16px',
        maxWidth: '560px',
        width: '100%',
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 30px rgba(56, 189, 248, 0.15)',
        color: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          background: 'rgba(30, 41, 59, 0.6)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: 'rgba(56, 189, 248, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#38bdf8'
            }}>
              <Focus size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold', color: '#f8fafc' }}>
                Camera Optics &amp; Focus Diagnostic
              </h2>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                {diagnostics?.label || 'Active Video Stream'}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* Stream Specs Summary Pill */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(30, 41, 59, 0.5)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '10px 14px',
            borderRadius: '10px',
            fontSize: '12px'
          }}>
            <div>
              <span style={{ color: '#94a3b8' }}>Resolution: </span>
              <strong style={{ color: '#38bdf8' }}>{diagnostics?.width}×{diagnostics?.height}</strong>
            </div>
            <div>
              <span style={{ color: '#94a3b8' }}>Target FPS: </span>
              <strong style={{ color: '#4ade80' }}>{diagnostics?.frameRate || 30} fps</strong>
            </div>
            <div>
              <span style={{ color: '#94a3b8' }}>Facing: </span>
              <strong style={{ color: '#cbd5e1' }}>{diagnostics?.facingMode || 'Standard'}</strong>
            </div>
          </div>

          {/* Focus Diagnostics Card */}
          <div style={{
            background: isLocked ? 'rgba(34, 197, 94, 0.08)' : (isContinuous ? 'rgba(245, 158, 11, 0.08)' : 'rgba(56, 189, 248, 0.08)'),
            border: isLocked ? '1px solid rgba(34, 197, 94, 0.3)' : (isContinuous ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid rgba(56, 189, 248, 0.3)'),
            borderRadius: '12px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {isLocked ? (
                  <Lock size={16} style={{ color: '#4ade80' }} />
                ) : (
                  <Focus size={16} style={{ color: isContinuous ? '#fbbf24' : '#38bdf8' }} />
                )}
                <span style={{ fontWeight: 'bold', fontSize: '13px' }}>
                  Camera Focus Mode:
                </span>
              </div>
              <span style={{
                fontSize: '11px',
                fontWeight: 'bold',
                fontFamily: 'monospace',
                padding: '3px 8px',
                borderRadius: '6px',
                background: isLocked ? 'rgba(34, 197, 94, 0.2)' : (isContinuous ? 'rgba(245, 158, 11, 0.2)' : 'rgba(56, 189, 248, 0.2)'),
                color: isLocked ? '#86efac' : (isContinuous ? '#fde047' : '#7dd3fc'),
                border: isLocked ? '1px solid rgba(34, 197, 94, 0.4)' : (isContinuous ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid rgba(56, 189, 248, 0.4)')
              }}>
                {isLocked ? '🔒 LOCKED (Manual)' : (isContinuous ? '⚠️ CONTINUOUS (Autofocus)' : 'HARDWARE / UVC')}
              </span>
            </div>

            <div style={{ fontSize: '12.5px', lineHeight: '1.5', color: '#cbd5e1' }}>
              {isLocked && (
                <div style={{ color: '#86efac' }}>
                  ✅ <strong>Focus is locked!</strong> The camera lens will not search or hunt when your hands move across the neck. ArUco markers will maintain consistent clarity.
                </div>
              )}
              {isContinuous && (
                <div style={{ color: '#fde047' }}>
                  ⚠️ <strong>Autofocus is active:</strong> When your strumming or fretting hands move forward and back, the lens may briefly hunt for focus, temporarily blurring ArUco markers.
                </div>
              )}
              {!supportsSoftwareFocus && (
                <div style={{ color: '#94a3b8' }}>
                  ℹ️ This camera's focus is controlled in hardware / OS driver level rather than the browser WebRTC API (standard for external USB webcams on macOS).
                </div>
              )}
            </div>

            {/* In-Browser Software Focus Controls (If supported) */}
            {supportsSoftwareFocus && (
              <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={handleLock}
                  disabled={actionBusy || isLocked}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '8px 12px',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    borderRadius: '8px',
                    border: '1px solid rgba(34, 197, 94, 0.5)',
                    background: isLocked ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.25)',
                    color: '#86efac',
                    cursor: (actionBusy || isLocked) ? 'default' : 'pointer',
                    opacity: isLocked ? 0.6 : 1
                  }}
                >
                  <Lock size={14} />
                  <span>{isLocked ? 'Focus Locked' : '🔒 Lock Focus at Current Distance'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleContinuous}
                  disabled={actionBusy || isContinuous}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '8px 12px',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    background: 'rgba(255, 255, 255, 0.08)',
                    color: '#cbd5e1',
                    cursor: (actionBusy || isContinuous) ? 'default' : 'pointer',
                    opacity: isContinuous ? 0.6 : 1
                  }}
                >
                  <Unlock size={14} />
                  <span>Enable Autofocus</span>
                </button>
              </div>
            )}

            {actionStatus && (
              <div style={{
                fontSize: '11px',
                padding: '6px 10px',
                borderRadius: '6px',
                background: actionStatus.type === 'success' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                color: actionStatus.type === 'success' ? '#86efac' : '#fca5a5'
              }}>
                {actionStatus.msg}
              </div>
            )}
          </div>

          {/* External Hardware Guide (Logi Tune / Logitech / USB Webcams) */}
          <div style={{
            background: 'rgba(30, 41, 59, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '12px',
            padding: '16px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <Sliders size={16} style={{ color: '#38bdf8' }} />
              <strong style={{ fontSize: '13px', color: '#f8fafc' }}>
                External Webcam Setup (Logitech C920, C922, Brio &amp; Mac Mini)
              </strong>
            </div>

            <p style={{ margin: '0 0 10px 0', fontSize: '12.5px', color: '#94a3b8', lineHeight: '1.5' }}>
              External USB webcams maintain internal autofocus in their hardware chip. When you move your strumming hand, the camera firmware may hunt. To permanently lock focus:
            </p>

            <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: '#cbd5e1', lineHeight: '1.6' }}>
              <li>
                Open <strong>Logi Tune</strong> (or Camo / CameraController).
              </li>
              <li>
                Under <strong>Camera Settings</strong>, find <strong>Autofocus</strong> and switch it to <strong>OFF (Manual)</strong>.
              </li>
              <li>
                Adjust the focus distance slider until your guitar neck and frets look sharp at your playing distance (~0.8 m to 1.2 m).
              </li>
              <li>
                <strong>Done!</strong> The lens will stay fixed in hardware. Frets won't flicker or jump when your hands move.
              </li>
            </ol>
          </div>

          {/* Ambient Lighting & Shutter Speed Note */}
          <div style={{
            background: 'rgba(15, 23, 42, 0.6)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '14px 16px',
            display: 'flex',
            gap: '12px',
            alignItems: 'flex-start'
          }}>
            <Sun size={18} style={{ color: '#f59e0b', flexShrink: 0, marginTop: '2px' }} />
            <div style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: '1.5' }}>
              <strong style={{ color: '#f8fafc' }}>Room Lighting &amp; Motion Blur:</strong> Good room lighting allows the camera sensor to shoot at high shutter speeds (1/120s or faster). This eliminates motion blur when strumming rapidly and gives a deeper depth of field so both hands and markers stay sharp.
            </div>
          </div>

          {/* Collapsible Raw WebRTC Diagnostics */}
          <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '10px' }}>
            <button
              type="button"
              onClick={() => setShowRawDetails(!showRawDetails)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#64748b',
                cursor: 'pointer',
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 0'
              }}
            >
              {showRawDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              <span>{showRawDetails ? 'Hide Technical Driver Details' : 'Show Technical Driver Capabilities'}</span>
            </button>

            {showRawDetails && (
              <pre style={{
                background: '#090d16',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                padding: '10px',
                borderRadius: '8px',
                fontSize: '10.5px',
                fontFamily: 'monospace',
                color: '#94a3b8',
                overflowX: 'auto',
                marginTop: '8px',
                maxHeight: '160px'
              }}>
                {JSON.stringify({
                  label: diagnostics?.label,
                  currentFocusMode: diagnostics?.currentFocusMode,
                  supportedFocusModes: diagnostics?.focusModes,
                  currentExposureMode: diagnostics?.currentExposureMode,
                  supportedExposureModes: diagnostics?.exposureModes,
                  settings: diagnostics?.settings
                }, null, 2)}
              </pre>
            )}
          </div>

        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 20px',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(30, 41, 59, 0.4)',
          display: 'flex',
          justifyContent: 'flex-end'
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 20px',
              fontSize: '12px',
              fontWeight: 'bold',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              background: 'rgba(255, 255, 255, 0.1)',
              color: '#f8fafc',
              cursor: 'pointer'
            }}
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
