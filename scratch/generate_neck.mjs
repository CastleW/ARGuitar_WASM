import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import arucoDict from '../src/assets/aruco_dictionary.json' with { type: 'json' };

const FRET_DISTANCES_MM = [
  36.4, 70.7, 103.1, 133.6, 162.5, 189.7,
  215.4, 239.7, 262.6, 284.2, 304.6,
  323.8, 342.0, 359.2, 375.4, 390.7,
  405.1, 418.7, 431.6, 443.7, 455.1,
  465.9
];

const MARKERS = [
  { id: 1, centerMm: -56.5, sizeMm: 31.0, label: 'Marker 1 (Headstock)' },
  { id: 2, centerMm: 155.0, sizeMm: 31.0, label: 'Marker 2 (Fret 5)' },
  { id: 3, centerMm: 273.0, sizeMm: 31.0, label: 'Marker 3 (Fret 9-10)' },
  { id: 4, centerMm: 366.0, sizeMm: 31.0, label: 'Marker 4 (Fret 14-15)' },
  { id: 5, centerMm: 519.0, sizeMm: 31.0, label: 'Marker 5 (Strum Zone)' }
];

const INLAY_DOT_FRETS = [3, 5, 7, 9, 15, 17, 19, 21];
const DOUBLE_DOT_FRET = 12;

const NECK_WIDTH_MM = 46.0;
const STRING_COUNT = 6;
const STRING_SPAN_MM = 37.5;
const STRING_NAMES = ['e (1st)', 'B (2nd)', 'G (3rd)', 'D (4th)', 'A (5th)', 'E (6th)'];
const STRING_WEIGHTS = [0.25, 0.35, 0.45, 0.55, 0.65, 0.8];

function getMarkerBits(id) {
  const bytes = arucoDict[id][0];
  const bits = [];
  for (let k = 0; k < 25; k++) {
    let bit;
    if (k < 24) {
      bit = (bytes[Math.floor(k / 8)] >> (7 - (k % 8))) & 1;
    } else {
      bit = bytes[3] & 1;
    }
    bits.push(bit);
  }
  const grid = [];
  for (let r = 0; r < 5; r++) grid.push(bits.slice(r * 5, r * 5 + 5));
  return grid;
}

function renderArUcoSVG(id, centerMm, sizeMm, neckYCenterMm) {
  const ox = centerMm - sizeMm / 2;
  const oy = neckYCenterMm - sizeMm / 2;
  const cell = sizeMm / 7;
  const quietMargin = 3.5;
  const qx = ox - quietMargin;
  const qy = oy - quietMargin;
  const qw = sizeMm + quietMargin * 2;
  const qh = sizeMm + quietMargin * 2;

  let out = `  <!-- ArUco Marker ID ${id} -->\n`;
  out += `  <rect x="${qx.toFixed(2)}" y="${qy.toFixed(2)}" width="${qw.toFixed(2)}" height="${qh.toFixed(2)}" fill="#ffffff" stroke="#94a3b8" stroke-width="0.3"/>\n`;
  out += `  <rect x="${ox.toFixed(2)}" y="${oy.toFixed(2)}" width="${sizeMm.toFixed(2)}" height="${sizeMm.toFixed(2)}" fill="#000000"/>\n`;

  const bits = getMarkerBits(id);
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (bits[r][c]) {
        const bx = ox + (c + 1) * cell;
        const by = oy + (r + 1) * cell;
        out += `  <rect x="${bx.toFixed(3)}" y="${by.toFixed(3)}" width="${(cell + 0.02).toFixed(3)}" height="${(cell + 0.02).toFixed(3)}" fill="#ffffff"/>\n`;
      }
    }
  }

  out += `  <text x="${centerMm.toFixed(1)}" y="${(qy - 1.5).toFixed(1)}" font-family="system-ui, -apple-system, sans-serif" font-size="2.4" font-weight="bold" fill="#0284c7" text-anchor="middle">ArUco ID ${id} (${sizeMm}mm)</text>\n`;
  return out;
}

