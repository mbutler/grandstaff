// Each skill has its own records. Historical totals survive migration, but
// confidence uses dated evidence collected with the current scoring rules.
//
// Fluent items rest, then return. The rest is short for reading and longer
// for chords. A miss clears the rest. Progress lives in localStorage.

export type Kind = "note" | "interval" | "chunk" | "chord" | "scale";
export type Skill = "notes" | "intervals" | "chunks" | "chords" | "scales" | "construction" | "rhythm";
export type Outcome = "correct" | "incorrect" | "assisted";
export interface Evidence {
  outcome: Outcome;
  assisted: boolean;
  unaidedError: boolean;
  ms: number;
  at: number;
  pitchErrors: number;
  octaveErrors: number;
}
export type AppMode = "staff" | "chords" | "scales" | "count";
export type Drill = "notes" | "intervals" | "chunks";

export interface ItemStat {
  attempts: number;
  correct: number;
  totalMs: number;
  recentMs: number[];
  lastWrong: number;
  cleanStreak: number;
  lastCleanAt: number;
  assisted: number;
  pitchErrors: number;
  octaveErrors: number;
  evidence: Evidence[];
  retainedAt: number[];
}

export interface RecentAnswer {
  ms: number;
  correct: boolean;
  area: "staff" | "chords" | "scales";
  skill?: Skill;
  outcome?: Outcome;
  assisted?: boolean;
  unaidedError?: boolean;
}

/** A run of practice. The new-shape cap resets after a few quiet hours. */
export interface IntroWindow {
  count: number;
  lastAt: number;
}

export interface Settings {
  app: AppMode;
  drill: Drill;
  tier: 1 | 2 | 3 | 4;
  adaptive: boolean;
  landmarks: boolean;
  exactOctave: boolean;
  mouseCompensation: boolean;
  muted: boolean;
  inputMode: "linear" | "letters";
  pianoLabelMode: "none" | "c-only" | "all";
  showKeyHints: boolean;
  intervalType: "harmonic" | "melodic" | "mixed";
  chunkLength: 3 | 4;
  flashSec: number;
  chordStage: number;
  introCap: number;
  scaleStage: number;
}

export interface Save {
  schema: 2;
  settings: Settings;
  notes: Record<string, ItemStat>;
  intervals: Record<string, ItemStat>;
  chords: Record<string, ItemStat>;
  scales: Record<string, ItemStat>;
  chunks: Record<string, ItemStat>;
  construction: Record<string, ItemStat>;
  rhythm: Record<string, ItemStat>;
  clefFlips: number;
  recent: RecentAnswer[];
  intro: IntroWindow | null;
  scaleIntro: IntroWindow | null;
}

export const STORAGE_KEY = "piano-practice:v1";
export const STAFF_LEGACY_KEY = "grandstaff_trainer_stats_v1";
/** Quiet gap after which new chord shapes may be introduced again. */
export const INTRO_GAP_MS = 4 * 60 * 60 * 1000;
export const RECALL_GAP_MS = INTRO_GAP_MS;
export const DAY_MS = 24 * 60 * 60 * 1000;
// These are conservative product thresholds, not a validated learning model.
export const PROGRESS_RULES = { clean: 5, accuracy: 0.85, retained: 2, spanMs: DAY_MS };

export const BUDGET: Record<Kind, { slow: number; mid: number; fast: number; green: number; amber: number }> = {
  note: { slow: 1800, mid: 1100, fast: 850, green: 1000, amber: 1800 },
  interval: { slow: 1800, mid: 1100, fast: 850, green: 1000, amber: 1800 },
  chunk: { slow: 2800, mid: 1800, fast: 1200, green: 1500, amber: 2800 },
  chord: { slow: 4500, mid: 2800, fast: 2000, green: 2500, amber: 4000 },
  // Scales are timed per note: run time (including the start) over the number of steps.
  scale: { slow: 1100, mid: 700, fast: 450, green: 500, amber: 900 },
};

