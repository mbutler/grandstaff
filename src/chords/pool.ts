// Which chord and progression cards are in play. The stage ceiling is the
// curriculum gate. Inside it, cards already met stay in the mix, and the next
// unmet card waits at the frontier until this sitting still has room.

import { exposureCount, type ItemStat } from "../adapt/memory";
import type { Card } from "../types";

export interface Staged { id: string; level: number; sequence: number }
const byCurriculum = (a: Staged, b: Staged) => a.level - b.level || a.sequence - b.sequence || (a.id < b.id ? -1 : 1);

export function chordPool<T extends Staged = Card>(
  cards: readonly T[],
  stage: number,
  stats: Record<string, ItemStat>,
  introduced: number,
  cap: number,
): T[] {
  const open = cards.filter((card) => card.level <= stage).sort(byCurriculum);
  const seen = open.filter((card) => exposureCount(stats[card.id]) > 0);
  const frontier = open.find((card) => exposureCount(stats[card.id]) === 0);
  const allowNew = introduced < cap || seen.length === 0;
  if (frontier && allowNew) return [...seen, frontier];
  if (seen.length) return seen;
  return frontier ? [frontier] : [];
}

export function stageCounts(cards: readonly Staged[], stage: number, stats: Record<string, ItemStat>): { open: number; seen: number } {
  const open = cards.filter((card) => card.level <= stage);
  return { open: open.length, seen: open.filter((card) => exposureCount(stats[card.id]) > 0).length };
}
