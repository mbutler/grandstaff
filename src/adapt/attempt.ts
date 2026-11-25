import type { Outcome } from "./memory";

/** One question, including corrections. Assistance never becomes unaided success. */
export class Attempt {
  assisted: boolean;
  unaidedError = false;
  pitchErrors = 0;
  octaveErrors = 0;
  touched = false;
  recorded = false;
  constructor(assisted = false) { this.assisted = assisted; }
  help(): void { this.assisted = true; this.touched = true; }
  miss(kind: "pitch" | "octave" = "pitch"): void {
    this.touched = true;
    if (!this.assisted) this.unaidedError = true;
    if (kind === "octave") this.octaveErrors++;
    else this.pitchErrors++;
  }
  get outcome(): Outcome {
    if (this.pitchErrors + this.octaveErrors > 0) return "incorrect";
    return this.assisted ? "assisted" : "correct";
  }
}
