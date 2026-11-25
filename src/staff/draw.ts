import type { StaffPrompt } from "./prompt";

const SVG_NS = "http://www.w3.org/2000/svg";
const STEP_Y = 7;
const TREBLE_E4_Y = 136;
const BASS_G2_Y = 264;
const STAFF_LEFT = 62;
const STAFF_RIGHT = 636;

function svgEl(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

function noteY(d: number, clef: "treble" | "bass"): number {
  return clef === "treble" ? TREBLE_E4_Y - (d - 30) * STEP_Y : BASS_G2_Y - (d - 18) * STEP_Y;
}

export function drawStaticStaff(layer: SVGGElement): void {
  layer.replaceChildren();
  for (let i = 0; i < 5; i++) {
    const y = TREBLE_E4_Y - i * (STEP_Y * 2);
    layer.append(svgEl("line", { x1: STAFF_LEFT, y1: y, x2: STAFF_RIGHT, y2: y, stroke: "#334155", "stroke-width": 1.35 }));
  }
  for (let i = 0; i < 5; i++) {
    const y = BASS_G2_Y - i * (STEP_Y * 2);
    layer.append(svgEl("line", { x1: STAFF_LEFT, y1: y, x2: STAFF_RIGHT, y2: y, stroke: "#334155", "stroke-width": 1.35 }));
  }
  const topY = TREBLE_E4_Y - 8 * STEP_Y;
  const botY = BASS_G2_Y;
  layer.append(svgEl("line", { x1: STAFF_LEFT, y1: topY, x2: STAFF_LEFT, y2: botY, stroke: "#1e293b", "stroke-width": 2 }));
  layer.append(svgEl("line", { x1: STAFF_RIGHT - 6, y1: topY, x2: STAFF_RIGHT - 6, y2: botY, stroke: "#334155", "stroke-width": 1.4 }));
  layer.append(svgEl("line", { x1: STAFF_RIGHT, y1: topY, x2: STAFF_RIGHT, y2: botY, stroke: "#1e293b", "stroke-width": 3.5 }));
  const midY = (topY + botY) / 2;
  layer.append(svgEl("path", {
    d: `M ${STAFF_LEFT - 6} ${topY} C ${STAFF_LEFT - 26} ${topY + 18}, ${STAFF_LEFT - 8} ${midY - 24}, ${STAFF_LEFT - 24} ${midY} C ${STAFF_LEFT - 8} ${midY + 24}, ${STAFF_LEFT - 26} ${botY - 18}, ${STAFF_LEFT - 6} ${botY}`,
    fill: "none", stroke: "#1e293b", "stroke-width": 3.2, "stroke-linecap": "round",
  }));
  // Glyph anchors measured from the system music font so the treble spiral
  // sits on G4 and the bass dots straddle F3, with each clef covering its staff.
  const treble = svgEl("text", {
    x: STAFF_LEFT + 11, y: noteY(32, "treble") + 25, "font-size": 132,
    "font-family": "Georgia, 'Times New Roman', 'Apple Symbols', serif", fill: "#0f172a",
  });
  treble.textContent = "𝄞";
  layer.append(treble);
  const bass = svgEl("text", {
    x: STAFF_LEFT + 12, y: noteY(24, "bass") + 34, "font-size": 74,
    "font-family": "Georgia, 'Times New Roman', 'Apple Symbols', serif", fill: "#0f172a",
  });
  bass.textContent = "𝄢";
  layer.append(bass);
}

export function drawLandmarks(layer: SVGGElement, show: boolean): void {
  layer.replaceChildren();
  if (!show) return;
  const landmarks = [
    { d: 35, clef: "treble" as const, label: "C5", color: "#6366f1" },
    { d: 32, clef: "treble" as const, label: "G4", color: "#0ea5e9" },
    { d: 28, clef: "treble" as const, label: "C4", color: "#8b5cf6" },
    { d: 24, clef: "bass" as const, label: "F3", color: "#0ea5e9" },
    { d: 21, clef: "bass" as const, label: "C3", color: "#6366f1" },
  ];
  for (const mark of landmarks) {
    const y = noteY(mark.d, mark.clef);
    layer.append(svgEl("line", {
      x1: STAFF_LEFT + 68, y1: y, x2: STAFF_RIGHT - 14, y2: y, stroke: mark.color,
      "stroke-width": mark.label === "C4" ? 1.2 : 3.5,
      "stroke-dasharray": mark.label === "C4" ? "4 5" : "none",
      opacity: mark.label === "C4" ? 0.22 : 0.08,
    }));
    const badge = svgEl("text", {
      x: STAFF_RIGHT + 10, y: y + 3.5, "font-size": 10, "font-weight": 600,
      "font-family": "ui-monospace, monospace", fill: mark.color, opacity: 0.72,
    });
    badge.textContent = mark.label;
    layer.append(badge);
  }
}

function ledgerLines(container: SVGGElement, x: number, d: number, clef: "treble" | "bass"): void {
  const halfW = 16;
  const lines: number[] = [];
  if (clef === "treble") {
    if (d <= 28) for (let ld = 28; ld >= d; ld -= 2) lines.push(ld);
    if (d >= 40) for (let ld = 40; ld <= d; ld += 2) lines.push(ld);
  } else {
    if (d >= 28) for (let ld = 28; ld <= d; ld += 2) lines.push(ld);
    if (d <= 16) for (let ld = 16; ld >= d; ld -= 2) lines.push(ld);
  }
  for (const ld of lines) {
    const y = noteY(ld, clef);
    container.append(svgEl("line", { x1: x - halfW, y1: y, x2: x + halfW, y2: y, stroke: "#1e293b", "stroke-width": 1.5 }));
  }
}

function notehead(container: SVGGElement, x: number, d: number, clef: "treble" | "bass", color: string, withStem: boolean, stemDir: "up" | "down" | null = null): void {
  const y = noteY(d, clef);
  ledgerLines(container, x, d, clef);
  container.append(svgEl("ellipse", { cx: x, cy: y, rx: 9.2, ry: 6.7, fill: color, transform: `rotate(-18 ${x} ${y})` }));
  if (!withStem) return;
  const midD = clef === "treble" ? 34 : 22;
  const stemUp = stemDir ? stemDir === "up" : d < midD;
  const stemX = stemUp ? x + 8.3 : x - 8.3;
  container.append(svgEl("line", { x1: stemX, y1: y, x2: stemX, y2: stemUp ? y - 44 : y + 44, stroke: color, "stroke-width": 2 }));
}

export function drawPrompt(layer: SVGGElement, prompt: StaffPrompt | null, opts: { chunkIndex: number; chunkVisible: boolean; color: string | null }): void {
  layer.replaceChildren();
  if (!prompt) return;
  const color = opts.color ?? "#0f172a";
  if (prompt.kind === "notes") {
    notehead(layer, 355, prompt.note.d, prompt.note.clef, color, true);
    return;
  }
  if (prompt.kind === "intervals") {
    const { n1, n2, presentation } = prompt;
    if (presentation === "harmonic") {
      const low = n1.d <= n2.d ? n1 : n2;
      const high = n1.d <= n2.d ? n2 : n1;
      const isSecond = Math.abs(high.d - low.d) === 1;
      const midD = low.clef === "treble" ? 34 : 22;
      const stemUp = (low.d + high.d) / 2 < midD;
      const xLow = 355;
      const xHigh = isSecond ? (stemUp ? 355 + 16.5 : 355 - 16.5) : 355;
      notehead(layer, xLow, low.d, low.clef, color, false);
      notehead(layer, xHigh, high.d, high.clef, color, false);
      const yLow = noteY(low.d, low.clef);
      const yHigh = noteY(high.d, high.clef);
      const stemX = stemUp ? xLow + 8.3 : xLow - 8.3;
      layer.append(svgEl("line", {
        x1: stemX, y1: stemUp ? yLow : yHigh, x2: stemX, y2: stemUp ? yHigh - 42 : yLow + 42, stroke: color, "stroke-width": 2,
      }));
    } else {
      notehead(layer, 305, n1.d, n1.clef, color, true);
      notehead(layer, 405, n2.d, n2.clef, color, true);
    }
    return;
  }
  const spacing = prompt.notes.length === 4 ? 95 : 118;
  const startX = 355 - ((prompt.notes.length - 1) * spacing) / 2;
  prompt.notes.forEach((note, index) => {
    const x = startX + index * spacing;
    const solved = index < opts.chunkIndex;
    const active = index === opts.chunkIndex;
    if (opts.chunkVisible || solved) {
      notehead(layer, x, note.d, note.clef, solved ? "#059669" : color, true);
      return;
    }
    const slotY = note.clef === "treble" ? 108 : 236;
    layer.append(svgEl("circle", {
      cx: x, cy: slotY, r: 13, fill: active ? "#eef2ff" : "#f1f5f9",
      stroke: active ? "#6366f1" : "#94a3b8", "stroke-width": active ? 2.2 : 1.4,
      "stroke-dasharray": active ? "none" : "3 3",
    }));
    const mark = svgEl("text", {
      x, y: slotY + 4.5, "text-anchor": "middle", "font-size": 13, "font-weight": 700, fill: active ? "#4f46e5" : "#64748b",
    });
    mark.textContent = String(index + 1);
    layer.append(mark);
  });
}
