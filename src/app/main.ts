import { bindMute, playPiano, playWrong, unlockAudio } from "./audio";
import { flashKey, isSharpPitch, markTargets, pitchName, renderPiano, setKeyDown, STAFF_HI, STAFF_LO, staffHints } from "./piano";
import { rangeFor } from "./keyboard";
import {
  averageMs, emptySave, heatBand, introCount, exposureCount, progressState, recentAccuracy, loadSave, noteIntroduction, overlapMs, parseSave, pickWeighted,
  practiceMs, remember, recordOutcome, touchIntro, writeSave, type HeatBand, type Kind, type Save, type Skill,
} from "../adapt/memory";
import { octaveDirection } from "../chords/grip";
import { ChordInput } from "../chords/input";
import { Attempt } from "../adapt/attempt";
import { chordPool, stageCounts } from "../chords/pool";
import { STAGES } from "../deck/stages";
import { CATALOG, isClefFlip, LETTERS, notesForTier } from "../staff/catalog";
import { drawLandmarks, drawPrompt, drawStaticStaff } from "../staff/draw";
import { chunkPrompt, intervalPrompt, notePrompt, type StaffPrompt } from "../staff/prompt";
import { inversionLabel, type Card, type Deck } from "../types";
import { enterCount, leaveCount, onCountKey } from "./count";
import { SCALE_STAGE_COUNT, SCALE_STAGES, SCALES, type ScaleItem } from "../scales/catalog";
import { ScaleInput } from "../scales/input";

/** New scales per sitting. Fewer than chords: each one is fifteen notes to hold in memory. */
const SCALE_INTRO_CAP = 4;

const MOUSE_OFFSET_MS = 250;
const HOME_ROW: Record<string, { letter: string; sharp: boolean; midi: number }> = {
  a: { letter: "C", sharp: false, midi: 60 }, w: { letter: "C#", sharp: true, midi: 61 },
  s: { letter: "D", sharp: false, midi: 62 }, e: { letter: "D#", sharp: true, midi: 63 },
  d: { letter: "E", sharp: false, midi: 64 }, f: { letter: "F", sharp: false, midi: 65 },
  t: { letter: "F#", sharp: true, midi: 66 }, g: { letter: "G", sharp: false, midi: 67 },
  y: { letter: "G#", sharp: true, midi: 68 }, h: { letter: "A", sharp: false, midi: 69 },
  u: { letter: "A#", sharp: true, midi: 70 }, j: { letter: "B", sharp: false, midi: 71 },
  k: { letter: "C", sharp: false, midi: 72 },
};

let save: Save = emptySave();
let deck: Card[] = [];
let pianoSig = "";
const chordInput = new ChordInput();
const scaleInput = new ScaleInput();
const held = chordInput.held;
const pointerHeld = new Set<number>();
const touchKeys = new Map<number, number>();
let advanceTimer = 0;

const session = {
  prompt: null as StaffPrompt | null,
  chunkIndex: 0,
  chunkVisible: true,
  chunkTimer: 0,
  chunkFrame: 0,
  advancing: false,
  attempt: new Attempt(),
  chunkAssisted: false,
  promptStart: 0,
  lastNoteId: null as string | null,
  card: null as Card | null,
  step: 0,
  stepTimes: [] as number[],
  phase: "learn" as "learn" | "recall",
  showShape: false,
  guidedComplete: false,
  chordAttempt: new Attempt(),
  stepStart: 0,
  lastCardId: null as string | null,
  scale: null as ScaleItem | null,
  scalePhase: "learn" as "learn" | "recall",
  showScale: false,
  scaleComplete: false,
  scaleAttempt: new Attempt(),
  scaleStart: 0,
  lastScaleId: null as string | null,
};

const $ = <T extends Element = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;

function persist(): void {
  writeSave(save);
}

function adjustLatency(raw: number, pointer: boolean): number {
  if (!pointer || !save.settings.mouseCompensation) return raw;
  return Math.max(150, raw - MOUSE_OFFSET_MS);
}

const hiddenSpans: { start: number; end: number }[] = [];
let hiddenAt: number | null = null;
let overlayAt: number | null = null;
let resumeFlash = false;

function awaySince(since: number, until = performance.now()): number {
  const spans = hiddenAt === null ? [...hiddenSpans] : [...hiddenSpans, { start: hiddenAt, end: until }];
  if (overlayAt !== null) spans.push({ start: overlayAt, end: until });
  return overlapMs(since, until, spans);
}

function activeMs(since: number, until = performance.now()): number {
  return Math.max(0, until - since - awaySince(since, until));
}

function scoredMs(since: number, kind: Kind, pointer: boolean): number {
  return practiceMs(adjustLatency(activeMs(since), pointer), kind);
}

function watchVisibility(): void {
  hiddenAt = document.hidden ? performance.now() : null;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (hiddenAt === null) hiddenAt = performance.now();
      pauseFlash();
      return;
    }
    if (hiddenAt === null) return;
    hiddenSpans.push({ start: hiddenAt, end: performance.now() });
    hiddenAt = null;
    resumePreview();
    const keepAfter = performance.now() - 60 * 60 * 1000;
    while (hiddenSpans.length > 0 && hiddenSpans[0]!.end < keepAfter) hiddenSpans.shift();
  });
}

function hideFeedback(): void {
  $("latencyBadge").classList.add("hidden");
  $("hintBadge").classList.add("hidden");
}

function showFeedback(latencyMs: number | null, hint: string | null, tone: "emerald" | "amber" | "rose", kind: Kind, compensated = false): void {
  const latency = $("latencyBadge");
  const hintEl = $("hintBadge");
  if (latencyMs !== null) {
    const rounded = Math.round(latencyMs);
    latency.className = "animate-pop px-2.5 py-0.5 rounded-full font-mono text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-300";
    latency.textContent = `${rounded} ms`;
    latency.classList.remove("hidden");
  } else latency.classList.add("hidden");
  if (hint) {
    const colors = {
      emerald: "bg-emerald-100 text-emerald-800 border border-emerald-300",
      amber: "bg-amber-100 text-amber-900 border border-amber-300",
      rose: "bg-rose-100 text-rose-800 border border-rose-300",
    };
    hintEl.className = `animate-pop px-2.5 py-0.5 rounded-full text-xs font-semibold ${colors[tone]}`;
    hintEl.textContent = hint;
    hintEl.classList.remove("hidden");
  } else hintEl.classList.add("hidden");
}

function shake(): void {
  const el = $("staffContainer");
  el.classList.remove("animate-shake");
  void el.offsetWidth;
  el.classList.add("animate-shake");
}

