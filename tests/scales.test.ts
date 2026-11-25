import { expect, test } from "bun:test";
import { CHOPIN_MAJOR_ORDER, SCALES, spell } from "../src/scales/catalog";
import { ScaleInput } from "../src/scales/input";
import { chordPool } from "../src/chords/pool";
import { emptyStat, parseSave, emptySave } from "../src/adapt/memory";

test("majors follow Chopin's order: black-key scales first, C last", () => {
  expect(CHOPIN_MAJOR_ORDER).toEqual(["B", "Db", "F#", "E", "A", "D", "G", "Ab", "Eb", "Bb", "F", "C"]);
  const firstStage = SCALES.filter((s) => s.level === 1).map((s) => s.id);
  expect(firstStage).toEqual(["sc_b_maj_rh", "sc_b_maj_lh", "sc_db_maj_rh", "sc_db_maj_lh", "sc_fs_maj_rh", "sc_fs_maj_lh"]);
  expect(SCALES.find((s) => s.id === "sc_c_maj_rh")!.level).toBe(4);
  expect(SCALES.find((s) => s.id === "sc_c_maj_both")!.level).toBe(6);
  expect(SCALES).toHaveLength(72);
  expect(new Set(SCALES.map((s) => s.id)).size).toBe(72);
});

test("every scale names each letter once and goes up and back", () => {
  expect(spell("F#", [0, 2, 4, 5, 7, 9, 11])).toEqual(["F#", "G#", "A#", "B", "C#", "D#", "E#"]);
  expect(spell("D#", [0, 2, 3, 5, 7, 9, 11])).toEqual(["D#", "E#", "F#", "G#", "A#", "B#", "C##"]);
  for (const scale of SCALES) {
    expect(scale.steps).toHaveLength(15);
    expect(new Set(scale.names.slice(0, 7).map((n) => n[0])).size).toBe(7);
    expect(scale.steps[0]).toEqual(scale.steps[14]!);
    expect(scale.steps[7]!.map((m) => m - 12)).toEqual(scale.steps[0]!);
  }
});

test("melodic minor rises with raised 6 and 7 and falls as natural minor", () => {
  const a = SCALES.find((s) => s.id === "sc_a_mel_rh")!;
  expect(a.names.join(" ")).toBe("A B C D E F# G# A G F E D C B A");
  expect(a.steps.flat()).toEqual([69, 71, 72, 74, 76, 78, 80, 81, 79, 77, 76, 74, 72, 71, 69]);
  const both = SCALES.find((s) => s.id === "sc_a_mel_both")!;
  expect(both.steps[0]).toEqual([57, 69]);
});

test("fingering is shown for majors only, matching each hand", () => {
  const b = SCALES.find((s) => s.id === "sc_b_maj_both")!;
  expect(b.fingering).toEqual({ rh: "1 2 3 1 2 3 4 5 4 3 2 1 3 2 1", lh: "4 3 2 1 4 3 2 1 2 3 4 1 2 3 4" });
  expect(SCALES.find((s) => s.id === "sc_db_maj_lh")!.fingering).toEqual({ lh: "3 2 1 4 3 2 1 3 1 2 3 4 1 2 3" });
  expect(SCALES.find((s) => s.id === "sc_e_mel_rh")!.fingering).toBeNull();
});

test("a wrong note is a miss without restarting; pairs accept either order", () => {
  const input = new ScaleInput();
  input.begin([[60], [62], [64]]);
  expect(input.input(60, true)).toBe("step");
  expect(input.input(63, true)).toBe("miss");
  expect(input.input(74, true)).toBe("octave");
  expect(input.input(62, true)).toBe("step");
  expect(input.input(64, true)).toBe("done");
  expect(input.input(60, true)).toBe("ignored");

  input.begin([[48, 60], [50, 62]]);
  expect(input.input(60, true)).toBe("pending");
  expect(input.input(60, true)).toBe("ignored");
  expect(input.input(48, true)).toBe("step");
  expect(input.input(50, false)).toBe("pending");
  expect(input.input(74, false)).toBe("done");
});

test("the scale pool opens one new scale at a time inside the stage", () => {
  const pool = chordPool(SCALES, 1, {}, 0, 4);
  expect(pool.map((s) => s.id)).toEqual(["sc_b_maj_rh"]);
  const met = { sc_b_maj_rh: { ...emptyStat(), attempts: 1 } };
  expect(chordPool(SCALES, 1, met, 1, 4).map((s) => s.id)).toEqual(["sc_b_maj_rh", "sc_b_maj_lh"]);
  expect(chordPool(SCALES, 1, met, 4, 4).map((s) => s.id)).toEqual(["sc_b_maj_rh"]);
});

test("old saves gain an empty scales bucket and stage 1", () => {
  const old = emptySave() as Partial<ReturnType<typeof emptySave>>;
  delete old.scales; delete old.scaleIntro;
  const parsed = parseSave(JSON.parse(JSON.stringify(old)))!;
  expect(parsed.scales).toEqual({});
  expect(parsed.scaleIntro).toBeNull();
  expect(parsed.settings.scaleStage).toBe(1);
});
