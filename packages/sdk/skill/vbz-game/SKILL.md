---
name: vbz-game
description: Build a game on a Clockwork 2 simulation with the vbz kit: played locally on any page, and opted in to ranked runs on vbz.gg, which replays each ranked run on a server to check and rank it. Covers the one build and its runs, playLocal and the game's own page, opting in to ranked play, why a run is replayed and what that asks of a game - one seeded Prng and never Math.random, and a game that ignores its seed refused at upload - drawing your own controls and hit-testing them in tick, mapping keys, fingers, tilt and a locked mouse to declared inputs through the engine's device helpers, choosing what to record, the page module, the manifest, the files folder, data packs, a page's policy, the limits, and drawing with null3d. Use when starting a game, playing it locally, publishing it, adding randomness or data, mapping inputs, testing against the harness, or reading a refused upload. For the simulation's full rules - fixed ticks, Prng streams, dmath, snapshots, the checks - use the engine's guide, clockwork2.
---

# Building a game with the vbz kit

Two guides. The engine's, **clockwork2**, is how to write a simulation that
replays to the same state anywhere: fixed ticks, `Prng`, `dmath`, snapshots,
the conformance checks. Read it first and keep it open. **This one** is
everything between a conforming simulation and a game somebody plays: how it
is laid out and built, how a phone steers it, how a page plays it locally,
and what vbz.gg checks before it will rank it. It repeats the engine's guide
in two places, briefly, because they are the two things an author gets
wrong first: where randomness comes from, and what to record.

A game made with `vbz new` keeps both guides in `.claude/skills/`, this one
at `.claude/skills/vbz-game/` and the engine's at `.claude/skills/clockwork2/`,
copied from the versions of the two packages it installed. The packages ship
them at `node_modules/@vbz-gg/sdk/skill/vbz-game/` and
`node_modules/@clockwork2/engine/skill/clockwork2/`. A path that starts
`clockwork2/` is a file in the engine's guide.

## One build, and the runs it plays

A game is one build, and it plays wherever its author puts it.

- **Played locally**, on the game's own page, it is whatever the author
  intends: a story, free play, an endless session, a page that is never
  online. `playLocal` plays it, and nothing is uploaded, signed in or sent.
  A new game's page does exactly this.
- **A ranked run** is a kind of run vbz.gg serves: the platform issues the
  seed and serves the config, the same build plays it on a studio's page and
  records the player's inputs, and the platform replays them on a server and
  ranks what its replay computed. **A practice run** is the same, and never
  on a board. A game opts in by naming the ranked mode in
  `site/config.json` and publishing; the build does not change.
- **No run has a step limit**, local, ranked or practice. A run goes until
  the game ends it or the player leaves.

Determinism binds every run. Four rules bind only ranked and practice runs,
and a game played only locally may break them:

- the seed changes the state (`E_SEED_IGNORED`), and the manifest says how
  a run ranks (`E_RANK_UNDECLARED`);
- a run holds at most 16 inputs a tick on average (`E_INPUT_BUDGET`);
- inputs come only from the engine's device helpers, and an event a script
  on the page made is ignored;
- the platform's checks play the config a run is served: every declared
  setting at its default.

`vbz check --ranked` holds a game to them before its first upload.

## Start here

```bash
bunx @vbz-gg/sdk new ./my-game
cd ./my-game && bun install
bun run dev                       # your game, with a replay of every run
bun run site                      # your game's own page, played locally
```

The copy builds and plays before a line of it is changed, so anything that
breaks afterwards is something you just did. Its id is taken from the
directory name and is **immutable once published**: changing it later is a
different game with a different board.

The copy also carries the two guides in `.claude/skills/`, and an `AGENTS.md`
with the commands, the one rule and where the guides are, for an agent that
reads that file rather than loading skills. After upgrading `@vbz-gg/sdk` or
`@clockwork2/engine`, run `bunx vbz guides` from the game's root: it replaces
both folders with the guides the installed versions ship.

## The shape of a game