function headerStats(): void {
  const skill = activeSkill();
  const rows = save.recent.filter((row) => row.skill === skill && (!row.assisted || row.unaidedError)).slice(-30);
  const good = rows.filter((row) => row.correct);
  const avg = good.length ? Math.round(good.reduce((sum, row) => sum + row.ms, 0) / good.length) : null;
  const acc = rows.length ? Math.round((good.length / rows.length) * 100) : null;
  const avgText = avg === null ? "-- ms" : `${avg} ms`;
  const accText = acc === null ? "--%" : `${acc}%`;
  const flips = String(save.clefFlips);
  $("hdrAvgMs").textContent = avgText;
  $("mobAvgMs").textContent = avgText;
  $("hdrAcc").textContent = accText;
  $("mobAcc").textContent = accText;
  $("hdrFlips").textContent = flips;
  $("mobFlips").textContent = flips;
}

function paintActive(selector: string, attr: string, value: string, on: string, off: string): void {
  document.querySelectorAll<HTMLElement>(selector).forEach((button) => {
    button.className = `${button.className.split(" ").filter((token) => !token.startsWith("bg-") && token !== "text-white" && token !== "text-slate-400" && token !== "shadow-sm").join(" ")} ${button.dataset[attr] === value ? on : off}`.replace(/\s+/g, " ").trim();
  });
}

function syncChrome(): void {
  const { settings } = save;
  const on = "bg-indigo-600 text-white shadow-sm";
  const off = "text-slate-400";
  paintActive(".app-btn", "app", settings.app, on, off);
  paintActive(".drill-btn", "drill", settings.drill, on, off);
  paintActive(".tier-btn", "tier", String(settings.tier), "bg-studio-700 text-white", off);
  paintActive(".input-mode-btn", "input", settings.inputMode, on, off);
  paintActive(".int-type-btn", "intType", settings.intervalType, on, off);
  paintActive(".chunk-len-btn", "chunkLen", String(settings.chunkLength), on, off);

  const staff = settings.app === "staff";
  const chords = settings.app === "chords";
  const scales = settings.app === "scales";
  $("scaleBar").classList.toggle("hidden", !scales);
  $("scaleFace").classList.toggle("hidden", !scales);
  $("staffBar").classList.toggle("hidden", !staff);
  $("chordBar").classList.toggle("hidden", !chords);
  $("staffFace").classList.toggle("hidden", !staff);
  $("chordFace").classList.toggle("hidden", !chords);
  $("countFace").classList.toggle("hidden", settings.app !== "count");
  $("countBar").classList.toggle("hidden", settings.app !== "count");
  $("subBarIntervals").classList.toggle("hidden", !(staff && settings.drill === "intervals"));
  $("subBarChunks").classList.toggle("hidden", !(staff && settings.drill === "chunks"));
  $("inputSection").classList.toggle("hidden", settings.app === "count");

  const intervals = staff && settings.drill === "intervals";
  const showPiano = !intervals && (chords || scales || settings.inputMode === "linear");
  const showLetters = staff && !intervals && settings.inputMode === "letters";
  $("inputSelectorBar").classList.toggle("hidden", chords || scales || intervals);
  $("intervalDeck").classList.toggle("hidden", !intervals);
  $("intervalDeck").classList.toggle("flex", intervals);
  $("pianoDeck").classList.toggle("hidden", !showPiano);
  $("pianoDeck").classList.toggle("flex", showPiano);
  $("letterDeck").classList.toggle("hidden", !showLetters);
  $("letterDeck").classList.toggle("flex", showLetters);
  $("iconSoundOn").classList.toggle("hidden", settings.muted);
  $("iconSoundOff").classList.toggle("hidden", !settings.muted);
  ($("toggleLandmarks") as HTMLInputElement).checked = settings.landmarks;
  ($("toggleAdaptive") as HTMLInputElement).checked = settings.adaptive;
  ($("toggleExactOctave") as HTMLInputElement).checked = settings.exactOctave;
  ($("toggleMouseComp") as HTMLInputElement).checked = settings.mouseCompensation;
  ($("toggleKeyHints") as HTMLInputElement).checked = settings.showKeyHints;
  ($("pianoLabelMode") as HTMLSelectElement).value = settings.pianoLabelMode;
  ($("flashSlider") as HTMLInputElement).value = String(settings.flashSec);
  $("flashVal").textContent = `${settings.flashSec.toFixed(1)}s`;
  $("inputHelperText").textContent = chords
    ? "MIDI: hold common notes between changes. Optional bass is accepted, not scored. Mouse: click keys to toggle."
    : scales
      ? "Play one octave up and back. Hands together: both notes of each step, in either order."
      : "Play the note on your MIDI keyboard, tap a key, or use the home row.";
  updatePiano();
  headerStats();
  if (chords) paintStage();
  if (scales) paintScaleStage();
}

function updatePiano(): void {
  const { settings } = save;
  const chordRange = settings.app === "chords" && session.card ? rangeFor(gripMidis(session.card))
    : settings.app === "scales" && session.scale ? rangeFor(session.scale.steps.flat()) : null;
  const lo = chordRange?.lo ?? STAFF_LO;
  const hi = chordRange?.hi ?? STAFF_HI;
  const sig = `${settings.app}|${lo}|${hi}|${settings.showKeyHints}|${settings.pianoLabelMode}|${settings.inputMode}|${settings.drill}`;
  if (sig === pianoSig) return;
  pianoSig = sig;
  const keyboard = $("pianoKeyboard");
  renderPiano(keyboard, lo, hi, {
    hints: settings.app === "staff" ? staffHints() : new Map(),
    showHints: settings.app === "staff" && settings.showKeyHints,
    labels: settings.pianoLabelMode,
  });
  if (save.settings.app === "chords") markTargets(session.showShape ? currentGrip()?.midi ?? [] : []);
  if (save.settings.app === "scales") markTargets(session.showScale ? scaleInput.current : []);
  for (const midi of held) setKeyDown(midi, true);
}

function paintStage(): void {
  const stage = save.settings.chordStage;
  $("stageLabel").textContent = `Stage ${stage} · ${STAGES[stage] ?? "Practice"}`;
  const counts = stageCounts(deck, stage, save.chords);
  const introduced = introCount(save.intro, Date.now());
  $("stageMeta").textContent = `${counts.seen} of ${counts.open} met · ${introduced} new this sitting`;
  ($("stageDown") as HTMLButtonElement).disabled = stage <= 1;
  ($("stageUp") as HTMLButtonElement).disabled = stage >= 21;
}

function renderStaff(): void {
  drawPrompt($<SVGGElement>("staffNotesLayer"), session.prompt, {
    chunkIndex: session.chunkIndex,
    chunkVisible: session.chunkVisible,
    color: null,
  });
}

function clearChunkTimers(): void {
  if (session.chunkTimer) window.clearTimeout(session.chunkTimer);
  if (session.chunkFrame) window.cancelAnimationFrame(session.chunkFrame);
  session.chunkTimer = 0;
  session.chunkFrame = 0;
  $("flashProgressWrap").classList.add("hidden");
}

