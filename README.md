# vbz.gg SDK

The SDK for building games that run on [vbz.gg](https://vbz.gg), the backend
that checks and ranks the scores of a game studio's games.

A game on vbz.gg is a [Clockwork 2](https://github.com/vbz-gg/clockwork2)
simulation, so its score is something a server can check rather than trust: the
browser records what the player pressed, the server replays that log, and the
server's answer is the one that counts. This repository is what sits between
that engine, the vbz.gg platform and the page a studio serves its game from.

It publishes one package, `@vbz-gg/sdk`, which carries:

- **the page module**: what a game is built into for a studio's page to load,
  and the contract between the two, so a page and a game built against
  different releases still work together
- **a page's client and host**, which sign a player in, load the game's page
  module, play a run against the platform, replay a settled run for watching
  and show the board
- **the build and the checks**, which turn a game into the two modules an
  upload carries and hold it to the engine's and the platform's rules first
- **a harness**, which loads your game locally the way a studio's page does:
  two origins, the platform's paths and headers, the policy a studio's page
  sends, and a replay of every run
- **an agent guide**, the same material written for an agent to follow,
  which `vbz new` and `vbz guides` copy into a game beside the engine's

Versions up to 0.2.0 were published as `@vbz-gg/game-base`, from a
repository of that name, and the command was `game-base`. Later versions are
`@vbz-gg/sdk`, and the command is `vbz`.

What a game author does with it is in
[`packages/sdk/README.md`](packages/sdk/README.md), and
[`docs/sdk.md`](docs/sdk.md) explains how the whole thing works.

## Layout

```
packages/sdk/                 the published package
packages/sdk/templates/       a game to copy and start from, shipped with it
packages/sdk/skill/vbz-game/  the agent guide for building one, shipped with it
docs/sdk.md                   how it works, from first principles
fixtures/paddle/              a small game steered by tilt
fixtures/folder/              a game that loads from its files folder as an engine built into one does
e2e/                          the browser suite, driving the harness and a studio's page for real
scripts/                      this repository's own tooling
```

## Commands

```bash
bun install
bun run build          # tsc -b over project references
bun run typecheck
bun run lint           # biome check .
bun run lint:fix
bun run test           # the unit suite; bare `bun test` also picks up the browser specs
bun run test:coverage  # the same tests, then the 99% floor over packages/*/src
bun run test:e2e       # the browser suite: the harness and a studio's page, for real
bun run check:publishable   # pack the package and read what a consumer gets
```

A release is one dispatch of `release.yml`, which bumps, publishes and tags.
`engine-update.yml` opens a pull request when clockwork2 publishes a new
engine. Both are in [`AGENTS.md`](AGENTS.md).

## License

MIT