```
src/sim/index.ts     the simulation's entry: default export + MANIFEST
src/sim/manifest.ts  what the platform reads without running anything
src/sim/game.ts      the rules
src/present/         the renderer
src/capture.ts       which keys, fingers and tilt drive which inputs
src/present.ts       the page module's entry, which a page loads
site/                the game's own page
site/config.json     the page's mode: { "mode": "local" } or ranked
```

Two entries, and they become two files:

| Entry | Becomes | Loaded by |
|---|---|---|
| `src/sim/index.ts` | the **simulation**, the rules code | the browser **and** the server that replays you |
| `src/present.ts` | the **page module** | a page, in the browser: the game's own, or a studio's |

`src/sim/index.ts` must never reach `src/present/`. The import graph is
scanned transitively, and a simulation that can reach a canvas is a simulation
that can decide a score from one. The page module does not carry its own copy
of the simulation either: it imports `cw2:sim`, which the platform rewrites to
the simulation's content address at upload. One object, fetched by the browser
and loaded by the validator, same bytes and same hash.

`bun run build` writes everything a page plays and an upload carries:
`dist/sim.js`, `dist/present.js`, `dist/manifest.json`, the files folder the
game's `package.json` names, copied to `dist/files/` and listed in
`dist/files.json`, and `dist/game.json`, which a page playing locally reads
(`references/artifacts.md`).

## Replays and randomness

A score on vbz is what a server computed, not what the page showed. The page
records the player's inputs and sends them, the platform replays them against
your rules code on a server, with the seed and config it issued for the run,
and the board takes the counters that replay reached. A run whose replay
disagrees with the page never reaches the board. So everything the simulation
does has to follow from the seed, the config and the inputs, and randomness
is where that breaks first:

- One `Prng` from `@clockwork2/engine`, made in `init` from the seed `init`
  is given: `this.rng = new Prng(seed)`. Never `Math.random`, and never a
  seed of your own from the clock, the URL or the device. The server has none
  of them.
- Each system draws from its own labelled sub-stream:
  `this.spawn = this.rng.stream("spawn")`, then
  `this.spawn.randomInt(0, 2)`, which includes both ends. With one stream, a
  draw added to one system shifts every later draw in another, and every run
  already recorded stops replaying.
- The generator is part of the state. `snapshot()` holds
  `this.rng.exportState()`, and `restore()` hands it back with
  `this.rng.importState(state)`, which restores the sub-streams with it.
- The renderer may use `Math.random` for anything the simulation never reads,
  such as which way a spark flies.

A game that ignores its seed passes every check the engine runs on every game
and is still refused at upload. The engine's ranked set, which
`vbz check --ranked` runs here, adds a seed check that plays one input log
under two seeds, and the platform runs that check on an upload too: a game
that passes through the same states under both is rejected with
`E_SEED_IGNORED`, because every day would be the same puzzle and the daily
board an all-time one. `clockwork2/references/determinism-rules.md`
has the full rules, `dmath` and time included.

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
mapping that names an input the manifest does not declare. The engine's
device helpers do the recording, from real devices, through that mapping.

A mapping that reads tilt makes tilt required. A page starts no run on a
device or in a browser that cannot give it, a laptop included, and keys
mapped beside it do not change that. Try such a game on a laptop with the
browser's sensor emulation.

A game draws its own controls. Its renderer paints them, the game records
where a finger is and whether it is down, and the simulation **hit-tests in
`tick`**, as the next section says.

## Choosing what to record

Every input a run records is sent, stored and replayed, and the platform
refuses a run holding more than 16 inputs per tick, counted over the whole
run (`E_INPUT_BUDGET`). What a game records is decided by the ranges in its
manifest and by `src/capture.ts`:

- Record changes, not streams. The device helpers record a level (where a
  finger is, a stick, tilt) only when its value changes, and a press once
  when it goes down and once when it comes up. Never push a reading of your
  own every frame.
- Declare the coarsest range that still tells the game what it needs. The
  range is the recording's resolution: a finger measured in a thousand steps
  crosses one on nearly every frame, and the template records one in coarse
  steps across its field, which is all it needs to tell two buttons apart.
- Hit-test in `tick`. Record where a finger is and whether it is down, in the
  manifest's units, and let the simulation decide what was under it, against
  the same rectangles the renderer draws from. A renderer that worked out
  which control was pressed and recorded the answer would replay perfectly
  and still have settled the result where nothing checks it.