function pauseFlash(): void {
  if (save.settings.app === "staff" && session.prompt?.kind === "chunks" && session.chunkVisible && !session.advancing) {
    resumeFlash = true;
    clearChunkTimers();
  }
}

function resumePreview(): void {
  if (resumeFlash && !document.hidden && overlayAt === null) {
    resumeFlash = false;
    startChunkFlash();
  }
}

function startChunkFlash(assisted = false): void {
  if (assisted) { session.chunkAssisted = true; session.attempt.help(); }
  clearChunkTimers();
  session.chunkVisible = true;
  renderStaff();
  if (document.hidden || overlayAt !== null) { resumeFlash = true; return; }
  const duration = save.settings.flashSec * 1000;
  const wrap = $("flashProgressWrap");
  const bar = $("flashProgressBar");
  wrap.classList.remove("hidden");
  bar.style.width = "100%";
  const t0 = performance.now();
  const tick = (now: number) => {
    const pct = Math.max(0, 100 - ((now - t0) / duration) * 100);
    bar.style.width = `${pct}%`;
    if (pct > 0 && session.chunkVisible) session.chunkFrame = requestAnimationFrame(tick);
  };
  session.chunkFrame = requestAnimationFrame(tick);
  session.chunkTimer = window.setTimeout(() => {
    session.chunkVisible = false;
    session.promptStart = performance.now();
    wrap.classList.add("hidden");
    const count = session.prompt?.kind === "chunks" ? session.prompt.notes.length : 0;
    $("promptBadge").textContent = `Play back note ${session.chunkIndex + 1} of ${count}`;
    renderStaff();
  }, duration);
}

function nextStaff(): void {
  flushStaff();
  cancelAdvance();
  clearChunkTimers();
  session.advancing = false;
  session.attempt = new Attempt();
  session.chunkAssisted = false;
  hideFeedback();
  const pool = notesForTier(save.settings.tier);
  const badge = $("promptBadge");
  const dir = $("directionBadge");
  dir.classList.add("hidden");
  const now = Date.now();
  if (save.settings.drill === "notes") {
    const prompt = notePrompt(pool, save.notes, save.settings.adaptive, session.lastNoteId, now);
    session.prompt = prompt;
    session.lastNoteId = prompt.note.id;
    badge.textContent = prompt.note.clef === "treble" ? "Treble · play this note" : "Bass · play this note";
  } else if (save.settings.drill === "intervals") {
    const prompt = intervalPrompt(pool, save.settings.intervalType, save.intervals, save.settings.adaptive, now);
    session.prompt = prompt;
    badge.textContent = prompt.presentation === "harmonic" ? "Name the stacked interval" : "Name the melodic interval";
    if (prompt.presentation === "melodic") {
      dir.textContent = prompt.n2.d > prompt.n1.d ? "Ascending" : "Descending";
      dir.classList.remove("hidden");
    }
  } else {
    const prompt = chunkPrompt(pool, save.settings.chunkLength);
    session.prompt = prompt;
    session.chunkIndex = 0;
    badge.textContent = `Memorize this ${prompt.notes.length}-note pattern`;
    session.promptStart = performance.now();
    startChunkFlash();
    return;
  }
  session.promptStart = performance.now();
  renderStaff();
}

function activeSkill(): Skill {
  if (save.settings.app === "count") return "rhythm";
  if (save.settings.app === "chords") return "chords";
  if (save.settings.app === "scales") return "scales";
  return save.settings.drill;
}

function cancelAdvance(): void {
  window.clearTimeout(advanceTimer);
  advanceTimer = 0;
}

function advanceAfter(callback: () => void, delay: number): void {
  cancelAdvance();
  advanceTimer = window.setTimeout(callback, delay);
}

function saveAttempt(skill: Skill, id: string, kind: Kind, attempt: Attempt, ms: number): void {
  if (attempt.recorded) return;
  const scored = practiceMs(ms, kind);
  save[skill][id] = recordOutcome(save[skill][id], attempt.outcome, scored, Date.now(), attempt);
  remember(save, skill, attempt.outcome, scored, attempt.assisted, attempt.unaidedError);
  attempt.recorded = true;
  persist();
  headerStats();
}

function staffRecord(): { skill: Skill; id: string; kind: Kind } | null {
  const prompt = session.prompt;
  if (!prompt) return null;
  if (prompt.kind === "notes") return { skill: "notes", id: prompt.note.id, kind: "note" };
  if (prompt.kind === "intervals") return { skill: "intervals", id: String(prompt.size), kind: "interval" };
  return { skill: "chunks", id: `${prompt.clef}:${prompt.notes.length}`, kind: "chunk" };
}

function flushStaff(completed = false, pointer = false): void {
  const row = staffRecord();
  if (!row || (!completed && !session.attempt.touched)) return;
  saveAttempt(row.skill, row.id, row.kind, session.attempt, scoredMs(session.promptStart, row.kind, pointer));
}

function answerFeedback(attempt: Attempt): string {
  if (attempt.outcome === "incorrect") return attempt.assisted ? "Assisted · corrected" : "Corrected · try again later";
  return attempt.assisted ? "Assisted practice" : "Correct";
}

function handleNote(input: { letter: string; sharp: boolean; midi: number | null; pointer: boolean }): void {
  if (save.settings.app !== "staff" || session.advancing || !session.prompt || session.prompt.kind === "intervals") return;
  const prompt = session.prompt;
  if (prompt.kind === "chunks" && session.chunkVisible) return;
  const target = prompt.kind === "notes" ? prompt.note : prompt.notes[session.chunkIndex];
  if (!target) return;
  const letterOk = !input.sharp && input.letter === target.letter;
  const exact = input.midi !== null && save.settings.exactOctave;
  const match = exact ? input.midi === target.midi : letterOk;
  const kind = prompt.kind === "chunks" ? "chunk" : "note";
  if (!match) {
    const octave = exact && letterOk;
    session.attempt.miss(octave ? "octave" : "pitch");
    playWrong();
    shake();
    let hint = input.sharp ? "Natural note — try again" : `Try again (${input.letter})`;
    if (octave) hint = input.midi! < target.midi ? "Right letter, higher octave" : "Right letter, lower octave";
    else if (!input.sharp && isClefFlip(target, input.letter)) {
      save.clefFlips++;
      persist();
      headerStats();
      hint = target.clef === "bass" ? "Clef flip — bass" : "Clef flip — treble";
    }
    showFeedback(null, hint, "amber", kind);
    return;
  }
  const elapsed = scoredMs(session.promptStart, kind, input.pointer);
  flushStaff(true, input.pointer);
  playPiano(target.midi, 0.85, 0.28);
  const feedback = answerFeedback(session.attempt);
  showFeedback(session.attempt.outcome === "correct" ? elapsed : null, feedback, "emerald", kind);
  if (prompt.kind === "notes") {
    session.advancing = true;
    drawPrompt($<SVGGElement>("staffNotesLayer"), prompt, { chunkIndex: 0, chunkVisible: true, color: "#059669" });
    advanceAfter(nextStaff, 500);
  } else {
    session.chunkIndex++;
    renderStaff();
    if (session.chunkIndex >= prompt.notes.length) {
      session.advancing = true;
      advanceAfter(nextStaff, 700);
    } else {
      session.attempt = new Attempt(session.chunkAssisted);
      session.promptStart = performance.now();
      $("promptBadge").textContent = `Play back note ${session.chunkIndex + 1} of ${prompt.notes.length}`;
    }
  }
}