// Render Master Assembly Guide & Overview Sheet (Page 0)
function renderGuidePageSVG({ pageWidthMm = 280, pageHeightMm = 195 }) {
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pageWidthMm} ${pageHeightMm}" width="${pageWidthMm}mm" height="${pageHeightMm}mm" style="background:#ffffff; font-family:system-ui,-apple-system,sans-serif;">\n`;

  // Header Box
  svg += `<rect x="10" y="8" width="${pageWidthMm - 20}" height="28" rx="4" fill="#f8fafc" stroke="#cbd5e1" stroke-width="0.5"/>\n`;
  svg += `<text x="18" y="19" font-size="7" font-weight="900" fill="#0f172a">🎸 ARGuitar — Construction &amp; Assembly Guide</text>\n`;
  svg += `<text x="18" y="27" font-size="3.6" font-weight="600" fill="#0284c7">Overview, Measurements &amp; Step-by-Step Instructions for Making Your AR Guitar</text>\n`;

  // Materials & Tools Card
  svg += `<rect x="10" y="40" width="125" height="52" rx="4" fill="#f8fafc" stroke="#e2e8f0" stroke-width="0.5"/>\n`;
  svg += `<text x="18" y="49" font-size="4" font-weight="bold" fill="#0f172a">📦 Materials &amp; Tools Needed:</text>\n`;
  svg += `<text x="18" y="57" font-size="2.8" fill="#334155">• <tspan font-weight="bold">Base Strip:</tspan> Wood batten, molding, heavy cardboard, or ruler</text>\n`;
  svg += `<text x="22" y="62" font-size="2.5" fill="#64748b">Recommended size: ~45–46 mm wide × ~60–65 cm long, ~1 cm thick</text>\n`;
  svg += `<text x="18" y="68" font-size="2.8" fill="#334155">• <tspan font-weight="bold">Standard Printer Paper:</tspan> 3 sheets of A4 or US Letter</text>\n`;
  svg += `<text x="18" y="74" font-size="2.8" fill="#334155">• <tspan font-weight="bold">Craft Tools:</tspan> Scissors or hobby knife &amp; metal ruler</text>\n`;
  svg += `<text x="18" y="80" font-size="2.8" fill="#334155">• <tspan font-weight="bold">Adhesive:</tspan> Glue stick, double-sided tape, or clear packing tape</text>\n`;
  svg += `<text x="18" y="86" font-size="2.8" fill="#334155">• <tspan font-weight="bold">Webcam:</tspan> 720p or 1080p camera connected to a computer</text>\n`;

  // Scale & Calibration Notice Card
  svg += `<rect x="145" y="40" width="125" height="52" rx="4" fill="#f0f9ff" stroke="#0284c7" stroke-width="0.8"/>\n`;
  svg += `<text x="153" y="49" font-size="4" font-weight="bold" fill="#0369a1">⚠️ CRITICAL: 100% Print Scale</text>\n`;
  svg += `<text x="153" y="57" font-size="2.8" fill="#0369a1">In your print dialog, select <tspan font-weight="bold">"Actual Size"</tspan> or <tspan font-weight="bold">"100%"</tspan>.</text>\n`;
  svg += `<text x="153" y="62" font-size="2.5" fill="#0284c7">Do NOT choose "Fit to Page" or "Shrink to Fit".</text>\n`;
  // Miniature 50mm ruler
  svg += `<rect x="153" y="67" width="50" height="9" fill="#ffffff" stroke="#0284c7" stroke-width="0.6"/>\n`;
  for (let m = 0; m <= 50; m += 10) {
    const mx = 153 + m;
    svg += `<line x1="${mx}" y1="67" x2="${mx}" y2="76" stroke="#0284c7" stroke-width="0.6"/>\n`;
    svg += `<text x="${mx}" y="82" font-size="2.4" font-family="monospace" fill="#0284c7" text-anchor="middle">${m / 10}</text>\n`;
  }
  svg += `<text x="210" y="73" font-size="2.5" font-weight="bold" fill="#0369a1">← 50 mm (5.0 cm)</text>\n`;
  svg += `<text x="153" y="88" font-size="2.4" fill="#64748b">Verify each printed sheet against this 50mm test bar.</text>\n`;

  // Full Mini Diagram of Assembled Neck
  svg += `<rect x="10" y="96" width="${pageWidthMm - 20}" height="40" rx="4" fill="#ffffff" stroke="#cbd5e1" stroke-width="0.5"/>\n`;
  svg += `<text x="18" y="104" font-size="3.5" font-weight="bold" fill="#0f172a">📐 Complete AR Guitar Layout (Fender 25.5" / 64.8 cm Scale, 46 mm Neck Width):</text>\n`;

  // Mini neck representation
  const miniScale = 0.35; // scale from mm to drawing coords
  const miniNeckX = 18;
  const miniNeckY = 112;
  const miniNeckH = 14;
  const miniNutX = miniNeckX + 85 * miniScale;

  // Background
  svg += `<rect x="${miniNeckX}" y="${miniNeckY}" width="${660 * miniScale}" height="${miniNeckH}" fill="#fdfbf7" stroke="#334155" stroke-width="0.6"/>\n`;
  // Nut
  svg += `<line x1="${miniNutX}" y1="${miniNeckY - 2}" x2="${miniNutX}" y2="${miniNeckY + miniNeckH + 2}" stroke="#0f172a" stroke-width="1.5"/>\n`;
  svg += `<text x="${miniNutX}" y="${miniNeckY - 3}" font-size="2.4" font-weight="bold" fill="#0f172a" text-anchor="middle">NUT (0cm)</text>\n`;

  // Frets
  FRET_DISTANCES_MM.forEach((fx, idx) => {
    const px = miniNutX + fx * miniScale;
    svg += `<line x1="${px}" y1="${miniNeckY}" x2="${px}" y2="${miniNeckY + miniNeckH}" stroke="#94a3b8" stroke-width="0.4"/>\n`;
  });

  // Markers
  MARKERS.forEach(m => {
    const mx = miniNutX + m.centerMm * miniScale;
    const ms = m.sizeMm * miniScale;
    svg += `<rect x="${mx - ms / 2}" y="${miniNeckY + miniNeckH / 2 - ms / 2}" width="${ms}" height="${ms}" fill="#0284c7"/>\n`;
    svg += `<text x="${mx}" y="${miniNeckY + miniNeckH + 6}" font-size="2.2" font-weight="bold" fill="#0284c7" text-anchor="middle">M${m.id}</text>\n`;
    svg += `<text x="${mx}" y="${miniNeckY + miniNeckH + 9}" font-size="1.8" font-family="monospace" fill="#64748b" text-anchor="middle">${(m.centerMm / 10).toFixed(1)}cm</text>\n`;
  });

  // Strum Zone
  const strumStartX = miniNutX + 475 * miniScale;
  const strumW = 95 * miniScale;
  svg += `<rect x="${strumStartX}" y="${miniNeckY}" width="${strumW}" height="${miniNeckH}" fill="rgba(56, 189, 248, 0.2)" stroke="#38bdf8" stroke-dasharray="2,1" stroke-width="0.5"/>\n`;
  svg += `<text x="${strumStartX + strumW / 2}" y="${miniNeckY - 3}" font-size="2.4" font-weight="bold" fill="#0284c7" text-anchor="middle">STRUM ZONE</text>\n`;

  // Step-by-Step Table
  svg += `<rect x="10" y="140" width="${pageWidthMm - 20}" height="46" rx="4" fill="#f8fafc" stroke="#cbd5e1" stroke-width="0.5"/>\n`;
  svg += `<text x="18" y="148" font-size="3.6" font-weight="bold" fill="#0f172a">✂️ Assembly Instructions in 4 Steps:</text>\n`;
  svg += `<text x="18" y="155.5" font-size="2.8" fill="#1e293b"><tspan font-weight="bold" fill="#0284c7">1. Print Sheets 1 to 3:</tspan> Verify the 50mm scale box with a ruler. If it is 50mm, your scale is exact.</text>\n`;
  svg += `<text x="18" y="162.5" font-size="2.8" fill="#1e293b"><tspan font-weight="bold" fill="#0284c7">2. Trim the Cut Lines:</tspan> On <tspan font-weight="bold">Page 2</tspan>, cut cleanly along the red dashed line at 170 mm. On <tspan font-weight="bold">Page 3</tspan>, cut at 375 mm.</text>\n`;
  svg += `<text x="18" y="169.5" font-size="2.8" fill="#1e293b"><tspan font-weight="bold" fill="#0284c7">3. Align &amp; Join:</tspan> Lay Page 2 over the shaded tab of Page 1. Align the red crosshair targets ⨁ and fret lines, then tape or glue.</text>\n`;
  svg += `<text x="18" y="174" font-size="2.5" fill="#64748b">Repeat with Page 3 over Page 2. You now have a complete, continuous 64 cm guitar neck!</text>\n`;
  svg += `<text x="18" y="180.5" font-size="2.8" fill="#1e293b"><tspan font-weight="bold" fill="#0284c7">4. Mount &amp; Play:</tspan> Affix to your wooden strip or card. Hold like a real guitar in front of your camera, launch ARGuitar, and strum!</text>\n`;

  svg += `</svg>\n`;
  return svg;
}

