# @vbz-gg/sdk

The SDK for building a browser game on
[Clockwork 2](https://github.com/vbz-gg/clockwork2): fixed-step ticks, seeded
randomness, and an input log that replays to the same state anywhere. You
build the game once. It plays on any page you put it on, talking to nobody,
and the same build can opt in to ranked runs on [vbz.gg](https://vbz.gg),
the backend that replays every ranked run on a server to check and rank
its score.

```bash
bunx @vbz-gg/sdk new ./my-game
cd ./my-game && bun install
bun run dev      # the game, with a replay of every run you play
bun run site     # the game's own page, played locally
```

That copy builds and plays before a line of it is changed, so anything that
breaks afterwards is something you just did. Its page plays locally: it
loads the build beside it and plays with `playLocal`, with no sign-in, no
key and no request to anybody. Its id comes from the directory name, and is
immutable once published to vbz.gg.

Versions up to 0.2.0 were published as `@vbz-gg/game-base`, with the command
`game-base`. The command is now `vbz`.

`@clockwork2/engine` is a peer dependency: your game installs one copy of the
engine, and both of its modules are built against it.

The copy also carries two guides for an agent, in `.claude/skills/`: the
engine's, `clockwork2`, on writing a simulation that replays exactly, and this
package's, `vbz-game`, on everything else: the page, the files folder, local
play and ranked play. Its `AGENTS.md` says where they are. Both come from the
versions the game installed, so after upgrading `@vbz-gg/sdk` or
`@clockwork2/engine`, run `bunx vbz guides` to replace them with the guides
the new versions ship.

## Local play, and ranked play

Played locally, the game is whatever you make it: a story, free play, an
endless session, a page that is never online. Nothing is uploaded and no run
has a step limit.

A ranked run is a kind of run vbz.gg serves: the platform issues its seed
and serves its config, the same build plays it on your page and records the
player's inputs, and the platform replays them and ranks what its replay
computed. A practice run is the same, and never on a board. You opt in by
naming the ranked mode in `site/config.json` and uploading with
`vbz publish`; the build does not change. A few rules bind only those runs:
the seed has to change what happens, a run holds at most 16 inputs a tick on
average, inputs come from the engine's device helpers and never from a
script on the page, and the platform's checks play the settings it serves.
`vbz check --ranked` holds a game to them before an upload.

## The six commands

```bash
vbz new     <dir>   copy a game that already conforms, and rename it
vbz guides  <dir>   replace the game's agent guides with the installed ones
vbz build   <dir>   write dist/: the two modules, the manifest and the files folder
vbz check   <dir>   run the engine's checks and hold src/capture.ts to the manifest;
                    --ranked adds what a ranked or practice run needs
vbz dev     <dir>   load the game the way a studio's page does, on two origins
vbz publish <dir> --game <id>   upload dist/ and wait for the verdict
```

`build` refuses a version that is not plain `MAJOR.MINOR.PATCH`. `check`
also prints the version, its release line and the line's contract hash, so
you can tell before an upload whether a patch keeps what its line fixes.
`check --ranked` is how to test that a recording replays to the state it
recorded before you publish: the platform runs only part of those checks on
an upload, and none of the ones that test record and replay.

`dev` is your game's page on your laptop. The game's two modules and its
files folder are served on one port at the paths and with the headers
`files.vbz.gg` uses, and a page on another port loads the page module from
there and plays it with `playLocal`, under the Content-Security-Policy a
studio's page should send. When a run ends, the
page shows whether the run replays to what it showed, how many inputs it
recorded against the budget a ranked or practice run is held to, and its size
in bytes; `--ranked` turns the report red over that budget. The runs play
every setting at its default, as the platform serves them, and
`--config <file>` plays a JSON config of your own instead, which a game with
a required setting that has no default needs here.
`--address` and `--https` with `--cert` and `--key` serve it to a phone on
your network, and `--site` serves your game's own page from `site/`, in the
mode `site/config.json` names: played locally from the build beside it, or
ranked, against a stand-in for the platform.

`publish` is for your build system. It uploads `dist/` to the game you name,
with one of your studio's secret keys from `VBZ_STUDIO_KEY`: first each file
of the files folder the platform does not already hold, then the version.
The platform answers a version it would refuse, one that is not newer or a
patch that changes its line's rules, before any file goes up, and files
stored for a version that never arrives are removed a day later. Then it
waits for the platform's checks:

```bash
VBZ_STUDIO_KEY=vbz_sk_... vbz publish . --game <game id>
```

It exits 0 when the version passed its checks and is published, and prints
the release line it joined and which runs it serves: today's ranked runs,
the next day's, or none, and practice or not. Before the verdict the
platform replays at most 3 of the line's most recent ranked runs under the
new version, and with the verdict the command prints how many end
differently, which decides nothing and is there for you to read.
Anything else exits 1: a
rejection prints the code and the first check that failed, a refusal prints
the platform's detail, such as the fields a patch may not change, and a
version an operator took down exits 1 too. The platform is
`https://api.vbz.gg` unless `--api` or `VBZ_API_ORIGIN` names another.
Don't add a script called `publish` to your `package.json`: npm runs a script
with that name on its own, as part of `npm publish`.

## Your game's two modules and its files folder

`src/sim/index.ts` becomes the **rules code**, which decides the score and
imports nothing: a replay runs it on a server with no canvas at all.
`src/present.ts` becomes the **page module**, which a page loads. It
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

A game may also carry a **files folder**: a renderer's engine your own tools
built, art, and the data packs the rules code reads. Name it in
`package.json`, and say there what a page's policy has to allow for it that
the build cannot show:

```json
{ "vbz": { "files": "files", "needs": { "wasm": true, "workers": true } } }
```

`vbz build` lists every file by path, size and SHA-256 and names the folder
by the SHA-256 of that list. The page module imports a file of it as
`cw2:files/<path>`, and a data pack is a file of it at the path the manifest
declares, which the module fetches before the run starts, or once the rules
code names it in `packsNeeded()`. A presentation that has to get ready, such
as one that compiles a WebAssembly renderer, has a `prepare`, and the run's
clock starts only once it resolves, so a device that cannot draw the game
fails with `E_PRESENTATION_FAILED` before a tick.

What a build may hold, as `@vbz-gg/sdk/build` exports it:

| | |
|---|---|
| the rules code | 4 MiB |
| the page module | 16 MiB |
| one file of the folder | 64 MiB |
| the whole folder | 512 MiB, in at most 10,000 files |
| one data pack | 16 MiB |
| every data pack together | 48 MiB |
| a run's recording | 31 MiB |

The agent guide's `references/files.md` has the folder, data packs and
needs in full, and `references/null3d.md` the recipe for drawing with null3d.

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
finger crosses is an input to record and, in a ranked run, to send, store
and replay, and the platform holds a ranked or practice run to a budget of
16 inputs per tick, counted over the whole run. The template records a
finger in steps of 30 field units, which is enough to tell its two buttons
apart. Its presentation fills the element it is mounted in,
because a finger is measured across that element.

A mapping that reads a controller or locks the mouse needs your page to pass
`onNotice`, so a player can be told when the browser blocks it. A mapping
that reads tilt makes your page ask for it in the Play button's click, which
`playLocal` and `playRun` do for you.

A game that reads tilt starts no run without it, even if it maps keys too.
On a device or in a browser that cannot give tilt, a laptop included, Play
says why, and a ranked page asks the platform for nothing. Try such a game on a laptop with
the browser's sensor emulation: in Chrome, DevTools' Sensors panel (the
Command Menu's Show Sensors) sets the device's orientation.

## Playing it on your page

`vbz build` writes `dist/` with `dist/game.json` beside the build, so a plain
static host serves `dist/` as it is. A page maps the page module's two
imports with an import map and plays with `playLocal`:

```html
<script type="importmap">{"imports":{"cw2:sim":"./game/sim.js","cw2:files/":"./game/files/"}}</script>
```

```ts
import { loadGame, localAddress, playLocal } from "@vbz-gg/sdk/host"

const url = new URL("game/game.json", document.baseURI).href
const game = await loadGame(localAddress(await (await fetch(url)).json(), url))

playButton.onclick = () => {
  playLocal(stage, {
    game,
    scripted: "ignore", // or "record", to drive the game from a script of your own
    onEnded: (ended) => show(ended.counters), // ended.recording replays to the same counters
    onError: (error) => tell(error.message),
  })
}
```

It plays a fresh seed and every setting at its default unless you pass a
`seed` or a `config`, asks no platform anything, and has no step limit. Its
seed always starts `local:`, which no seed the platform issues does, so a
local run's recording can never be submitted as a ranked run's. The page's
policy is `localPageCsp` from `@vbz-gg/sdk/harness`, with the import map
admitted by its hash. The template's `site/` is such a page.

## Typing your calls to the platform

`@vbz-gg/sdk/api` holds the shapes of every route a game's page or a build
system calls on vbz.gg, as TypeScript types only:

```ts
import type { PlatformRoutes, PublicRefusalCode, StartedRun } from "@vbz-gg/sdk/api"

type Board = PlatformRoutes["GET /v1/board"]["response"]
```

A refusal arrives as `{ error, message }`, where `error` is one of
`PublicRefusalCode`. Switch on the code, never on the status.

## Ranked play on your page

Once the game is published to vbz.gg, `@vbz-gg/sdk/platform` is your page's
client for the platform: it signs a player
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
what happened and what to do. It gets the game ready in `stage` before it
asks the platform for a run, so a device that cannot draw it spends none.
It moves focus to `stage` so keys reach the game, and keeps the game to one
tab of the browser in each mode, so a second tab cannot close the first
tab's run. The platform says which version each run plays, and a resumed
run plays its own, which `playRun` loads when it is not the one you did.

Your page's Content-Security-Policy has to let the game in and keep every
other game out. Name your game's own path on the platform's file origin, the
API, and the sign-in in `frame-src`: `signIn()` puts a box over your page
holding the platform's sign-in in a frame, which frames only for your page's
exact origin, and without `frame-src` the box stays empty:

```
script-src 'self' https://files.vbz.gg/g/<game id>/; connect-src 'self' https://api.vbz.gg;
frame-src https://signin.vbz.gg
```

A game that compiles WebAssembly, starts workers or fetches files of its
folder needs more, and `pageCsp` from `@vbz-gg/sdk/harness` builds the
policy from what the game says it needs.

Any bundler that leaves `loadGame`'s import of a URL to the browser works:
Vite, webpack and esbuild are tested. A page with no bundler can serve the
package's `dist/` itself. `docs/sdk.md` in the repository has the whole
recommended policy and what each of these needs.

The player's token is kept in `localStorage` and renewed at every run start.
A failure is a `PlatformRefusal`, carrying the platform's code, or a
`PlatformClientError`, carrying the client's, such as `E_SIGNIN_UNREACHABLE`
or `E_GAME_UNLOADABLE`. Switch on `code`. The platform's page guide has every
route, and the `page.md` reference in the skill has every client code. The
template's `site/` is a whole page built this way, which `vbz dev --site`
runs on your laptop against a stand-in for the platform once its
`site/config.json` names the ranked mode, and plays locally until then.

## License

MIT