function handleInterval(size: number, pointer: boolean): void {
  if (save.settings.app !== "staff" || save.settings.drill !== "intervals" || session.advancing || session.prompt?.kind !== "intervals") return;
  const prompt = session.prompt;
  const elapsed = scoredMs(session.promptStart, "interval", pointer);
  if (size !== prompt.size) {
    session.attempt.miss();
    playWrong();
    shake();
    showFeedback(null, `Not a ${intervalName(size)}`, "rose", "interval");
    return;
  }
  session.advancing = true;
  flushStaff(true, pointer);
  const gap = prompt.presentation === "harmonic" ? 0 : 0.24;
  playPiano(prompt.n1.midi, 0.8, 0.22, 0);
  playPiano(prompt.n2.midi, 0.8, 0.22, gap);
  showFeedback(session.attempt.outcome === "correct" ? elapsed : null, answerFeedback(session.attempt), "emerald", "interval");
  drawPrompt($<SVGGElement>("staffNotesLayer"), prompt, { chunkIndex: 0, chunkVisible: true, color: "#059669" });
  advanceAfter(nextStaff, 600);
}

function intervalName(size: number): string {
  if (size === 8) return "octave";
  const suffix = size === 2 ? "nd" : size === 3 ? "rd" : "th";
  return `${size}${suffix}`;
}

function gripMidis(card: Card): number[] {
  if (card.kind === "chord") return card.inversions[card.targetInversion]!.midi;
  return card.steps.flatMap((step) => step.midi);
}

function currentGrip(): { midi: number[]; names: string[]; symbol: string } | null {
  const card = session.card;
  if (!card) return null;
  if (card.kind === "chord") {
    const voicing = card.inversions[card.targetInversion]!;
    return { midi: voicing.midi, names: voicing.names, symbol: voicing.symbol };
  }
  const voicing = card.steps[session.step];
  if (!voicing) return null;
  return { midi: voicing.midi, names: voicing.names, symbol: voicing.symbol };
}

function paintChord(): void {
  const card = session.card;
  const face = $("chordSymbol");
  if (!card) {
    face.textContent = "Nothing in this stage";
    $("chordDetail").textContent = "";
    $("chordSteps").replaceChildren();
    return;
  }
  const grip = currentGrip();
  $("directionBadge").classList.add("hidden");
  if (card.kind === "chord") {
    $("promptBadge").textContent = "Play this shape";
    $("chordEyebrow").textContent = card.quality;
    face.textContent = card.symbol;
    $("chordDetail").textContent = inversionLabel(card.targetInversion);
    $("chordSteps").replaceChildren();
    $("chordGroove").textContent = "";
  } else {
    $("promptBadge").textContent = "Play this change";
    $("chordEyebrow").textContent = `${card.name} · ${card.key}`;
    face.textContent = grip?.symbol ?? "";
    $("chordDetail").textContent = `Change ${session.step + 1} of ${card.steps.length} · ${inversionLabel(card.startInversion)}`;
    $("chordGroove").textContent = card.styles[0] ? `Groove, later: ${card.styles[0]}` : "";
    const row = $("chordSteps");
    row.replaceChildren();
    card.steps.forEach((step, index) => {
      const pill = document.createElement("span");
      pill.className = `step-pill px-2 py-1 rounded-lg border text-sm font-semibold ${index === session.step ? "current" : "border-slate-300 text-slate-600"}`;
      pill.textContent = step.symbol;
      row.append(pill);
    });
  }
  $("promptBadge").textContent = session.guidedComplete ? "Guided run complete" : session.phase === "learn" ? "Learn this shape" : "Recall from memory";
  markTargets(session.showShape && grip ? grip.midi : []);
  $("chordExplanation").textContent = session.showShape ? card.hint : "";
  $("chordNotes").textContent = session.showShape && grip ? `Right hand: ${grip.names.join(" · ")}. Optional bass: ${grip.symbol.includes("/") ? grip.symbol.split("/").at(-1) : /^([A-G][#b]*)/.exec(grip.symbol)?.[1]}.` : "";
  $("peekChordBtn").textContent = session.showShape ? "Shape shown · assisted" : "Show shape";
  ($("peekChordBtn") as HTMLButtonElement).disabled = session.showShape;
  $("recallChordBtn").classList.toggle("hidden", !session.showShape && !session.guidedComplete);
  $("nextChordBtn").classList.toggle("hidden", !session.guidedComplete);
}

function startChord(phase: "learn" | "recall"): void {
  cancelAdvance();
  session.advancing = false;
  session.phase = phase;
  session.showShape = phase === "learn";
  session.guidedComplete = false;
  session.chordAttempt = new Attempt(phase === "learn");
  session.step = 0;
  session.stepTimes = [];
  hideFeedback();
  pianoSig = "";
  updatePiano();
  paintChord();
  const grip = currentGrip();
  if (grip) chordInput.begin(grip.midi, grip.symbol);
  session.stepStart = performance.now();
}

function nextChord(): void {
  flushChord();
  const pool = chordPool(deck, save.settings.chordStage, save.chords, introCount(save.intro, Date.now()), save.settings.introCap);
  if (!pool.length) { session.card = null; paintChord(); return; }
  const chosen = pickWeighted(pool, (id) => save.chords[id], "chord", save.settings.adaptive, session.lastCardId, Date.now());
  session.card = chosen;
  session.lastCardId = chosen.id;
  const learn = exposureCount(save.chords[chosen.id]) === 0 || (chosen.kind === "progression" && chosen.guided);
  startChord(learn ? "learn" : "recall");
  paintStage();
}

function flushChord(completed = false, ms?: number): void {
  const card = session.card;
  const attempt = session.chordAttempt;
  if (!card || attempt.recorded || (!completed && !attempt.touched)) return;
  // A partial clean progression supplies no completion evidence. Preserve actual errors/help.
  if (!completed && attempt.outcome === "correct") return;
  const before = exposureCount(save.chords[card.id]);
  saveAttempt("chords", card.id, "chord", attempt, ms ?? scoredMs(session.stepStart, "chord", false));
  save.intro = before === 0 ? noteIntroduction(save.intro, Date.now()) : touchIntro(save.intro, Date.now());
  persist();
  paintStage();
}

