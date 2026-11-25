// A bar is a row of equal syllables. A note is a span of those syllables.
// The cursor only moves forward one syllable at a time. Jumping ahead does
// not count the later notes; it leaves the open note as wide as the
// syllables already said.

import { makeNote } from "../staff/catalog";

export type CellKind = "play" | "hold" | "rest";

export interface CountSpan {
  start: number;
  length: number;
  midi: number;
  d: number;
  kind: "note" | "rest";
}

export interface CountCard {
  id: string;
  title: string;
  hint: string;
  success: string;
  cells: CellKind[];
  spans: CountSpan[];
}

export const BAR_CELLS = 8;
export const EIGHTH_SYLLABLES = ["1", "&", "2", "&", "3", "&", "4", "&"] as const;

const VALUE_NAME = ["", "eighth", "quarter", "dotted quarter", "half", "five eighths", "dotted half", "seven eighths", "whole"];

export function valueName(cells: number): string {
  return VALUE_NAME[cells] ?? `${cells} eighths`;
}

function withArticle(name: string): string {
  return `${name.startsWith("eighth") ? "an" : "a"} ${name}`;
}

export function countedLength(start: number, length: number, cursor: number): number {
  if (cursor <= start) return 0;
  return Math.min(length, cursor - start);
}

export function shrinkCopy(syllable: string, trueCells: number, countedCells: number): string {
  if (countedCells <= 0) return `You skipped “${syllable}”. Say that syllable before the next note.`;
  const truth = valueName(trueCells);
  const heard = valueName(countedCells);
  return `You skipped “${syllable}”. That ${truth} counted as ${withArticle(heard)}.`;
}

/** Copy for a jump that tried to leave `cursor` unspoken. */
export function missMessage(card: CountCard, cursor: number): string {
  const syllable = EIGHTH_SYLLABLES[cursor] ?? String(cursor + 1);
  const span = card.spans.find((item) => cursor >= item.start && cursor < item.start + item.length);
  if (!span) return `Say “${syllable}” before you move on.`;
  return shrinkCopy(syllable, span.length, countedLength(span.start, span.length, cursor));
}

export function progressMessage(card: CountCard, cursor: number): string {
  if (cursor >= card.cells.length) return card.success;
  if (cursor === 0) return "Tap each syllable in order, holds included. Spacebar says the next one.";
  const syllable = EIGHTH_SYLLABLES[cursor] ?? String(cursor + 1);
  const kind = card.cells[cursor];
  if (kind === "hold") return `Say “${syllable}”. This note is still sounding.`;
  if (kind === "rest") return `Say “${syllable}” through the rest.`;
  return `Say “${syllable}” and start the next note.`;
}

/** Consecutive one-syllable notes share a beam. */
export function beamGroups(spans: readonly CountSpan[]): number[][] {
  const groups: number[][] = [];
  let current: number[] = [];
  const flush = () => {
    if (current.length > 1) groups.push(current);
    current = [];
  };
  spans.forEach((span, index) => {
    const prev = current.length ? spans[current[current.length - 1]!] : null;
    const joins = span.kind === "note" && span.length === 1 && prev?.kind === "note" && span.start === prev.start + prev.length;
    if (joins) current.push(index);
    else {
      flush();
      current = span.kind === "note" && span.length === 1 ? [index] : [];
    }
  });
  flush();
  return groups;
}

function pitch(name: string): { d: number; midi: number } {
  const note = makeNote(name[0]!, Number(name.slice(1)), "treble");
  return { d: note.d, midi: note.midi };
}

function line(pattern: { cells: number; name: string }[]): CountSpan[] {
  let start = 0;
  return pattern.map((item) => {
    const tone = pitch(item.name);
    const span: CountSpan = { start, length: item.cells, midi: tone.midi, d: tone.d, kind: "note" };
    start += item.cells;
    return span;
  });
}

function card(id: string, title: string, hint: string, success: string, spans: CountSpan[]): CountCard {
  const cells: CellKind[] = Array.from({ length: BAR_CELLS }, () => "rest");
  for (const span of spans) {
    if (span.kind === "rest") continue;
    cells[span.start] = "play";
    for (let i = 1; i < span.length; i++) cells[span.start + i] = "hold";
  }
  return { id, title, hint, success, cells, spans };
}

export const CARDS: readonly CountCard[] = [
  card(
    "quarters",
    "Four quarters",
    "A quarter is two eighths. Play on the number, hold through the &.",
    "All four quarters kept both syllables.",
    line([
      { cells: 2, name: "E4" },
      { cells: 2, name: "F4" },
      { cells: 2, name: "G4" },
      { cells: 2, name: "A4" },
    ]),
  ),
  card(
    "quarter-eighths",
    "Quarter, then two eighths",
    "The quarter still owns an &. Each eighth is one syllable.",
    "The quarters stayed wide, and the eighths stayed one syllable.",
    line([
      { cells: 2, name: "E4" },
      { cells: 1, name: "F4" },
      { cells: 1, name: "G4" },
      { cells: 2, name: "A4" },
      { cells: 1, name: "B4" },
      { cells: 1, name: "C5" },
    ]),
  ),
  card(
    "dotted",
    "Dotted quarter, then an eighth",
    "A dot adds one syllable. The dotted quarter is play, hold, hold.",
    "Each dotted quarter held for three syllables.",
    line([
      { cells: 3, name: "E4" },
      { cells: 1, name: "G4" },
      { cells: 3, name: "F4" },
      { cells: 1, name: "A4" },
    ]),
  ),
];