- Leave out what `tick` never reads, and give a stick or tilt a deadband, so
  a resting hand records nothing.

`clockwork2/references/inputs.md` has the rules in full and a measured table
of what each kind of device costs over a five-minute run. The harness reports
every run's inputs against the budget, so try a new mapping there before
publishing.

## What the page module entry does

`src/present.ts` hands the rules code, its manifest, the renderer and the
mapping to `definePageModule` from `@vbz-gg/sdk/game`:

```ts
export default definePageModule({ createGame, manifest: MANIFEST, createPresentation, capture })
```

That bundles the engine's host with your game, so the engine that plays a run
on any page is the one you built and checked with. A page loads the module
and calls its `mount`; it never builds a host of its own. The renderer must
fill the element it is mounted in, because a pointer's position is measured
across that element.

A renderer that has to get ready, because it compiles WebAssembly, starts
workers or waits for a GPU, has a `prepare` that resolves once it can draw.
The run's clock starts only then, so no tick runs and no input is recorded
before the game can be drawn, and a device that cannot draw it fails with
`E_PRESENTATION_FAILED` before tick 0, and before a ranked page asks the
platform for a run.

## The files folder and data packs

A game may carry a folder of files its own tools built: a renderer's engine,
art, and the data packs the rules code reads. Name it, and what a page's
policy has to allow for it, in `package.json`:

```json
{ "vbz": { "files": "files", "needs": { "wasm": true, "workers": true } } }
```

The page module imports a file of it as `cw2:files/<path>`. A data pack is a
file of it at the path the manifest's `assets` declares, with its size and
SHA-256, read by the rules code from `init` (a start pack) or once
`packsNeeded()` names it (a demand pack). `references/files.md` has the
folder, data packs, the needs and every limit.

## Playing locally

The game's own page, `site/`, plays the build beside it with `playLocal`
while `site/config.json` says `{ "mode": "local" }`, which a new game ships
with. It loads `game/game.json`, which `vbz build` writes, with
`localAddress`, maps the page module's `cw2:sim` and `cw2:files/` with an
import map, and talks to nobody. `playLocal` takes a seed and a config of
the page's own or plays a fresh seed and every setting at its default, and
hands `onEnded` the run's recording, which replays to the same counters. Its
seed always starts `local:`, which no seed the platform issues does, so a
local run can never be submitted as a ranked one. `references/page.md` has
it whole.

## Opting in to ranked play

1. Keep the four rules above. `vbz check --ranked` runs the set the
   platform runs on an upload.
2. Name the ranked mode, the platform's addresses and the game's page key in
   `site/config.json`, and try the page against the stand-in for the
   platform with `bun run site`.
3. Publish with `vbz publish`, from a build system holding the studio's
   secret key. The build is the same one the page played locally.

`references/page.md` has the client, the sign-in's box and a run from start
to result, and `references/ingest.md` what the platform checks.

## Testing it

`bun run check` builds the game and runs the engine's conformance checks
every game needs over the rules code, holds `src/capture.ts` to the manifest,
and prints the version, its release line and the line's contract hash. It
exits 0 only when all of that passes. `vbz check --ranked` runs the engine's
ranked set instead, which adds the seed check and that the manifest says how
a run ranks. Run it before every upload: it is how to test that a recording
replays to the state it recorded. The platform runs only part of that set on
an upload, and none of the checks that test record and replay, so a game
that is not deterministic passes the upload and fails its players;
`references/ingest.md` says what the platform runs.

`bun run dev` is your game's page on your laptop: the game's two modules and
its files folder on one origin, and a page on another that loads the page
module the way a studio's page does and plays it with `playLocal`, under the
Content-Security-Policy a studio's page sends, with the game's needs. Two
ports are two origins, so a module import that a studio's page would refuse
is refused here first.