function onChordMatch(pointer: boolean): void {
  const grip = currentGrip();
  if (!grip || session.advancing) return;
  const elapsed = scoredMs(session.stepStart, "chord", pointer);
  session.chordAttempt.touched = true;
  grip.midi.forEach((midi, index) => playPiano(midi, 0.7, 0.18, index * 0.01));
  session.stepTimes.push(elapsed);
  // Mouse keys latch for assembling a chord with one pointer. Hardware/touch keys remain held.
  for (const midi of [...pointerHeld]) {
    if (![...touchKeys.values()].includes(midi)) { held.delete(midi); pointerHeld.delete(midi); setKeyDown(midi, false); }
  }
  const card = session.card!;
  const steps = card.kind === "chord" ? 1 : card.steps.length;
  if (session.step + 1 >= steps) {
    const avg = session.stepTimes.reduce((sum, ms) => sum + ms, 0) / session.stepTimes.length;
    flushChord(true, avg);
    session.advancing = true;
    showFeedback(session.chordAttempt.outcome === "correct" ? avg : null, answerFeedback(session.chordAttempt), "emerald", "chord");
    if (session.phase === "learn") { session.guidedComplete = true; paintChord(); }
    else advanceAfter(() => { session.advancing = false; nextChord(); }, 650);
    return;
  }
  session.step++;
  paintChord();
  const next = currentGrip()!;
  chordInput.begin(next.midi, next.symbol);
  session.stepStart = performance.now();
  showFeedback(null, "Keep common notes held", "emerald", "chord");
}

function chordNote(midi: number, down: boolean, pointer: boolean): void {
  if (save.settings.app !== "chords") return;
  if (!session.card || session.advancing) {
    if (pointer && down) return;
    if (down) held.add(midi); else { held.delete(midi); pointerHeld.delete(midi); }
    setKeyDown(midi, down);
    return;
  }
  if (pointer && down) pointerHeld.add(midi);
  if (!down) pointerHeld.delete(midi);
  const result = chordInput.input(midi, down, save.settings.exactOctave);
  setKeyDown(midi, down);
  if (result === "match") onChordMatch(pointer);
  else if (result === "octave" || result === "miss") {
    session.chordAttempt.miss(result === "octave" ? "octave" : "pitch");
    const grip = currentGrip()!;
    const hint = result === "octave"
      ? octaveDirection([...held], grip.midi) === "higher" ? "Right shape, higher octave" : "Right shape, lower octave"
      : "Check the shape and try again";
    playWrong();
    showFeedback(null, hint, "amber", "chord");
  }
}

function peekChord(): void {
  if (!session.card || session.advancing) return;
  session.chordAttempt.help();
  session.showShape = true;
  paintChord();
}

function recallChord(): void {
  if (!session.card) return;
  flushChord();
  startChord("recall");
}

function hearChord(): void {
  if (!session.card || session.advancing) return;
  session.chordAttempt.help();
  const grip = currentGrip();
  grip?.midi.forEach((midi) => playPiano(midi, 1.2, 0.2));
  showFeedback(null, "Listen, then try the shape · assisted", "amber", "chord");
}

function paintScaleStage(): void {
  const stage = save.settings.scaleStage;
  $("scaleStageLabel").textContent = `Stage ${stage} · ${SCALE_STAGES[stage] ?? "Practice"}`;
  const counts = stageCounts(SCALES, stage, save.scales);
  $("scaleStageMeta").textContent = `${counts.seen} of ${counts.open} met · ${introCount(save.scaleIntro, Date.now())} new this sitting`;
  ($("scaleStageDown") as HTMLButtonElement).disabled = stage <= 1;
  ($("scaleStageUp") as HTMLButtonElement).disabled = stage >= SCALE_STAGE_COUNT;
}

function paintScale(): void {
  const item = session.scale;
  $("directionBadge").classList.add("hidden");
  if (!item) {
    $("scaleTitle").textContent = "Nothing in this stage";
    for (const id of ["scaleEyebrow", "scaleDetail", "scaleExplanation", "scaleFingering"]) $(id).textContent = "";
    $("scaleSteps").replaceChildren();
    return;
  }
  const at = scaleInput.index;
  $("promptBadge").textContent = session.scaleComplete ? "Guided run complete" : session.scalePhase === "learn" ? "Learn this scale" : "Play from memory";
  $("scaleEyebrow").textContent = item.handLabel;
  $("scaleTitle").textContent = item.title;
  $("scaleDetail").textContent = `One octave up and back · note ${Math.min(at + 1, item.steps.length)} of ${item.steps.length}`;
  const row = $("scaleSteps");
  row.replaceChildren();
  item.names.forEach((name, index) => {
    const pill = document.createElement("span");
    const state = index < at ? "border-emerald-300 bg-emerald-50 text-emerald-700" : index === at && !session.scaleComplete ? "current" : "border-slate-300 text-slate-500";
    pill.className = `scale-pill px-1.5 py-0.5 rounded-md border text-xs font-semibold font-mono ${state}`;
    // From memory, the names stay hidden until each note is played.
    pill.textContent = session.showScale || index < at ? name : "·";
    row.append(pill);
  });
  markTargets(session.showScale && !session.scaleComplete ? scaleInput.current : []);
  $("scaleExplanation").textContent = session.showScale ? item.hint : "";
  const fingers = item.fingering ? [item.fingering.rh && `RH ${item.fingering.rh}`, item.fingering.lh && `LH ${item.fingering.lh}`].filter(Boolean).join(" · ") : "";
  $("scaleFingering").textContent = session.showScale ? fingers : "";
  $("peekScaleBtn").textContent = session.showScale ? "Scale shown · assisted" : "Show scale";
  ($("peekScaleBtn") as HTMLButtonElement).disabled = session.showScale;
  $("recallScaleBtn").classList.toggle("hidden", !session.showScale && !session.scaleComplete);
  $("nextScaleBtn").classList.toggle("hidden", !session.scaleComplete);
}

function startScale(phase: "learn" | "recall"): void {
  cancelAdvance();
  session.advancing = false;
  session.scalePhase = phase;
  session.showScale = phase === "learn";
  session.scaleComplete = false;
  session.scaleAttempt = new Attempt(phase === "learn");
  hideFeedback();
  if (session.scale) scaleInput.begin(session.scale.steps);
  pianoSig = "";
  updatePiano();
  paintScale();
  session.scaleStart = performance.now();
}

function nextScale(): void {
  flushScale();
  const now = Date.now();
  const pool = chordPool(SCALES, save.settings.scaleStage, save.scales, introCount(save.scaleIntro, now), SCALE_INTRO_CAP);
  if (!pool.length) { session.scale = null; paintScale(); return; }
  const chosen = pickWeighted(pool, (id) => save.scales[id], "scale", save.settings.adaptive, session.lastScaleId, now);
  session.scale = chosen;
  session.lastScaleId = chosen.id;
  startScale(exposureCount(save.scales[chosen.id]) === 0 ? "learn" : "recall");
  paintScaleStage();
}

