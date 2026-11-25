import { afterEach, expect, test } from "bun:test";
import { Window, type HTMLElement as HappyHTMLElement } from "happy-dom";
import { emptySave, STORAGE_KEY, type Save } from "../src/adapt/memory";
import { generateDeck } from "../src/deck/generate";
import type { Card } from "../src/types";

const html = await Bun.file(new URL('../public/index.html', import.meta.url)).text();
const allCards = generateDeck().cards;
const c = allCards.find(c => c.id === 't1_c_maj_root')!;
let win: Window;
let run = 0;
let midiHandler: ((event: { data: Uint8Array }) => void) | undefined;
const globals = ['window', 'document', 'navigator', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame'] as const;
const originals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));

async function setup(save: Save = emptySave(), cards: Card[] = [c], raw?: unknown) {
  win = new Window({ url: 'http://localhost:5173', settings: { enableJavaScriptEvaluation: false, disableJavaScriptFileLoading: true } });
  win.document.write(html.replace('{{DECK}}', JSON.stringify({ cards })));
  save.settings.muted = true;
  save.settings.mouseCompensation = false;
  win.localStorage.setItem(STORAGE_KEY, JSON.stringify(raw ?? save));
  const input = { name: 'Test MIDI', get onmidimessage() { return midiHandler; }, set onmidimessage(value) { midiHandler = value; } };
  Object.defineProperty(win.navigator, 'requestMIDIAccess', { value: async () => ({ inputs: new Map([['test', input]]) }) });
  for (const key of globals) Object.defineProperty(globalThis, key, { value: key === 'requestAnimationFrame' || key === 'cancelAnimationFrame' ? win[key].bind(win) : win[key], configurable: true, writable: true });
  await import(`../src/app/main.ts?ui=${++run}`);
  await Promise.resolve();
  click('#midiBtn');
  await Promise.resolve();
}
function click(selector: string) { win.document.querySelector<HappyHTMLElement>(selector)!.click(); }
function text(selector: string) { return win.document.querySelector(selector)!.textContent; }
function note(midi: number, down = true) { midiHandler!({ data: new Uint8Array([down ? 0x90 : 0x80, midi, down ? 100 : 0]) }); }
function read(): Save { return JSON.parse(win.localStorage.getItem(STORAGE_KEY)!); }
function delay(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }
afterEach(async () => {
  await win?.happyDOM.abort();
  for (const key of globals) {
    const desc = originals.get(key);
    if (desc) Object.defineProperty(globalThis, key, desc); else Reflect.deleteProperty(globalThis, key);
  }
  midiHandler = undefined;
});

test('a new chord teaches first, then offers a fresh unaided attempt', async () => {
  const save = emptySave(); save.settings.app = 'chords';
  await setup(save);
  expect(text('#promptBadge')).toBe('Learn this shape');
  expect(win.document.querySelectorAll('.target-key')).toHaveLength(3);
  expect(text('#chordExplanation')).toContain('Major triad');
  for (const n of [60, 64, 67]) note(n);
  expect(text('#promptBadge')).toBe('Guided run complete');
  expect(read().chords[c.id]?.assisted).toBe(1);
  expect(read().chords[c.id]?.attempts).toBe(0);
  click('#recallChordBtn');
  expect(win.document.querySelectorAll('.target-key')).toHaveLength(0);
  expect(text('#chordExplanation')).toBe('');
  // Common held notes are allowed, but the same shape needs an actual new attack.
  note(67, false); note(67);
  expect(read().chords[c.id]?.correct).toBe(1);
  expect(read().chords[c.id]?.assisted).toBe(1);
  click('[data-app="count"]');
  await delay(700);
  expect(text('#promptBadge')).toBe('Say every syllable');
});

test('peek records assistance and octave corrections cannot become clean recall', async () => {
  const save = emptySave(); save.settings.app = 'chords';
  await setup(save);
  click('#recallChordBtn');
  for (const n of [72, 76, 79]) note(n);
  for (const n of [72, 76, 79]) note(n, false);
  click('#peekChordBtn');
  for (const n of [60, 64, 67]) note(n);
  const stat = read().chords[c.id]!;
  expect(stat.correct).toBe(0);
  expect(stat.assisted).toBe(1);
  expect(stat.octaveErrors).toBe(1);
  expect(stat.attempts).toBe(1);
  expect(text('#hdrAcc')).toBe('0%');
  expect(stat.evidence[0]?.outcome).toBe('incorrect');
});

