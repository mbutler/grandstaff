// Decide whether the notes currently held are the right-hand shape on the card.
// A roll is fine: a subset of the target is still "pending". A pitch that is
// not in the shape is a miss. The same shape an octave away is a hint when
// exact octave is on, and a match when it is off.

export type GripResult = "pending" | "match" | "octave" | "miss";

function uniqueSorted(notes: readonly number[]): number[] {
  return [...new Set(notes)].sort((a, b) => a - b);
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((note, index) => note === b[index]);
}

function pitchClasses(notes: readonly number[]): number[] {
  return notes.map((note) => note % 12).sort((a, b) => a - b);
}

function lowestPitchClass(notes: readonly number[]): number {
  return Math.min(...notes) % 12;
}

/** `held` is a subset of `target`, allowing duplicate pitch classes in neither. */
function isSubMultiset(held: readonly number[], target: readonly number[]): boolean {
  const remaining = [...target];
  for (const pitch of held) {
    const index = remaining.indexOf(pitch);
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return true;
}

export function judgeGrip(held: readonly number[], target: readonly number[], exactOctave: boolean): GripResult {
  const down = uniqueSorted(held);
  const want = uniqueSorted(target);
  if (!down.length || !want.length) return "pending";
  if (sameNumbers(down, want)) return "match";

  const heldPcs = pitchClasses(down);
  const targetPcs = pitchClasses(want);
  if (down.some((note) => !targetPcs.includes(note % 12))) return "miss";

  const sameShape = sameNumbers(heldPcs, targetPcs) && lowestPitchClass(down) === lowestPitchClass(want);
  if (!exactOctave) {
    if (sameShape) return "match";
    if (isSubMultiset(heldPcs, targetPcs) && down.length < want.length) return "pending";
    return "miss";
  }

  if (sameShape) return "octave";
  if (down.every((note) => want.includes(note))) return "pending";
  return "miss";
}

/** "higher" means the written shape sits above what is being held. */
export function octaveDirection(held: readonly number[], target: readonly number[]): "higher" | "lower" {
  const heldAvg = held.reduce((sum, note) => sum + note, 0) / held.length;
  const targetAvg = target.reduce((sum, note) => sum + note, 0) / target.length;
  return targetAvg > heldAvg ? "higher" : "lower";
}