/** Time per note, from the prompt to the last note, so a hesitant start counts. */
function scaleMs(): number {
  const steps = session.scale?.steps.length ?? 1;
  return practiceMs(activeMs(session.scaleStart) / steps, "scale");
}

function flushScale(completed = false): void {
  const item = session.scale;
  const attempt = session.scaleAttempt;
  if (!item || attempt.recorded || (!completed && !attempt.touched)) return;
  // Half a clean scale is not a recall. Errors and help still count.
  if (!completed && attempt.outcome === "correct") return;
  const before = exposureCount(save.scales[item.id]);
  saveAttempt("scales", item.id, "scale", attempt, scaleMs());
  save.scaleIntro = before === 0 ? noteIntroduction(save.scaleIntro, Date.now()) : touchIntro(save.scaleIntro, Date.now());
  persist();
  paintScaleStage();
}

function scaleNote(midi: number): void {
  if (save.settings.app !== "scales") return;
  flashKey(midi);
  if (!session.scale || session.advancing || session.scaleComplete) return;
  const result = scaleInput.input(midi, save.settings.exactOctave);
  if (result === "ignored") return;
  if (result === "miss" || result === "octave") {
    session.scaleAttempt.miss(result === "octave" ? "octave" : "pitch");
    playWrong();
    const want = scaleInput.current;
    const hint = result === "octave"
      ? midi < want[0]! ? "Right note, higher octave" : "Right note, lower octave"
      : `Not that one · you're on note ${scaleInput.index + 1}`;
    showFeedback(null, hint, "amber", "scale");
    return;
  }
  session.scaleAttempt.touched = true;
  playPiano(midi, 0.5, 0.22);
  if (result === "pending") return;
  if (result === "step") { paintScale(); return; }
  const ms = scaleMs();
  flushScale(true);
  session.advancing = true;
  const outcome = session.scaleAttempt.outcome;
  showFeedback(null, outcome === "correct" ? `Correct · ${Math.round(ms)} ms a note` : answerFeedback(session.scaleAttempt), "emerald", "scale");
  if (session.scalePhase === "learn") { session.scaleComplete = true; session.advancing = false; paintScale(); }
  else { paintScale(); advanceAfter(() => { session.advancing = false; nextScale(); }, 900); }
}

function peekScale(): void {
  if (!session.scale || session.advancing) return;
  session.scaleAttempt.help();
  session.showScale = true;
  paintScale();
}

function recallScale(): void {
  if (!session.scale) return;
  flushScale();
  startScale("recall");
}

function hearScale(): void {
  if (!session.scale || session.advancing) return;
  session.scaleAttempt.help();
  session.scale.steps.forEach((step, index) => step.forEach((midi) => playPiano(midi, 0.45, 0.2, index * 0.28)));
  showFeedback(null, "Listen, then play it · assisted", "amber", "scale");
}

function heatClass(band: HeatBand): string {
  if (band === "green") return "bg-emerald-500/20 border-emerald-500/50 text-emerald-200";
  if (band === "amber") return "bg-amber-500/20 border-amber-500/50 text-amber-200";
  if (band === "rose") return "bg-rose-500/20 border-rose-500/50 text-rose-200";
  return "bg-studio-800/80 border-studio-700 text-slate-400";
}

function heatCell(title: string, statId: string, bucket: Save["notes"], kind: Kind): HTMLElement {
  const stat = bucket[statId];
  const mean = averageMs(stat);
  const avg = mean === null ? null : Math.round(mean);
  const cell = document.createElement("div");
  cell.className = `p-2 rounded-xl border text-center ${heatClass(heatBand(stat, kind))}`;
  const recent = recentAccuracy(stat);
  const acc = recent === null ? "No recent recall" : `${Math.round(recent * 100)}% recent recall`;
  const state = progressState(stat, kind);
  cell.title = stat ? `${stat.attempts} recall attempts · ${stat.assisted} assisted · ${stat.pitchErrors} pitch errors · ${stat.octaveErrors} octave errors. Earlier totals are retained; confidence uses recent dated evidence.` : "Not practiced yet";
  cell.innerHTML = `<div class="text-sm font-bold font-mono">${title}</div><div class="text-[11px] font-mono mt-0.5">${avg === null ? "—" : `${avg} ms`}</div><div class="text-[10px] opacity-70">${state}</div><div class="text-[10px] opacity-70">${acc}</div>`;
  return cell;
}

function renderHeatmap(): void {
  let reliable = 0;
  let attempts = 0;
  let correct = 0;
  for (const note of CATALOG.all) {
    const stat = save.notes[note.id];
    if (!stat) continue;
    attempts += stat.attempts;
    correct += stat.correct;
    if (["Reliable", "Fluent"].includes(progressState(stat, "note"))) reliable++;
  }
  $("hmMasteredCount").textContent = `${reliable} / ${CATALOG.all.length}`;
  const chordSeen = Object.values(save.chords).filter((stat) => exposureCount(stat) > 0).length;
  $("hmChordCount").textContent = String(chordSeen);
  $("hmAccuracy").textContent = attempts ? `${Math.round((correct / attempts) * 100)}%` : "--%";
  $("hmClefFlips").textContent = String(save.clefFlips);
  const treble = $("hmTrebleGrid");
  const bass = $("hmBassGrid");
  treble.replaceChildren();
  bass.replaceChildren();
  for (const note of CATALOG.treble) treble.append(heatCell(note.label, note.id, save.notes, "note"));
  for (const note of CATALOG.bass) bass.append(heatCell(note.label, note.id, save.notes, "note"));
  const intervals = $("hmIntervalGrid");
  intervals.replaceChildren();
  for (let size = 2; size <= 8; size++) intervals.append(heatCell(intervalName(size), String(size), save.intervals, "interval"));
  const chunks = $("hmChunkGrid");
  chunks.replaceChildren();
  for (const clef of ["treble", "bass"]) for (const length of [3, 4]) {
    chunks.append(heatCell(`${clef} · ${length}`, `${clef}:${length}`, save.chunks, "chunk"));
  }
  const chords = $("hmChordGrid");
  chords.replaceChildren();
  const open = deck.filter((card) => card.level <= save.settings.chordStage && exposureCount(save.chords[card.id]) > 0).slice(0, 160);
  for (const card of open) {
    const title = card.kind === "chord" ? card.symbol : `${card.symbols.join(" ")}`;
    chords.append(heatCell(title, card.id, save.chords, "chord"));
  }
  if (!open.length) {
    const empty = document.createElement("p");
    empty.className = "text-xs text-slate-400 col-span-full";
    empty.textContent = "No chord shapes yet. They show up here after you play them.";
    chords.append(empty);
  }
  const scales = $("hmScaleGrid");
  scales.replaceChildren();
  const met = SCALES.filter((item) => exposureCount(save.scales[item.id]) > 0);
  for (const item of met) {
    const hand = item.hand === "rh" ? "RH" : item.hand === "lh" ? "LH" : "HT";
    scales.append(heatCell(`${item.tonic} ${item.type === "major" ? "maj" : "mel"} ${hand}`, item.id, save.scales, "scale"));
  }
  if (!met.length) {
    const empty = document.createElement("p");
    empty.className = "text-xs text-slate-400 col-span-full";
    empty.textContent = "No scales yet. They show up here after you play them.";
    scales.append(empty);
  }
}