test('guided progression keeps common tones throughout and never needs a full release', async () => {
  const card = allCards.find(c => c.id === 't2_backbone_c_root')!;
  const save = emptySave(); save.settings.app = 'chords'; save.settings.chordStage = 13;
  await setup(save, [card]);
  for (const n of [60, 64, 67]) note(n);
  expect(text('#chordSymbol')).toBe('F');
  note(65); note(69); note(64, false); note(67, false);
  expect(text('#chordSymbol')).toBe('G');
  for (const n of [60, 65, 69]) note(n, false);
  for (const n of [59, 62, 67]) note(n);
  expect(text('#chordSymbol')).toBe('C');
  note(59, false); note(62, false); note(60); note(64);
  expect(text('#promptBadge')).toBe('Guided run complete');
  const stat = read().chords[card.id]!;
  expect(stat.assisted).toBe(1);
  expect(stat.pitchErrors).toBe(0);
});

test('black-key and octave mistakes are included in note accuracy', async () => {
  const save = emptySave(); save.settings.app = 'staff';
  const random = Math.random;
  Math.random = () => 0;
  try { await setup(save); } finally { Math.random = random; }
  // At random=0, the first tier item is C3 in bass.
  note(49); note(60); note(48);
  const stat = read().notes.C3_bass!;
  expect(stat.attempts).toBe(1);
  expect(stat.correct).toBe(0);
  expect(stat.pitchErrors).toBe(1);
  expect(stat.octaveErrors).toBe(1);
});

test('chunk preview is not timed or scored; each replay step records its own errors', async () => {
  const save = emptySave(); save.settings.app = 'staff'; save.settings.drill = 'chunks'; save.settings.flashSec = 0.8;
  const random = Math.random;
  Math.random = () => 0;
  try { await setup(save); } finally { Math.random = random; }
  // Deterministic treble chunk C4 D4 C4. Preview input must be ignored.
  note(60);
  expect(read().chunks).toEqual({});
  await delay(850);
  note(61); note(60);
  note(63); note(62);
  note(60);
  const stat = read().chunks['treble:3']!;
  expect(read().notes).toEqual({});
  expect(stat.attempts).toBe(3);
  expect(stat.correct).toBe(1);
  expect(stat.pitchErrors).toBe(2);
  expect(stat.recentMs[0]).toBeLessThan(500);
});

test('replaying a chunk is assisted and reset cannot reintroduce a pending error', async () => {
  const save = emptySave(); save.settings.drill = 'chunks'; save.settings.flashSec = 0.8;
  const random = Math.random;
  Math.random = () => 0;
  try { await setup(save); } finally { Math.random = random; }
  click('#peekChunkBtn');
  await delay(850);
  for (const n of [60, 62, 60]) note(n);
  expect(read().chunks['treble:3']?.assisted).toBe(3);
  expect(read().chunks['treble:3']?.attempts).toBe(0);
  click('[data-drill="notes"]');
  note(61);
  click('#openHeatmapBtn'); click('#resetStatsBtn'); click('#confirmResetBtn');
  expect(read().notes).toEqual({});
  expect(read().chunks).toEqual({});
});

test('saving after v1 migration retains an untouched pre-upgrade backup', async () => {
  const raw = { schema: 1, settings: { app: 'staff', muted: true }, notes: { C4_treble: { attempts: 4, correct: 3, totalMs: 2500 } } };
  await setup(emptySave(), [c], raw);
  click('[data-app="chords"]');
  expect(JSON.parse(win.localStorage.getItem('piano-practice:before-v2')!)).toEqual(raw);
  expect(read().schema).toBe(2);
  expect(read().notes.C4_treble?.correct).toBe(3);
});

