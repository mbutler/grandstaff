import { bindMute, playPiano, playWrong, unlockAudio } from "./audio";
import { flashKey, isSharpPitch, markTargets, pitchName, renderPiano, setKeyDown, STAFF_HI, STAFF_LO, staffHints } from "./piano";
import { rangeFor } from "./keyboard";
import {
  averageMs, BUDGET, emptySave, heatBand, introCount, isMastered, loadSave, noteIntroduction, overlapMs, parseSave, pickWeighted,
  practiceMs, remember, recordAttempt, touchIntro, writeSave, type HeatBand, type Kind, type Save,
} from "../adapt/memory";
import { judgeGrip, octaveDirection } from "../chords/grip";
import { chordPool, stageCounts } from "../chords/pool";
import { STAGES } from "../deck/stages";
import { CATALOG, isClefFlip, LETTERS, notesForTier } from "../staff/catalog";
import { drawLandmarks, drawPrompt, drawStaticStaff } from "../staff/draw";
import { chunkPrompt, intervalPrompt, notePrompt, type StaffPrompt } from "../staff/prompt";
import { inversionLabel, type Card, type Deck } from "../types";

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
const held = new Set<number>();
const pointerHeld = new Set<number>();

const session = {
  prompt: null as StaffPrompt | null,
  chunkIndex: 0,
  chunkVisible: true,
  chunkTimer: 0,
  chunkFrame: 0,
  advancing: false,
  hadMistake: false,
  promptStart: 0,
  lastNoteId: null as string | null,
  card: null as Card | null,
  step: 0,
  stepTimes: [] as number[],
  spoiled: false,
  recorded: false,
  armed: true,
  stepStart: 0,
  lastCardId: null as string | null,
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

function awaySince(since: number, until = performance.now()): number {
  const spans = hiddenAt === null ? hiddenSpans : [...hiddenSpans, { start: hiddenAt, end: until }];
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
      return;
    }
    if (hiddenAt === null) return;
    hiddenSpans.push({ start: hiddenAt, end: performance.now() });
    hiddenAt = null;
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
    const budget = BUDGET[kind];
    let cls = "bg-emerald-100 text-emerald-800 border border-emerald-300";
    let label = kind === "chord" ? "Fluent" : "Instant";
    if (rounded >= budget.amber) { cls = "bg-rose-100 text-rose-800 border border-rose-300"; label = "Slow"; }
    else if (rounded >= budget.green) { cls = "bg-amber-100 text-amber-800 border border-amber-300"; label = "Solid"; }
    latency.className = `animate-pop px-2.5 py-0.5 rounded-full font-mono text-xs font-semibold ${cls}`;
    latency.textContent = compensated ? `${rounded} ms · ${label}` : `${rounded} ms · ${label}`;
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
  const area = save.settings.app === "chords" ? "chords" : "staff";
  const rows = save.recent.filter((row) => row.area === area);
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
  $("staffBar").classList.toggle("hidden", !staff);
  $("chordBar").classList.toggle("hidden", !chords);
  $("staffFace").classList.toggle("hidden", !staff);
  $("chordFace").classList.toggle("hidden", !chords);
  $("countFace").classList.toggle("hidden", settings.app !== "count");
  $("subBarIntervals").classList.toggle("hidden", !(staff && settings.drill === "intervals"));
  $("subBarChunks").classList.toggle("hidden", !(staff && settings.drill === "chunks"));
  $("inputSection").classList.toggle("hidden", settings.app === "count");

  const intervals = staff && settings.drill === "intervals";
  const showPiano = !intervals && (chords || settings.inputMode === "linear");
  const showLetters = staff && !intervals && settings.inputMode === "letters";
  $("inputSelectorBar").classList.toggle("hidden", chords || intervals);
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
    ? "Hold the right-hand shape on your MIDI keyboard. A small roll still counts."
    : "Play the note on your MIDI keyboard, tap a key, or use the home row.";
  updatePiano();
  headerStats();
  if (chords) paintStage();
}

function updatePiano(): void {
  const { settings } = save;
  const chordRange = settings.app === "chords" && session.card ? rangeFor(gripMidis(session.card)) : null;
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
  if (session.card && save.settings.app === "chords" && session.spoiled) markTargets(currentGrip()?.midi ?? []);
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

function startChunkFlash(): void {
  clearChunkTimers();
  session.chunkVisible = true;
  renderStaff();
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
    wrap.classList.add("hidden");
    const count = session.prompt?.kind === "chunks" ? session.prompt.notes.length : 0;
    $("promptBadge").textContent = `Play back note ${session.chunkIndex + 1} of ${count}`;
    renderStaff();
  }, duration);
}