function renderNeckSegmentSVG({
  startX,
  endX,
  pageWidthMm = 280,
  pageHeightMm = 195,
  neckTopY = 68,
  pageTitle = '',
  pageNumber = 1,
  totalPages = 3,
  leftOverlap = null,
  rightOverlap = null
}) {
  const neckBottomY = neckTopY + NECK_WIDTH_MM;
  const neckYCenter = neckTopY + NECK_WIDTH_MM / 2;
  const spanX = endX - startX;
  const offsetX = (pageWidthMm - spanX) / 2 - startX;

  let svg = ``;
  svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pageWidthMm} ${pageHeightMm}" width="${pageWidthMm}mm" height="${pageHeightMm}mm" style="background:#ffffff; font-family:system-ui,-apple-system,sans-serif;">\n`;

  // Defs: hatch pattern for overlap zones
  svg += `<defs>
    <pattern id="overlapHatch" width="4" height="4" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="0" y2="4" stroke="#e0e7ff" stroke-width="1.5" />
    </pattern>
  </defs>\n`;

  // Page Header
  svg += `<!-- Page Header -->\n`;
  svg += `<rect x="10" y="8" width="${pageWidthMm - 20}" height="32" rx="4" fill="#f8fafc" stroke="#cbd5e1" stroke-width="0.5"/>\n`;
  svg += `<text x="18" y="20" font-size="6.5" font-weight="800" fill="#0f172a">🎸 ARGuitar — Printable Practice Neck (1:1 Scale)</text>\n`;
  svg += `<text x="18" y="27.5" font-size="4" font-weight="600" fill="#0284c7">${pageTitle} · Sheet ${pageNumber} of ${totalPages}</text>\n`;
  svg += `<text x="18" y="34.5" font-size="3" fill="#64748b">Print at 100% (Actual Size). Mount on ~45-46mm wide wood strip, ruler, or heavy card.</text>\n`;

  // 50mm Scale Verification Box
  const scaleBoxX = pageWidthMm - 78;
  const scaleBoxY = 12;
  svg += `<!-- Scale Verification Box -->\n`;
  svg += `<g transform="translate(${scaleBoxX}, ${scaleBoxY})">\n`;
  svg += `  <rect x="0" y="0" width="66" height="24" rx="3" fill="#ffffff" stroke="#0284c7" stroke-width="0.8"/>\n`;
  svg += `  <text x="33" y="6" font-size="2.6" font-weight="bold" fill="#0369a1" text-anchor="middle">⚠️ SCALE CHECK: EXACTLY 50 mm</text>\n`;
  svg += `  <rect x="8" y="8" width="50" height="7" fill="#f0f9ff" stroke="#0284c7" stroke-width="0.6"/>\n`;
  for (let m = 0; m <= 50; m += 10) {
    const mx = 8 + m;
    svg += `  <line x1="${mx}" y1="8" x2="${mx}" y2="15" stroke="#0284c7" stroke-width="0.6"/>\n`;
    svg += `  <text x="${mx}" y="19" font-size="2.4" font-family="monospace" fill="#0284c7" text-anchor="middle">${m / 10}</text>\n`;
  }
  svg += `  <text x="33" y="22.5" font-size="2.1" fill="#64748b" text-anchor="middle">Measure bar with ruler: 0 to 5 cm</text>\n`;
  svg += `</g>\n`;

  // Main Neck Group with translation
  svg += `<!-- Main Neck Area -->\n`;
  svg += `<g transform="translate(${offsetX.toFixed(2)}, 0)">\n`;

  // Background for neck
  const neckFill = `#fdfbf7`;
  svg += `  <rect x="${startX}" y="${neckTopY}" width="${spanX}" height="${NECK_WIDTH_MM}" fill="${neckFill}" stroke="#334155" stroke-width="0.8"/>\n`;

  // Overlap zones (if any)
  if (leftOverlap) {
    const { fromX, toX, cutX } = leftOverlap;
    const w = toX - fromX;
    svg += `  <!-- Left Overlap Tab -->\n`;
    svg += `  <rect x="${fromX}" y="${neckTopY}" width="${w}" height="${NECK_WIDTH_MM}" fill="url(#overlapHatch)"/>\n`;
    svg += `  <line x1="${cutX}" y1="${neckTopY - 7}" x2="${cutX}" y2="${neckBottomY + 7}" stroke="#ef4444" stroke-width="0.7" stroke-dasharray="2,2"/>\n`;
    svg += `  <text x="${cutX}" y="${neckTopY - 8.5}" font-size="2.6" font-weight="bold" fill="#ef4444" text-anchor="middle">✂️ CUT / JOIN EDGE (${cutX}mm)</text>\n`;
    // Alignment Crosshairs
    svg += `  <circle cx="${cutX}" cy="${neckTopY}" r="2" fill="none" stroke="#ef4444" stroke-width="0.6"/>\n`;
    svg += `  <line x1="${cutX - 2.5}" y1="${neckTopY}" x2="${cutX + 2.5}" y2="${neckTopY}" stroke="#ef4444" stroke-width="0.5"/>\n`;
    svg += `  <line x1="${cutX}" y1="${neckTopY - 2.5}" x2="${cutX}" y2="${neckTopY + 2.5}" stroke="#ef4444" stroke-width="0.5"/>\n`;
    svg += `  <circle cx="${cutX}" cy="${neckBottomY}" r="2" fill="none" stroke="#ef4444" stroke-width="0.6"/>\n`;
    svg += `  <line x1="${cutX - 2.5}" y1="${neckBottomY}" x2="${cutX + 2.5}" y2="${neckBottomY}" stroke="#ef4444" stroke-width="0.5"/>\n`;
    svg += `  <line x1="${cutX}" y1="${neckBottomY - 2.5}" x2="${cutX}" y2="${neckBottomY + 2.5}" stroke="#ef4444" stroke-width="0.5"/>\n`;
  }

  if (rightOverlap) {
    const { fromX, toX, cutX } = rightOverlap;
    const w = toX - fromX;
    svg += `  <!-- Right Overlap Tab -->\n`;
    svg += `  <rect x="${fromX}" y="${neckTopY}" width="${w}" height="${NECK_WIDTH_MM}" fill="url(#overlapHatch)"/>\n`;
    svg += `  <line x1="${cutX}" y1="${neckTopY - 7}" x2="${cutX}" y2="${neckBottomY + 7}" stroke="#ef4444" stroke-width="0.7" stroke-dasharray="2,2"/>\n`;
    svg += `  <text x="${cutX}" y="${neckTopY - 8.5}" font-size="2.6" font-weight="bold" fill="#ef4444" text-anchor="middle">✂️ CUT / JOIN EDGE (${cutX}mm)</text>\n`;
    // Alignment Crosshairs
    svg += `  <circle cx="${cutX}" cy="${neckTopY}" r="2" fill="none" stroke="#ef4444" stroke-width="0.6"/>\n`;
    svg += `  <line x1="${cutX - 2.5}" y1="${neckTopY}" x2="${cutX + 2.5}" y2="${neckTopY}" stroke="#ef4444" stroke-width="0.5"/>\n`;
    svg += `  <line x1="${cutX}" y1="${neckTopY - 2.5}" x2="${cutX}" y2="${neckTopY + 2.5}" stroke="#ef4444" stroke-width="0.5"/>\n`;
    svg += `  <circle cx="${cutX}" cy="${neckBottomY}" r="2" fill="none" stroke="#ef4444" stroke-width="0.6"/>\n`;
    svg += `  <line x1="${cutX - 2.5}" y1="${neckBottomY}" x2="${cutX + 2.5}" y2="${neckBottomY}" stroke="#ef4444" stroke-width="0.5"/>\n`;
    svg += `  <line x1="${cutX}" y1="${neckBottomY - 2.5}" x2="${cutX}" y2="${neckBottomY + 2.5}" stroke="#ef4444" stroke-width="0.5"/>\n`;
  }

  // 6 Strings
  const stringStep = STRING_SPAN_MM / (STRING_COUNT - 1);
  const firstStringY = neckYCenter - STRING_SPAN_MM / 2;
  for (let s = 0; s < STRING_COUNT; s++) {
    const sy = firstStringY + s * stringStep;
    const weight = STRING_WEIGHTS[s];
    svg += `  <line x1="${startX}" y1="${sy.toFixed(2)}" x2="${endX}" y2="${sy.toFixed(2)}" stroke="#94a3b8" stroke-width="${weight}"/>\n`;
  }

  // Nut (if within range)
  if (startX <= 0 && endX >= 0) {
    svg += `  <!-- Nut (0.0 mm) -->\n`;
    svg += `  <rect x="-2" y="${neckTopY - 1}" width="4" height="${NECK_WIDTH_MM + 2}" fill="#0f172a" stroke="#000000" stroke-width="0.5"/>\n`;
    svg += `  <text x="0" y="${neckTopY - 3}" font-size="3.2" font-weight="900" fill="#0f172a" text-anchor="middle">NUT (0.0 cm)</text>\n`;
    for (let s = 0; s < STRING_COUNT; s++) {
      const sy = firstStringY + s * stringStep;
      svg += `  <text x="-4" y="${(sy + 1).toFixed(2)}" font-size="2.2" font-weight="bold" fill="#475569" text-anchor="end">${STRING_NAMES[s]}</text>\n`;
    }
  }

  // Headstock area (if startX < 0)
  if (startX < 0) {
    svg += `  <!-- Headstock Tag -->\n`;
    svg += `  <text x="${(startX + -10) / 2}" y="${neckBottomY + 7}" font-size="3" font-weight="bold" fill="#64748b" text-anchor="middle">HEADSTOCK AREA</text>\n`;
  }

  // Fret positions within [startX, endX]
  FRET_DISTANCES_MM.forEach((fretX, idx) => {
    const fretNum = idx + 1;
    if (fretX >= startX - 2 && fretX <= endX + 2) {
      svg += `  <!-- Fret ${fretNum} (${(fretX / 10).toFixed(2)} cm) -->\n`;
      svg += `  <line x1="${fretX.toFixed(2)}" y1="${neckTopY}" x2="${fretX.toFixed(2)}" y2="${neckBottomY}" stroke="#475569" stroke-width="1.0"/>\n`;
      svg += `  <text x="${fretX.toFixed(2)}" y="${neckBottomY + 5.5}" font-size="3.2" font-weight="bold" fill="#1e293b" text-anchor="middle">${fretNum}</text>\n`;
      svg += `  <text x="${fretX.toFixed(2)}" y="${neckBottomY + 9}" font-size="2.0" font-family="monospace" fill="#64748b" text-anchor="middle">${(fretX / 10).toFixed(1)}cm</text>\n`;

      if (INLAY_DOT_FRETS.includes(fretNum)) {
        const prevFretX = idx === 0 ? 0 : FRET_DISTANCES_MM[idx - 1];
        const dotX = (prevFretX + fretX) / 2;
        if (dotX >= startX && dotX <= endX) {
          svg += `  <circle cx="${dotX.toFixed(2)}" cy="${neckYCenter.toFixed(2)}" r="2.8" fill="#e2e8f0" stroke="#94a3b8" stroke-width="0.5"/>\n`;
        }
      } else if (fretNum === DOUBLE_DOT_FRET) {
        const prevFretX = FRET_DISTANCES_MM[idx - 1];
        const dotX = (prevFretX + fretX) / 2;
        if (dotX >= startX && dotX <= endX) {
          svg += `  <circle cx="${dotX.toFixed(2)}" cy="${(neckYCenter - 7.5).toFixed(2)}" r="2.4" fill="#e2e8f0" stroke="#94a3b8" stroke-width="0.5"/>\n`;
          svg += `  <circle cx="${dotX.toFixed(2)}" cy="${(neckYCenter + 7.5).toFixed(2)}" r="2.4" fill="#e2e8f0" stroke="#94a3b8" stroke-width="0.5"/>\n`;
        }
      }
    }
  });

  // Fretboard End (after 22nd fret)
  if (endX >= 465.9 && startX <= 470) {
    svg += `  <!-- 22nd Fret End Line -->\n`;
    svg += `  <line x1="470" y1="${neckTopY}" x2="470" y2="${neckBottomY}" stroke="#0f172a" stroke-width="1.8"/>\n`;
    svg += `  <text x="470" y="${neckTopY - 2.5}" font-size="2.6" font-weight="bold" fill="#0f172a" text-anchor="middle">Fretboard End (22 Frets)</text>\n`;
  }

  // Strumming Zone indication
  if (endX >= 480 && startX <= 570) {
    const sZoneStart = Math.max(startX, 475);
    const sZoneEnd = Math.min(endX, 565);
    svg += `  <!-- Strum Zone -->\n`;
    svg += `  <rect x="${sZoneStart}" y="${neckTopY + 2}" width="${sZoneEnd - sZoneStart}" height="${NECK_WIDTH_MM - 4}" fill="rgba(56, 189, 248, 0.08)" stroke="#38bdf8" stroke-dasharray="3,2" stroke-width="0.5"/>\n`;
    svg += `  <text x="${(sZoneStart + sZoneEnd) / 2}" y="${neckTopY - 2.5}" font-size="3" font-weight="bold" fill="#0284c7" text-anchor="middle">⚡ STRUM ZONE (Right Hand Strum Target)</text>\n`;
  }

  // ArUco Markers that fall in this segment
  MARKERS.forEach(m => {
    if (m.centerMm >= startX - 15 && m.centerMm <= endX + 15) {
      svg += renderArUcoSVG(m.id, m.centerMm, m.sizeMm, neckYCenter);
    }
  });

  // Top & Bottom Edge Ruler Markings
  svg += `  <!-- Top & Bottom Edge Cut Lines / Ruler -->\n`;
  const rulerStartX = Math.ceil(startX / 10) * 10;
  for (let rx = rulerStartX; rx <= endX; rx += 10) {
    svg += `  <line x1="${rx}" y1="${neckTopY}" x2="${rx}" y2="${neckTopY - 2}" stroke="#64748b" stroke-width="0.4"/>\n`;
    svg += `  <line x1="${rx}" y1="${neckBottomY}" x2="${rx}" y2="${neckBottomY + 2}" stroke="#64748b" stroke-width="0.4"/>\n`;
    svg += `  <text x="${rx}" y="${neckBottomY + 14}" font-size="2.0" font-family="monospace" fill="#94a3b8" text-anchor="middle">${rx / 10}</text>\n`;
  }

  svg += `</g>\n`; // end translated neck group

  // Footer / Instructions at bottom of page
  svg += `<!-- Footer -->\n`;
  const footY = pageHeightMm - 18;
  svg += `<rect x="10" y="${footY}" width="${pageWidthMm - 20}" height="12" rx="3" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="0.4"/>\n`;
  svg += `<text x="18" y="${footY + 5}" font-size="2.8" font-weight="bold" fill="#334155">ASSEMBLY TIP:</text>\n`;
  svg += `<text x="45" y="${footY + 5}" font-size="2.6" fill="#475569">Cut along the red dashed lines and align the crosshair targets. Glue or double-sided tape onto wood/card.</text>\n`;
  svg += `<text x="18" y="${footY + 9.5}" font-size="2.5" fill="#64748b">ARGuitar_WASM by Mark Watson · Standard 25.5" (64.8cm) Fender-scale fret positions · 46mm neck width</text>\n`;

  svg += `</svg>\n`;
  return svg;
}

