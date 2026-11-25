import { playClick, playPiano, unlockAudio } from "./audio";
import { renderCount } from "../count/draw";
import { CARDS, missMessage, progressMessage, type CountCard } from "../count/ruler";

const CELL_MS = 460;

let cardIndex = 0;
let cursor = 0;
let miss: number[] = [];
let hearAt: number | null = null;
let hearToken = 0;
let hearTimers: number[] = [];
let mounted = false;

const $ = <T extends Element = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;

function card(): CountCard {
  return CARDS[cardIndex] ?? CARDS[0]!;
}

function stopHear(): void {
  hearToken++;
  hearTimers.forEach((timer) => window.clearTimeout(timer));
  hearTimers = [];
  hearAt = null;
  const hear = $("countHear");
  if (hear) hear.textContent = "Hear";
}

function paint(): void {
  const current = card();
  const done = cursor >= current.cells.length && miss.length === 0;
  $("countTitle").textContent = current.title;
  $("countMeta").textContent = `Bar ${cardIndex + 1} of ${CARDS.length} · eighth-note ruler`;
  $("countHint").textContent = current.hint;
  $("promptBadge").textContent = done ? "Bar complete" : "Say every syllable";
  const status = $("countStatus");
  status.textContent = miss.length ? missMessage(current, cursor) : progressMessage(current, cursor);
  status.className = `text-sm min-h-[2.5rem] flex-1 ${miss.length ? "text-rose-700" : done ? "text-emerald-700" : "text-slate-600"}`;
  $("countRetry").classList.toggle("hidden", cursor === 0 && miss.length === 0);
  const next = $("countNext");
  next.classList.toggle("hidden", !done);
  next.textContent = cardIndex === CARDS.length - 1 ? "From the top" : "Next bar";
  renderCount($<SVGSVGElement>("countSvg"), { card: current, cursor, miss, hearAt, done }, tap);
}

function restart(): void {
  stopHear();
  cursor = 0;
  miss = [];
  paint();
}

function nextCard(): void {
  cardIndex = (cardIndex + 1) % CARDS.length;
  restart();
}

function tap(index: number): void {
  unlockAudio();
  stopHear();
  const current = card();
  if (cursor >= current.cells.length) return;
  if (index < cursor) return;
  if (index > cursor) {
    miss = Array.from({ length: index - cursor }, (_, offset) => cursor + offset);
    paint();
    return;
  }
  miss = [];
  cursor += 1;
  playClick(current.cells[index] === "play");
  paint();
}

function sayNext(): void {
  const current = card();
  if (cursor >= current.cells.length && miss.length === 0) {
    nextCard();
    return;
  }
  tap(cursor);
}

function hear(): void {
  unlockAudio();
  if (hearAt !== null || hearTimers.length) {
    stopHear();
    paint();
    return;
  }
  const current = card();
  const token = ++hearToken;
  $("countHear").textContent = "Stop";
  for (const span of current.spans) {
    if (span.kind !== "note") continue;
    playPiano(span.midi, (span.length * CELL_MS) / 1000 * 0.92, 0.2, (span.start * CELL_MS) / 1000);
  }
  for (let i = 0; i < current.cells.length; i++) {
    playClick(i % 2 === 0, (i * CELL_MS) / 1000);
    hearTimers.push(window.setTimeout(() => {
      if (token !== hearToken) return;
      hearAt = i;
      paint();
    }, i * CELL_MS));
  }
  hearTimers.push(window.setTimeout(() => {
    if (token !== hearToken) return;
    stopHear();
    paint();
  }, current.cells.length * CELL_MS + 40));
}

export function mountCount(): void {
  if (mounted) return;
  mounted = true;
  $("countHear").addEventListener("click", hear);
  $("countRetry").addEventListener("click", restart);
  $("countNext").addEventListener("click", nextCard);
}

export function enterCount(): void {
  mountCount();
  paint();
}

export function leaveCount(): void {
  stopHear();
}

export function onCountKey(event: KeyboardEvent): void {
  if (event.key !== " " && event.key !== "Spacebar") return;
  event.preventDefault();
  sayNext();
}
