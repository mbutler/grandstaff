import { pickWeighted, type ItemStat } from "../adapt/memory";
import { type StaffNote } from "./catalog";

export interface NotePrompt { kind: "notes"; note: StaffNote }
export interface IntervalPrompt {
  kind: "intervals";
  n1: StaffNote;
  n2: StaffNote;
  size: number;
  presentation: "harmonic" | "melodic";
}
export interface ChunkPrompt { kind: "chunks"; notes: StaffNote[]; clef: "treble" | "bass" }
export type StaffPrompt = NotePrompt | IntervalPrompt | ChunkPrompt;

const SIZES = [2, 3, 4, 5, 6, 7, 8].map((size) => ({ id: String(size), size }));

export function notePrompt(
  pool: readonly StaffNote[],
  stats: Record<string, ItemStat>,
  adaptive: boolean,
  excludeId: string | null,
  now: number,
): NotePrompt {
  const note = pickWeighted(pool, (id) => stats[id], "note", adaptive, excludeId, now);
  return { kind: "notes", note };
}

export function intervalPrompt(
  pool: readonly StaffNote[],
  preference: "harmonic" | "melodic" | "mixed",
  stats: Record<string, ItemStat>,
  adaptive: boolean,
  now: number,
): IntervalPrompt {
  const wanted = Math.random() < 0.5 ? "treble" : "bass";
  const preferred = pool.filter((note) => note.clef === wanted);
  const clefPool = preferred.length >= 2 ? preferred : pool;
  const minD = Math.min(...clefPool.map((note) => note.d));
  const maxD = Math.max(...clefPool.map((note) => note.d));
  const size = pickWeighted(SIZES, (id) => stats[id], "interval", adaptive, null, now).size;

  let n1 = clefPool[Math.floor(Math.random() * clefPool.length)]!;
  let n2 = clefPool[Math.min(clefPool.length - 1, 2)]!;
  let chosen = Math.abs(n2.d - n1.d) + 1;
  for (let tries = 0; tries < 40; tries++) {
    const start = clefPool[Math.floor(Math.random() * clefPool.length)]!;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const targetD = start.d + dir * (size - 1);
    const end = clefPool.find((note) => note.d === targetD);
    if (end && targetD >= minD && targetD <= maxD) {
      n1 = start;
      n2 = end;
      chosen = size;
      break;
    }
  }

  let presentation: "harmonic" | "melodic" = preference === "melodic" ? "melodic" : "harmonic";
  if (preference === "mixed") presentation = Math.random() < 0.5 ? "harmonic" : "melodic";
  return { kind: "intervals", n1, n2, size: chosen, presentation };
}

export function chunkPrompt(pool: readonly StaffNote[], length: number): ChunkPrompt {
  const clef = Math.random() < 0.5 ? "treble" : "bass";
  const clefPool = pool.filter((note) => note.clef === clef).sort((a, b) => a.d - b.d);
  const notes = [clefPool[Math.floor(Math.random() * clefPool.length)]!];
  const steps = [-2, -1, 1, 2, 3, -3];
  for (let i = 1; i < length; i++) {
    const prevIdx = clefPool.indexOf(notes[i - 1]!);
    const valid = steps.filter((step) => prevIdx + step >= 0 && prevIdx + step < clefPool.length);
    const chosen = valid[Math.floor(Math.random() * valid.length)] ?? 0;
    notes.push(clefPool[prevIdx + chosen]!);
  }
  return { kind: "chunks", notes, clef };
}