When a run ends, the harness replays its recording against the built rules
code and says three things under the game: whether the replay matches, how
many inputs the recording holds against the budget the platform allows, and
its size in bytes. A run that does not match, or inputs the platform would
refuse, is what to fix before publishing. `references/harness.md` has the
flags for a phone (`--address`, `--https`) and `--site`, which serves the
game's own page in the mode `site/config.json` names: played locally from
the build, which a new game ships with, or ranked, against a stand-in for
the platform.

## When ingest refuses

Every refusal carries a code, and `vbz build` refuses most of the same
things first, on the same bytes. The ones that are about this guide rather
than about determinism:

- `E_SIM_NOT_SELF_CONTAINED` - the simulation imports something. It runs with
  no network at all, so an import is a fault on every session.
- `E_PRESENT_IMPORT_MISSING` - the page module carries its own copy of the
  simulation instead of importing `cw2:sim`. Two copies is the thing the
  whole split exists to prevent.
- `E_PRESENT_IMPORT_UNEXPECTED` - the page module imports something besides
  the simulation and files of its folder. Bundle it in, or build it into the
  folder.
- `E_PRESENT_DYNAMIC_IMPORT` - the page module loads code by `import()`. Code
  that loads by an address worked out as it runs goes in the files folder.
- `E_PRESENT_SPECIFIER_AMBIGUOUS` - `"cw2:sim"` or `cw2:files/` also appears
  as data, so rewriting the specifier would change something the game reads.
- `E_FILE_UNLISTED` - the page module imports a file the folder does not
  hold.
- `E_PACK_UNLISTED`, `E_PACK_MISMATCH` - a data pack the manifest declares
  is not in the folder, or is not the size and SHA-256 it declares.
- `E_VERSION_INVALID` - the version is not plain `MAJOR.MINOR.PATCH`.
- `E_MANIFEST_INVALID` - the manifest's shape is wrong, or `rankBy` is
  empty, names a counter you did not declare, or comes without `tiePolicy`;
  a setting it requires has no default, so no run could be served it; or it
  is over 512 KiB as JSON, which `vbz build` refuses first.
- `E_RANK_UNDECLARED` - the manifest declares neither `rankBy` nor
  `tiePolicy`, so a ranked run has nothing to be ordered by. A game played
  only on its own page may leave both out; `vbz check --ranked` reports the
  same code before an upload does.

After the upload, the checks decide, and `vbz publish` prints the code of the
first one that failed. Besides the engine's own codes, the platform's checks
end a version in these:

- `E_SIM_NO_MANIFEST`, `E_MANIFEST_MISMATCH` - the built simulation exports
  no `MANIFEST`, or one that is not the uploaded `dist/manifest.json`. Build
  again rather than editing either by hand.
- `E_CHECKS_OVER_BUDGET` - the engine's checks the platform runs at upload
  ran out of time on the game's start or its steps. Each step they play is
  given what one step of an hour of the game's own play at its own rate may
  cost its replay: 2,778 microseconds of one CPU a step at 30 steps a
  second, 1,389 at 60 and 695 at 120. Each time they load the rules code,
  once for the headless check and up to six times for the seed check,
  importing it, reading its start packs and running `init` are given 5
  seconds of one CPU a load. Written only once every attempt has run out, so
  a moment's slowness on the platform's side refuses nothing.
  `vbz check --ranked` prints what a step cost on your machine in its
  `performance` check; make the step, or the start, cheaper.
- `E_PAGE_MODULE_UNLOADABLE`, `E_PAGE_MODULE_INVALID`,
  `E_PAGE_MODULE_THREW` - the page module would not load in the checks'
  browser, was not one a page plays, or failed while it was mounted in
  watch mode on a recording with nothing pressed, got ready or ran a few
  steps. A game the checks' browser cannot draw, because it has no WebGL
  and no WebGPU, is mounted with `draw: false` and gets ready without
  drawing; that is reported, never refused.
- `E_PAGE_MODULE_NOT_READY` - the page module did not load and get ready
  within 60 seconds of the checks' browser starting: its presentation's
  `prepare`, or its start packs, never settled. Written only once every
  attempt has run out. A `prepare` that waits on something outside the
  game's files folder, on a permission, or on a network the checks do not
  have never gets ready there.