test('the progress panel pauses recall timing and ignores MIDI attacks', async () => {
  const save = emptySave(); save.settings.app = 'chords';
  await setup(save);
  click('#recallChordBtn');
  click('#openHeatmapBtn');
  for (const n of [61, 63, 68]) note(n);
  await delay(300);
  click('#closeHeatmapBtn');
  for (const n of [60, 64, 67]) note(n);
  const stat = read().chords[c.id]!;
  expect(stat.correct).toBe(1);
  expect(stat.pitchErrors).toBe(0);
  expect(stat.recentMs[0]).toBeLessThan(200);
});

test('an interrupted recall preserves the error exactly once in its own skill', async () => {
  const save = emptySave(); save.settings.app = 'chords';
  await setup(save);
  click('#recallChordBtn'); note(61);
  click('[data-app="staff"]');
  expect(read().chords[c.id]?.attempts).toBe(1);
  expect(read().chords[c.id]?.correct).toBe(0);
  expect(read().notes).toEqual({});
  click('[data-app="count"]');
  expect(read().chords[c.id]?.attempts).toBe(1);
});

test('leaving a partial clean progression does not claim a completed recall or hint', async () => {
  const card = allCards.find(c => c.id === 't2_backbone_c_root')!;
  const save = emptySave(); save.settings.app = 'chords'; save.settings.chordStage = 13;
  await setup(save, [card]);
  click('#recallChordBtn');
  for (const n of [60, 64, 67]) note(n);
  click('[data-app="count"]');
  expect(read().chords[card.id]).toBeUndefined();
});

test('a new scale is taught note by note, then recalled with names hidden', async () => {
  const save = emptySave(); save.settings.app = 'scales';
  await setup(save);
  expect(text('#scaleTitle')).toBe('B major');
  expect(text('#scaleEyebrow')).toBe('Right hand');
  expect(text('#promptBadge')).toBe('Learn this scale');
  expect([...win.document.querySelectorAll('.target-key')].map(el => (el as unknown as HappyHTMLElement).dataset.midi)).toEqual(['71']);
  expect(text('#scaleFingering')).toContain('RH 1 2 3 1 2 3 4 5');
  const b = [71, 73, 75, 76, 78, 80, 82, 83, 82, 80, 78, 76, 75, 73, 71];
  for (const n of b) { note(n); note(n, false); }
  expect(text('#promptBadge')).toBe('Guided run complete');
  expect(read().scales.sc_b_maj_rh?.assisted).toBe(1);
  expect(read().scales.sc_b_maj_rh?.attempts).toBe(0);
  click('#recallScaleBtn');
  expect(text('#promptBadge')).toBe('Play from memory');
  expect(win.document.querySelectorAll('.target-key')).toHaveLength(0);
  expect(text('#scaleSteps')).not.toContain('C#');
  for (const n of b.slice(0, 3)) note(n);
  note(74); // D natural: a miss, but the run continues from E
  for (const n of b.slice(3)) note(n);
  const stat = read().scales.sc_b_maj_rh!;
  expect(stat.attempts).toBe(1);
  expect(stat.correct).toBe(0);
  expect(stat.pitchErrors).toBe(1);
  expect(stat.evidence.at(-1)?.outcome).toBe('incorrect');
});

test('a clean scale from memory records one correct recall timed per note', async () => {
  const save = emptySave(); save.settings.app = 'scales';
  save.scales.sc_b_maj_rh = { attempts: 0, correct: 0, totalMs: 0, recentMs: [], lastWrong: 0, cleanStreak: 0, lastCleanAt: 0, assisted: 1, pitchErrors: 0, octaveErrors: 0, evidence: [], retainedAt: [] };
  save.scaleIntro = { count: 4, lastAt: Date.now() };
  await setup(save);
  expect(text('#promptBadge')).toBe('Play from memory');
  for (const n of [71, 73, 75, 76, 78, 80, 82, 83, 82, 80, 78, 76, 75, 73, 71]) note(n);
  const stat = read().scales.sc_b_maj_rh!;
  expect(stat.correct).toBe(1);
  expect(stat.evidence.at(-1)!.ms).toBeLessThan(3000);
  expect(text('#hintBadge')).toContain('ms a note');
  expect(text('#hdrAcc')).toBe('100%');
});