/** Longest response stored as a time. Past this, a gap is one hard read. */
export const PRACTICE_CAP: Record<Kind, number> = {
  note: 6_000,
  interval: 6_000,
  chord: 12_000,
  chunk: 12_000,
  scale: 3_000,
};

const NOTE_REST = [0, 20_000, 60_000, 180_000, 600_000, 1_800_000];
const CHORD_REST = [0, 30_000, 120_000, 600_000, 3_600_000, 86_400_000, 259_200_000, 604_800_000];

export function emptyStat(): ItemStat {
  return { attempts: 0, correct: 0, totalMs: 0, recentMs: [], lastWrong: 0, cleanStreak: 0, lastCleanAt: 0, assisted: 0, pitchErrors: 0, octaveErrors: 0, evidence: [], retainedAt: [] };
}

export function defaultSettings(): Settings {
  return {
    app: "staff",
    drill: "notes",
    tier: 1,
    adaptive: true,
    landmarks: true,
    exactOctave: true,
    mouseCompensation: true,
    muted: false,
    inputMode: "linear",
    pianoLabelMode: "none",
    showKeyHints: false,
    intervalType: "mixed",
    chunkLength: 3,
    flashSec: 1.5,
    chordStage: 1,
    introCap: 8,
    scaleStage: 1,
  };
}

export function emptySave(): Save {
  return {
    schema: 2,
    settings: defaultSettings(),
    notes: {},
    intervals: {},
    chords: {},
    scales: {},
    chunks: {},
    construction: {},
    rhythm: {},
    clefFlips: 0,
    recent: [],
    intro: null,
    scaleIntro: null,
  };
}

/** Speed sample after a pause. The hit or miss is recorded separately. */
export function practiceMs(elapsedMs: number, kind: Kind): number {
  if (!Number.isFinite(elapsedMs)) return 0;
  return Math.min(Math.max(0, elapsedMs), PRACTICE_CAP[kind]);
}

/** How much of [since, until] overlaps the given spans. */
export function overlapMs(since: number, until: number, spans: readonly { start: number; end: number }[]): number {
  let total = 0;
  let endOfCovered = since;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    const start = Math.max(span.start, since, endOfCovered);
    const end = Math.min(span.end, until);
    if (end > start) { total += end - start; endOfCovered = end; }
  }
  return total;
}

export function averageMs(stat: ItemStat | undefined): number | null {
  if (!stat || stat.correct === 0) return null;
  const recent = stat.evidence.filter((row) => row.outcome === "correct" && !row.assisted).slice(-6);
  if (recent.length) return recent.reduce((sum, row) => sum + row.ms, 0) / recent.length;
  if (stat.recentMs.length > 0) return stat.recentMs.reduce((a, b) => a + b, 0) / stat.recentMs.length;
  return stat.totalMs / stat.correct;
}

export function restMs(kind: Kind, streak: number): number {
  const ladder = kind === "chord" || kind === "scale" ? CHORD_REST : NOTE_REST;
  const index = Math.min(Math.max(streak, 0), ladder.length - 1);
  return ladder[index]!;
}

/** How likely this item is to be asked next. Unseen and struggling items weigh more. */
export function itemWeight(stat: ItemStat | undefined, kind: Kind, adaptive: boolean, now: number): number {
  if (!adaptive) return 1;
  if (!stat || stat.attempts === 0) return 4;
  const budget = BUDGET[kind];
  const avg = averageMs(stat) ?? budget.slow;
  const err = 1 - stat.correct / Math.max(1, stat.attempts);
  let weight = 1;
  if (avg > budget.slow) weight += 4.5;
  else if (avg > budget.mid) weight += 2.2;
  else if (avg < budget.fast) weight *= 0.6;
  weight += err * 5;
  if (stat.lastWrong && now - stat.lastWrong < 60_000) weight += 2.5;
  const struggling = err > 0.25 || (stat.lastWrong > 0 && now - stat.lastWrong < 60_000);
  if (!struggling && stat.lastCleanAt && now - stat.lastCleanAt < restMs(kind, stat.cleanStreak)) weight *= 0.15;
  return Math.max(0.35, weight);
}

