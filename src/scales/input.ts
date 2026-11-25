// Follow a scale one step at a time. A step is one key, or a left/right pair
// for hands together (either order, rolled or simultaneous). A wrong key is a
// miss but does not restart the run: carry on from the note you were on.
// Releases are ignored, and so is re-striking a key already played in this step.

export type ScaleResult = "pending" | "step" | "done" | "miss" | "octave" | "ignored";

export class ScaleInput {
  private steps: readonly (readonly number[])[] = [];
  index = 0;
  private got: number[] = [];   // indexes into the current step already played
  private struck = new Set<number>();

  begin(steps: readonly (readonly number[])[]): void {
    this.steps = steps;
    this.index = 0;
    this.got = [];
    this.struck.clear();
  }

  get done(): boolean { return this.index >= this.steps.length; }
  get current(): readonly number[] { return this.steps[this.index] ?? []; }

  input(midi: number, exactOctave: boolean): ScaleResult {
    if (this.done) return "ignored";
    if (this.struck.has(midi)) return "ignored";
    const want = this.current;
    const open = want.map((_, i) => i).filter((i) => !this.got.includes(i));
    const hit = open.find((i) => exactOctave ? want[i] === midi : want[i]! % 12 === midi % 12);
    if (hit === undefined) {
      if (exactOctave && want.some((note) => note % 12 === midi % 12)) return "octave";
      return "miss";
    }
    this.got.push(hit);
    this.struck.add(midi);
    if (this.got.length < want.length) return "pending";
    this.index++;
    this.got = [];
    this.struck.clear();
    return this.done ? "done" : "step";
  }
}
