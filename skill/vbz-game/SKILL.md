---
name: vbz-game
description: Build a game that runs on vbz.gg, the backend that checks and ranks a game studio's scores, on top of a Clockwork 2 simulation - the two artifacts an upload carries, the manifest the platform reads without running anything, drawing your own controls and mapping keys, fingers and tilt to the inputs the manifest declares, and the page module a studio's page loads. Use when starting a game for vbz.gg, mapping inputs, writing the page module entry, testing against the harness, or working out why ingest refused an upload. For the simulation's own rules - fixed ticks, seeded randomness, dmath, snapshots - use the platform-game skill instead.
---

# Building a game that runs on vbz.gg

Two skills, and they do not overlap. **platform-game** is how to write a
simulation that replays to the same state on somebody else's server: fixed
ticks, `Prng`, `dmath`, snapshots, the twelve conformance checks. Read it
first and keep it open. **This one** is everything between a conforming
simulation and a game somebody can play on vbz: how it is laid out, how it is
built, how a phone steers it, and what the platform checks before it will list
it.

## Start here

```bash
bunx @vbz-gg/sdk new ./my-game
cd ./my-game && bun install
bun run dev                       # your game, loaded the way a studio's page loads it
```

The copy builds and plays before a line of it is changed, so anything that
breaks afterwards is something you just did. Its id is taken from the
directory name and is **immutable once published**: changing it later is a
different game with a different board.

## The shape of a game

```
src/sim/index.ts     the simulation's entry: default export + MANIFEST
src/sim/manifest.ts  what the platform reads without running anything
src/sim/game.ts      the rules
src/present/         the renderer
src/capture.ts       which keys, fingers and tilt drive which inputs
src/present.ts       the page module's entry, which a studio's page loads
```

Two entries, and they become two files:

| Entry | Becomes | Loaded by |
|---|---|---|
| `src/sim/index.ts` | the **simulation**, the rules code | the browser **and** the server that replays you |
| `src/present.ts` | the **page module** | a studio's page, in the browser |

`src/sim/index.ts` must never reach `src/present/`. The import graph is
scanned transitively, and a simulation that can reach a canvas is a simulation
that can decide a score from one. The page module does not carry its own copy
of the simulation either: it imports `cw2:sim`, which the platform rewrites to
the simulation's content address at upload. One object, fetched by the browser
and loaded by the validator, same bytes and same hash.

`bun run build` writes all three files a submission carries:
`dist/sim.js`, `dist/present.js` and `dist/manifest.json`.

## Inputs

A manifest declares each input the game records, by name and the whole numbers
it carries, and nothing about devices:

```ts
inputs: {
  left: { min: 0, max: 1, label: "Left" },  // a press
  right: { min: 0, max: 1, label: "Right" },
}
```

`src/capture.ts` says which keys, fingers, gamepad buttons and tilt drive each
one, as the engine's `CaptureMapping`. It touches no DOM, so it can be checked
without loading anything that draws, and the engine's `checkCapture` refuses a
mapping that names an input the manifest does not declare.

A mapping that reads tilt makes tilt required. A page starts no run on a
device or in a browser that cannot give it, a laptop included, and keys
mapped beside it do not change that. Try such a game on a laptop with the
browser's sensor emulation.

A game draws its own controls. Its renderer paints them, and the game records
where a finger is and whether it is down, and **hit-tests in `tick`**, in the
units its manifest declares. Not in the renderer: a game may not construct an
input event, and a renderer that decided which control was pressed would be
deciding the result on the client.

## What the page module entry does

`src/present.ts` hands the rules code, its manifest, the renderer and the
mapping to `definePageModule` from `@vbz-gg/sdk/game`:

```ts
export default definePageModule({ createGame, manifest: MANIFEST, createPresentation, capture })
```

That bundles the engine's host with your game, so the engine that plays a run
on a studio's page is the one you built and checked with. A studio's page
loads the module and calls its `mount`; it never builds a host of its own.
The renderer must fill the element it is mounted in, because a pointer's
position is measured across that element.

## Testing it

`bun run check` builds the game and runs the engine's conformance checks
over the rules code, holds `src/capture.ts` to the manifest, and prints the
version, its release line and the line's contract hash. It exits 0 only when
all of that passes.

`bun run dev` is your game's page on your laptop: the game's two modules on
one origin, and a page on another that loads the page module the way a
studio's page does, under the Content-Security-Policy a studio's page sends.
Two ports are two origins, so a module import that a studio's page would
refuse is refused here first.

When a run ends, the harness replays its recording against the built rules
code and says three things under the game: whether the replay matches, how
many inputs the recording holds against the budget the platform allows, and
its size in bytes. A run that does not match, or inputs the platform would
refuse, is what to fix before publishing. `references/harness.md` has the
flags for a phone (`--address`, `--https`) and `--site`, which serves the
game's own page against a stand-in for the platform.

