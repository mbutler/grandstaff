// Scales in Chopin's teaching order: the black-key majors first (B, Db, F#),
// because long fingers fall on black keys and the thumb only meets white ones.
// Then the sharp keys toward fewer black keys (E, A, D, G), the flat keys
// (Ab, Eb, Bb, F), and C major last: no black keys to anchor the hand.
// Each hand is learned alone before hands together. Melodic minor follows,
// with each minor key next to its relative major in the same order.
//
// One item is one octave up and back, one hand (or both), from memory.

export type ScaleType = "major" | "melodic";
export type ScaleHand = "rh" | "lh" | "both";

export interface ScaleItem {
  id: string;
  level: number;
  sequence: number;
  tonic: string;
  type: ScaleType;
  hand: ScaleHand;
  title: string;        // "B major", "G# melodic minor"
  handLabel: string;    // "Right hand"
  steps: number[][];    // each step: the MIDI keys to play (two for hands together)
  names: string[];      // spelled note name per step
  fingering: { rh?: string; lh?: string } | null;
  hint: string;
}

export const SCALE_STAGES: Record<number, string> = {
  1: "B, D♭, F♯ major · hands separately",
  2: "E, A, D, G major · hands separately",
  3: "A♭, E♭, B♭, F major · hands separately",
  4: "C major · hands separately",
  5: "Black-key and sharp majors · hands together",
  6: "Flat majors and C · hands together",
  7: "Melodic minor · hands separately",
  8: "Melodic minor · hands together",
};
export const SCALE_STAGE_COUNT = 8;

const GROUPS = [
  { keys: ["B", "Db", "F#"], level: 1 },
  { keys: ["E", "A", "D", "G"], level: 2 },
  { keys: ["Ab", "Eb", "Bb", "F"], level: 3 },
  { keys: ["C"], level: 4 },
];
export const CHOPIN_MAJOR_ORDER = GROUPS.flatMap((group) => group.keys);
/** Relative minors of the Chopin order (G# is the relative of B, and so on). */
const RELATIVE_MINOR: Record<string, string> = {
  B: "G#", Db: "Bb", "F#": "D#", E: "C#", A: "F#", D: "B", G: "E", Ab: "F", Eb: "C", Bb: "G", F: "D", C: "A",
};

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MELODIC_UP = [0, 2, 3, 5, 7, 9, 11];
const NATURAL_DOWN = [0, 2, 3, 5, 7, 8, 10];

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const ACCIDENTAL: Record<number, string> = { [-2]: "bb", [-1]: "b", 0: "", 1: "#", 2: "##" };

export function pitchClass(name: string): number {
  const letter = LETTERS.indexOf(name[0]!);
  const shift = [...name.slice(1)].reduce((sum, char) => sum + (char === "#" ? 1 : char === "b" ? -1 : 0), 0);
  return (LETTER_PC[letter]! + shift + 12) % 12;
}

/** Spell each degree on consecutive letters, so every scale names all seven letters. */
export function spell(tonic: string, semitones: readonly number[]): string[] {
  const start = LETTERS.indexOf(tonic[0]!);
  const root = pitchClass(tonic);
  return semitones.map((semi, degree) => {
    const letter = (start + degree) % 7;
    const offset = ((root + semi - LETTER_PC[letter]! + 18) % 12) - 6;
    return LETTERS[letter]! + ACCIDENTAL[offset];
  });
}

// Standard one-octave fingerings, ascending. Descending reverses them.
const RH_FINGERS: Record<string, string> = {
  C: "12312345", G: "12312345", D: "12312345", A: "12312345", E: "12312345", B: "12312345",
  "F#": "23412312", Db: "23123412", Ab: "34123123", Eb: "31234123", Bb: "21231234", F: "12341234",
};
const LH_FINGERS: Record<string, string> = {
  C: "54321321", G: "54321321", D: "54321321", A: "54321321", E: "54321321", F: "54321321",
  B: "43214321", "F#": "43213214", Db: "32143213", Ab: "32143213", Eb: "32143213", Bb: "32143213",
};

function upAndBack(fingers: string): string {
  const up = [...fingers];
  return [...up, ...up.slice(0, -1).reverse()].join(" ");
}

