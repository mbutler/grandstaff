import { describe, expect, test } from "bun:test";
import { Attempt } from "../src/adapt/attempt";
import { ChordInput, bassPitchClass } from "../src/chords/input";
import { chordPool } from "../src/chords/pool";
import { generateDeck } from "../src/deck/generate";
import {
  DAY_MS, emptySave, heatBand, parseSave, progressState, recordAttempt, recordOutcome, recentAccuracy,
} from "../src/adapt/memory";

const start = 1_800_000_000_000;

describe("learning evidence", () => {
  test("a single quick success is learning, and low accuracy never turns green", () => {
    let stat = recordAttempt(undefined, true, 500, start);
    expect(progressState(stat, "note", start)).toBe("Learning");
    expect(heatBand(stat, "note", start)).toBe("rose");
    for (let i = 0; i < 3; i++) stat = recordAttempt(stat, false, 2000, start + i + 1);
    stat = recordAttempt(stat, true, 500, start + 5);
    expect(heatBand(stat, "note", start + 5)).toBe("rose");
  });
  test("same-sitting repetition cannot establish fluency", () => {
    let stat;
    for (let i = 0; i < 100; i++) stat = recordAttempt(stat, true, 500, start + i * 1000);
    expect(progressState(stat, "note", start + 100000)).toBe("Learning");
  });
  test("delayed accurate recall establishes reliability; speed and recency are separate", () => {
    let stat;
    for (let day = 0; day < 3; day++) for (let i = 0; i < 2; i++) {
      stat = recordAttempt(stat, true, 1800, start + day * DAY_MS + i * 1000);
    }
    const now = start + 2 * DAY_MS + 2000;
    expect(progressState(stat, "note", now)).toBe("Reliable");
    for (let i = 0; i < 6; i++) stat = recordAttempt(stat, true, 500, now + i * 1000);
    expect(progressState(stat, "note", now + 6000)).toBe("Fluent");
    expect(progressState(stat, "note", now + 2 * DAY_MS)).toBe("Review due");
    stat = recordOutcome(stat, "assisted", 500, now + 2 * DAY_MS);
    expect(progressState(stat, "note", now + 2 * DAY_MS)).toBe("Learning");
  });
  test("a failed delayed recall followed by corrections does not prove retention", () => {
    let stat = recordAttempt(undefined, true, 500, start);
    for (let day = 1; day < 4; day++) {
      stat = recordAttempt(stat, false, 500, start + day * DAY_MS);
      for (let i = 1; i < 8; i++) stat = recordAttempt(stat, true, 500, start + day * DAY_MS + i * 1000);
    }
    expect(stat.retainedAt).toHaveLength(0);
    expect(progressState(stat, "note", start + 3 * DAY_MS + 10000)).toBe("Learning");
  });
  test("guidance records exposure without hurting recall accuracy or erasing corrections", () => {
    const attempt = new Attempt(true);
    attempt.miss("octave");
    attempt.miss("pitch");
    expect(attempt.outcome).toBe("incorrect");
    const stat = recordOutcome(undefined, attempt.outcome, 900, start, attempt);
    expect(stat.attempts).toBe(0);
    expect(stat.assisted).toBe(1);
    expect(stat.octaveErrors).toBe(1);
    expect(stat.pitchErrors).toBe(1);
    expect(recentAccuracy(stat)).toBeNull();
    expect(stat.evidence[0]?.outcome).toBe("incorrect");
    const deck = generateDeck().cards;
    expect(chordPool(deck, 1, { t1_c_maj_root: stat }, 1, 8).map(c => c.id)).toEqual(["t1_c_maj_root", "t1_g_maj_root"]);
  });
  test("a correction or later peek cannot overwrite an error", () => {
    const attempt = new Attempt();
    attempt.miss("octave");
    attempt.help();
    expect(attempt.outcome).toBe("incorrect");
    expect(attempt.assisted).toBe(true);
  });
  test("v1 imports preserve totals without inventing evidence or attributing mixed history to chunks", () => {
    const raw = { schema: 1, notes: { C4_treble: { attempts: 100, correct: 99, totalMs: 49500, recentMs: [500], cleanStreak: 99, lastCleanAt: start } },
      chords: { t1_c_maj_root: { attempts: 12, correct: 10 } }, recent: [{ ms: 500, correct: true, area: "staff" }] };
    const migrated = parseSave(raw)!;
    expect(migrated.schema).toBe(2);
    expect(migrated.notes.C4_treble?.correct).toBe(99);
    expect(migrated.chords.t1_c_maj_root?.attempts).toBe(12);
    expect(migrated.chunks).toEqual({});
    expect(migrated.recent[0]?.skill).toBeUndefined();
    expect(progressState(migrated.notes.C4_treble, "note", start)).toBe("Learning");
    const roundtrip = parseSave(JSON.parse(JSON.stringify(migrated)));
    expect(roundtrip).toEqual(migrated);
    expect(parseSave({ schema: 99 })).toBeNull();
  });
  test("v2 roundtrips separate evidence and reserved skill buckets", () => {
    const save = emptySave();
    save.chunks['treble:3'] = recordOutcome(undefined, "assisted", 2000, start);
    save.notes.C4_treble = recordAttempt(undefined, true, 500, start);
    expect(parseSave(JSON.parse(JSON.stringify(save)))).toEqual(save);
  });
});

