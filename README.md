# Piano

One practice app for the iPad at the piano, in the GrandStaff studio layout.

- **Staff** — note recall, interval shapes, and flash chunks. Latency, accuracy, and clef flips are saved.
- **Chords** — Piano For All shapes and progressions. You play the right-hand grip on a MIDI keyboard. The app hears whether it was the written shape, and how long it took.
- **Count** — reserved for a pulse drill (`1 e & a`). The rhythm patterns already live in `src/app/rhythm.ts`.

There is no daily queue and no Again / Hard / Good / Easy buttons. Each note, interval, and chord keeps one record. Unseen and shaky items come up more often. Fluent ones rest, then return. Notes rest for minutes. Chords rest for longer. A miss brings an item back immediately.

Chords open one curriculum stage at a time. Inside that stage, shapes you have already met stay in the mix, and the next unmet shape joins them. A sitting introduces a handful of new shapes, then reviews, so one long session does not open the whole book. Raising the stage lets the next unmet shape be further along. It does not dump every new card at once.

Progress is stored in this browser under `piano-practice:v1`. The first launch copies note and interval stats from `grandstaff_trainer_stats_v1` when that key exists. Old chord schedules under `chord-practice:v2` are left untouched. Export a backup from the heat map. On the iPad, add the page to the Home Screen so the browser is less likely to clear the data.

Open it in midiweb so the keyboard can connect. Tap **Connect MIDI**.

```bash
bun install
bun test
bun run build
```

Upload `dist/` and serve it over HTTP. `index.html` already contains the deck, so the page does not need a separate `deck.json` fetch when the script is allowed to run.
