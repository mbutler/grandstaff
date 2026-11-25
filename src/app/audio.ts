let audio: AudioContext | null = null;
let isMuted = () => false;

export function bindMute(read: () => boolean): void {
  isMuted = read;
}

function context(): AudioContext | null {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!audio && Ctx) audio = new Ctx();
  if (audio?.state === "suspended") void audio.resume();
  return audio;
}

function freq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function playPiano(midi: number, duration = 0.8, volume = 0.25, delay = 0): void {
  if (isMuted()) return;
  const ctx = context();
  if (!ctx) return;
  const now = ctx.currentTime + delay;
  const master = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(Math.min(4800, freq(midi) * 6), now);
  filter.frequency.exponentialRampToValueAtTime(Math.max(400, freq(midi) * 1.6), now + duration * 0.85);
  master.gain.setValueAtTime(0.0001, now);
  master.gain.linearRampToValueAtTime(volume, now + 0.012);
  master.gain.exponentialRampToValueAtTime(volume * 0.35, now + 0.18);
  master.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  filter.connect(master);
  master.connect(ctx.destination);
  for (const partial of [
    { mult: 1, type: "triangle" as OscillatorType, gain: 0.72 },
    { mult: 2, type: "sine" as OscillatorType, gain: 0.22 },
    { mult: 3, type: "sine" as OscillatorType, gain: 0.07 },
  ]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = partial.type;
    osc.frequency.setValueAtTime(freq(midi) * partial.mult, now);
    gain.gain.setValueAtTime(partial.gain, now);
    osc.connect(gain);
    gain.connect(filter);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }
}

export function playWrong(): void {
  if (isMuted()) return;
  const ctx = context();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(145, now);
  osc.frequency.exponentialRampToValueAtTime(105, now + 0.14);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(380, now);
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(0.12, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.18);
}

export function unlockAudio(): void {
  context();
}
