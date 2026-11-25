// One memory for every drill. A note, an interval, and a chord shape share
// the same record. MIDI (or a tap) writes the outcome. Nothing here asks for
// an Again / Hard / Good / Easy grade.
//
// Fluent items rest, then return. The rest is short for reading and longer
// for chords. A miss clears the rest. Progress lives in localStorage.

export type Kind = "note" | "interval" | "chord";
export type AppMode = "staff" | "chords" | "count";
export type Drill = "notes" | "intervals" | "chunks";

export interface ItemStat {
  attempts: number;
  correct: number;
  totalMs: number;
  recentMs: number[];
  lastWrong: number;
  cleanStreak: number;
  lastCleanAt: number;
}

export interface RecentAnswer {
  ms: number;
  correct: boolean;
  area: "staff" | "chords";
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
}

export interface Save {
  schema: 1;
  settings: Settings;
  notes: Record<string, ItemStat>;
  intervals: Record<string, ItemStat>;
  chords: Record<string, ItemStat>;
  clefFlips: number;
  recent: RecentAnswer[];
  intro: IntroWindow | null;
}

export const STORAGE_KEY = "piano-practice:v1";
export const STAFF_LEGACY_KEY = "grandstaff_trainer_stats_v1";
/** Quiet gap after which new chord shapes may be introduced again. */
export const INTRO_GAP_MS = 4 * 60 * 60 * 1000;

export const BUDGET: Record<Kind, { slow: number; mid: number; fast: number; green: number; amber: number }> = {
  note: { slow: 1800, mid: 1100, fast: 850, green: 1000, amber: 1800 },
  interval: { slow: 1800, mid: 1100, fast: 850, green: 1000, amber: 1800 },
  chord: { slow: 4500, mid: 2800, fast: 2000, green: 2500, amber: 4000 },
};

/** Longest response stored as a time. Past this, a gap is one hard read. */
export const PRACTICE_CAP: Record<Kind, number> = {
  note: 6_000,
  interval: 6_000,
  chord: 12_000,
};

const NOTE_REST = [0, 20_000, 60_000, 180_000, 600_000, 1_800_000];
const CHORD_REST = [0, 30_000, 120_000, 600_000, 3_600_000, 86_400_000, 259_200_000, 604_800_000];

export function emptyStat(): ItemStat {
  return { attempts: 0, correct: 0, totalMs: 0, recentMs: [], lastWrong: 0, cleanStreak: 0, lastCleanAt: 0 };
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
  };
}

export function emptySave(): Save {
  return {
    schema: 1,
    settings: defaultSettings(),
    notes: {},
    intervals: {},
    chords: {},
    clefFlips: 0,
    recent: [],
    intro: null,
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
  for (const span of spans) {
    const start = Math.max(span.start, since);
    const end = Math.min(span.end, until);
    if (end > start) total += end - start;
  }
  return total;
}

export function averageMs(stat: ItemStat | undefined): number | null {
  if (!stat || stat.correct === 0) return null;
  if (stat.recentMs.length > 0) return stat.recentMs.reduce((a, b) => a + b, 0) / stat.recentMs.length;
  return stat.totalMs / stat.correct;
}

export function restMs(kind: Kind, streak: number): number {
  const ladder = kind === "chord" ? CHORD_REST : NOTE_REST;
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

export function recordAttempt(stat: ItemStat | undefined, correct: boolean, elapsedMs: number, now: number): ItemStat {
  const next = stat ? { ...stat, recentMs: [...stat.recentMs] } : emptyStat();
  next.attempts++;
  if (correct) {
    next.correct++;
    next.totalMs += elapsedMs;
    next.recentMs = [...next.recentMs, elapsedMs].slice(-6);
    next.cleanStreak++;
    next.lastCleanAt = now;
  } else {
    next.lastWrong = now;
    next.cleanStreak = 0;
  }
  return next;
}

export function isMastered(stat: ItemStat | undefined, kind: Kind): boolean {
  const avg = averageMs(stat);
  if (!stat || avg === null || stat.attempts === 0) return false;
  return avg < BUDGET[kind].green && stat.correct / stat.attempts >= 0.85;
}

export type HeatBand = "unseen" | "green" | "amber" | "rose";

export function heatBand(stat: ItemStat | undefined, kind: Kind): HeatBand {
  const avg = averageMs(stat);
  if (!stat || stat.attempts === 0 || avg === null) return stat && stat.attempts > 0 ? "rose" : "unseen";
  const budget = BUDGET[kind];
  if (avg < budget.green) return "green";
  if (avg < budget.amber) return "amber";
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
        .slice(-30)
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
    app: row.app === "chords" || row.app === "count" ? row.app : "staff",
    drill: row.drill === "intervals" || row.drill === "chunks" ? row.drill : "notes",
  };
}

export function parseSave(raw: unknown): Save | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<Save>;
  if (row.schema !== 1) return null;
  return {
    schema: 1,
    settings: readSettings(row.settings),
    notes: mapStats(row.notes),
    intervals: mapStats(row.intervals),
    chords: mapStats(row.chords),
    clefFlips: typeof row.clefFlips === "number" ? row.clefFlips : 0,
    recent: Array.isArray(row.recent)
      ? row.recent.filter((item) => item && typeof item.ms === "number" && typeof item.correct === "boolean").slice(-30)
      : [],
    intro: row.intro && typeof row.intro === "object" && typeof row.intro.count === "number" && typeof row.intro.lastAt === "number"
      ? { count: row.intro.count, lastAt: row.intro.lastAt }
      : null,
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
  } catch (error) {
    console.warn("Could not save progress", error);
  }
}

export function remember(save: Save, area: RecentAnswer["area"], correct: boolean, ms: number): void {
  save.recent = [...save.recent, { ms, correct, area }].slice(-30);
}
