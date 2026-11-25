// Natural notes on the grand staff. Same catalog the GrandStaff trainer used:
// 18 treble notes (B3–E6) and 18 bass notes (A1–D4).

export interface StaffNote {
  id: string;
  label: string;
  letter: string;
  octave: number;
  d: number;
  midi: number;
  clef: "treble" | "bass";
}

export const LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;
const SEMI_FROM_C: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function makeNote(letter: string, octave: number, clef: "treble" | "bass"): StaffNote {
  const idx = LETTERS.indexOf(letter as (typeof LETTERS)[number]);
  const d = octave * 7 + idx;
  const midi = (octave + 1) * 12 + SEMI_FROM_C[letter]!;
  return { id: `${letter}${octave}_${clef}`, label: `${letter}${octave}`, letter, octave, d, midi, clef };
}

function buildCatalog(): { treble: StaffNote[]; bass: StaffNote[]; all: StaffNote[] } {
  const treble: StaffNote[] = [];
  const bass: StaffNote[] = [];
  for (let d = 27; d <= 44; d++) treble.push(makeNote(LETTERS[d % 7]!, Math.floor(d / 7), "treble"));
  for (let d = 12; d <= 29; d++) bass.push(makeNote(LETTERS[d % 7]!, Math.floor(d / 7), "bass"));
  return { treble, bass, all: [...bass, ...treble] };
}

export const CATALOG = buildCatalog();

const TIER_1_IDS = new Set([
  "C3_bass", "D3_bass", "E3_bass", "F3_bass", "G3_bass", "B3_bass", "C4_bass",
  "C4_treble", "D4_treble", "F4_treble", "G4_treble", "A4_treble", "B4_treble", "C5_treble", "D5_treble",
]);

export function notesForTier(tier: 1 | 2 | 3 | 4): StaffNote[] {
  if (tier === 1) return CATALOG.all.filter((note) => TIER_1_IDS.has(note.id));
  if (tier === 2) {
    return CATALOG.all.filter((note) =>
      (note.clef === "bass" && note.d >= 18 && note.d <= 28) ||
      (note.clef === "treble" && note.d >= 28 && note.d <= 38));
  }
  if (tier === 3) {
    return CATALOG.all.filter((note) =>
      (note.clef === "bass" && note.d >= 16 && note.d <= 29) ||
      (note.clef === "treble" && note.d >= 27 && note.d <= 40));
  }
  return CATALOG.all;
}

/** Same staff position read in the other clef. */
export function isClefFlip(target: StaffNote, playedLetter: string): boolean {
  const targetIdx = LETTERS.indexOf(target.letter as (typeof LETTERS)[number]);
  const expected = target.clef === "bass" ? (targetIdx + 5) % 7 : (targetIdx + 2) % 7;
  return playedLetter === LETTERS[expected];
}
