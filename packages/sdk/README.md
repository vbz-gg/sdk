# @vbz-gg/sdk

The SDK for building a game that runs on [vbz.gg](https://vbz.gg), the backend
that checks and ranks the scores of a game studio's games.

A game on vbz.gg is a [Clockwork 2](https://github.com/vbz-gg/clockwork2)
simulation: fixed-step ticks, seeded randomness, and an input log that a server
replays to check the score. Your studio serves the game from a page of its
own. This package is what sits between the engine, the vbz.gg platform and
that page: it builds your game into the two modules an upload carries, checks
it, gives your page a client for the platform and a host that loads and plays
the game, and runs all of it on your laptop first.

Versions up to 0.2.0 were published as `@vbz-gg/game-base`, with the command
`game-base`. The command is now `vbz`.

```bash
bunx @vbz-gg/sdk new ./my-game
cd ./my-game && bun install
bun run dev
```

That copy builds and plays before a line of it is changed, so anything that
breaks afterwards is something you just did. Its id comes from the directory
name and is immutable once published.

`@clockwork2/engine` is a peer dependency: your game installs one copy of the
engine, and both of its modules are built against it.

## The five commands

```bash
vbz new     <dir>   copy a game that already conforms, and rename it
vbz build   <dir>   write dist/sim.js, dist/present.js and dist/manifest.json
vbz check   <dir>   run the engine's checks and hold src/capture.ts to the manifest
vbz dev     <dir>   load the game the way a studio's page does, on two origins
vbz publish <dir> --game <id>   upload dist/ and wait for the verdict
```

`build` refuses a version that is not plain `MAJOR.MINOR.PATCH`. `check`
also prints the version, its release line and the line's contract hash, so
you can tell before an upload whether a patch keeps what its line fixes.

`dev` is your game's page on your laptop. The game's two modules are served
on one port at the paths and with the headers `files.vbz.gg` uses, and a page
on another port loads the page module from there and plays it, under the
Content-Security-Policy a studio's page should send. When a run ends, the
page shows whether the run replays to what it showed, how many inputs it
recorded against the budget the platform allows, and its size in bytes.
`--address` and `--https` with `--cert` and `--key` serve it to a phone on
your network, and `--site` serves your game's own page from `site/` against
a stand-in for the platform.

`publish` is for your build system. It uploads `dist/` to the game you name,
with one of your studio's secret keys from `VBZ_STUDIO_KEY`, then waits for
the platform's checks:

```bash
VBZ_STUDIO_KEY=vbz_sk_... vbz publish . --game <game id>
```

It exits 0 when the version passed its checks and is published, and prints
the release line it joined and which runs it serves: today's ranked runs,
the next day's, or none, and practice or not. Once the platform has measured
it, it also prints how many of the line's recent ranked runs end differently
under the new version, which decides nothing and is there for you to read.
Anything else exits 1: a
rejection prints the code and the first check that failed, a refusal prints
the platform's detail, such as the fields a patch may not change, and a
version an operator took down exits 1 too. The platform is
`https://api.vbz.gg` unless `--api` or `VBZ_API_ORIGIN` names another.
Don't add a script called `publish` to your `package.json`: npm runs a script
with that name on its own, as part of `npm publish`.

## Your game's two modules

`src/sim/index.ts` becomes the **rules code**, which decides the score and
imports nothing: the platform replays it on a server with no canvas at all.
`src/present.ts` becomes the **page module**, which a studio's page loads. It
bundles your renderer, your input mapping and the engine's host that plays
them, and imports the rules code by the one name `cw2:sim`:

```ts
import createGame, { MANIFEST } from "cw2:sim"
import { definePageModule } from "@vbz-gg/sdk/game"
import { capture } from "./capture"
import { createPresentation } from "./present/canvas"

export default definePageModule({ createGame, manifest: MANIFEST, createPresentation, capture })
```

The page never builds a host of its own. It loads the module and calls its
`mount`, so the engine that plays a run on a studio's page is the one your
game was built and checked with.

## Controls

Your game draws its own. Its renderer paints the buttons, the engine's device
helpers record where each finger is and whether it is down, and your `tick`
decides what a finger landed on, against the same rectangles the renderer
drew. The template keeps them in one file, `src/sim/field.ts`, which both
read. Never decide in the renderer and hand the answer over: it would replay
perfectly and still settle the result where nothing checks it.

The manifest declares each input by name and the whole numbers it carries,
and `src/capture.ts` says which keys, fingers, controller buttons, sticks and
tilt drive each one:

```ts
export const capture: CaptureMapping = {
  keys: { ArrowLeft: "left", ArrowRight: "right" },
  pointers: [{ down: "touch0", x: "touch0X", y: "touch0Y" }],
  gamepads: { any: { buttons: { 14: "left", 15: "right" } } },
}
```

Keep the ranges coarse and record changes rather than a stream: every value a
finger crosses is an input to send, store and replay, and the platform holds
a run to a budget of 16 inputs per tick, counted over the whole run. The
template records a finger in steps of 30 field units, which is enough to tell
its two buttons apart. Its presentation fills the element it is mounted in,
because a finger is measured across that element.

A mapping that reads a controller or locks the mouse needs your page to pass
`onNotice`, so a player can be told when the browser blocks it. A mapping
that reads tilt makes your page ask for it in the Play button's click, which
`playRun` does for you.

A game that reads tilt starts no run without it, even if it maps keys too.
On a device or in a browser that cannot give tilt, a laptop included, Play
says why and asks the platform for nothing. Try such a game on a laptop with
the browser's sensor emulation: in Chrome, DevTools' Sensors panel (the
Command Menu's Show Sensors) sets the device's orientation.

## Typing your calls to the platform

`@vbz-gg/sdk/api` holds the shapes of every route a game's page or a build
system calls on vbz.gg, as TypeScript types only:

```ts
import type { PlatformRoutes, PublicRefusalCode, StartedRun } from "@vbz-gg/sdk/api"

type Board = PlatformRoutes["GET /v1/board"]["response"]
```

A refusal arrives as `{ error, message }`, where `error` is one of
`PublicRefusalCode`. Switch on the code, never on the status.

## Putting the game on your page

`@vbz-gg/sdk/platform` is your page's client for vbz.gg: it signs a player
in, starts a run, sends the run as it goes, submits it, and reads the board.
`@vbz-gg/sdk/host` loads the game's page module, plays a run through it,
replays a settled run for watching, and adds a sign-in button and a board
table.

```ts
import { loadGame, mountBoard, mountSignIn, playRun } from "@vbz-gg/sdk/host"
import { createPlatformClient } from "@vbz-gg/sdk/platform"

const platform = createPlatformClient({
  apiOrigin: "https://api.vbz.gg",
  signInOrigin: "https://signin.vbz.gg",
  pageKey: PAGE_KEY, // vbz_pk_..., from the dashboard
})

mountSignIn(signInSlot, { client: platform }) // redraws whenever the player changes
const board = mountBoard(boardSlot, { client: platform, period: "week" })
await board.refresh()

// Before the click, so a game that will not load spends no run.
const page = await platform.game()
const version = page.today?.version ?? null // null while ranked play is paused
const game = version === null ? null : await loadGame(version)

playButton.onclick = () => {
  if (game === null) return
  playRun(stage, {
    client: platform,
    game,
    mode: "ranked",
    title: page.game.title,
    onState: (state) => render(state), // ends at "done", with the replay's result
    onNotice: (notice) => tell(notice.detail),
  })
}
```

`playRun` runs inside the click: a game that reads tilt has to be asked
before anything is awaited, and when the answer is anything but yes, the run
fails before it starts, with a code and a sentence that tells the player
what happened and what to do. It moves focus to `stage` so keys reach the
game, and keeps the game to one tab of the browser in each mode, so a second
tab cannot close the first tab's run. The platform says which version each
run plays, and a resumed run plays its own, which `playRun` loads when
it is not the one you did.

Your page's Content-Security-Policy has to let the game in and keep every
other game out. Name your game's own path on the platform's file origin and
the API:

```
script-src 'self' https://files.vbz.gg/g/<game id>/; connect-src 'self' https://api.vbz.gg
```

Any bundler that leaves `loadGame`'s import of a URL to the browser works:
Vite, webpack and esbuild are tested. A page with no bundler can serve the
package's `dist/` itself. `docs/sdk.md` in the repository has the whole
recommended policy and what each of these needs.

The player's token is kept in `localStorage` and renewed at every run start.
A failure is a `PlatformRefusal`, carrying the platform's code, or a
`PlatformClientError`, carrying the client's, such as `E_POPUP_BLOCKED` or
`E_GAME_UNLOADABLE`. Switch on `code`. The platform's page guide has every
route, and the `page.md` reference in the skill has every client code. The
template's `site/` is a whole page built this way, which `vbz dev --site`
runs on your laptop.

## License

MIT