export function pickWeighted<T extends { id: string }>(
  items: readonly T[],
  statFor: (id: string) => ItemStat | undefined,
  kind: Kind,
  adaptive: boolean,
  excludeId: string | null,
  now: number,
  random: () => number = Math.random,
): T {
  const narrowed = items.length > 1 && excludeId ? items.filter((item) => item.id !== excludeId) : items;
  const pool = narrowed.length ? narrowed : items;
  const choice = pool[Math.floor(random() * pool.length)]!;
  if (!adaptive || pool.length === 1) return choice;
  const weights = pool.map((item) => itemWeight(statFor(item.id), kind, true, now));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = random() * total;
  for (let i = 0; i < pool.length; i++) {
    cursor -= weights[i]!;
    if (cursor <= 0) return pool[i]!;
  }
  return pool[pool.length - 1]!;
}

export function exposureCount(stat: ItemStat | undefined): number {
  return stat ? stat.attempts + stat.assisted : 0;
}

export function recentAccuracy(stat: ItemStat | undefined): number | null {
  const rows = stat?.evidence.filter((row) => !row.assisted || row.unaidedError) ?? [];
  return rows.length ? rows.filter((row) => row.outcome === "correct").length / rows.length : null;
}

export function recordOutcome(stat: ItemStat | undefined, outcome: Outcome, elapsedMs: number, now: number,
  details: { assisted?: boolean; unaidedError?: boolean; pitchErrors?: number; octaveErrors?: number } = {}): ItemStat {
  const next = stat ? { ...stat, recentMs: [...stat.recentMs], evidence: [...stat.evidence], retainedAt: [...stat.retainedAt] } : emptyStat();
  const assisted = details.assisted === true || outcome === "assisted";
  const previous = next.evidence.at(-1);
  if (assisted) next.assisted++;
  if (!assisted || details.unaidedError) next.attempts++;
  next.pitchErrors += details.pitchErrors ?? 0;
  next.octaveErrors += details.octaveErrors ?? 0;
  if (outcome === "correct" && !assisted) {
    next.correct++;
    next.totalMs += elapsedMs;
    next.recentMs = [...next.recentMs, elapsedMs].slice(-6);
    next.cleanStreak++;
    next.lastCleanAt = now;
    if (previous && now - previous.at >= RECALL_GAP_MS) next.retainedAt = [...next.retainedAt, now].slice(-6);
  } else {
    if (outcome === "incorrect") next.lastWrong = now;
    next.cleanStreak = 0;
  }
  next.evidence = [...next.evidence, { outcome, assisted, unaidedError: details.unaidedError === true, ms: elapsedMs, at: now,
    pitchErrors: details.pitchErrors ?? 0, octaveErrors: details.octaveErrors ?? 0 }].slice(-12);
  return next;
}

/** Compatibility helper for binary results and historical callers. */
export function recordAttempt(stat: ItemStat | undefined, correct: boolean, elapsedMs: number, now: number): ItemStat {
  return recordOutcome(stat, correct ? "correct" : "incorrect", elapsedMs, now);
}

export type ProgressState = "Unseen" | "Learning" | "Reliable" | "Fluent" | "Review due";
export function progressState(stat: ItemStat | undefined, kind: Kind, now = Date.now()): ProgressState {
  if (!stat || exposureCount(stat) === 0) return "Unseen";
  const clean = stat.evidence.filter((row) => row.outcome === "correct" && !row.assisted);
  const last = stat.evidence.at(-1);
  // Require fresh unaided evidence; old aggregate totals cannot establish retention.
  const retained = stat.retainedAt.filter((at) => now - at <= 30 * DAY_MS);
  const established = clean.length >= PROGRESS_RULES.clean &&
    (recentAccuracy(stat) ?? 0) >= PROGRESS_RULES.accuracy &&
    stat.cleanStreak >= 2 && last?.outcome === "correct" && !last.assisted &&
    retained.length >= PROGRESS_RULES.retained && retained.at(-1)! - retained[0]! >= PROGRESS_RULES.spanMs;
  if (!established) return "Learning";
  if (now - stat.lastCleanAt >= Math.max(DAY_MS, restMs(kind, stat.cleanStreak))) return "Review due";
  return (averageMs(stat) ?? Infinity) < BUDGET[kind].green ? "Fluent" : "Reliable";
}

