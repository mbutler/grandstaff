// Span of white keys the on-screen piano shows for the current chord.

const BLACK = new Set([1, 3, 6, 8, 10]);
const isBlack = (midi: number) => BLACK.has(((midi % 12) + 12) % 12);
const WHITE_KEYS_MIN = 15;

const whiteCount = (lo: number, hi: number) => {
  let n = 0;
  for (let m = lo; m <= hi; m++) if (!isBlack(m)) n++;
  return n;
};

/** Range covering every note, starting on C or F and ending on E or B. */
export function rangeFor(allMidi: number[]): { lo: number; hi: number } {
  let lo = Math.min(...allMidi) - 2;
  let hi = Math.max(...allMidi) + 2;
  const startsGroup = (m: number) => m % 12 === 0 || m % 12 === 5;
  const endsGroup = (m: number) => m % 12 === 4 || m % 12 === 11;
  while (!startsGroup(lo)) lo--;
  while (!endsGroup(hi)) hi++;
  while (whiteCount(lo, hi) < WHITE_KEYS_MIN) {
    if (Math.min(...allMidi) - lo <= hi - Math.max(...allMidi)) do lo--; while (!startsGroup(lo));
    else do hi++; while (!endsGroup(hi));
  }
  return { lo, hi };
}