function clearPractice(): void {
  resumeFlash = false;
  cancelAdvance();
  clearChunkTimers();
  session.prompt = null;
  session.card = null;
  session.scale = null;
  session.scaleComplete = false;
  session.scaleAttempt = new Attempt();
  scaleInput.begin([]);
  chordInput.clear();
  pointerHeld.clear();
  touchKeys.clear();
  session.advancing = false;
  session.attempt = new Attempt();
  session.chordAttempt = new Attempt();
  for (const el of document.querySelectorAll("[data-midi]")) el.classList.remove("pressed", "target-key");
}

function go(app: Save["settings"]["app"]): void {
  if (save.settings.app === "count" && app !== "count") leaveCount();
  flushStaff();
  flushChord();
  flushScale();
  clearPractice();
  save.settings.app = app;
  persist();
  hideFeedback();
  syncChrome();
  if (app === "staff") nextStaff();
  else if (app === "chords") nextChord();
  else if (app === "scales") nextScale();
  else {
    clearChunkTimers();
    $("directionBadge").classList.add("hidden");
    enterCount();
  }
}

function connectMidi(): void {
  unlockAudio();
  const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccess> };
  if (!nav.requestMIDIAccess) {
    $("midiLabel").textContent = "No Web MIDI";
    showFeedback(null, "This browser has no Web MIDI. Open the page in midiweb.", "amber", "note");
    return;
  }
  void nav.requestMIDIAccess().then((access) => {
    const attach = () => {
      const inputs = [...access.inputs.values()];
      for (const input of inputs) input.onmidimessage = onMidi;
      const dot = $("midiDot");
      if (inputs.length) {
        dot.className = "w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]";
        $("midiLabel").textContent = inputs[0]!.name || "MIDI piano";
      } else {
        dot.className = "w-2 h-2 rounded-full bg-slate-500";
        $("midiLabel").textContent = "No MIDI device";
      }
    };
    attach();
    access.onstatechange = attach;
  }).catch(() => {
    $("midiLabel").textContent = "MIDI denied";
  });
}

function onMidi(event: MIDIMessageEvent): void {
  const [status = 0, data1 = 0, data2 = 0] = event.data ?? [];
  const command = status & 0xf0;
  const down = command === 0x90 && data2 > 0;
  const up = command === 0x80 || (command === 0x90 && data2 === 0);
  if (!down && !up) return;
  if (document.hidden || overlayAt !== null) {
    if (up) { held.delete(data1); pointerHeld.delete(data1); setKeyDown(data1, false); }
    return;
  }
  if (save.settings.app === "chords") {
    chordNote(data1, down, false);
    return;
  }
  if (save.settings.app === "scales") {
    if (down) scaleNote(data1);
    return;
  }
  if (!down || save.settings.app !== "staff") return;
  const name = pitchName(data1);
  flashKey(data1);
  handleNote({ letter: name.replace("#", ""), sharp: isSharpPitch(data1), midi: data1, pointer: false });
}

