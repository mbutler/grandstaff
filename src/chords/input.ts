import { judgeGrip, type GripResult } from "./grip";

const PCS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function bassPitchClass(symbol: string): number {
  const name = symbol.split("/").at(-1)!;
  const match = /^([A-G])([#b]*)/.exec(name)!;
  const alteration = [...match[2]!].reduce((sum, char) => sum + (char === "#" ? 1 : -1), 0);
  return (PCS[match[1]!]! + alteration + 12) % 12;
}

/** Keep common tones; tolerate old voices only until they are released.
 * An optional root/slash bass below the RH is accepted, but isn't assessed.
 * Each call consumes one physical key event; unchanged grips never auto-advance.
 */
export class ChordInput {
  readonly held = new Set<number>();
  private carry = new Set<number>();
  private target: readonly number[] = [];
  private bass = 0;
  begin(target: readonly number[], symbol: string): void {
    this.target = target;
    this.bass = bassPitchClass(symbol);
    this.carry = new Set(this.held);
  }
  clear(): void { this.held.clear(); this.carry.clear(); }
  private judge(notes: number[], exactOctave: boolean): GripResult {
    const direct = judgeGrip(notes, this.target, exactOctave);
    if (direct === "match" || direct === "octave") return direct;
    const rh = notes.filter((note) => !(note < Math.min(...this.target) && note % 12 === this.bass));
    return judgeGrip(rh, this.target, exactOctave);
  }
  input(note: number, down: boolean, exactOctave: boolean): GripResult {
    if (!this.target.length) return "pending";
    if (down) {
      if (this.held.has(note)) return "pending";
      this.held.add(note);
    } else {
      if (!this.held.delete(note)) return "pending";
      this.carry.delete(note);
    }
    const current = [...this.held];
    const result = this.judge(current, exactOctave);
    // New out-of-shape attacks are errors even while an old chord is releasing.
    if (down && !this.carry.has(note) && this.judge([note], exactOctave) === "miss") return "miss";
    if (result === "octave") return down ? "octave" : "pending";
    if (result !== "miss") return result;
    const fresh = current.filter((n) => !this.carry.has(n) || this.target.includes(n));
    const withoutOldVoices = this.judge(fresh, exactOctave);
    if (withoutOldVoices !== "miss") return "pending";
    // A wrong pitch is counted on its attack, never again on every release.
    return down ? "miss" : "pending";
  }
}