export type HeatBand = "unseen" | "green" | "amber" | "rose";
export function heatBand(stat: ItemStat | undefined, kind: Kind, now = Date.now()): HeatBand {
  const state = progressState(stat, kind, now);
  if (state === "Unseen") return "unseen";
  if (state === "Fluent") return "green";
  if (state === "Reliable" || state === "Review due") return "amber";
  return "rose";
}

export function introCount(intro: IntroWindow | null, now: number, gap = INTRO_GAP_MS): number {
  if (!intro || now - intro.lastAt > gap) return 0;
  return intro.count;
}

export function noteIntroduction(intro: IntroWindow | null, now: number, gap = INTRO_GAP_MS): IntroWindow {
  return { count: introCount(intro, now, gap) + 1, lastAt: now };
}

export function touchIntro(intro: IntroWindow | null, now: number, gap = INTRO_GAP_MS): IntroWindow {
  return { count: introCount(intro, now, gap), lastAt: now };
}

function asStat(raw: unknown): ItemStat | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Partial<ItemStat>;
  if (typeof row.attempts !== "number") return undefined;
  return {
    attempts: row.attempts,
    correct: typeof row.correct === "number" ? row.correct : 0,
    totalMs: typeof row.totalMs === "number" ? row.totalMs : 0,
    recentMs: Array.isArray(row.recentMs) ? row.recentMs.filter((ms) => typeof ms === "number") : [],
    lastWrong: typeof row.lastWrong === "number" ? row.lastWrong : 0,
    cleanStreak: typeof row.cleanStreak === "number" ? row.cleanStreak : 0,
    lastCleanAt: typeof row.lastCleanAt === "number" ? row.lastCleanAt : 0,
    assisted: typeof row.assisted === "number" ? row.assisted : 0,
    pitchErrors: typeof row.pitchErrors === "number" ? row.pitchErrors : 0,
    octaveErrors: typeof row.octaveErrors === "number" ? row.octaveErrors : 0,
    evidence: Array.isArray(row.evidence) ? row.evidence.filter((e) => e &&
      ["correct", "incorrect", "assisted"].includes(e.outcome) && typeof e.assisted === "boolean" &&
      Number.isFinite(e.ms) && Number.isFinite(e.at)).slice(-12).map((e) => ({ ...e, unaidedError: e.unaidedError === true })) : [],
    retainedAt: Array.isArray(row.retainedAt) ? row.retainedAt.filter((at) => Number.isFinite(at)).slice(-6) : [],
  };
}

function mapStats(raw: unknown): Record<string, ItemStat> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, ItemStat> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const stat = asStat(value);
    if (stat) out[id] = stat;
  }
  return out;
}

/** GrandStaff stored notes and intervals before this app existed. Copy them once. */
export function migrateStaffStats(raw: unknown): Pick<Save, "notes" | "intervals" | "clefFlips" | "recent"> | null {
  if (!raw || typeof raw !== "object") return null;
  const legacy = raw as {
    notes?: unknown;
    intervals?: unknown;
    clefFlips?: unknown;
    recentSession?: { ms?: number; correct?: boolean }[];
  };
  const recent = Array.isArray(legacy.recentSession)
    ? legacy.recentSession
        .filter((row) => typeof row?.ms === "number" && typeof row?.correct === "boolean")
        .slice(-120)
        .map((row) => ({ ms: row.ms!, correct: row.correct!, area: "staff" as const }))
    : [];
  return {
    notes: mapStats(legacy.notes),
    intervals: mapStats(legacy.intervals),
    clefFlips: typeof legacy.clefFlips === "number" ? legacy.clefFlips : 0,
    recent,
  };
}

