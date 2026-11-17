# Lane Runner

Lane Runner is a game for [vbz.gg](https://vbz.gg), built with the vbz kit
(`@vbz-gg/sdk`) on the Clockwork 2 engine (`@clockwork2/engine`). A server
replays every run from the player's own inputs, and the score it computes is
the one that counts.

## Commands

```bash
bun install
bun run dev      # play it, loaded the way a studio's page loads it
bun run check    # the engine's checks, and the input mapping held to the manifest
bun run build    # the two modules, the manifest and the files an upload carries
bun run site     # the game's page, against a stand-in for the platform
VBZ_STUDIO_KEY=vbz_sk_... bunx vbz publish . --game <game id>
```

There is no `publish` script, because npm runs a script with that name by
itself as part of `npm publish`.

## The one rule

The simulation, everything under `src/sim/`, must be a pure function of its
seed, its config, its input log and the data packs its manifest pins, and
must produce the same bits on V8, JavaScriptCore and SpiderMonkey. The server
replays it with nothing else, on whichever engine it runs, so a simulation
that reads anything more, such as `Math.random`, the clock or the page,
replays to a different state and the run never reaches the board. vbz.gg
does not yet take a simulation that reads a data pack, so for a game here
that leaves the seed, the config and the input log.

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
