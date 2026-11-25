const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK = new Set([1, 3, 6, 8, 10]);

export const STAFF_LO = 48;
export const STAFF_HI = 72;

const HINTS = new Map<number, string>([
  [60, "A"], [61, "W"], [62, "S"], [63, "E"], [64, "D"], [65, "F"], [66, "T"],
  [67, "G"], [68, "Y"], [69, "H"], [70, "U"], [71, "J"], [72, "K"],
]);

export function pitchName(midi: number): string {
  return NAMES[((midi % 12) + 12) % 12]!;
}

export function isSharpPitch(midi: number): boolean {
  return BLACK.has(((midi % 12) + 12) % 12);
}

export function staffHints(): Map<number, string> {
  return HINTS;
}

export function renderPiano(
  container: HTMLElement,
  lo: number,
  hi: number,
  options: { hints: Map<number, string>; showHints: boolean; labels: "none" | "c-only" | "all" },
): void {
  container.replaceChildren();
  const whites: { midi: number; name: string }[] = [];
  const blacks: { midi: number; name: string; after: number }[] = [];
  let whiteIndex = 0;
  for (let midi = lo; midi <= hi; midi++) {
    const name = pitchName(midi);
    if (isSharpPitch(midi)) blacks.push({ midi, name, after: whiteIndex - 1 });
    else {
      whites.push({ midi, name });
      whiteIndex++;
    }
  }
  const whiteWidth = 100 / whites.length;
  container.style.minWidth = whites.length > 16 ? `${whites.length * 40}px` : "";

  for (const key of whites) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.midi = String(key.midi);
    button.setAttribute("aria-label", `${key.name}${Math.floor(key.midi / 12) - 1}`);
    button.className = "piano-white relative flex-1 h-full bg-slate-50 border-r border-slate-300 last:border-r-0 rounded-b-lg flex flex-col items-center justify-end pb-2 focus:outline-none";
    const showLabel = options.labels === "all" || (options.labels === "c-only" && key.name === "C");
    if (showLabel) {
      const label = document.createElement("span");
      label.className = `text-[11px] font-bold ${key.midi % 12 === 0 && key.name === "C" && key.midi === 60 ? "text-indigo-600" : "text-slate-500"}`;
      label.textContent = key.midi === 60 ? "C4" : key.name;
      button.append(label);
    } else if (key.midi === 60) {
      const dot = document.createElement("span");
      dot.className = "w-1.5 h-1.5 rounded-full bg-indigo-400/70 mb-1";
      button.append(dot);
    }
    const hint = options.hints.get(key.midi);
    if (options.showHints && hint) {
      const el = document.createElement("span");
      el.className = "mt-1 px-1.5 py-0.5 rounded bg-slate-200/90 text-slate-600 font-mono text-[10px] font-semibold";
      el.textContent = hint;
      button.append(el);
    }
    container.append(button);
  }

  for (const key of blacks) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.midi = String(key.midi);
    button.setAttribute("aria-label", `${key.name}${Math.floor(key.midi / 12) - 1}`);
    const left = (key.after + 1) * whiteWidth;
    const width = whiteWidth * 0.62;
    button.style.left = `calc(${left}% - ${width / 2}%)`;
    button.style.width = `${width}%`;
    button.className = "piano-black absolute top-0 h-[60%] z-10 bg-slate-900 border border-slate-700 rounded-b-md flex flex-col items-center justify-end pb-1 focus:outline-none";
    const hint = options.hints.get(key.midi);
    if (options.showHints && hint) {
      const el = document.createElement("span");
      el.className = "text-[9px] font-mono text-slate-400 font-semibold";
      el.textContent = hint;
      button.append(el);
    }
    container.append(button);
  }
}

export function flashKey(midi: number): void {
  const el = document.querySelector<HTMLElement>(`[data-midi="${midi}"]`);
  if (!el) return;
  el.classList.add("pressed");
  window.setTimeout(() => el.classList.remove("pressed"), 140);
}

export function setKeyDown(midi: number, down: boolean): void {
  document.querySelector<HTMLElement>(`[data-midi="${midi}"]`)?.classList.toggle("pressed", down);
}

export function markTargets(midis: readonly number[]): void {
  const wanted = new Set(midis);
  document.querySelectorAll<HTMLElement>("[data-midi]").forEach((el) => {
    el.classList.toggle("target-key", wanted.has(Number(el.dataset.midi)));
  });
}