// Generate the 3 printable pages
const guideSvg = renderGuidePageSVG({ pageWidthMm: 280, pageHeightMm: 195 });

const page1Svg = renderNeckSegmentSVG({
  startX: -82,
  endX: 180,
  pageTitle: 'Headstock & Frets 0–5 (Nut, Marker 1 & Marker 2)',
  pageNumber: 1,
  totalPages: 3,
  rightOverlap: { fromX: 160, toX: 180, cutX: 170 }
});

const page2Svg = renderNeckSegmentSVG({
  startX: 160,
  endX: 385,
  pageTitle: 'Frets 6–15 (Marker 3, Fret 12 Inlay & Marker 4)',
  pageNumber: 2,
  totalPages: 3,
  leftOverlap: { fromX: 160, toX: 180, cutX: 170 },
  rightOverlap: { fromX: 365, toX: 385, cutX: 375 }
});

const page3Svg = renderNeckSegmentSVG({
  startX: 365,
  endX: 570,
  pageTitle: 'Frets 16–22 & Strumming Zone (Marker 5)',
  pageNumber: 3,
  totalPages: 3,
  leftOverlap: { fromX: 365, toX: 385, cutX: 375 }
});

// Full continuous scale SVG (670mm x 90mm)
function renderFullContinuousSVG() {
  const startX = -85;
  const endX = 580;
  const totalW = endX - startX + 40;
  const totalH = 100;
  const neckTopY = 30;
  const neckBottomY = neckTopY + NECK_WIDTH_MM;
  const neckYCenter = neckTopY + NECK_WIDTH_MM / 2;
  const offsetX = 20 - startX;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}mm" height="${totalH}mm" style="background:#ffffff; font-family:system-ui,-apple-system,sans-serif;">\n`;
  svg += `<text x="20" y="15" font-size="5" font-weight="bold" fill="#0f172a">ARGuitar Continuous Practice Neck (1:1 Full Scale — 25.5" Fender Scale)</text>\n`;
  svg += `<g transform="translate(${offsetX}, 0)">\n`;
  svg += `  <rect x="${startX}" y="${neckTopY}" width="${endX - startX}" height="${NECK_WIDTH_MM}" fill="#fdfbf7" stroke="#334155" stroke-width="0.8"/>\n`;

  const stringStep = STRING_SPAN_MM / (STRING_COUNT - 1);
  const firstStringY = neckYCenter - STRING_SPAN_MM / 2;
  for (let s = 0; s < STRING_COUNT; s++) {
    const sy = firstStringY + s * stringStep;
    svg += `  <line x1="${startX}" y1="${sy.toFixed(2)}" x2="${endX}" y2="${sy.toFixed(2)}" stroke="#94a3b8" stroke-width="${STRING_WEIGHTS[s]}"/>\n`;
  }

  svg += `  <rect x="-2" y="${neckTopY - 1}" width="4" height="${NECK_WIDTH_MM + 2}" fill="#0f172a"/>\n`;
  svg += `  <text x="0" y="${neckTopY - 3}" font-size="3" font-weight="bold" fill="#0f172a" text-anchor="middle">NUT (0.0 cm)</text>\n`;
  for (let s = 0; s < STRING_COUNT; s++) {
    const sy = firstStringY + s * stringStep;
    svg += `  <text x="-4" y="${(sy + 1).toFixed(2)}" font-size="2.2" font-weight="bold" fill="#475569" text-anchor="end">${STRING_NAMES[s]}</text>\n`;
  }

  FRET_DISTANCES_MM.forEach((fretX, idx) => {
    const fretNum = idx + 1;
    svg += `  <line x1="${fretX.toFixed(2)}" y1="${neckTopY}" x2="${fretX.toFixed(2)}" y2="${neckBottomY}" stroke="#475569" stroke-width="0.8"/>\n`;
    svg += `  <text x="${fretX.toFixed(2)}" y="${neckBottomY + 5}" font-size="2.8" font-weight="bold" fill="#1e293b" text-anchor="middle">${fretNum}</text>\n`;

    if (INLAY_DOT_FRETS.includes(fretNum)) {
      const prevFretX = idx === 0 ? 0 : FRET_DISTANCES_MM[idx - 1];
      const dotX = (prevFretX + fretX) / 2;
      svg += `  <circle cx="${dotX.toFixed(2)}" cy="${neckYCenter.toFixed(2)}" r="2.6" fill="#e2e8f0" stroke="#94a3b8" stroke-width="0.4"/>\n`;
    } else if (fretNum === DOUBLE_DOT_FRET) {
      const prevFretX = FRET_DISTANCES_MM[idx - 1];
      const dotX = (prevFretX + fretX) / 2;
      svg += `  <circle cx="${dotX.toFixed(2)}" cy="${(neckYCenter - 7.5).toFixed(2)}" r="2.2" fill="#e2e8f0" stroke="#94a3b8" stroke-width="0.4"/>\n`;
      svg += `  <circle cx="${dotX.toFixed(2)}" cy="${(neckYCenter + 7.5).toFixed(2)}" r="2.2" fill="#e2e8f0" stroke="#94a3b8" stroke-width="0.4"/>\n`;
    }
  });

  svg += `  <rect x="475" y="${neckTopY + 2}" width="95" height="${NECK_WIDTH_MM - 4}" fill="rgba(56, 189, 248, 0.08)" stroke="#38bdf8" stroke-dasharray="3,2" stroke-width="0.5"/>\n`;
  svg += `  <text x="522" y="${neckTopY - 2.5}" font-size="3" font-weight="bold" fill="#0284c7" text-anchor="middle">⚡ STRUM ZONE</text>\n`;

  MARKERS.forEach(m => {
    svg += renderArUcoSVG(m.id, m.centerMm, m.sizeMm, neckYCenter);
  });

  for (let rx = -70; rx <= endX; rx += 10) {
    svg += `  <line x1="${rx}" y1="${neckBottomY}" x2="${rx}" y2="${neckBottomY + 2}" stroke="#64748b" stroke-width="0.4"/>\n`;
    svg += `  <text x="${rx}" y="${neckBottomY + 11}" font-size="2" font-family="monospace" fill="#94a3b8" text-anchor="middle">${rx / 10}</text>\n`;
  }

  svg += `</g>\n</svg>\n`;
  return svg;
}