function exportBackup(): void {
  const blob = new Blob([JSON.stringify(save, null, 1)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "piano-practice-backup.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

async function loadDeck(): Promise<Card[]> {
  const embedded = $("deck-data").textContent?.trim() ?? "";
  if (embedded.startsWith("{")) return (JSON.parse(embedded) as Deck).cards;
  const response = await fetch(`deck.json?v=${document.documentElement.dataset.build ?? ""}`);
  return ((await response.json()) as Deck).cards;
}

function bind(): void {
  document.querySelectorAll<HTMLElement>(".app-btn").forEach((button) => {
    button.addEventListener("click", () => go(button.dataset.app as Save["settings"]["app"]));
  });
  document.querySelectorAll<HTMLElement>(".drill-btn").forEach((button) => {
    button.addEventListener("click", () => {
      save.settings.drill = button.dataset.drill as Save["settings"]["drill"];
      persist();
      syncChrome();
      nextStaff();
    });
  });
  document.querySelectorAll<HTMLElement>(".tier-btn").forEach((button) => {
    button.addEventListener("click", () => {
      save.settings.tier = Number(button.dataset.tier) as Save["settings"]["tier"];
      persist();
      syncChrome();
      nextStaff();
    });
  });
  document.querySelectorAll<HTMLElement>(".input-mode-btn").forEach((button) => {
    button.addEventListener("click", () => {
      save.settings.inputMode = button.dataset.input as Save["settings"]["inputMode"];
      persist();
      syncChrome();
    });
  });
  document.querySelectorAll<HTMLElement>(".int-type-btn").forEach((button) => {
    button.addEventListener("click", () => {
      save.settings.intervalType = button.dataset.intType as Save["settings"]["intervalType"];
      persist();
      syncChrome();
      nextStaff();
    });
  });
  document.querySelectorAll<HTMLElement>(".chunk-len-btn").forEach((button) => {
    button.addEventListener("click", () => {
      save.settings.chunkLength = Number(button.dataset.chunkLen) === 4 ? 4 : 3;
      persist();
      syncChrome();
      nextStaff();
    });
  });
  document.querySelectorAll<HTMLElement>(".interval-btn").forEach((button) => {
    button.addEventListener("click", () => handleInterval(Number(button.dataset.interval), true));
  });
  document.querySelectorAll<HTMLElement>(".letter-pad-btn").forEach((button) => {
    button.addEventListener("click", () => handleNote({ letter: button.dataset.letter ?? "C", sharp: false, midi: null, pointer: true }));
  });
  $("peekChunkBtn").addEventListener("click", () => { if (save.settings.drill === "chunks" && !session.advancing) startChunkFlash(true); });
  $("peekChordBtn").addEventListener("click", peekChord);
  $("recallChordBtn").addEventListener("click", recallChord);
  $("hearChordBtn").addEventListener("click", hearChord);
  $("nextChordBtn").addEventListener("click", nextChord);
  $("peekScaleBtn").addEventListener("click", peekScale);
  $("recallScaleBtn").addEventListener("click", recallScale);
  $("hearScaleBtn").addEventListener("click", hearScale);
  $("nextScaleBtn").addEventListener("click", nextScale);
  window.addEventListener("pagehide", () => { flushStaff(); flushChord(); flushScale(); });
  $("flashSlider").addEventListener("input", (event) => {
    save.settings.flashSec = Number((event.target as HTMLInputElement).value);
    $("flashVal").textContent = `${save.settings.flashSec.toFixed(1)}s`;
    persist();
  });
  for (const [id, key] of [
    ["toggleLandmarks", "landmarks"], ["toggleAdaptive", "adaptive"], ["toggleExactOctave", "exactOctave"],
    ["toggleMouseComp", "mouseCompensation"], ["toggleKeyHints", "showKeyHints"],
  ] as const) {
    $(id).addEventListener("change", (event) => {
      (save.settings[key] as boolean) = (event.target as HTMLInputElement).checked;
      persist();
      if (key === "landmarks") drawLandmarks($<SVGGElement>("staffLandmarkLayer"), save.settings.landmarks);
      syncChrome();
    });
  }
  $("pianoLabelMode").addEventListener("change", (event) => {
    save.settings.pianoLabelMode = (event.target as HTMLSelectElement).value as Save["settings"]["pianoLabelMode"];
    persist();
    pianoSig = "";
    syncChrome();
  });
  $("muteBtn").addEventListener("click", () => { save.settings.muted = !save.settings.muted; persist(); syncChrome(); });
  $("midiBtn").addEventListener("click", connectMidi);
  $("stageDown").addEventListener("click", () => { save.settings.chordStage = Math.max(1, save.settings.chordStage - 1); persist(); nextChord(); syncChrome(); });
  $("stageUp").addEventListener("click", () => { save.settings.chordStage = Math.min(21, save.settings.chordStage + 1); persist(); nextChord(); syncChrome(); });
  $("scaleStageDown").addEventListener("click", () => { save.settings.scaleStage = Math.max(1, save.settings.scaleStage - 1); persist(); nextScale(); syncChrome(); });
  $("scaleStageUp").addEventListener("click", () => { save.settings.scaleStage = Math.min(SCALE_STAGE_COUNT, save.settings.scaleStage + 1); persist(); nextScale(); syncChrome(); });
  const modal = $("heatmapModal");
  $("openHeatmapBtn").addEventListener("click", () => {
    overlayAt ??= performance.now();
    pauseFlash();
    renderHeatmap(); modal.classList.remove("hidden");
  });
  const close = () => {
    if (overlayAt !== null) hiddenSpans.push({ start: overlayAt, end: performance.now() });
    overlayAt = null;
    resumePreview();
    modal.classList.add("hidden"); $("confirmResetBtn").classList.add("hidden"); $("resetStatsBtn").classList.remove("hidden");
  };
  $("closeHeatmapBtn").addEventListener("click", close);
  $("heatmapBackdrop").addEventListener("click", close);
  $("exportBtn").addEventListener("click", exportBackup);
  $("importFile").addEventListener("change", async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    let parsed: Save | null = null;
    try { parsed = parseSave(JSON.parse(await file.text())); } catch { /* display the same import error */ }
    if (!parsed) { showFeedback(null, "That file is not a piano backup", "rose", "note"); return; }
    if (save.settings.app === "count") leaveCount();
    clearPractice();
    save = parsed;
    go(save.settings.app);
    renderHeatmap();
  });
  $("resetStatsBtn").addEventListener("click", () => { $("resetStatsBtn").classList.add("hidden"); $("confirmResetBtn").classList.remove("hidden"); });
  $("confirmResetBtn").addEventListener("click", () => {
    const settings = save.settings;
    clearPractice();
    save = emptySave();
    save.settings = settings;
    persist();
    headerStats();
    renderHeatmap();
    $("confirmResetBtn").classList.add("hidden");
    $("resetStatsBtn").classList.remove("hidden");
    go(settings.app);
  });

  $("pianoKeyboard").addEventListener("pointerdown", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-midi]");
    if (!button) return;
    event.preventDefault();
    unlockAudio();
    const midi = Number(button.dataset.midi);
    if (save.settings.app === "scales") { scaleNote(midi); return; }
    if (save.settings.app === "chords") {
      if (event.pointerType === "mouse") chordNote(midi, !pointerHeld.has(midi), true);
      else {
        touchKeys.set(event.pointerId, midi);
        button.setPointerCapture(event.pointerId);
        chordNote(midi, true, true);
      }
    }
    else {
      flashKey(midi);
      handleNote({ letter: pitchName(midi).replace("#", ""), sharp: isSharpPitch(midi), midi, pointer: true });
    }
  });
  const releasePointer = (event: PointerEvent) => {
    const midi = touchKeys.get(event.pointerId);
    touchKeys.delete(event.pointerId);
    if (midi !== undefined && ![...touchKeys.values()].includes(midi)) chordNote(midi, false, true);
  };
  window.addEventListener("pointerup", releasePointer);
  window.addEventListener("pointercancel", releasePointer);
  window.addEventListener("keydown", (event) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = (event.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (event.key === "Escape") { close(); return; }
    if (!modal.classList.contains("hidden")) return;
    unlockAudio();
    if (save.settings.app === "count") { onCountKey(event); return; }
    if (event.code === "Space" && save.settings.app === "staff" && save.settings.drill === "chunks") {
      event.preventDefault();
      if (!session.advancing) startChunkFlash(true);
      return;
    }
    if (save.settings.app === "staff" && save.settings.drill === "intervals") {
      const num = Number(event.key);
      if (num >= 2 && num <= 8) { event.preventDefault(); handleInterval(num, false); }
      return;
    }
    if (save.settings.app === "chords" || save.settings.app === "scales") return;
    const key = event.key.toLowerCase();
    if (save.settings.inputMode === "letters" && LETTERS.includes(key.toUpperCase() as (typeof LETTERS)[number])) {
      event.preventDefault();
      handleNote({ letter: key.toUpperCase(), sharp: false, midi: null, pointer: false });
      return;
    }
    const mapped = HOME_ROW[key];
    if (save.settings.inputMode === "linear" && mapped) {
      event.preventDefault();
      flashKey(mapped.midi);
      handleNote({ letter: mapped.letter.replace("#", ""), sharp: mapped.sharp, midi: mapped.midi, pointer: false });
    }
  });
}

async function boot(): Promise<void> {
  watchVisibility();
  save = loadSave();
  bindMute(() => save.settings.muted);
  drawStaticStaff($<SVGGElement>("staffStaticLayer"));
  drawLandmarks($<SVGGElement>("staffLandmarkLayer"), save.settings.landmarks);
  bind();
  try {
    deck = await loadDeck();
  } catch {
    $("promptBadge").textContent = "Could not load the chord deck";
  }
  void navigator.storage?.persist?.();
  syncChrome();
  if (save.settings.app === "chords") nextChord();
  else if (save.settings.app === "scales") nextScale();
  else if (save.settings.app === "staff") nextStaff();
  else enterCount();
}

void boot();