## When ingest refuses

Every refusal carries a code. The ones that are about this skill rather than
about determinism:

- `E_SIM_NOT_SELF_CONTAINED` - the simulation imports something. It runs with
  no network at all, so an import is a fault on every session.
- `E_PRESENT_IMPORT_MISSING` - the page module carries its own copy of the
  simulation instead of importing `cw2:sim`. Two copies is the thing the
  whole split exists to prevent.
- `E_PRESENT_IMPORT_UNEXPECTED` - the page module imports something besides
  the simulation. Bundle it in.
- `E_PRESENT_SPECIFIER_AMBIGUOUS` - `"cw2:sim"` also appears as data, so
  rewriting the specifier would change something the game reads.
- `E_VERSION_INVALID` - the version is not plain `MAJOR.MINOR.PATCH`.
- `E_MANIFEST_INVALID` - the manifest's shape is wrong.
- `E_RANKBY_UNDECLARED` - `rankBy` names a counter you did not declare. The
  game would list and never rank anybody.

`references/ingest.md` has the whole path from an upload to a listing.

## Versions

A `version` is `MAJOR.MINOR.PATCH`, and vbz reads it as a promise about the
rules. A **patch** changes how the game looks or fixes a bug and keeps what a
score means; a **minor** changes the rules; a **major** is a different game.
All patches of one `MAJOR.MINOR` are one release line, which the platform
treats as one game. A ranked run plays the highest published patch of the
day's line, highest by version number, so a patch that passes its checks
reaches the next ranked start. A new minor waits for the next day's seed.

Before bumping, compare the new manifest with the line's contract, which is
its earliest version that was not rejected. If `schemaVersion`, `id`,
`session`, `inputs` (each one's `min` and `max`), `counters` (each one's
`name`, `direction` and `monotonic`), `rankBy`, `tiePolicy`, `params` (all
but `label` and `description`), or the capabilities `deterministic`,
`physics` and `multiplayer` differ, it is a minor: the platform refuses that
patch with `E_PATCH_CHANGES_RULES`. `vbz check` prints the line's contract
hash, so two builds can be compared. If only the rules code changed, decide
whether the same play could now score differently. If it could, it is a
minor too: the platform cannot see that difference, and the board mixes a
line's patches.

A studio cannot take a version down. A broken version is replaced by
publishing a newer patch, and until that patch passes its checks the broken
one is what today's ranked runs play, so test a patch with `vbz dev` before
publishing it. When an operator takes down the patch today's ranked runs
play, nothing falls back to an older one: ranked play is paused until a
newer patch passes, and practice carries on.

## Never

- **Build an input event.** The engine's helpers record them. This is why a
  control is hit-tested in `tick` and not in the renderer.
- **Hit-test in CSS pixels.** A pointer is measured across the element in the
  range your manifest declares before the log sees it, so a coordinate in
  your `tick` is already in that space.
- **Draw a control somewhere the simulation does not believe it is.** Read one
  set of numbers from both sides, as the template's renderer and its `tick`
  both read the buttons' rectangles from `src/sim/field.ts`.
- **Reach the renderer from the simulation.** Not for a canvas size, not for a
  device pixel ratio, not once.
- **Change what the simulation does without bumping `version`.** Every score
  already recorded becomes unverifiable and nothing announces it.
- **Ship a rules change as a patch.** A patch is the same game, and its scores
  share a board with the line's earlier patches.
- **Change `id` after publishing.** It is the board.
- **Put the seed in a URL.** The page hands it to the module's `mount`.

## References

- `references/artifacts.md` - the two entries, `cw2:sim`, the rewrite, the
  content addressing and the size caps.
- `references/harness.md` - what `vbz dev` serves, the report on each run,
  the flags for a phone and for the game's own page, and what it does not
  reproduce.
- `references/ingest.md` - what the platform checks, in the order it checks it.
- `references/page.md` - the studio's page: signing a player in, a run from
  start to result, and the client's codes.

## Commands

- `vbz new <dir>` - a game that already conforms.
- `vbz build <dir>` - the three files a submission carries.
- `vbz check <dir>` - the engine's checks and the input mapping, with the
  version, its release line and the line's contract hash.
- `vbz dev <dir>` - your game's page, locally, on two origins, with a report
  on every run.
- `vbz publish <dir> --game <id>` - upload `dist/` and wait for the
  platform's verdict. The studio's secret key comes from `VBZ_STUDIO_KEY`,
  never a flag. It exits 0 when the version passed its checks and is
  published, and prints the release line it joined, which runs it serves,
  and how many of the line's recent ranked runs end differently under it.
  Anything else exits 1, a version an operator took down included: a
  rejection prints the first check that failed, and a refusal the
  platform's detail.
