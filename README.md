# Piano

One practice app for the iPad at the piano, in the GrandStaff studio layout.

- **Staff** — note reading, interval-size recognition, and flash chunks. Each drill has separate recent accuracy and latency. Chunk steps are grouped by clef and pattern length; they no longer change individual note-reading scores.
- **Chords** — Piano For All shapes and progressions. New items and guided cards open with highlighted keys, an explanation, and **Hear shape**. Play with guidance, then choose **Try from memory** for a fresh recall attempt. Existing familiar cards normally open in recall.
- **Scales** — one octave up and back, from memory, in Chopin's order: B, D♭ and F♯ major first (long fingers on the black keys), then E, A, D, G, then A♭, E♭, B♭, F, and C major last. Each hand alone comes before hands together; melodic minor follows (up with raised 6 and 7, down as natural minor), with each minor next to its relative major. A new scale opens in guided mode, with the next key highlighted, note names, the hint and the fingering (majors only). Then choose **Try from memory**, where names stay hidden until you play them. A wrong note counts as an error, but you keep going from the note you were on. Speed is the time per note from the prompt to the last note. At most four new scales are introduced per sitting.
- **Count** — three untimed eighth-note-ruler exercises with playback. These teach subdivision order; they do not yet assess timing or contribute to adaptive progress.

On a MIDI keyboard, hold common notes while moving the other fingers between chords. Rolls and overlapping releases are accepted. An optional root (or the specified slash bass) below the right hand is permitted; bass performance is not assessed. A repeated identical chord requires a new attack. For the on-screen piano, hold multiple fingers on touch devices, or click keys to toggle them with a mouse.

A question has one result: clean recall, assisted practice, or an incorrect attempt subsequently corrected. Guidance does not lower recall accuracy. An unaided error still counts as an incorrect recall if you request help afterward, and the use of help is also retained. Wrong pitches and octave errors are recorded separately. Chunk preview time, time in the background, and time viewing the heat map are excluded from recall timing. Preview input is ignored; peeking during chunk playback marks the remaining steps as assisted.

The heat map uses **Learning**, **Reliable**, **Fluent**, and **Review due**. Reliability requires at least five clean outcomes in the latest twelve records, at least 85% recent recall accuracy, two consecutive clean outcomes, and two successful returns after gaps of at least four hours. Those delayed successes must span at least 24 hours and fall within the last 30 days. Fluency additionally considers task-specific response speed. Review status considers the last clean response and the rest setting, with a minimum of one day. These are conservative app rules, not a validated measure of piano proficiency. One quick answer cannot establish fluency. Earlier totals remain available, while confidence requires new dated evidence.

Practice is continuous: there is no daily queue or Again / Hard / Good / Easy grading. Unseen and difficult items receive more weight. The existing rest ladder reduces selection probability; a fuller overdue-review scheduler is still future work. Chords open one curriculum stage at a time, with a cap on new introductions per sitting.

Progress stays in this browser under `piano-practice:v1`, now with save schema 2. The first write after upgrading preserves the original schema-1 save at `piano-practice:before-v2`. Old backups still import. Existing note, interval, and chord totals are retained; historical mixed staff records cannot be retrospectively separated. Separate construction and rhythm storage is reserved for future exercises. Export a backup from the heat map. On the iPad, add the page to the Home Screen so the browser is less likely to clear the data.

Open it in midiweb so the keyboard can connect. Tap **Connect MIDI**.

```bash
bun install
bun test
bun run typecheck
bun run build
```

Tests cover chord transitions, guided/recall flows with simulated MIDI, error attribution, delayed progress evidence, and save migration. They do not replace testing a physical keyboard on the iPad.

Upload `dist/` and serve it over HTTP. `index.html` already contains the deck, so the page does not need a separate `deck.json` fetch when the script is allowed to run.
