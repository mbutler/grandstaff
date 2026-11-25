import { beforeAll, describe, expect, test } from "bun:test";
import { generateDeck } from "../src/deck/generate";
import {
  emptyStat, introCount, itemWeight, migrateStaffStats, noteIntroduction, overlapMs, practiceMs, recordAttempt, restMs,
} from "../src/adapt/memory";
import { judgeGrip } from "../src/chords/grip";
import { chordPool } from "../src/chords/pool";
import type { ChordCard } from "../src/types";

beforeAll(() => {
  const mem = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => void mem.set(key, value),
    removeItem: (key: string) => void mem.delete(key),
    clear: () => mem.clear(),
    key: (index: number) => [...mem.keys()][index] ?? null,
    get length() { return mem.size; },
  } as Storage;
});

const deck = generateDeck().cards;
const cMajor = deck.find((card) => card.id === "t1_c_maj_root") as ChordCard;
const grip = cMajor.inversions[0]!.midi;

describe("grip", () => {
  test("a partial chord is still pending and the written shape matches", () => {
    expect(judgeGrip(grip.slice(0, 2), grip, true)).toBe("pending");
    expect(judgeGrip(grip, grip, true)).toBe("match");
  });

  test("the same shape an octave up is a hint when exact octave is on", () => {
    expect(judgeGrip(grip.map((note) => note + 12), grip, true)).toBe("octave");
    expect(judgeGrip(grip.map((note) => note + 12), grip, false)).toBe("match");
  });

  test("a wrong pitch is a miss", () => {
    expect(judgeGrip([grip[0]! + 1], grip, true)).toBe("miss");
  });
});

describe("memory", () => {
  test("unseen items are preferred and a clean run rests", () => {
    expect(itemWeight(undefined, "chord", true, 1_000)).toBe(4);
    const fast = recordAttempt(undefined, true, 400, 1_000);
    fast.cleanStreak = 3;
    fast.lastCleanAt = 1_000;
    const rested = itemWeight(fast, "note", true, 1_000 + 1000);
    const fresh = itemWeight({ ...fast, lastCleanAt: 0, cleanStreak: 0 }, "note", true, 1_000);
    expect(rested).toBeLessThan(fresh);
    expect(restMs("chord", 5)).toBeGreaterThan(restMs("note", 5));
  });

  test("a long pause is stored as one hard read", () => {
    expect(practiceMs(1_400, "note")).toBe(1_400);
    expect(practiceMs(5 * 60_000, "note")).toBe(6_000);
    expect(practiceMs(5 * 60_000, "interval")).toBe(6_000);
    expect(practiceMs(20_000, "chord")).toBe(12_000);
    expect(practiceMs(Number.NaN, "note")).toBe(0);
    const stat = recordAttempt(undefined, true, practiceMs(5 * 60_000, "note"), 1_000);
    expect(stat.recentMs).toEqual([6_000]);
    expect(stat.cleanStreak).toBe(1);
  });

  test("time in the background is left out of the answer", () => {
    expect(overlapMs(0, 10_000, [{ start: 2_000, end: 5_000 }])).toBe(3_000);
    expect(overlapMs(4_000, 9_000, [{ start: 2_000, end: 5_000 }, { start: 8_000, end: 12_000 }])).toBe(2_000);
    expect(overlapMs(0, 1_000, [{ start: 2_000, end: 3_000 }])).toBe(0);
  });

  test("a miss clears the streak and a quiet gap resets new shapes", () => {
    const missed = recordAttempt(recordAttempt(undefined, true, 500, 1_000), false, 800, 2_000);
    expect(missed.cleanStreak).toBe(0);
    expect(missed.lastWrong).toBe(2_000);
    const intro = noteIntroduction(null, 0);
    expect(introCount(intro, 1_000)).toBe(1);
    expect(introCount(intro, 5 * 60 * 60 * 1000)).toBe(0);
  });

  test("grandstaff stats migrate", () => {
    const migrated = migrateStaffStats({
      notes: { C4_treble: { attempts: 4, correct: 3, totalMs: 2400, recentMs: [700], lastWrong: 0 } },
      intervals: { "5": { attempts: 2, correct: 2, totalMs: 1800 } },
      clefFlips: 3,
      recentSession: [{ ms: 500, correct: true }],
    });
    expect(migrated?.notes.C4_treble?.recentMs).toEqual([700]);
    expect(migrated?.clefFlips).toBe(3);
    expect(migrated?.recent[0]?.area).toBe("staff");
  });
});

describe("chord pool", () => {
  test("stage 1 offers only the first unmet shape", () => {
    const pool = chordPool(deck, 1, {}, 0, 8);
    expect(pool.map((card) => card.id)).toEqual(["t1_c_maj_root"]);
  });

  test("after that shape is met, the next one joins and the cap can hold the frontier back", () => {
    const stats = { t1_c_maj_root: { ...emptyStat(), attempts: 1 } };
    expect(chordPool(deck, 1, stats, 1, 8).map((card) => card.id)).toEqual(["t1_c_maj_root", "t1_g_maj_root"]);
    expect(chordPool(deck, 1, stats, 8, 8).map((card) => card.id)).toEqual(["t1_c_maj_root"]);
  });

  test("a higher stage does not skip an unmet earlier shape", () => {
    const pool = chordPool(deck, 5, {}, 0, 8);
    expect(pool[0]!.id).toBe("t1_c_maj_root");
    expect(pool).toHaveLength(1);
  });
});