function nextStaff(): void {
  clearChunkTimers();
  session.advancing = false;
  session.hadMistake = false;
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

function noteStat(id: string, correct: boolean, ms: number): void {
  const scored = practiceMs(ms, "note");
  save.notes[id] = recordAttempt(save.notes[id], correct, scored, Date.now());
  remember(save, "staff", correct, scored);
  persist();
  headerStats();
}

function intervalStat(size: number, correct: boolean, ms: number): void {
  const id = String(size);
  const scored = practiceMs(ms, "interval");
  save.intervals[id] = recordAttempt(save.intervals[id], correct, scored, Date.now());
  remember(save, "staff", correct, scored);
  persist();
  headerStats();
}

function handleNote(input: { letter: string; sharp: boolean; midi: number | null; pointer: boolean }): void {
  if (save.settings.app !== "staff" || (save.settings.drill !== "notes" && save.settings.drill !== "chunks")) return;
  if (session.advancing || !session.prompt) return;
  const target = session.prompt.kind === "notes" ? session.prompt.note : session.prompt.kind === "chunks" ? session.prompt.notes[session.chunkIndex] : null;
  if (!target) return;
  if (input.sharp) {
    playWrong();
    shake();
    showFeedback(null, "Natural note", "rose", "note");
    return;
  }
  const letterOk = input.letter === target.letter;
  const exact = input.midi !== null && save.settings.exactOctave;
  const match = exact ? input.midi === target.midi : letterOk;
  if (exact && letterOk && !match && input.midi !== null) {
    playPiano(input.midi, 0.35, 0.2);
    showFeedback(null, input.midi < target.midi ? "Right letter, higher octave" : "Right letter, lower octave", "amber", "note");
    return;
  }
  if (match) {
    const elapsed = scoredMs(session.promptStart, "note", input.pointer);
    playPiano(target.midi, 0.85, 0.28);
    if (session.prompt.kind === "notes") {
      session.advancing = true;
      if (!session.hadMistake) noteStat(target.id, true, elapsed);
      showFeedback(elapsed, target.label, "emerald", "note", input.pointer && save.settings.mouseCompensation);
      drawPrompt($<SVGGElement>("staffNotesLayer"), session.prompt, { chunkIndex: 0, chunkVisible: true, color: "#059669" });
      window.setTimeout(nextStaff, 340);
    } else {
      const share = activeMs(session.promptStart) / (session.chunkIndex + 1);
      const chunkMs = practiceMs(Math.max(250, adjustLatency(share, input.pointer)), "note");
      noteStat(target.id, true, chunkMs);
      session.chunkIndex++;
      renderStaff();
      if (session.prompt.kind === "chunks" && session.chunkIndex >= session.prompt.notes.length) {
        session.advancing = true;
        showFeedback(chunkMs, "Chunk complete", "emerald", "note");
        window.setTimeout(nextStaff, 600);
      } else {
        $("promptBadge").textContent = `Play back note ${session.chunkIndex + 1} of ${session.prompt.kind === "chunks" ? session.prompt.notes.length : 0}`;
        showFeedback(null, `${target.label}`, "emerald", "note");
      }
    }
    return;
  }
  playWrong();
  shake();
  if (!session.hadMistake) {
    session.hadMistake = true;
    noteStat(target.id, false, scoredMs(session.promptStart, "note", false));
  }
  if (isClefFlip(target, input.letter)) {
    save.clefFlips++;
    persist();
    headerStats();
    showFeedback(null, target.clef === "bass" ? "Clef flip — bass" : "Clef flip — treble", "amber", "note");
  } else showFeedback(null, `Try again (${input.letter})`, "rose", "note");
}

function handleInterval(size: number, pointer: boolean): void {
  if (save.settings.app !== "staff" || save.settings.drill !== "intervals" || session.advancing || session.prompt?.kind !== "intervals") return;
  const prompt = session.prompt;
  const elapsed = scoredMs(session.promptStart, "interval", pointer);
  if (size === prompt.size) {
    session.advancing = true;
    if (!session.hadMistake) intervalStat(prompt.size, true, elapsed);
    const gap = prompt.presentation === "harmonic" ? 0 : 0.24;
    playPiano(prompt.n1.midi, 0.8, 0.22, 0);
    playPiano(prompt.n2.midi, 0.8, 0.22, gap);
    showFeedback(elapsed, intervalName(size), "emerald", "interval", pointer && save.settings.mouseCompensation);
    drawPrompt($<SVGGElement>("staffNotesLayer"), prompt, { chunkIndex: 0, chunkVisible: true, color: "#059669" });
    window.setTimeout(nextStaff, 520);
  } else {
    playWrong();
    shake();
    if (!session.hadMistake) {
      session.hadMistake = true;
      intervalStat(prompt.size, false, elapsed);
    }
    showFeedback(null, `Not a ${intervalName(size)}`, "rose", "interval");
  }
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
  markTargets(session.spoiled && grip ? grip.midi : []);
  $("peekChordBtn").textContent = session.spoiled && grip ? grip.names.join(" ") : "Peek shape";
}

function nextChord(): void {
  hideFeedback();
  session.spoiled = false;
  session.recorded = false;
  session.step = 0;
  session.stepTimes = [];
  session.armed = held.size === 0;
  session.stepStart = performance.now();
  const pool = chordPool(deck, save.settings.chordStage, save.chords, introCount(save.intro, Date.now()), save.settings.introCap);
  if (!pool.length) {
    session.card = null;
    paintChord();
    return;
  }
  const chosen = pickWeighted(pool, (id) => save.chords[id], "chord", save.settings.adaptive, session.lastCardId, Date.now());
  session.card = chosen;
  session.lastCardId = chosen.id;
  pianoSig = "";
  paintChord();
  updatePiano();
  paintStage();
}

function storeChord(correct: boolean, ms: number): void {
  const card = session.card;
  if (!card || session.recorded) return;
  const before = save.chords[card.id]?.attempts ?? 0;
  const scored = practiceMs(ms, "chord");
  save.chords[card.id] = recordAttempt(save.chords[card.id], correct, scored, Date.now());
  save.intro = before === 0 ? noteIntroduction(save.intro, Date.now()) : touchIntro(save.intro, Date.now());
  remember(save, "chords", correct, scored);
  session.recorded = true;
  persist();
  headerStats();
  paintStage();
}

function finishChord(cleanMs: number): void {
  if (!session.spoiled) storeChord(true, cleanMs);
  session.advancing = true;
  showFeedback(cleanMs, "Got it", "emerald", "chord");
  window.setTimeout(() => {
    session.advancing = false;
    nextChord();
  }, 420);
}

function onChordMatch(pointer: boolean): void {
  const grip = currentGrip();
  if (!grip || session.advancing) return;
  const elapsed = scoredMs(session.stepStart, "chord", pointer);
  grip.midi.forEach((midi, index) => playPiano(midi, 0.7, 0.18, index * 0.01));
  session.stepTimes.push(elapsed);
  const card = session.card;
  if (!card) return;
  const steps = card.kind === "chord" ? 1 : card.steps.length;
  if (session.step + 1 >= steps) {
    const avg = session.stepTimes.reduce((sum, ms) => sum + ms, 0) / session.stepTimes.length;
    session.armed = false;
    finishChord(avg);
    return;
  }
  session.step++;
  session.armed = false;
  paintChord();
  showFeedback(null, grip.symbol, "emerald", "chord");
}

function onChordMiss(): void {
  playWrong();
  shake();
  if (!session.recorded) storeChord(false, scoredMs(session.stepStart, "chord", false));
  session.spoiled = true;
  showFeedback(null, "Not that shape", "rose", "chord");
}

function chordNote(midi: number, down: boolean, pointer: boolean): void {
  if (save.settings.app !== "chords") return;
  if (!down) {
    held.delete(midi);
    pointerHeld.delete(midi);
    setKeyDown(midi, false);
    if (held.size === 0) {
      session.armed = true;
      if (!session.advancing) session.stepStart = performance.now();
    }
    return;
  }
  if (!session.card || session.advancing) return;
  if (down) {
    held.add(midi);
    if (pointer) pointerHeld.add(midi);
    setKeyDown(midi, true);
    if (!pointer) flashKey(midi);
    if (!session.armed) return;
    const grip = currentGrip();
    if (!grip) return;
    const result = judgeGrip([...held], grip.midi, save.settings.exactOctave);
    if (result === "match") onChordMatch(pointer);
    else if (result === "octave") showFeedback(null, octaveDirection([...held], grip.midi) === "higher" ? "Right shape, higher octave" : "Right shape, lower octave", "amber", "chord");
    else if (result === "miss") onChordMiss();
  }
}

function peekChord(): void {
  if (!session.card) return;
  session.spoiled = true;
  if (!session.recorded) storeChord(false, scoredMs(session.stepStart, "chord", false));
  paintChord();
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
  const acc = stat && stat.attempts ? `${Math.round((stat.correct / stat.attempts) * 100)}% · ${stat.attempts}` : "Unseen";
  cell.innerHTML = `<div class="text-sm font-bold font-mono">${title}</div><div class="text-[11px] font-mono mt-0.5">${avg === null ? "—" : `${avg} ms`}</div><div class="text-[10px] opacity-70">${acc}</div>`;
  return cell;
}

function renderHeatmap(): void {
  let mastered = 0;
  let attempts = 0;
  let correct = 0;
  for (const note of CATALOG.all) {
    const stat = save.notes[note.id];
    if (!stat) continue;
    attempts += stat.attempts;
    correct += stat.correct;
    if (isMastered(stat, "note")) mastered++;
  }
  $("hmMasteredCount").textContent = `${mastered} / ${CATALOG.all.length}`;
  const chordSeen = Object.values(save.chords).filter((stat) => stat.attempts > 0).length;
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
  const chords = $("hmChordGrid");
  chords.replaceChildren();
  const open = deck.filter((card) => card.level <= save.settings.chordStage && (save.chords[card.id]?.attempts ?? 0) > 0).slice(0, 160);
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
}

function go(app: Save["settings"]["app"]): void {
  held.clear();
  pointerHeld.clear();
  session.armed = true;
  save.settings.app = app;
  persist();
  hideFeedback();
  syncChrome();
  if (app === "staff") nextStaff();
  else if (app === "chords") nextChord();
  else {
    clearChunkTimers();
    $("promptBadge").textContent = "Counting";
    $("directionBadge").classList.add("hidden");
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
  if (save.settings.app === "chords") {
    chordNote(data1, down, false);
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
  $("peekChunkBtn").addEventListener("click", () => { if (save.settings.drill === "chunks") startChunkFlash(); });
  $("peekChordBtn").addEventListener("click", peekChord);
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
  const modal = $("heatmapModal");
  $("openHeatmapBtn").addEventListener("click", () => { renderHeatmap(); modal.classList.remove("hidden"); });
  const close = () => { modal.classList.add("hidden"); $("confirmResetBtn").classList.add("hidden"); $("resetStatsBtn").classList.remove("hidden"); };
  $("closeHeatmapBtn").addEventListener("click", close);
  $("heatmapBackdrop").addEventListener("click", close);
  $("exportBtn").addEventListener("click", exportBackup);
  $("importFile").addEventListener("change", async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const parsed = parseSave(JSON.parse(await file.text()));
    if (!parsed) { showFeedback(null, "That file is not a piano backup", "rose", "note"); return; }
    save = parsed;
    persist();
    syncChrome();
    renderHeatmap();
    if (save.settings.app === "chords") nextChord(); else if (save.settings.app === "staff") nextStaff();
  });
  $("resetStatsBtn").addEventListener("click", () => { $("resetStatsBtn").classList.add("hidden"); $("confirmResetBtn").classList.remove("hidden"); });
  $("confirmResetBtn").addEventListener("click", () => {
    const settings = save.settings;
    save = emptySave();
    save.settings = settings;
    persist();
    headerStats();
    renderHeatmap();
    $("confirmResetBtn").classList.add("hidden");
    $("resetStatsBtn").classList.remove("hidden");
    if (settings.app === "chords") nextChord(); else nextStaff();
  });

  $("pianoKeyboard").addEventListener("pointerdown", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-midi]");
    if (!button) return;
    event.preventDefault();
    unlockAudio();
    const midi = Number(button.dataset.midi);
    if (save.settings.app === "chords") chordNote(midi, true, true);
    else {
      flashKey(midi);
      handleNote({ letter: pitchName(midi).replace("#", ""), sharp: isSharpPitch(midi), midi, pointer: true });
    }
  });
  window.addEventListener("pointerup", () => {
    for (const midi of [...pointerHeld]) chordNote(midi, false, true);
  });
  window.addEventListener("keydown", (event) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = (event.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (event.key === "Escape") { close(); return; }
    if (!modal.classList.contains("hidden")) return;
    unlockAudio();
    if (save.settings.app === "count") return;
    if (event.code === "Space" && save.settings.app === "staff" && save.settings.drill === "chunks") {
      event.preventDefault();
      startChunkFlash();
      return;
    }
    if (save.settings.app === "staff" && save.settings.drill === "intervals") {
      const num = Number(event.key);
      if (num >= 2 && num <= 8) { event.preventDefault(); handleInterval(num, false); }
      return;
    }
    if (save.settings.app === "chords") return;
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
  else if (save.settings.app === "staff") nextStaff();
  else $("promptBadge").textContent = "Counting";
}

void boot();
