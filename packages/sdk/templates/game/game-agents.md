# Lane Runner

Lane Runner is a game built with the vbz.gg SDK (`@vbz-gg/sdk`) on the
Clockwork 2 engine (`@clockwork2/engine`). It is one build, shipped any way
its author chooses: their own site, a static host, a game portal, or a page
that is never online. Its own page in `site/` plays it and talks to nobody
while `site/config.json` says `{ "mode": "local" }`, as it ships: nothing is
uploaded, and nobody signs in.

Ranked runs on [vbz.gg](https://vbz.gg) are optional. Once the page names
the ranked mode and the game is published, vbz.gg serves each run its seed
and settings, this build plays it and records the player's inputs, and a
server replays them, so the score it computes is the one that counts. A
ranked run also holds the game to rules a local run does not: the seed has
to change what happens, a run holds at most 16 inputs a tick on average,
inputs come only from the engine's device helpers, and the checks play
every setting at its default. `bunx vbz check . --ranked` runs them.

## Commands

```bash
bun install
bun run dev      # play it, with a replay of every run
bun run check    # the engine's checks, and the input mapping held to the manifest
bun run build    # the two modules, the manifest and the files folder, into dist/
bun run site     # the game's page, in the mode site/config.json names
# only if the game is published to vbz.gg:
VBZ_STUDIO_KEY=vbz_sk_... bunx vbz publish . --game <game id>
```

There is no `publish` script, because npm runs a script with that name by
itself as part of `npm publish`.

## The one rule

The simulation, everything under `src/sim/`, must be a pure function of its
seed, its config, its input log and the data packs its manifest pins, and
must produce the same bits on V8, JavaScriptCore and SpiderMonkey. A run's
recording replays anywhere: the harness replays every run, and on vbz.gg a
server replays every ranked run, on whichever engine it runs, with nothing
else. So a simulation that reads anything more, such as `Math.random`, the
clock or the page, replays to a different state, and on vbz.gg the run
never reaches the board. A data pack is a file of the game's files folder,
the one `package.json` names, and goes with the build to every replay.

## The guides

Two guides hold the rest, written for an agent to follow:

- `.claude/skills/clockwork2/SKILL.md` is the engine's: how to write a
  simulation that replays to the same state anywhere.
- `.claude/skills/vbz-game/SKILL.md` is the SDK's: everything between that
  simulation and a game a page plays, from inputs and controls to shipping
  the build, and, if you use vbz.gg, publishing it.

Read both before changing the game. They come from the versions of the two
packages this game installed, so after upgrading `@vbz-gg/sdk` or
`@clockwork2/engine`, run `bunx vbz guides` to replace them with the guides
the new versions ship.