describe("physical chord changes", () => {
  test("C to F to G to C keeps common tones and accepts arrivals before releases", () => {
    const input = new ChordInput();
    input.begin([60, 64, 67], "C");
    expect(input.input(60, true, true)).toBe("pending");
    expect(input.input(64, true, true)).toBe("pending");
    expect(input.input(67, true, true)).toBe("match");
    input.begin([60, 65, 69], "F");
    expect(input.input(65, true, true)).toBe("pending");
    expect(input.input(69, true, true)).toBe("pending");
    expect(input.input(64, false, true)).toBe("pending");
    expect(input.input(67, false, true)).toBe("match");
    expect(input.held.has(60)).toBe(true);
    input.begin([59, 62, 67], "G");
    for (const n of [60, 65, 69]) expect(input.input(n, false, true)).toBe("pending");
    input.input(59, true, true); input.input(62, true, true);
    expect(input.input(67, true, true)).toBe("match");
    input.begin([60, 64, 67], "C");
    input.input(59, false, true); input.input(62, false, true);
    input.input(60, true, true);
    expect(input.input(64, true, true)).toBe("match");
    expect(input.held.has(67)).toBe(true);
  });
  test("a fresh wrong pitch during a change is an error, not a tolerated old voice", () => {
    const input = new ChordInput();
    input.begin([60, 64, 67], "C");
    for (const n of [60, 64, 67]) input.input(n, true, true);
    input.begin([60, 65, 69], "F");
    expect(input.input(66, true, true)).toBe("miss");
    expect(input.input(66, false, true)).toBe("pending");
  });
  test("rootless C7 accepts its LH root; slash chords accept only the specified bass", () => {
    const input = new ChordInput();
    input.begin([58, 64, 67], "C7");
    expect(input.input(48, true, true)).toBe("pending");
    input.input(58, true, true); input.input(64, true, true);
    expect(input.input(67, true, true)).toBe("match");
    input.clear(); input.begin([59, 62, 67], "G/B");
    expect(input.input(47, true, true)).toBe("pending");
    input.input(43, true, true);
    input.input(59, true, true); input.input(62, true, true);
    expect(input.input(67, true, true)).toBe("miss");
    expect(bassPitchClass("C#/E#")).toBe(5);
  });
  test("a repeated identical chord requires rearticulation", () => {
    const input = new ChordInput();
    input.begin([60, 64, 67], "C");
    for (const n of [60, 64, 67]) input.input(n, true, true);
    input.begin([60, 64, 67], "C");
    expect(input.input(67, true, true)).toBe("pending");
    expect(input.input(67, false, true)).toBe("pending");
    expect(input.input(67, true, true)).toBe("match");
  });
  test("a rolled octave-shifted shape is classified as an octave error", () => {
    const input = new ChordInput();
    input.begin([60, 64, 67], "C");
    expect(input.input(72, true, true)).toBe("pending");
    expect(input.input(76, true, true)).toBe("pending");
    expect(input.input(79, true, true)).toBe("octave");
  });
});

test("overlapping interruptions exclude time only once", async () => {
  const { overlapMs } = await import('../src/adapt/memory');
  expect(overlapMs(0, 10000, [{ start: 2000, end: 8000 }, { start: 4000, end: 9000 }])).toBe(7000);
});
