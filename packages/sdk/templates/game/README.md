# Lane Runner

A starting point for a game on the Clockwork 2 engine, built with the vbz
kit. Three lanes, rocks coming towards you, motes to collect.

```bash
bun install
bun run dev      # play it, with a replay of every run you play
bun run check    # the engine's checks, and the input mapping held to the manifest
bun run build    # the two modules, the manifest and the files folder, into dist/
bun run site     # the game's own page, played locally
```

It is one build, and you ship it any way you choose: your own site, a
static host, a game portal, or a page that is never online. Its own page,
`site/`, plays the build beside it and talks to nobody: no account, no
upload, no sign-in, and no limit on how long a run lasts. A player has no
identity there unless you give them one.

Ranked runs on vbz.gg are one more use of the same build, which you may
never need; "If you use vbz.gg" below has them.

## What is where

```
src/sim/index.ts      the rules code's entry: a default export and MANIFEST
src/sim/game.ts       the simulation, the only thing that decides a score
src/sim/field.ts      where the playfield and the two buttons are, in the game's own units
src/sim/manifest.ts   the manifest: inputs, counters, settings and version
src/capture.ts        which keys, fingers and controllers drive which inputs
src/present/canvas.ts the renderer, which reads and never writes
src/present.ts        the page module's entry, which a page loads
site/                 your game's page: played locally, or on vbz.gg sign-in, Play, Practice and the board
site/config.json      which of the two the page is: { "mode": "local" } as it ships
AGENTS.md             what an agent working on the game reads first
.claude/skills/       the engine's guide and the kit's, for an agent to follow
```

The line that matters is between `src/sim/` and everything else. The
conformance checker is pointed at `src/sim/index.ts` and scans its imports
transitively: a simulation that can reach a canvas is a simulation that can
decide a score from one. Swap the renderer and nothing in `sim/` changes,
which is what lets a replay, the harness's or a server's, run your game with
no canvas at all.

The two guides in `.claude/skills/` come from the versions of
`@clockwork2/engine` and `@vbz-gg/sdk` the game installed. After upgrading
either, `bunx vbz guides` replaces them with the ones the new versions ship.

Lane Runner ships no files folder. A game that needs one, for a renderer's
engine, art, or data the rules code reads, names it in `package.json` as
`"vbz": { "files": "files" }`, and says there what a page's policy has to
allow for it. The kit's guide has it in `references/files.md`, and drawing
with null3d in `references/null3d.md`.

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

Keep the ranges coarse. Every value a finger crosses is an input to record
and replay, and a range of 0 to 16 across the field records a fraction of
what 0 to 1000 would, for a game that only needs to know which button.

## The page

`site/` is the page players open, and it is yours to deploy wherever you
host your site. `site/index.html` is the shell, `site/page.ts` wires it up
with the SDK and `site/messages.ts` holds every sentence it shows.
`site/config.json` names the page's mode, and the page is in no other.

**Played locally**, `{ "mode": "local" }`, which a new game ships with, the
page talks to nobody. It loads the build `bun run build` wrote, served beside
the page as `game/`, and Play starts a local run with `playLocal`: no
sign-in, no board, and nothing sent anywhere. `index.html` maps the page
module's two imports, `cw2:sim` and `cw2:files/`, to `./game/sim.js` and
`./game/files/` with an import map, so a plain static host serves `dist/` as
it is, and `dist/game.json` tells the page where each part is. A page that
sends a Content-Security-Policy admits the import map by the SHA-256 of its
exact text.

**Ranked, on vbz.gg**, `{ "mode": "ranked", "apiOrigin":
"https://api.vbz.gg", "signInOrigin": "https://signin.vbz.gg", "pageKey":
"vbz_pk_..." }`, the page signs a player in through a box over the page
holding the platform's sign-in, loads the game's page module before the Play
button is pressed, starts a ranked or a practice run in the click, and shows
today's board. The platform says which version each run plays; the page
loads what it is told and never chooses. The build is the same one; opting
in is this file and `vbz publish`. A page key is public, so the file can
ship as it is; without one, the page says which file to fill in.

`bun run site`, which is `vbz dev . --site`, serves it on this machine in
the mode `site/config.json` names. Played locally, the build is served
beside the page as `/game/`. Ranked, on vbz.gg, the page talks to a stand-in
for the platform's page routes and sign-in, which plays as one local player
on a fixed seed, and `bun run site` answers the page's `config.json` with
the stand-in's API, sign-in and page key. The stand-in neither replays nor
ranks a run: it settles each one with the counters the page sent, and says
so in the terminal. The page is served under the Content-Security-Policy a
page should send, which lets scripts come from your page's own
origin and, ranked, from your game's own path on the platform's bundles
origin, and nowhere else, and lets the page frame the sign-in. In production
that path is `https://files.vbz.gg/g/<game id>/`.

To deploy it, bundle `site/main.ts` for the browser with whatever builds the
rest of your site and serve it as `main.js` beside `index.html` and
`site.css`, with `dist/` beside them as `game/` when the page plays locally.
Any host that serves files will do, as long as it sends every `.js` file as
JavaScript and a `.wasm` file as `application/wasm`; the kit's guide has
the rest under "Distributing the build", with the policy the page sends.
`dist/sim.js` and `dist/present.js` keep their names from one build to the
next, so cache them as files that change in place.

## If you use vbz.gg

vbz.gg serves each ranked run its seed and settings, this same build plays
it on your page and records the player's inputs, and vbz.gg replays them on
a server and ranks the score its replay computed. A practice run is the
same, and never on a board. A ranked run holds the game to a few rules a
local one does not: the seed has to change what happens, a run holds at most
16 inputs a tick on average, inputs come from the engine's device helpers
and never from a script on the page, and the checks play every setting at
its default. `bunx vbz check . --ranked` runs those checks before an upload.

On a day when ranked play is paused, because the version the day's runs
were playing was taken down, the page says "Ranked play is paused; practice
is open" and reads the game again on every Play, so the first Play after a
newer patch passes its checks is a ranked run again. A player barred for
tampered submissions is told when the bar ends.

### Releasing on vbz.gg

A game played only on its own page needs none of this. The version is
written once, in `src/sim/manifest.ts`, and `package.json` carries none. The
comment above it lists what a release line fixes. In short: a patch changes
how the game looks or fixes a bug and keeps what a score means; a minor
changes the rules; a major is a different game. Every version sharing a
`MAJOR.MINOR` is one release line, which players, the board and the day's
seed treat as one game.

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

### Undoing a patch on vbz.gg

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