const fullSvg = renderFullContinuousSVG();

const publicNeckDir = path.resolve('public/neck');
fs.mkdirSync(publicNeckDir, { recursive: true });

fs.writeFileSync(path.join(publicNeckDir, 'arguitar_neck_guide.svg'), guideSvg, 'utf8');
fs.writeFileSync(path.join(publicNeckDir, 'arguitar_neck_page1.svg'), page1Svg, 'utf8');
fs.writeFileSync(path.join(publicNeckDir, 'arguitar_neck_page2.svg'), page2Svg, 'utf8');
fs.writeFileSync(path.join(publicNeckDir, 'arguitar_neck_page3.svg'), page3Svg, 'utf8');
fs.writeFileSync(path.join(publicNeckDir, 'arguitar_neck_full_scale.svg'), fullSvg, 'utf8');

console.log('Saved SVGs to public/neck/');

// Generate multi-page printable HTML
const printableHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ARGuitar Printable Practice Neck (1:1 Actual Size)</title>
  <style>
    @page {
      size: 297mm 210mm;
      margin: 0;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      color: #f8fafc;
    }
    .no-print {
      max-width: 900px;
      margin: 20px auto;
      padding: 24px;
      background: #1e293b;
      border-radius: 12px;
      border: 1px solid #334155;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    }
    .no-print h1 {
      margin-top: 0;
      color: #38bdf8;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .print-btn {
      background: linear-gradient(135deg, #0284c7, #0369a1);
      color: white;
      border: none;
      padding: 12px 28px;
      font-size: 16px;
      font-weight: bold;
      border-radius: 8px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(2, 132, 199, 0.4);
      transition: all 0.2s ease;
    }
    .print-btn:hover {
      background: #0284c7;
      transform: translateY(-1px);
    }
    .download-links {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 15px;
    }
    .download-links a {
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.3);
      padding: 6px 14px;
      border-radius: 6px;
      text-decoration: none;
      font-size: 13px;
    }
    .download-links a:hover {
      background: rgba(56, 189, 248, 0.2);
    }
    .instructions {
      background: rgba(15, 23, 42, 0.6);
      padding: 16px;
      border-radius: 8px;
      margin-top: 15px;
      border-left: 4px solid #38bdf8;
      font-size: 14px;
      line-height: 1.6;
    }
    .instructions ol {
      margin: 8px 0 0 20px;
      padding: 0;
    }
    .page {
      background: #ffffff;
      width: 280mm;
      height: 195mm;
      margin: 15px auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.6);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    @media print {
      html, body {
        background: #ffffff !important;
        margin: 0 !important;
        padding: 0 !important;
        width: 297mm;
        height: auto;
      }
      .no-print {
        display: none !important;
      }
      .page {
        margin: 0 !important;
        padding: 0 !important;
        box-shadow: none !important;
        width: 297mm !important;
        height: 210mm !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        page-break-after: always !important;
        break-after: page !important;
        overflow: hidden !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }
      .page:last-of-type {
        page-break-after: avoid !important;
        break-after: avoid !important;
      }
    }
  </style>
</head>
<body>

  <div class="no-print">
    <h1>🎸 ARGuitar Practice Neck — 1:1 Scale Printable Template</h1>
    <p>This template lets anyone build their own physical AR Guitar practice neck using paper, card, or wood!</p>
    
    <div style="display:flex; gap:16px; align-items:center; margin: 18px 0;">
      <button class="print-btn" onclick="window.print()">🖨️ Print 1:1 Scale Template</button>
      <span style="color:#94a3b8; font-size:14px;">(⚠️ Remember: Set scale to <strong>100% / Actual Size</strong> in your print dialog)</span>
    </div>

    <div class="download-links">
      <a href="arguitar_neck_printable.pdf" target="_blank" download>📄 Download Complete PDF (Guide + 3 Sheets)</a>
      <a href="arguitar_neck_full_scale.svg" target="_blank" download>📐 Continuous Full Scale SVG (67cm)</a>
      <a href="arguitar_neck_guide.svg" target="_blank" download>Guide Sheet SVG</a>
      <a href="arguitar_neck_page1.svg" target="_blank" download>Sheet 1 SVG</a>
      <a href="arguitar_neck_page2.svg" target="_blank" download>Sheet 2 SVG</a>
      <a href="arguitar_neck_page3.svg" target="_blank" download>Sheet 3 SVG</a>
    </div>

    <div class="instructions">
      <strong>🛠️ Quick 3-Step Assembly Guide:</strong>
      <ol>
        <li><strong>Print at 100%:</strong> Ensure printer scale is set to <strong>100% (Actual Size)</strong>. Measure the 50mm blue scale check bar on each sheet with a ruler to verify accuracy.</li>
        <li><strong>Cut & Align Overlaps:</strong> Cut along the red dashed lines on Sheet 2 and Sheet 3. Place them over the shaded overlap tabs on Sheet 1 and Sheet 2, aligning the red crosshairs.</li>
        <li><strong>Mount on Card or Wood:</strong> Glue or tape the assembled 64cm strip onto a 45–46mm wide piece of wood moulding, heavy card, or a yardstick/ruler. Launch ARGuitar and play!</li>
      </ol>
    </div>
  </div>

  <!-- Page 0: Guide Sheet -->
  <div class="page">
    ${guideSvg}
  </div>

  <!-- Page 1: Sheet 1 -->
  <div class="page">
    ${page1Svg}
  </div>

  <!-- Page 2: Sheet 2 -->
  <div class="page">
    ${page2Svg}
  </div>

  <!-- Page 3: Sheet 3 -->
  <div class="page">
    ${page3Svg}
  </div>

</body>
</html>`;

fs.writeFileSync(path.join(publicNeckDir, 'index.html'), printableHtml, 'utf8');
console.log('Saved public/neck/index.html');

// Render PDF using headless Chrome
try {
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const htmlPath = path.resolve('public/neck/index.html');
  const pdfPath = path.resolve('public/neck/arguitar_neck_printable.pdf');

  console.log('Generating PDF with headless Chrome...');
  execSync(`"${chromePath}" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="${pdfPath}" file://${htmlPath}`, { stdio: 'pipe' });

  const pdfStats = fs.statSync(pdfPath);
  console.log(`PDF successfully generated: ${pdfPath} (${(pdfStats.size / 1024).toFixed(1)} KB)`);
} catch (e) {
  console.error('Error generating PDF:', e.message);
}
