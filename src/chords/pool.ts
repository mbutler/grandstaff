// Which chord and progression cards are in play. The stage ceiling is the
// curriculum gate. Inside it, cards already met stay in the mix, and the next
// unmet card waits at the frontier until this sitting still has room.

import type { ItemStat } from "../adapt/memory";
import type { Card } from "../types";

const byCurriculum = (a: Card, b: Card) => a.level - b.level || a.sequence - b.sequence || (a.id < b.id ? -1 : 1);

export function chordPool(
  cards: readonly Card[],
  stage: number,
  stats: Record<string, ItemStat>,
  introduced: number,
  cap: number,
): Card[] {
  const open = cards.filter((card) => card.level <= stage).sort(byCurriculum);
  const seen = open.filter((card) => (stats[card.id]?.attempts ?? 0) > 0);
  const frontier = open.find((card) => (stats[card.id]?.attempts ?? 0) === 0);
  const allowNew = introduced < cap || seen.length === 0;
  if (frontier && allowNew) return [...seen, frontier];
  if (seen.length) return seen;
  return frontier ? [frontier] : [];
}

export function stageCounts(cards: readonly Card[], stage: number, stats: Record<string, ItemStat>): { open: number; seen: number } {
  const open = cards.filter((card) => card.level <= stage);
  return { open: open.length, seen: open.filter((card) => (stats[card.id]?.attempts ?? 0) > 0).length };
}
