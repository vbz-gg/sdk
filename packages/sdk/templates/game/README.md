# Lane Runner

A starting point for a game that runs on vbz.gg. Three lanes, rocks coming
towards you, motes to collect.

```bash
bun install
bun run dev      # play it, loaded the way a studio's page loads it
bun run check    # the engine's checks, and the input mapping held to the manifest
bun run build    # the three files an upload carries
```

## What is where

```
src/sim/index.ts      the rules code's entry: a default export and MANIFEST
src/sim/game.ts       the simulation, the only thing that decides a score
src/sim/field.ts      where the playfield and the two buttons are, in the game's own units
src/sim/manifest.ts   what the platform knows without running anything
src/capture.ts        which keys, fingers and controllers drive which inputs
src/present/canvas.ts the renderer, which reads and never writes
src/present.ts        the page module's entry, which a studio's page loads
```

The line that matters is between `src/sim/` and everything else. The
conformance checker is pointed at `src/sim/index.ts` and scans its imports
transitively: a simulation that can reach a canvas is a simulation that can
decide a score from one. Swap the renderer and nothing in `sim/` changes,
which is what lets the platform replay your game on a server with no canvas
at all.

## Controls

The game draws its own controls. The renderer paints two buttons along the
bottom, and `tick` decides whether a finger landed on one, against the same
rectangles in `src/sim/field.ts`. Nothing on the page draws a pad for you, and
nothing should decide in the renderer what was pressed: that would replay
perfectly and still settle the result where nothing checks it.

`src/capture.ts` says what each device records, through the engine's device
helpers: the arrow keys and A and D press `left` and `right`, as a
controller's d-pad does; a controller's stick is recorded as left, centre or
right; and two fingers each record whether they are down and where they are,
in coarse steps across the field. Two thumbs, one on each button, are two
fingers. The canvas fills the element it is mounted in, because a finger is
measured across that element, so the buttons are where the game believes
they are at every size.

At the smallest size the manifest allows, 320 by 480 CSS pixels, each button
is drawn 100 by 80 pixels and takes a press across 110 by 90. A test measures
both against the 44 pixels a thumb needs, so keep it passing when you move
them.

Keep the ranges coarse. Every value a finger crosses is an input to record,
store and replay, and a range of 0 to 16 across the field records a fraction
of what 0 to 1000 would, for a game that only needs to know which button.

## Releasing

The version is written once, in `src/sim/manifest.ts`, and `package.json`
carries none. The comment above it lists what a release line fixes. In
short: a patch changes how the game looks or fixes a bug and keeps what a
score means; a minor changes the rules; a major is a different game. Every
version sharing a `MAJOR.MINOR` is one release line, which players, the board
and the day's seed treat as one game.

To release:

```bash
# raise version in src/sim/manifest.ts, then
bun run check
bun run build
VBZ_STUDIO_KEY=vbz_sk_... bunx vbz publish . --game <game id>
```

There is no `publish` script in `package.json` on purpose: npm runs a script
with that name by itself, as part of `npm publish`.

`vbz publish` prints the release line the version joined and, once the
platform's checks pass, which runs it serves. A patch of today's line reaches
today's ranked runs from the next start. A new minor or major waits for the
next day's seed, so nobody's ranked day changes rules halfway through. A patch
that changes a field its line fixes is refused with `E_PATCH_CHANGES_RULES`,
and the command prints which fields moved and the minor to publish them as
instead.

## Undoing a patch

A studio never takes a version down. It replaces one by publishing a newer
version, and today's ranked runs reach the newer one from their next start.
To go back to how 1.0.2 played after 1.0.3 turned out broken, publish 1.0.2's
code as 1.0.4:

```bash
git switch -c undo-1.0.3 <the commit 1.0.2 was built from>
# set version in src/sim/manifest.ts to 1.0.4: above every version of the line
bun run check
bun run build
VBZ_STUDIO_KEY=vbz_sk_... bunx vbz publish . --game <game id>
```

The number has to move forward: a patch must be greater than every version
already in its line, rejected ones aside, so 1.0.2 again is refused as a
version that exists. The old code is still a patch, because it keeps what the
line fixes.