function readSettings(raw: unknown): Settings {
  const base = defaultSettings();
  if (!raw || typeof raw !== "object") return base;
  const row = raw as Partial<Settings>;
  return {
    ...base,
    ...row,
    tier: row.tier === 2 || row.tier === 3 || row.tier === 4 ? row.tier : 1,
    chordStage: typeof row.chordStage === "number" ? Math.min(21, Math.max(1, Math.round(row.chordStage))) : 1,
    introCap: typeof row.introCap === "number" ? Math.min(30, Math.max(1, Math.round(row.introCap))) : 8,
    chunkLength: row.chunkLength === 4 ? 4 : 3,
    flashSec: typeof row.flashSec === "number" ? Math.min(3, Math.max(0.8, row.flashSec)) : 1.5,
    scaleStage: typeof row.scaleStage === "number" ? Math.min(8, Math.max(1, Math.round(row.scaleStage))) : 1,
    app: row.app === "chords" || row.app === "scales" || row.app === "count" ? row.app : "staff",
    drill: row.drill === "intervals" || row.drill === "chunks" ? row.drill : "notes",
  };
}

function readIntro(raw: unknown): IntroWindow | null {
  const row = raw as Partial<IntroWindow> | null | undefined;
  return row && typeof row === "object" && typeof row.count === "number" && typeof row.lastAt === "number"
    ? { count: row.count, lastAt: row.lastAt }
    : null;
}

export function parseSave(raw: unknown): Save | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<Omit<Save, "schema">> & { schema?: number };
  if (row.schema !== 1 && row.schema !== 2) return null;
  return {
    schema: 2,
    settings: readSettings(row.settings),
    notes: mapStats(row.notes),
    intervals: mapStats(row.intervals),
    chords: mapStats(row.chords),
    scales: mapStats(row.scales),
    chunks: mapStats(row.chunks),
    construction: mapStats(row.construction),
    rhythm: mapStats(row.rhythm),
    clefFlips: typeof row.clefFlips === "number" ? row.clefFlips : 0,
    recent: Array.isArray(row.recent)
      ? row.recent.filter((item) => item && typeof item.ms === "number" && typeof item.correct === "boolean").slice(-120)
      : [],
    intro: readIntro(row.intro),
    scaleIntro: readIntro(row.scaleIntro),
  };
}

export function loadSave(): Save {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? parseSave(JSON.parse(raw)) : null;
    if (parsed) return parsed;
  } catch {
    /* fall through and start from the GrandStaff stats, if any */
  }
  const save = emptySave();
  try {
    const legacy = localStorage.getItem(STAFF_LEGACY_KEY);
    const migrated = legacy ? migrateStaffStats(JSON.parse(legacy)) : null;
    if (migrated) {
      save.notes = migrated.notes;
      save.intervals = migrated.intervals;
      save.clefFlips = migrated.clefFlips;
      save.recent = migrated.recent;
    }
  } catch {
    /* keep the empty save */
  }
  return save;
}

export function writeSave(save: Save): void {
  try {
    const old = localStorage.getItem(STORAGE_KEY);
    if (old && !localStorage.getItem("piano-practice:before-v2")) {
      try { if (JSON.parse(old).schema === 1) localStorage.setItem("piano-practice:before-v2", old); } catch { /* malformed old save */ }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
  } catch (error) {
    console.warn("Could not save progress", error);
  }
}

export function remember(save: Save, skill: Skill, outcome: Outcome, ms: number, assisted = false, unaidedError = false): void {
  const area: RecentAnswer["area"] = skill === "chords" || skill === "construction" ? "chords" : skill === "scales" ? "scales" : "staff";
  save.recent = [...save.recent, { ms, correct: outcome === "correct" && !assisted, area, skill, outcome, assisted, unaidedError }].slice(-120);
}