const HAND_LABEL: Record<ScaleHand, string> = { rh: "Right hand", lh: "Left hand", both: "Hands together" };
const slug = (note: string) => note.toLowerCase().replace(/#/g, "s");

function whiteKeys(names: readonly string[], midis: readonly number[]): string[] {
  const black = new Set([1, 3, 6, 8, 10]);
  return names.filter((_, i) => !black.has(midis[i]! % 12));
}

function majorHint(tonic: string, level: number, names: string[], midis: number[]): string {
  if (level === 1) {
    return `The long fingers sit on the black keys. Thumbs land only on the white keys (${whiteKeys(names, midis).join(" and ")}), so each hand moves between two positions.`;
  }
  if (level === 2) return "The same two-position pattern as B major, with more white keys. Cross the thumb under right after the third finger, then after the fourth.";
  if (level === 3) {
    return tonic === "F"
      ? "The left hand plays like C major; the right hand crosses after the fourth finger to clear B♭."
      : "The flat keys mirror the sharp keys. Start on a finger, not the thumb; the right thumb lands on C and F.";
  }
  return "All white keys, so nothing guides the hand. Angle the hand slightly inward, let idle fingers lean the way you're going, and tuck the thumb under as soon as the previous key is up.";
}

function build(tonic: string, type: ScaleType, hand: ScaleHand, level: number, sequence: number, hint: string): ScaleItem {
  const up = type === "major" ? MAJOR : MELODIC_UP;
  const down = type === "major" ? MAJOR : NATURAL_DOWN;
  const upNames = spell(tonic, up);
  const downNames = spell(tonic, down);
  const rhRoot = 60 + pitchClass(tonic);
  const back = [6, 5, 4, 3, 2, 1, 0];
  // Up through the octave, then back from the seventh degree to the tonic.
  const rh = [...up.map((s) => rhRoot + s), rhRoot + 12, ...back.map((d) => rhRoot + down[d]!)];
  const names = [...upNames, tonic, ...back.map((d) => downNames[d]!)];
  const steps = rh.map((midi) => hand === "rh" ? [midi] : hand === "lh" ? [midi - 12] : [midi - 12, midi]);
  const fingering = type === "major" ? {
    ...(hand !== "lh" ? { rh: upAndBack(RH_FINGERS[tonic]!) } : {}),
    ...(hand !== "rh" ? { lh: upAndBack(LH_FINGERS[tonic]!) } : {}),
  } : null;
  const title = type === "major" ? `${tonic} major` : `${tonic} melodic minor`;
  return {
    id: `sc_${slug(tonic)}_${type === "major" ? "maj" : "mel"}_${hand}`,
    level, sequence, tonic, type, hand, title, handLabel: HAND_LABEL[hand], steps, names, fingering,
    hint: hand === "both" ? `${hint} Left hand an octave below; play each pair of notes together.` : hint,
  };
}

export function scaleCatalog(): ScaleItem[] {
  const items: ScaleItem[] = [];
  CHOPIN_MAJOR_ORDER.forEach((tonic, order) => {
    const level = GROUPS.find((group) => group.keys.includes(tonic))!.level;
    const rootMidi = 60 + pitchClass(tonic);
    const names = spell(tonic, MAJOR);
    const hint = majorHint(tonic, level, names, MAJOR.map((s) => rootMidi + s));
    items.push(build(tonic, "major", "rh", level, order * 10, hint));
    items.push(build(tonic, "major", "lh", level, order * 10 + 1, hint));
    items.push(build(tonic, "major", "both", level <= 2 ? 5 : 6, order * 10 + 2, hint));
    const minor = RELATIVE_MINOR[tonic]!;
    const minorHint = `Going up, a major scale with a lowered third. Coming down, the sixth and seventh drop too: the same notes as ${tonic} major.`;
    items.push(build(minor, "melodic", "rh", 7, order * 10, minorHint));
    items.push(build(minor, "melodic", "lh", 7, order * 10 + 1, minorHint));
    items.push(build(minor, "melodic", "both", 8, order * 10 + 2, minorHint));
  });
  return items;
}

export const SCALES = scaleCatalog();
