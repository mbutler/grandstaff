/** Durations measured in eighth-note cells; irregular spans need tied notation. */
export function noteValue(cells: number): { hollow: boolean; stem: boolean; flags: number; dotted: boolean } {
  const binary = (n: number) => n > 0 && Number.isInteger(Math.log2(n));
  const dotted = !binary(cells) && binary(cells / 1.5);
  const base = dotted ? cells / 1.5 : cells;
  if (!binary(base) || base > 8 || base < 0.125) throw new Error(`Duration ${cells} requires tied or unsupported notation`);
  return { hollow: base >= 4, stem: base < 8, flags: Math.max(0, Math.log2(2 / base)), dotted };
}
