// One staff and one ruler, sharing the same columns. A notehead sits in its
// attack cell. The pale bar is the written length. The solid bar grows only
// as far as the syllables already said.

import { beamGroups, countedLength, EIGHTH_SYLLABLES, type CountCard, type CountSpan } from "./ruler";

const SVG_NS = "http://www.w3.org/2000/svg";
const LEFT = 118;
const RIGHT = 744;
const CELLS = 8;
const CELL_W = (RIGHT - LEFT) / CELLS;
const STAFF_TOP = 46;
const LINE_GAP = 13;
const E4_Y = STAFF_TOP + 4 * LINE_GAP;
const STEP = LINE_GAP / 2;
const STROKE_Y = 116;
const RULER_Y = 130;
const RULER_H = 70;

export interface CountView {
  card: CountCard;
  cursor: number;
  miss: readonly number[];
  hearAt: number | null;
  done: boolean;
}

function el(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function text(value: string, attrs: Record<string, string | number>): SVGElement {
  const node = el("text", attrs);
  node.textContent = value;
  return node;
}

function noteY(d: number): number {
  return E4_Y - (d - 30) * STEP;
}

function cellX(index: number): number {
  return LEFT + index * CELL_W;
}

function centerX(index: number): number {
  return cellX(index) + CELL_W / 2;
}

function rounded(x: number, y: number, w: number, h: number, r: number, left: boolean, right: boolean): string {
  const rl = left ? r : 0;
  const rr = right ? r : 0;
  return `M ${x + rl} ${y} H ${x + w - rr} Q ${x + w} ${y} ${x + w} ${y + rr} V ${y + h - rr} Q ${x + w} ${y + h} ${x + w - rr} ${y + h} H ${x + rl} Q ${x} ${y + h} ${x} ${y + h - rl} V ${y + rl} Q ${x} ${y} ${x + rl} ${y} Z`;
}

function bar(layer: SVGGElement, start: number, cells: number, y: number, h: number, fill: string, leftRound: boolean, rightRound: boolean, flushRight = false): void {
  if (cells <= 0) return;
  const x = cellX(start) + 4;
  const w = cells * CELL_W - 4 - (flushRight ? 0 : 4);
  layer.append(el("path", { d: rounded(x, y, w, h, 9, leftRound, rightRound), fill }));
}

function drawSpanBar(layer: SVGGElement, span: CountSpan, cursor: number, abandoned: boolean, done: boolean): void {
  const counted = countedLength(span.start, span.length, cursor);
  const short = abandoned && counted < span.length;
  const play = short ? "#be123c" : done ? "#047857" : "#4338ca";
  const hold = short ? "#fecdd3" : done ? "#a7f3d0" : "#c7d2fe";
  const stroke = short ? "#e11d48" : done ? "#059669" : "#4f46e5";
  bar(layer, span.start, span.length, RULER_Y + 4, RULER_H - 8, "#e0e7ff", true, true);
  bar(layer, span.start, span.length, STROKE_Y, 5, "#ddd6fe", true, true);
  if (counted <= 0) return;
  bar(layer, span.start, counted, RULER_Y + 4, RULER_H - 8, counted === 1 ? play : hold, true, true);
  if (counted > 1) bar(layer, span.start, 1, RULER_Y + 4, RULER_H - 8, play, true, false, true);
  bar(layer, span.start, counted, STROKE_Y, 5, stroke, true, counted === span.length);
}

function notehead(layer: SVGGElement, span: CountSpan): void {
  const x = centerX(span.start);
  const y = noteY(span.d);
  if ((span.d - 30) % 2 === 0 && (span.d < 30 || span.d > 38)) {
    layer.append(el("line", { x1: x - 12, y1: y, x2: x + 12, y2: y, stroke: "#1e293b", "stroke-width": 1.3 }));
  }
  layer.append(el("ellipse", {
    cx: x, cy: y, rx: 7.1, ry: 5.1, fill: "#0f172a", transform: `rotate(-18 ${x} ${y})`,
  }));
}

const STEM = 1.55;
const BEAM = 3.5;
const BEAM_GAP = 2.8;
const FLAG_STEP = 13;

function stemX(span: CountSpan, up: boolean): number {
  return centerX(span.start) + (up ? 6.5 : -6.5);
}

/** Eighth = one hook, sixteenth = two. The ruler's shortest note is an eighth. */
function hooksFor(span: CountSpan): number {
  return span.length === 1 ? 1 : 0;
}

/** One stroked hook. A sixteenth draws this twice, a staff-space apart, so the hooks never fuse. */
function flagCurve(sx: number, tip: number, up: boolean): string {
  const s = up ? 1 : -1;
  const at = (dx: number, dy: number) => `${(sx + dx).toFixed(1)} ${(tip + s * dy).toFixed(1)}`;
  return `M ${at(0, 0)} C ${at(8, 3)} ${at(16, 12)} ${at(9, 23)}`;
}

function drawFlags(layer: SVGGElement, sx: number, tip: number, up: boolean, hooks: number): void {
  for (let hook = 0; hook < hooks; hook++) {
    const at = up ? tip + hook * FLAG_STEP : tip - hook * FLAG_STEP;
    layer.append(el("path", {
      d: flagCurve(sx, at, up),
      fill: "none",
      stroke: "#0f172a",
      "stroke-width": 2.15,
      "stroke-linecap": "round",
    }));
  }
}

function drawSingle(layer: SVGGElement, span: CountSpan): void {
  const up = span.d < 34;
  const x = stemX(span, up);
  const y = noteY(span.d);
  const hooks = hooksFor(span);
  const reach = 36 + Math.max(0, hooks - 1) * FLAG_STEP;
  const tip = up ? y - reach : y + reach;
  notehead(layer, span);
  layer.append(el("line", { x1: x, y1: y, x2: x, y2: tip, stroke: "#0f172a", "stroke-width": STEM, "stroke-linecap": "butt" }));
  if (span.length >= 3 && span.length % 2 === 1) {
    const onLine = (span.d - 30) % 2 === 0;
    layer.append(el("circle", { cx: centerX(span.start) + 13, cy: onLine ? y - STEP : y, r: 2.05, fill: "#0f172a" }));
  }
  if (hooks > 0) drawFlags(layer, x, tip, up, hooks);
}

function beamEnds(ys: number[], up: boolean): { y1: number; y2: number } {
  const reach = 31;
  const raw1 = up ? ys[0]! - reach : ys[0]! + reach;
  const raw2 = up ? ys[ys.length - 1]! - reach : ys[ys.length - 1]! + reach;
  const mid = (raw1 + raw2) / 2;
  const slant = Math.max(-7, Math.min(7, (raw2 - raw1) * 0.45));
  let y1 = mid - slant / 2;
  let y2 = mid + slant / 2;
  if (!up) {
    const top = Math.min(y1, y2) - BEAM;
    const belowStaff = E4_Y + 5;
    if (top < belowStaff) {
      const shift = belowStaff - top;
      y1 += shift;
      y2 += shift;
    }
    const bottom = Math.max(y1, y2);
    const aboveRuler = STROKE_Y - 8;
    if (bottom > aboveRuler) {
      const shift = bottom - aboveRuler;
      y1 -= shift;
      y2 -= shift;
    }
  }
  return { y1, y2 };
}

function beamPath(x1: number, outer1: number, x2: number, outer2: number, up: boolean): string {
  const toward = up ? BEAM : -BEAM;
  return `M ${x1} ${outer1} L ${x2} ${outer2} L ${x2} ${outer2 + toward} L ${x1} ${outer1 + toward} Z`;
}

function drawBeamed(layer: SVGGElement, spans: CountSpan[]): void {
  const average = spans.reduce((sum, span) => sum + span.d, 0) / spans.length;
  const up = average < 34;
  const ys = spans.map((span) => noteY(span.d));
  const { y1, y2 } = beamEnds(ys, up);
  const levels = Math.max(...spans.map(hooksFor), 1);
  const outerAt = (index: number) => spans.length === 1 ? y1 : y1 + (y2 - y1) * (index / (spans.length - 1));
  spans.forEach((span) => notehead(layer, span));
  for (let level = 0; level < levels; level++) {
    const inset = level * (BEAM + BEAM_GAP);
    const shift = up ? inset : -inset;
    const x1 = stemX(spans[0]!, up);
    const x2 = stemX(spans[spans.length - 1]!, up);
    layer.append(el("path", {
      d: beamPath(x1, y1 + shift, x2, y2 + shift, up),
      fill: "#0f172a",
    }));
  }
  spans.forEach((span, index) => {
    const outer = outerAt(index);
    const into = up ? outer + BEAM + 0.4 : outer - BEAM - 0.4;
    const x = stemX(span, up);
    layer.append(el("line", {
      x1: x, y1: noteY(span.d), x2: x, y2: into,
      stroke: "#0f172a", "stroke-width": STEM, "stroke-linecap": "butt",
    }));
  });
}

function syllableInk(card: CountCard, index: number, cursor: number, miss: readonly number[]): string {
  const span = card.spans.find((item) => index >= item.start && index < item.start + item.length);
  if (span && index === span.start && index < cursor) return "#ffffff";
  if (miss.includes(index)) return "#9f1239";
  return "#1e293b";
}

export function renderCount(svg: SVGSVGElement, view: CountView, onCell: (index: number) => void): void {
  svg.setAttribute("viewBox", "0 0 760 210");
  svg.replaceChildren();
  const { card, cursor, miss, hearAt, done } = view;
  const open = card.spans.find((span) => cursor >= span.start && cursor < span.start + span.length);

  for (let i = 0; i < 5; i++) {
    const y = STAFF_TOP + i * LINE_GAP;
    svg.append(el("line", { x1: LEFT, y1: y, x2: RIGHT, y2: y, stroke: "#334155", "stroke-width": 1.25 }));
  }
  svg.append(el("line", { x1: LEFT, y1: STAFF_TOP, x2: LEFT, y2: E4_Y, stroke: "#1e293b", "stroke-width": 1.6 }));
  svg.append(el("line", { x1: RIGHT, y1: STAFF_TOP, x2: RIGHT, y2: E4_Y, stroke: "#1e293b", "stroke-width": 2.4 }));
  svg.append(text("𝄞", {
    x: 26, y: noteY(32) + 2, "font-size": 84, "font-family": "Georgia, 'Times New Roman', serif", fill: "#0f172a",
  }));
  svg.append(text("4", {
    x: 84, y: STAFF_TOP + LINE_GAP + 8, "text-anchor": "middle", "font-size": 20, "font-weight": 700,
    "font-family": "Georgia, 'Times New Roman', serif", fill: "#0f172a",
  }));
  svg.append(text("4", {
    x: 84, y: STAFF_TOP + 3 * LINE_GAP + 6, "text-anchor": "middle", "font-size": 20, "font-weight": 700,
    "font-family": "Georgia, 'Times New Roman', serif", fill: "#0f172a",
  }));

  for (let i = 0; i <= CELLS; i++) {
    const beat = i % 2 === 0;
    svg.append(el("line", {
      x1: cellX(i), y1: STAFF_TOP - 8, x2: cellX(i), y2: RULER_Y + RULER_H,
      stroke: beat ? "#cbd5e1" : "#e7e5e4", "stroke-width": beat ? 1.25 : 1,
    }));
  }

  for (const span of card.spans) drawSpanBar(svg, span, cursor, miss.length > 0 && span === open, done);

  if (hearAt !== null) {
    svg.append(el("rect", {
      x: cellX(hearAt), y: STAFF_TOP - 10, width: CELL_W, height: RULER_Y + RULER_H - (STAFF_TOP - 10),
      fill: "#4f46e5", opacity: 0.1, "pointer-events": "none",
    }));
  }

  const groups = beamGroups(card.spans);
  const grouped = new Set(groups.flat());
  for (const group of groups) drawBeamed(svg, group.map((index) => card.spans[index]!));
  card.spans.forEach((span, index) => {
    if (span.kind === "note" && !grouped.has(index)) drawSingle(svg, span);
  });

  for (const index of miss) {
    svg.append(el("rect", {
      x: cellX(index) + 6, y: RULER_Y + 6, width: CELL_W - 12, height: RULER_H - 12, rx: 8, class: "count-gap",
    }));
  }

  for (let i = 0; i < CELLS; i++) {
    const syllable = EIGHTH_SYLLABLES[i] ?? "";
    const ink = syllableInk(card, i, cursor, miss);
    const onPlay = ink === "#ffffff";
    svg.append(text(syllable, {
      x: centerX(i), y: RULER_Y + 32, "text-anchor": "middle",
      "font-size": hearAt === i ? 20 : 16, "font-weight": syllable === "&" ? 560 : 720,
      "font-family": "ui-monospace, monospace", fill: ink, "pointer-events": "none",
    }));
    const role = card.cells[i] === "play" ? "play" : card.cells[i] === "hold" ? "hold" : "rest";
    svg.append(text(role, {
      x: centerX(i), y: RULER_Y + 52, "text-anchor": "middle", "font-size": 10, "font-weight": 600,
      "font-family": "Inter, system-ui, sans-serif",
      fill: onPlay ? "rgba(255,255,255,0.84)" : miss.includes(i) ? "#9f1239" : "#64748b",
      "pointer-events": "none",
    }));
    const hit = el("rect", {
      x: cellX(i), y: 16, width: CELL_W, height: RULER_Y + RULER_H - 12, fill: "transparent", role: "button",
    });
    hit.setAttribute("data-cell", String(i));
    hit.setAttribute("aria-label", `${syllable}, ${role}`);
    hit.style.cursor = "pointer";
    hit.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      onCell(i);
    });
    svg.append(hit);
  }
}
