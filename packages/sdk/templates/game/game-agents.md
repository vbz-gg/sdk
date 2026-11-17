# Lane Runner

Lane Runner is a game built with the vbz kit (`@vbz-gg/sdk`) on the
Clockwork 2 engine (`@clockwork2/engine`). It is one build, played two ways:

- **Locally**, on its own page in `site/`, which talks to nobody while
  `site/config.json` says `{ "mode": "local" }`, as it ships.
- **Ranked**, on [vbz.gg](https://vbz.gg), once the page names the ranked
  mode and the game is published: vbz.gg serves each run its seed and
  settings, this build plays it and records the player's inputs, and a
  server replays them, so the score it computes is the one that counts.

A ranked run also holds the game to rules a local run does not: the seed
has to change what happens, a run holds at most 16 inputs a tick on
average, inputs come only from the engine's device helpers, and the checks
play every setting at its default. `bunx vbz check . --ranked` runs them.

## Commands

```bash
bun install
bun run dev      # play it, with a replay of every run
bun run check    # the engine's checks, and the input mapping held to the manifest
bun run build    # the two modules, the manifest and the files folder, into dist/
bun run site     # the game's page, in the mode site/config.json names
VBZ_STUDIO_KEY=vbz_sk_... bunx vbz publish . --game <game id>
```

There is no `publish` script, because npm runs a script with that name by
itself as part of `npm publish`.

## The one rule

The simulation, everything under `src/sim/`, must be a pure function of its
seed, its config, its input log and the data packs its manifest pins, and
must produce the same bits on V8, JavaScriptCore and SpiderMonkey. That
holds for a local run as much as a ranked one, because a recording replays
anywhere. vbz.gg's server replays a ranked run with nothing else, on
whichever engine it runs, so a simulation that reads anything more, such as
`Math.random`, the clock or the page, replays to a different state and the
run never reaches the board. A data
pack is a file of the game's files folder, the one `package.json` names, and
the platform stores it with the version and hands it to the replay.

## The guides

Two guides hold the rest, written for an agent to follow:

- `.claude/skills/clockwork2/SKILL.md` is the engine's: how to write a
  simulation that replays to the same state on a server.
- `.claude/skills/vbz-game/SKILL.md` is the kit's: everything between that
  simulation and a game on vbz.gg, from inputs and controls to publishing.

Read both before changing the game. They come from the versions of the two
packages this game installed, so after upgrading `@vbz-gg/sdk` or
`@clockwork2/engine`, run `bunx vbz guides` to replace them with the guides
the new versions ship.