- `E_REPLAY_MODULE` - the rules code would not load on the platform's
  replay service, which loads it with its data packs and runs a few steps
  with nothing pressed, or the replay died while it loaded them. The first
  failure's message carries the service's own error text. The service is
  Cloudflare Workers, whose runtime refuses some work at a module's top
  level with an error of its own, which Cloudflare lists on its Hyperdrive
  troubleshooting page: "Disallowed operation called within global scope.
  Asynchronous I/O (ex: fetch() or connect()), setting a timeout, and
  generating random values are not allowed within global scope." So the top
  level of the rules code, and of every library it bundles, does none of
  those. The rules code, its data
  packs and the game's state share 128 MB of memory there.
- `E_REPLAY_OVER_BUDGET` - the same replay ran out of its CPU time, its wall
  time or its memory in those steps: 5 minutes of CPU, 7.5 minutes of wall
  time and 128 MB of memory, the platform's figures for one replay on
  Cloudflare. Make `init` and a step cheaper, or hold less at once in the
  rules code, its data packs and its state; every ranked run's replay has
  the same budget for every step the run took.
- `E_REPLAY_THREW`, `E_REPLAY_REACHED_OUT` - the same replay failed for
  another reason, and every player's run would too: the rules code threw or
  reached for something the replay service does not have, such as the
  network, in its first steps. The first failure's message says where.
- `E_ENGINE_DIVERGED`, `E_PAGE_MODULE_DIVERGED`, `E_REPLAY_MALFORMED` - no
  longer reached. They were JavaScriptCore, V8 and SpiderMonkey computing
  different states from the same bytes, the page module playing the bot's
  log to another state than its replay, and a log the replay service could
  not take; the checks no longer play a version in three engines, compare
  what its page module reports with a replay, or send the replay service a
  log. They stay in the SDK's types so code that names them keeps
  compiling.

`references/ingest.md` has the whole path from an upload to a listing.

## Drawing with null3d

null3d draws from workers with a WebAssembly core. It goes in the files
folder, built by its own Vite plugin, and its input stays off;
`references/null3d.md` is the recipe, mouse look-around and isolation
included.

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

- `references/artifacts.md` - the two entries, `cw2:sim`, the rewrite and
  the content addressing.
- `references/files.md` - the files folder, data packs, what a page's
  policy needs, and every limit.
- `references/harness.md` - what `vbz dev` serves, the report on each run,
  the flags for a phone and for the game's own page, and what it does not
  reproduce.
- `references/ingest.md` - what the platform checks, in the order it checks it.
- `references/page.md` - a page: playing locally, signing a player in, a
  ranked run from start to result, and the client's codes.
- `references/null3d.md` - drawing with null3d: the files folder, the
  readiness gate, input off, mouse look-around, its maths and isolation.

## Commands

- `vbz new <dir>` - a game that already conforms, with both guides in
  `.claude/skills/` and an `AGENTS.md`.
- `vbz guides <dir>` - replace the game's two guides with the ones its
  installed `@vbz-gg/sdk` and `@clockwork2/engine` ship. It stops, writing
  nothing, when either package or its guide is missing.
- `vbz build <dir>` - the two modules, the manifest and the files folder a
  submission carries.
- `vbz check <dir>` - the engine's checks and the input mapping, with the
  version, its release line and the line's contract hash. `--ranked` runs
  the set a ranked or practice run needs, which tests record and replay;
  the platform runs only part of it.
- `vbz dev <dir>` - your game's page, locally, on two origins, with a report
  on every run.
- `vbz publish <dir> --game <id>` - upload `dist/`, each file of the
  files folder the platform lacks and then the version, and wait for the
  platform's verdict. The studio's secret key comes from `VBZ_STUDIO_KEY`,
  never a flag. It exits 0 when the version passed its checks and is
  published, and prints the release line it joined, which runs it serves,
  and how many of the line's recent ranked runs end differently under it.
  Anything else exits 1, a version an operator took down included: a
  rejection prints the first check that failed, and a refusal the
  platform's detail. A version still being checked when the wait runs out
  exits 1 and says where to read its verdict later: the platform tries a
  check that ran out of time again before it refuses anything, so that
  refusal can come after the command has stopped.
