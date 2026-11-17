# How the SDK works

This explains the SDK from first principles, for somebody who has not seen it.
`README.md` says what the repository is, `packages/sdk/README.md` is what
a game author reads, and `AGENTS.md` is the working guidance that assumes this
page.

## Three repositories, one game

A game on [vbz.gg](https://vbz.gg) is a [Clockwork 2](https://github.com/vbz-gg/clockwork2)
simulation. The engine owns determinism: the seed, `dmath`, the manifest, the
recording format, the host that runs a game in a page, and the device helpers
that turn keys, fingers, controllers and tilt into recorded inputs. It knows
nothing about vbz.gg.

The vbz.gg platform is the backend for game studios. It owns studios and their
keys, player sign-in, the checks on an upload, the daily seed, the server-side
replay and the board. Its API is `https://api.vbz.gg` and its sign-in window
`https://signin.vbz.gg`. Once a version passes its checks, the platform copies
the version's two modules to `https://files.vbz.gg`, a public bucket served
through Cloudflare's cache, and a game's code reaches players from there and
never through a platform server.

A studio serves its game from a page of its own, with no frame. The page
signs a player in, imports the game's page module from `files.vbz.gg`, and
plays a run through it, sending the run to the platform as it goes.

Between them sits a set of decisions that belong to neither: what a page
module is and how a page drives it, how a page holds a run to the platform's
rules, and how an author builds and tries all of it before an upload. That set
is this package.

So the SDK owns seven things, one per subpath export:

| Subpath | What it is |
|---|---|
| `/api` | The shapes of the platform's public routes, as types only |
| `/platform` | A game page's client for those routes: sign-in, runs, the board |
| `/host` | The game on a page: loading its page module, a platform run through it, a local run, watching a run, and two widgets |
| `/game` | What a page module is built from: `definePageModule` and the contract a page drives it through |
| `/build` | A game's source to the two modules and the files folder an upload carries, every limit the platform holds them to, and what a version and a release line are |
| `/serve` | The handler that serves a game's modules and files at the paths and with the headers `files.vbz.gg` uses |
| `/harness` | The build and the handler, wired into a local page that loads the game the way a studio's page does |

Beside them the package ships a CLI
(`vbz new | guides | build | check | dev | publish`), the template `new`
copies, and the agent guide at `skill/vbz-game/`, which is the same material
written for an agent to follow literally.

The platform imports `/api`, and declares each public route's answer with its
types. It imports `/build`, so it reads a version, a release line and a
patch's contract with the same functions `vbz check` uses, and `/serve` for
its development bundles server. A game's page module is built from `/game`. A
studio's page talks to the platform through `/platform` and loads and plays
the game with `/host`. An author runs `/harness`, whose page loads the game
with `/host` too.

## The platform's route shapes

`/api` is types only: every route a game's page or a build system calls,
keyed by method and path in `PlatformRoutes`, with its credential, its body
and its answer, and `PublicRefusalCode`, every refusal those routes answer by
name. It compiles to an empty module, so importing it adds nothing to a
bundle, and a test holds it to exporting no value.

The types live here and not in the platform so the dependency runs one way.
The platform depends on this package and this package on nothing of the
platform's, so a change to a route's shape lands here first, is released, and
is then taken by the platform. The platform's build fails when one of its
routes answers a shape, or a refusal code, these types do not name.

## The page module

A game reaches a studio's page as one ES module, the **page module**. It
carries the game's presentation, its input mapping and the engine's host that
plays them, bundled with the game's own copy of the engine, and it imports
exactly one thing: the game's rules code. Its entry is a few lines:

```ts
import createGame, { MANIFEST } from "cw2:sim"
import { definePageModule } from "@vbz-gg/sdk/game"
import { capture } from "./capture"
import { createPresentation } from "./present/canvas"

export default definePageModule({ createGame, manifest: MANIFEST, createPresentation, capture })
```

`definePageModule` returns a `PageModule`, which is all a page ever sees of
the game:

- `contract`, the version of this shape the module speaks, `2` today;
- `manifestHash`, the engine's canonical hash of the manifest;
- `needsMotion`, true when the mapping reads tilt, so a page asks for motion
  in the click;
- `tickHz`, the game's tick rate, and `servedConfig`, the engine's
  `servedConfig`: every setting the manifest declares, at its default, which
  is what a platform serves a ranked or practice run. It is null when the
  manifest declares a required setting with no default, which only a page
  naming its own config can play. A page holds no engine, so the module says
  both;
- `check()`, which answers a list of problems and never throws: the manifest
  it was given is not the one its rules code carries (`E_GAME_MODULE_INVALID`),
  or the mapping names something the manifest does not declare
  (`E_CAPTURE_INVALID`);
- `requestMotion()`, the engine's, from the module's own copy;
- `prepare(element, { files })`, which gets the game ready in the element
  before a run is asked for: it makes the presentation, handing it the
  version's files folder, mounts it and waits for the engine's
  `Presentation.prepare`, and fetches the start data packs from the folder.
  Its `ready` settles with null, or with why the game cannot play here: the
  engine's `E_PRESENTATION_FAILED` for a device the presentation cannot draw
  on, carrying what the presentation said, or the engine's pack codes. The
  prepared game's `mount` plays one run in the element;
- `mount(element, options)`, which is `prepare` and that `mount` in one
  call: it builds the engine's `GameHost` in the element once the game is
  ready, attaches the device helpers, and plays a run live or replays a given
  log.

A run is `play` or `watch`, and both take the run's seed, config, tick rate,
the manifest hash it was issued for, and handlers for checkpoints, frames,
the end, an error and a device notice. A played run has no step limit: it
goes until the game ends it or the page stops it, and it says whether an
event a script dispatched is recorded, `scripted: "ignore"` or `"record"`,
the engine's own switch on its device helpers. A ranked or practice run takes
its inputs from the player's devices alone, so `playRun` always passes
`"ignore"`. A watched run takes the recorded inputs and `maxTicks`, where the
replay stops, which is `Math.max(endTick, 1)` of the run it replays; with
`draw: false` it builds no presentation at all and reports its checkpoints,
for a browser that cannot draw the game, such as the platform's page-module
check. `mount` refuses a run issued for another manifest (`E_WRONG_GAME`), a
tick rate the game does not run at, a step limit on a played run, or a
played run that does not say what to do with a scripted event, before
anything is built. The clock starts only once the game is ready, so no tick
runs and nothing is recorded before it can be drawn, and a failure to get
ready arrives at `onError` before tick 0. It hands back `recorded()`,
`stop(reason)` and `destroy()`; a run stopped while it gets ready ends at
tick 0 once it is. The presentation fills the element it is mounted in,
stretched the same way on both axes, because the helpers measure a finger
across that element.

The data packs the manifest declares are files of the version's files
folder, at their declared paths. The module fetches the start packs from the
folder's address before the run starts and a demand pack when the game names
it, with the engine's pack loader, and the engine checks each one's size and
SHA-256 before the game may read it.

Everything that crosses between the page and the module is plain data:
numbers, strings, arrays and objects of them, and functions to call. A
failure arrives as `{ code, message }` rather than an error object, because
the page holds no copy of the engine and the module's classes are not the
page's. An engine error is recognised by the engine's own mark, from whichever
copy threw it.

`contract` exists because a page and a module are built at different times,
often against different releases of this package. Every release drives every
contract version an earlier release drove, and a page refuses a module that
speaks one it does not know with `E_GAME_CONTRACT_UNKNOWN`, naming both,
rather than misreading it. A page on this release drives contract 1 as it was
built: its module stops a run at its own manifest's step limit, whatever the
page passes, knows no files folder and no word on scripted events, cannot be
watched without drawing, and is ready at once. The browser suite holds the
first half to a module the first release of contract 1 built, committed and
never rebuilt.

`/game` is a value subpath, bundled into every page module, so it holds to
what a page module may do. It reads nothing from the browser when it loads,
contains no dynamic `import(`, and imports nothing of `/host`, `/platform` or
the CLI. A test holds all three.

## Choosing what to record

A manifest declares each input a run records, by name and the whole numbers
it carries, and nothing about devices:

```ts
inputs: {
  left: { min: 0, max: 1, label: "Left" },     // a press
  stick: { min: -1, max: 1, label: "Stick" },  // left, centre or right
  touch0X: { min: 0, max: 16 },                // where a finger is, in steps
}
```

A recorded input is a tick, a declared name and a whole number. Which key,
finger, controller or tilt drives each one is the game's input mapping, an
engine `CaptureMapping` in `src/capture.ts`, a file that touches no DOM so
`vbz check` can hold it to the manifest without loading anything that draws.
The engine's device helpers do the recording: a key and a controller button
as a press, a stick and tilt as a level recorded only when it changes, and
each finger as a slot of its own with where it is and whether it is down.
Slot 0 is the first finger down and slot 1 the second, so two thumbs on two
buttons are two pointers, and lifting one leaves the other held.

A game draws its own controls. There is no pad from the page and no hook for
controls a page builds. The game's renderer paints its buttons, the helpers
record where each finger is, and the rules code decides in `tick` what a
finger landed on, against the same rectangles the renderer drew. The
template reads both from one file, `src/sim/field.ts`. Deciding in the
renderer and handing over the answer would replay perfectly and still settle
the result on the client, where nothing checks it, which is why a game never
constructs an input.

What to record is a choice about size. Every value a finger crosses is an
input to record, send, store and replay, and the platform holds a ranked or
practice run to a budget of 16 inputs per tick, counted over the whole run. So record changes,
not a stream, in the coarsest range that still tells the game what it needs:
the template records a finger in steps of 30 field units, 0 to 16 across and
0 to 24 down, which is all it takes to tell two buttons apart. A deadband on
a stick or on tilt keeps a resting hand from recording anything.

Two things a page has to provide. A mapping that reads a controller or locks
the mouse needs the page's `onNotice`, because a browser can block either
and the player has to be told; without it the mount fails with the engine's
`E_ARG_INVALID`. And a mapping that reads tilt makes the module report
`needsMotion`, and the page has to ask for motion inside the click that
starts the run, before anything is awaited, because iOS grants it only there.

A game that reads tilt is steered by it, so it starts no run without it. On
a device or in a browser that cannot give tilt, a laptop included, Play says
why and asks the platform for nothing, even when the mapping also reads keys.
An author tries such a game on a laptop with the browser's sensor emulation:
in Chrome, DevTools' Sensors panel (the Command Menu's Show Sensors) sets the
device's orientation.

## Hosting a game on a page

`/host` puts a game on a studio's page. The harness's page uses it too, so a
page and the harness cannot load a game two ways. Nothing in it reads the
browser when it loads, and it holds no engine: it reaches the game through
the module's own `mount`.

**`loadGame(version)`** imports a version's page module and checks it before
anything is played, because what arrives was built by somebody else, often
with another release of this package. In order, each with the code it fails
with:

1. The module's address and its files folder's are absolute and https, or
   http to this machine, the folder's ending in `/`, and the import succeeds
   (`E_GAME_UNLOADABLE`, with the address).
2. The default export is an object (`E_GAME_MODULE_INVALID`).
3. Its `contract` is one this release drives (`E_GAME_CONTRACT_UNKNOWN`).
4. `mount`, `check` and `requestMotion` are functions, `manifestHash` a
   string and `needsMotion` a boolean, and for contract 2 `prepare` a
   function, `tickHz` a number and `servedConfig` an object or null
   (`E_GAME_MODULE_INVALID`, naming the field).
5. Its manifest hash is the version's (`E_WRONG_GAME`).
6. Its own `check()` finds nothing (the problem's own code; one this release
   does not know is `E_GAME_MODULE_INVALID` in the module's words).
7. No built-in a simulation calls has been replaced on the page, removed, or
   set to something that is not a function (`E_PAGE_ALTERS_BUILTINS`, naming
   it). This reads the engine's allowed `Math` functions and the `Array`,
   `Map`, `Set`, `Object`, `JSON`, `Number` and `String` methods through
   `Function.prototype.toString`. It catches a library's mistake, not
   somebody determined to hide one.

Load before the click, from what `GET /v1/game` names, so a failure spends no
run. A version names its files folder beside its page module, `filesUrl`, and
the loaded game hands it to the module with every run, so a page never names
one. A failed import is kept by the browser for the life of the page:
Chromium, Firefox and WebKit all answer a second `import()` of the same URL
with the first failure, without asking the network again, so the only retry
is a reload, and `E_GAME_UNLOADABLE` says so.

**`playRun(element, { client, game, mode, onState, onNotice, title })`**
runs inside the Play button's click. When the game reads tilt it asks for it
first, then for the run's lock, both before anything is awaited. Once the
lock is held and tilt is granted, it gets the game ready in the element with
the module's own `prepare`, and starts the run only when it is, so a device
the game cannot draw on fails with `E_PRESENTATION_FAILED`, in the client's
sentence, and a pack that did not arrive with the engine's code, before the
platform is asked for a run. The platform says
which version each run plays, and the page never chooses: a resumed run plays
the version it started on, and when its manifest hash is not the loaded
module's, `playRun` loads the run's own. It compares the hash rather than the
address, because one module's address can be written more than one way. When
the run's own module reads tilt the click did not ask for, the run stops with
`E_MOTION_NEEDS_TAP`, having sent nothing, and the next tap's `playRun` with
`played.game` resumes the same run without counting another. It moves focus
to `element`, labelled with `title`, so a key reaches the game rather than
the button a player just pressed, and `played.end()` submits the player
leaving as an abandoned run.

Any answer to the tilt request but a grant fails the run before the platform
is asked for one, and lets the lock go, with the engine's own code for what
happened: `E_MOTION_DENIED` when the player did not allow it,
`E_MOTION_NO_SENSOR` when no reading arrived, as on a laptop,
`E_MOTION_UNSUPPORTED` for a browser with no orientation events,
`E_MOTION_INSECURE` for a page that is not https, and `E_MOTION_BLOCKED` for
a page whose permissions policy forbids the sensors. Each is a client code
whose sentence tells the player what happened and what to do, and the run's
`detail` is that sentence. iOS remembers a refusal for the site and answers
every later request with it, without asking, until the site's data is
cleared in the browser's settings; the sentence for `E_MOTION_DENIED` says
so. A request whose promise is rejected rather than answered fails the run
with `E_UNEXPECTED`.

The platform keeps one open run per player, game and mode, and a second tab
of the same browser is the same player. Started while the first tab's run has
committed nothing, it would be handed that run, and two tabs playing one run
post chunks under the same numbers with different bodies, which the platform
counts against the player as tampering. Started once the run has committed a
chunk, it closes that run and answers a new one, which ends the first tab's
run under its player. So `playRun` takes a Web Lock in the click, before it
asks for a run, named for the game and the mode: `vbz-run:`, the page key and
the mode. It holds the lock until the platform has the run, after the submit.
A second tab finding it held stops with `E_RUN_OPEN_ELSEWHERE` having asked
the platform for nothing; a practice run beside a ranked one, or another
game, is not held back. A browser with no Web Locks starts nothing and stops
with `E_BROWSER_UNSUPPORTED`: Safari before 15.4, or a page that is not https.

**`playLocal(element, { game, scripted, onEnded })`** plays a game on a
page with no platform at all: a story, free play, an endless session, a page
that is never online. It is the same build a ranked run plays, loaded with
`loadGame` and played through the module's own `mount`, and it asks nothing
of the platform: no client, no page key, no sign-in, no lock and no request.
It takes an optional seed and config, a fresh seed and the module's served
config by default, says whether a scripted event is recorded, as the engine
asks every page to, and hands `onEnded` the run's recording. A game that
reads tilt asks for it first, in the click, and starts nothing without it,
as `playRun` does. A contract-1 module cannot say its tick rate or its
config, and is refused with `E_LOCAL_PLAY_UNSUPPORTED`; a game with a
required setting that has no default, played with no config, with
`E_CONFIG_REQUIRED`.

A local run can never pass for a ranked or practice run. Its seed always
starts `local:`, whatever the page passes, and every seed the platform issues
is 64 hex characters, so the platform refuses its recording with
`E_PINNED_MISMATCH`, as the stand-in does. Its recording is a
`LocalRecording`, and the client's `submit` takes a `RunRecording`, which only
`Run` hands it, so passing one compiles only behind a cast somebody wrote. A
page with devtools can still post anything through `request`; what stops it
is the seed.

**`watchRun(element, { client, runId })`** reads a settled run, loads its own
version's page module and replays its own inputs, to `replayTicks`, where the
platform's replay stopped: `Math.max(endTick, 1)`. An abandoned run ends where its player left it,
not wherever its rules code would have ended it. A run whose replay covers no
ticks is `E_NOTHING_TO_WATCH`.

Two widgets sit beside them. `mountSignIn` is a button that signs a player in
and out, calling `signIn()` in the click's own turn and showing a failure
beside itself in the client's own sentence. It follows the client through
`onPlayerChange` and redraws whenever the client's player changes, whoever
changed it: a sign-out elsewhere on the page, or a token the platform stopped
honouring, so a page needs no code to keep it true. `mountBoard` is a table of
a board: rank, name and each counter the game ranks by, in the manifest's
order, with the reader's own row marked `aria-current` and shown after the
page when it is not on it. Both are plain DOM and take every colour from a
`--gb-widget-*` custom property with a fallback.

## The page's client

`/platform` is what a studio's page uses to talk to the platform. It follows
the protocol the platform's page guide describes, `docs/your-game-page.md` in
vbz-gg/platform, and every request it makes goes through one function keyed
by `PlatformRoutes`, so it cannot call a route the platform does not declare.
A build system's routes are not offered: a secret key never belongs in a page.

`createPlatformClient({ apiOrigin, signInOrigin, pageKey })` makes the client:
`https://api.vbz.gg`, `https://signin.vbz.gg` and the game's page key from the
dashboard. It reads the browser only when it is made, never when the module
loads, so a page's bundle may import it during server-side rendering, and a
test hands it a page of its own through `environment`.

**Signing in** opens the sign-in window before anything is awaited, because a
browser opens one only in the turn of the click that asked. It sends a PKCE
challenge and a state, takes a message only from that window, on the sign-in
origin, of type `vbz.signin`, carrying that state, and trades the code at
`POST /v1/oauth/token`. A window closed with no code fails after 500 ms of
grace, because the window closes itself right after posting and a browser can
report the close first.

**The player's token** is kept in `localStorage`, one entry per page key,
because a token is good only beside a page key of its own studio. Every run
start renews it, and the renewed one is kept. A token the platform answers
with `E_SIGN_IN_REQUIRED` is dropped, but only while it is still the kept one:
an older run's token refused after the player signed in again says nothing
about the new one. The page also holds the player in memory and reads that
copy once it has one, so a browser that keeps nothing (a private window, a
blocked or full store) still plays this visit, and signs in again on the next.

**`onPlayerChange(listener)`** tells a page each time the client's player
changes: a sign-in, a sign-out, a token the platform stopped honouring, or one
the client finds expired when it next reads it. A renewed token for the same
player is no change. The listener runs inside the call that found the change,
never for the player there already was when it subscribed, and the function it
returns stops it. Every read and write of the kept player goes through the one
place that compares it with the last player seen, so nothing changes the
player without telling. `onSignedOut`, given when the client is made, hears
only the platform refusing the token.

A run's own writes and its result are sent with the token from its own start,
not with whatever player is kept by then.

**`Run`**, which `playRun` drives, holds the rules a page would otherwise get
wrong. Its phases are `loading` (the start and the module's import),
`playing`, `submitting`, `replaying`, `done` and `failed`. Every two seconds
of play, counted in ticks so no timer decides it, it slices what the module
has recorded into a chunk that ends at the last complete tick: one short of
the last tick the game reported while the run plays, because the engine takes
a tick's inputs before running it, and the end tick once the run has ended. A
chunk over the run's `limits.chunkBytes` is cut between ticks, measured with
the sequence number it carries, and each piece carries the checkpoints of its
own ticks: a checkpoint in a piece after one that already reached its tick is
refused. Every piece is held to `limits.runBytes` before it is sent, and while
the run plays one chunk's room is kept for the last commit, which goes just
before the recording. A piece that would eat into that room ends the run as if
the player left, and the last commit and the recording follow. A piece that
would not fit at all is never sent: the run ends where its chunks reach,
nothing is submitted, and the platform settles it from what it committed, as
it settles any abandoned run. So does a recording larger than
`limits.runBytes`. Chunks go one at a time; one that got no answer, or a 5xx,
goes again unchanged before the next, and after a refusal nothing more is
sent. The last chunk reaches the platform before the recording, a submit that
got no answer goes again (the same recording answers the same), and then it
asks for the result until the replay has run. `done` carries what the replay
computed, never what the page showed. A failed state carries the code, the
detail, and for the platform's own refusal its `refusalDetail`, which is where
`E_PLAYER_BARRED` says when the bar ends.

The client's own failures are `PlatformClientError`, with codes from
`CLIENT_ERROR`; the platform's are `PlatformRefusal`, with a
`PublicRefusalCode`. The two sets never share a code, and a compile-time check
holds them apart.

## What a studio's page needs

**A Content-Security-Policy** that lets the game's code in and keeps every
other game's out. Name your game's own path on `files.vbz.gg`, never the whole
origin, since every studio's games are served from it:

```
default-src 'none'; script-src 'self' https://files.vbz.gg/g/<game id>/;
style-src 'self'; img-src 'self' data: blob:;
connect-src 'self' https://api.vbz.gg; base-uri 'none'; form-action 'none';
frame-ancestors 'none'
```

That is the policy the harness serves its own page under (`pageCsp` in
`/harness`), and the browser suite measured it in Chromium, Firefox and
WebKit: it admits the page module's dynamic import and the module's own
static import of its rules code, and refuses another game's path on the same
origin before a request leaves. It needs no `unsafe-eval` and no inline
script. A page with more of its own adds to it.

A game may need more than its two modules, and `pageCsp` adds each need
only when it is named, in `needs`. A renderer that compiles WebAssembly, such
as null3d, needs `'wasm-unsafe-eval'` in `script-src`, which compiles
WebAssembly and evaluates no JavaScript; one that starts workers needs
`worker-src blob:` and the game's path; and a game that fetches files of its
folder, its data packs or its art, needs the game's path in `connect-src`.
Nothing a game needs adds `unsafe-eval`. A page carrying an inline script,
such as an import map, names it in `inlineScripts` and the policy admits it by
the SHA-256 of its exact text. `localPageCsp` is the same policy for a page
that serves its game from its own origin, as a game played only on its own
page does.

**A bundler that leaves `loadGame`'s import alone.** `loadGame` imports a URL
it is handed at run time, so the import is the browser's to make, and
`dist/host/load.js` carries `/* webpackIgnore: true */` and
`/* @vite-ignore */` on it. Measured in the browser suite with each
bundler's production build: Vite 8.3.5, webpack 5.112.2 and esbuild 0.28.2
each bundle a page that loads a game from another origin and plays it.
Without its comment, webpack turns the import into a lookup in its own
module table and the page answers `E_GAME_UNLOADABLE`; Vite 8 and esbuild
leave an import of a variable alone either way. Parcel and Turbopack are not
tested.

**The `development` export condition.** Every subpath's entry in the
package's exports map names the TypeScript in `src/` under `development`
before the compiled `dist/` under `default`. A dev build that sets the
condition runs the TypeScript: Vite's dev server does, and loaded and played
a game with it, and webpack in `mode: "development"` does, and built it under
Node 22. A production build does not set it and runs `dist/`. A dev setup
that cannot read TypeScript from `node_modules` should leave the condition
out of its resolver.

**A page with no bundler** can load the package from a copy of its `dist/`
on its own origin. Every file in it imports its neighbours by relative path,
so the page imports `/sdk/host/index.js` directly, or names
`@vbz-gg/sdk/host` in an import map. An import map is an inline script as far
as the policy is concerned: all three engines refused one under the policy
above, and loaded it once `script-src` carried its hash,
`'sha256-<base64 of the map's exact text>'`.

## The two artifacts and the files folder

`buildGameArtifacts` turns a source tree into two files and lists a folder:

- the **rules code**, built from `src/sim/index.ts`, with **zero** imports;
- the **page module**, built from `src/present.ts`, importing the rules code
  and, if it needs them, files of the folder;
- the **files folder**, which the game's own tools build: a renderer's
  engine, art, and the data packs the rules code reads.

A page module refers to its rules code as the bare specifier `cw2:sim` and by
no other name, for three measured reasons. Bun ignores `external` for a
relative import, so a relative import cannot be externalised under a name we
choose. Two spellings of one module emit two imports, two URLs and two module
instances, which is two `MANIFEST` objects in one page. And `cw2:` is not
resolvable by a browser, so an unrewritten page module fails loudly at load
rather than half-working. It names a file of its folder the same way, as
`cw2:files/<path>`, in a static import, and finds art and data at run time
through the folder's address, which the page hands it.

A game names its folder in its `package.json`, as
`"vbz": { "files": "<dir>" }`, so every command reads the same one. A game
that names none has an empty folder; one that names a folder that is not
there, or one inside `dist/`, stops the command. The folder is listed by
path, size and SHA-256, and named by the SHA-256 of that listing's canonical
text, `canonicalListing`, so a page module naming the folder names every byte
in it. A path is relative and POSIX, made of letters, digits, `.`, `_`, `-`
and `/` with no `.` or `..` segment, the pattern the engine holds a data
pack's path to, and a link in the folder is not followed.

What the contract checks, on the bytes rather than on the source:

1. One ES module, decodable as strict UTF-8.
2. `scanImports` returns **zero** entries for the rules code. For the page
   module every entry is an import statement, one or more name `cw2:sim`,
   and every other one names a file of the folder as `cw2:files/<path>`,
   whose path the listing holds.
3. The quoted literal `"cw2:sim"` occurs exactly as many times as it is
   imported, and `cw2:files/` exactly as many times as files are. A higher
   count means the string is also data, so a text rewrite would change
   something the game reads: refuse rather than rewrite.
4. The page module calls no `import()`, with a literal or a computed name,
   and no `new Worker`, `new SharedWorker` or `importScripts`. Bun's scanner
   sees only a literal `import()`, so these are found by reading the text as
   tokens, stepping over strings, comments and regular expressions. A load
   hidden behind a computed property gets past that reading; the page's
   policy, which names the game's own path and nothing else, is what bounds
   it.
5. Every limit in `limits.ts`: the rules code at most `MAX_SIM_BYTES`
   (4 MiB) and the page module `MAX_PRESENT_BYTES` (16 MiB); each file of the
   folder `MAX_FILE_BYTES` (64 MiB), all of them `MAX_FILES_BYTES` (512 MiB)
   in at most `MAX_FILES` (10,000); and each data pack the manifest declares
   is a file of the folder of its declared size and hash, at most
   `MAX_PACK_BYTES` (16 MiB), all of them `MAX_PACKS_BYTES` (48 MiB)
   together. `MAX_RUN_BYTES` (31 MiB) and `MAX_CHUNK_BYTES` (1 MiB) are a
   run's, which the platform hands a page and the stand-in reads.
   `MAX_LISTING_BYTES` is no limit of its own: it is the longest canonical
   listing those allow, which the platform takes as the body of the route
   that asks which files it lacks.

The platform also imports what it does with a file upload from here:
`missingFiles` answers which of a listing's files the game's store lacks,
`assertFileBytes` holds an uploaded file to the SHA-256 it was sent under
(`E_FILE_HASH_MISMATCH`), and `assertFilesHeld` refuses a version whose
listing names a file the store lacks (`E_FILES_MISSING`).

Then the addressing. Each module is stored under the SHA-256 of its own
bytes, and each file under the folder's name and its path.
`rewritePresentImports` replaces the page module's `cw2:sim` with
`/g/<game id>/sim/<64 hex>.js` and its `cw2:files/` with
`/g/<game id>/t/<listing sha256>/`, root-relative, so the bytes carry no
domain, and re-scans to prove the result imports exactly those paths. The
page module is hashed **after** the rewrite, so a stored page module's hash is
taken over bytes that already name one game, one rules code and one folder. A
page module can name exactly one rules code and one set of files, forever,
which is what makes "the browser and the validator ran the same code"
checkable rather than asserted.

`buildAndAddress` in `/harness` performs that whole sequence, which is the
same one the platform performs on an upload. `vbz build` writes the page
module **unrewritten**, with its specifiers intact, beside `dist/sim.js`,
`dist/manifest.json`, the listing as `dist/files.json`, exactly the text its
name is the hash of, and a copy of the folder as `dist/files/`: a page module
that arrived already pointing somewhere would be one naming code nobody
checked. It also writes `dist/game.json`, which a page playing the game
locally reads and an upload never carries.

## Serving

In production the two modules of a published version sit at
`https://files.vbz.gg/g/<game id>/sim/<sha256>.js` and
`https://files.vbz.gg/g/<game id>/present/<sha256>.js`, and its files under
`https://files.vbz.gg/g/<game id>/t/<listing sha256>/<path>`, copied there
when the version passes its checks, so a pending or rejected upload is never
public. A takedown deletes the copies and purges them from the cache.
`/serve`'s `createBlobServer` answers the same paths with the same headers,
for the harness and for the platform's development bundles server, so a page
meets one answer from a laptop and from the edge:

- `Access-Control-Allow-Origin: *`, because a page module is imported by a
  studio's page from another origin and every module import is a CORS
  request. What these files hold is public, and which page may run a game is
  the studio's policy to say, by its game's path. The 404 carries the header
  too, or a miss reads to the page as a network failure.
- `Cache-Control: public, max-age=31536000, immutable`, because each module
  is named by the digest of its own bytes, and each file by the digest of a
  listing that names its bytes, so neither ever changes.
- An `ETag` of the digest, or for a file of the folder's name and its path,
  and `304` for a request that names it.
- A module as JavaScript, and a file as the type its extension names in
  `FILE_CONTENT_TYPES`: JavaScript for a module script, `application/wasm`
  for WebAssembly, which a browser compiles by streaming only from that type,
  and `application/octet-stream` for anything it does not name, HTML among
  it, so a file opened on the bundles origin is never a page there.

## Starting a game

`vbz new ./my-game` copies the template out of the package and renames
it: the game's id comes from the directory, because an id is immutable once
published and a placeholder somebody forgets is a board under the wrong name.
The copy builds and plays before anything is changed, so an author's first
failure is one they caused.

The template ships inside the package rather than beside it in this
repository, at the same path relative to the CLI in the source tree and in
`dist`, which is what lets an installed copy find it. It is a game, Lane
Runner, with its own two buttons, keys and a controller, and `site/`, a page
in the mode its `site/config.json` names. `{ "mode": "local" }`, which a new
game ships with, plays the build beside the page with `playLocal` and talks
to nobody. `{ "mode": "ranked", apiOrigin, signInOrigin, pageKey }` is a
studio page with sign-in, Play, Practice and the board. The mode is named,
never worked out from whether a page key is there, and opting in to ranked
play changes that file and nothing about the build.

`vbz build` writes `dist/game.json` beside the build: where each part is,
relative to it, and what the manifest and the files folder hash to, so a
plain static host serves `dist/` as it is to a page playing the game
locally. Such a page maps the page module's `cw2:sim` and `cw2:files/` with
an import map, so the module's bytes are the ones an upload carries, and
`localAddress` in `/host` turns `game.json` and its URL into what `loadGame`
takes.

## The agent guides

A game has two sets of rules for an agent to follow, and each package ships
its own as an agent skill under `skill/`: the engine's, `clockwork2`, on
writing a simulation that replays to the same state on a server, and this
package's, `vbz-game`, on everything between that simulation and a game the
platform can check. A game keeps a copy of both in `.claude/skills/`, where an
agent's tools look for skills, so the guide an agent reads is the one for the
versions the game installed.

`vbz new` copies this package's own guide and the engine's, from the engine
installed beside this package: the one node would find from the CLI's own
module, looking in `node_modules` there and in each directory above. An
engine that is not installed there, or one from a release before the engine
shipped its guide, stops `vbz new` with a message naming what is missing,
before it has written anything.

It also writes an `AGENTS.md`, for an agent that reads that file rather than
loading skills, with the commands, the engine's one rule in full, and where
the two guides are, and a `CLAUDE.md` that is `@AGENTS.md`. The template
keeps them as `game-agents.md` and `game-claude.md` and they are renamed on
the way into a game, as `gitignore` is, because under their own names they
would steer an agent working on this repository as if it were working on a
game. A name that differed only by case would too: macOS and Windows open
`agents.md` for `AGENTS.md` on their default filesystems. A template missing
one of the three is an install that is broken, and `vbz new` says which file
and takes back what it wrote, as it does for anything that fails part-way:
a directory it made goes, and one that was there empty is left empty.

`vbz guides ./my-game` replaces both guides with the ones the game's own
packages ship, each found from the game's directory rather than from the
copy of the kit running the command, so a game that upgraded either package
gets the guides of the versions it now has. The directory has to be a game's
root, one whose `package.json` names `@vbz-gg/sdk` in its dependencies or
devDependencies; anything else is refused and never made, since node would
still find a game's packages from a mistyped folder inside it. Each folder is
replaced whole, so a file a newer guide dropped goes too, and anything else
in `.claude/skills/` is left alone. A package or a guide that is missing is
an error naming it, and nothing is written. It does not touch `AGENTS.md`,
which is the author's to edit.

Both commands copy the guides into temporary folders beside their targets,
and replace what the game had only once every copy exists. A copy that fails
part-way, on a file it cannot read or a full disk, leaves the game's guides
as they were and the temporary folders gone, so a game never holds the kit's
guide from one release beside the engine's from another.

## Checking a game

`vbz check ./my-game` builds the game, holds the manifest to its schema, runs
the engine's `every-game` set of conformance checks over the built rules code,
with every file the manifest declares laid out beside it, and holds
`src/capture.ts` to the manifest with `checkCapture`. `vbz check --ranked`
runs the engine's `ranked` set instead, which adds what only a ranked or
practice run needs and the platform runs on an upload: two seeds pass through
different states on one input log (`E_SEED_IGNORED`), and the manifest says
how a run ranks (`E_RANK_UNDECLARED`), which a game played only on its own
page may leave out. It prints the version,
its release line and the line's contract hash, `contractSha256`, so a patch
can be compared with the line it joins before it is uploaded. It exits 0
only when everything passes.

The engine's checks read the rules code with TypeScript's own parser, so
`vbz check` needs `typescript` installed in the game, and the template's
`devDependencies` carry it. No other command needs it. `vbz new` runs before
a game has installed anything, so the CLI loads the checks only when `check`
is the command it was given.

## Where a game's code runs

A game's code is the studio's, and so is everything it imports, which nobody
in the kit has read. The commands run where an author or a build system keeps
a studio's secret key and cloud credentials in the environment, so every
command that evaluates a game's code does it in a process of its own, started
with an empty environment, and never in its own process:

- `vbz build`, and every command that builds, runs the bundler with nothing
  but `NODE_ENV`, because the bundler runs the macros a game's source
  imports, and reads the manifest by importing the rules code with nothing at
  all.
- `vbz check` runs the engine's conformance checks over the rules code and
  imports `src/capture.ts` in one such process, which writes what it found to
  a file, because the game's own code may print.
- `vbz dev` replays each run against the rules code in one.
- `vbz publish` evaluates nothing of a game: it uploads what `vbz build`
  wrote as bytes, so the key it holds is never beside the game's code.

One function starts them all, `runGameProcess` in `build/game-process.ts`,
and a test per command plants a variable in its environment and holds the
game's code to never seeing it.

## The harness

`vbz dev ./my-game` builds the two real artifacts and serves them on one port
at the paths and with the headers above, under the game id
`00000000-0000-4000-8000-000000000000`, and serves a page on a **second
port** that loads the page module from there with `loadGame` and plays it
with `playLocal`, through the module's own `mount`. The page is served under the policy above,
naming the game's path on the first port, so a module a studio's page would
refuse is refused here first and said in the page's status line.

Two ports are two origins, which is what puts an author in front of a
cross-origin module import rather than after an upload. What two ports do
not reproduce is the second *registrable* domain: production serves a game's
code from a different site from the studio's page, and two ports on localhost
are one site. A module import carries no cookies either way, so the gap is
named rather than closed with an `/etc/hosts` entry.

The page adds what a studio's page does not need. **Start** and **End** drive
the run; Start asks for tilt first when the game reads it, and like Play on
a studio's page starts no run without it, keeping the code and its sentence
on the status line. When the run ends,
the page sends its recording back, and the harness replays it against the
built rules code, to the tick it ended, in a process of its own with an empty
environment, so a game cannot read a studio's key or a cloud credential from
the shell `vbz dev` runs in. It holds the run's inputs to the manifest with
the engine's `checkInputs`, and measures the recording. The page shows three
lines: whether the replay matches, how many inputs against the budget of 16 a
tick a ranked or practice run is held to, and the recording's size in bytes.
The budget binds only those runs, so a run over it is said as that figure and
turns the report red only under `vbz dev --ranked`. It publishes the
recording too, so an author can save the evidence the platform would replay.

The seed is a constant, so a run an author is debugging is the run they had a
moment ago. The platform's daily seed is a keyed HMAC of the game and the day,
which does the same job for a different reason. The config is the manifest's
served config, what the platform serves a run, and the harness reads both it
and the tick rate from the manifest `vbz build` wrote, refusing to start
without one. The files folder is served beside the two modules, and the
replay is handed the data packs from it.

**A phone** is another machine, and a browser loads a game's code from
another machine only over https and grants tilt only to a secure page. So
`--address` names the laptop's own address and `--https` with `--cert` and
`--key` serves both origins over https, with a certificate the phone trusts.
An address off this machine without `--https` is refused before anything
builds, and so is `0.0.0.0`, which no page can name.

**`--site`** serves the game's own `site/` in place of the harness page, in
the mode its `site/config.json` names, and refuses a file naming none.
Played locally, the build is served beside the page as `/game/`, under
`localPageCsp`, and nothing else runs. Ranked, the page is served under the
harness page's policy with the API added, against a stand-in for the
platform shipped in the package: the page routes and the sign-in window on
origins of their own, as one local player, on the harness seed and the
served config, at the platform's limits from `/build`, and the harness
answers the page's `config.json` with the mode, the stand-in's origins and
its page key. In either mode an inline script the page carries, such as its
import map, is admitted by the SHA-256 of its text, and what the game's
`package.json` says it needs of a page's policy,
`"vbz": { "needs": { "wasm": true, "workers": true, "files": true } }`, is
added to the harness page's policy and the site's.
The stand-in holds chunks and the submit to the manifest the way the
platform does, and settles a run with the counters its page sent, without a
replay, which the terminal says each time. It reads a run from a day still
open back to its own player alone, as the platform does, because watching
needs the day's seed, and answers anybody else with the platform's
`E_NOT_FOUND`, the answer a run that does not exist gets. Every refusal it
answers carries the platform's code and the platform's status for that code.
It ranks nothing.

## Versions and release lines

A game's `version` is a semantic version, `MAJOR.MINOR.PATCH`, and the parts
mean what they say about the rules:

- **A patch** changes how the game looks, or fixes a bug, and keeps what a
  score means. It is still the same game.
- **A minor** changes the rules: a new input, a new counter, a different way
  of ranking, a change to how long a run lasts.
- **A major** is a game players would call different.

A version has no prerelease or build suffix, no leading zero, and no part
above 2^31 - 1. `parseReleaseVersion` in `/build` is the one implementation:
`vbz build` refuses the same versions the platform does, with
`E_VERSION_INVALID`.

Every version sharing one `MAJOR.MINOR` is one **release line**, and the
platform treats a line as one game. The day's seed pins a line, the newest
by `(major, minor)` with a published version. A ranked run plays the line's
highest published patch, highest by version number, so a patch that passes
its checks at noon reaches the next ranked start. A new minor or major waits
for the next day's seed, so nobody's ranked day changes rules halfway
through. A practice run plays the newest playable version of any line.

A patch is held to its line's **contract**: the projection `lineContract`
takes of the manifest through `LINE_RULES`, a table over every manifest field
that fails to compile when the engine adds one nobody has placed. A line's
contract is set by its earliest version that was not rejected, pending
included. A patch that changes any of these is refused at upload with
`E_PATCH_CHANGES_RULES`, which names the fields and the minor to publish
instead: `schemaVersion`, `id`, `session`, `inputs` (each one's `min` and
`max`), `counters` (each one's `name`, `direction` and `monotonic`),
`rankBy`, `tiePolicy`, `params` (all but `label` and `description`), and of
the capabilities `deterministic`, `physics` and `multiplayer`. Free in a
patch: `version`, `name`, `kernel`, `genres`, `assets`, `budgets`, `display`,
every `label` and `description`, the other capabilities, the rules code's
bytes and the page module.

The platform can compare manifests. It cannot tell whether a bug fix in the
rules code changed what a score means, because both versions replay their own
runs perfectly. That part is the studio's promise: a fix that makes a level
easier, or a score larger for the same play, is a new minor, because the
board mixes the patches of one line, and every row names the exact version
it was played on.

Versions only move forward. A new line must be greater than every version the
game has that was not rejected, and a patch greater than every such version in
its line, or the upload is refused with `E_VERSION_NOT_NEWER`. A patch to an
older line is allowed: 1.2.5 may follow 1.3.0, which is how a studio fixes the
line today's ranked runs are on after it has already published the next minor.
The same version twice, a rejected one included, is `E_VERSION_EXISTS`.

Each run is pinned to the exact version it started on. Its replay runs that
version's rules code, and watching it later loads that version's page module,
so a later patch never changes a run already played.

A studio never takes a version down. It replaces one by publishing a newer
version, which the next ranked start reaches once it passes its checks. Only a
vbz operator takes a version down, for abuse, illegal content or harmful
code. When the patch today's ranked runs play is taken down, the line does
not fall back to an older patch: a ranked start answers `E_RANKED_PAUSED` and
`GET /v1/game` says the day is paused, until a newer patch passes its checks
or the next day's seed. Practice runs carry on.

### Cheating bars the player

A run whose replay disagrees with what the page reported never reaches the
board, and that is all that happens to it. A submission the platform refuses
as tampered is different: inputs the manifest never declared or values
outside their range, inputs no recording can hold, more inputs than the
budget, a chunk rewritten or reaching back, a submit contradicting what was
committed, or a time no run could take. An honest page cannot send one. Five
of them on one game within 24 hours bar that player from starting runs of that
game for the next 24 hours, and a start answers `E_PLAYER_BARRED` with when
the bar ends. The game keeps running for everybody else.

Nothing suspends a version automatically. When many different players' runs
fail the replay on one version, the game itself is the likelier cause, and
the platform mails the studio's admins and the vbz operators instead.

## Publishing a version

`vbz publish ./my-game --game <id>` uploads what `vbz build` wrote, the
files folder first. It sends the listing, `dist/files.json` as written, to
`POST /v1/games/:gameId/files/missing`, which answers with the SHA-256 of
each listed file the game's store lacks, and uploads each of those from
`dist/files/` as its own `PUT /v1/games/:gameId/files/:sha256`, its bytes
the body. A file is stored once per game under the hash of its bytes, so a
file a version shares with an earlier one is not sent again, two paths
holding the same bytes are sent once, and the store is the game's own, so a
studio learns nothing of another's files. The command checks each file
against the listing before it sends it, and checks that the platform names
the folder as `vbz build` did.

Then it uploads the version, `manifest`, `sim`, `present` and the listing as
`files`, as one multipart `POST /v1/games/:gameId/versions`, which the
platform refuses with `E_FILES_MISSING` if its store lacks a listed file,
prints the release line the version joined, and then reads the version back
at
`GET /v1/studios/:studioId/versions/:versionId` every two seconds until the
platform's checks decide. The upload's answer names the studio, so the
command needs only the game's id. It waits up to 15 minutes, because the
checks run the game in three engines, and a version still pending after that
is reported as still being checked rather than as failed.

Each of the four goes as a file part carrying the file's bytes as they are
on disk. A text part would not arrive that way: an encoder that follows the
HTML standard rewrites every line feed in one as CRLF, and Bun 1.4.3's and
Node 22's both do, where Bun 1.3.11's did not.

It is built for a studio's build system, so its exit code is the verdict: 0
when the version passed its checks and is published, with the release line
it joined and which runs it serves printed. A version that serves no run yet,
such as a new minor waiting for the next day's seed, still exits 0. A
rejection, a version an operator has taken down, a refusal and a platform
that does not answer all exit 1 with a code that names which, and a refusal
prints its `detail`: the fields a patch changed and the minor to publish
instead, or the versions an upload had to be above.

A published version also comes back with `patchScores`. As a version
publishes, the platform replays up to 50 of its line's most recent settled
ranked runs, played on the line's other versions, under the new rules code,
and counts the runs whose end tick, terminal or counters come out different.
That is the part of a patch's promise a manifest cannot show: a fix that
changes what the same play scores. The count decides nothing, and the
command prints it as the platform measured it, such as
`patch check: 3 of 50 recent ranked runs on line 1.2 end differently under
this version`. A line's first version has no runs of its line to replay, and
the command says so. While the platform has not measured a version,
`patchScores` is null and nothing is printed.

The studio's secret key comes from `VBZ_STUDIO_KEY` and nowhere else. A flag
would put it in shell history and in the process list. The request carries
no `Origin` header, which is how the platform tells a build system from a
browser: a secret key sent with one is refused. The platform's origin is
`--api`, else `VBZ_API_ORIGIN`, else `https://api.vbz.gg`, and it has to
be https, or http to the same machine, because the key travels with the
request.

The version is sent once. A retry of an upload that did arrive is refused
as `E_VERSION_EXISTS`, so a slow answer would turn into a confusing one.
Asking which files the platform lacks and uploading one are safe to repeat,
since a file is stored under the hash of its bytes, and each is tried up to
four times, two seconds apart, when the platform does not answer, fails or
asks for time; a refusal stops the command before the version is sent.
Reading the version back is safe to repeat too, and a read the platform
fails to answer is tried again until the wait runs out.

## The package

`@vbz-gg/sdk` is `"sideEffects": false` with one export per half, so
importing `/host` pulls the host, the client it drives and nothing else. That
matters because a studio's page imports `/host` and `/platform` into a
browser bundle: neither reaches a node built-in, the CLI, the harness or the
engine's code.

Every relative import inside `src/` carries `.js`, and a directory import
carries the whole `/index.js`. `tsc` emits a relative specifier exactly as the
source wrote it and node ESM has no extension resolution, so `from "./load"`
builds, typechecks and passes the whole suite under bun and then fails on a
consumer's first `import` with ERR_MODULE_NOT_FOUND. `bun run check:publishable`
is what catches the next one: it packs the tarball and imports every subpath the
exports map names with plain node. It also holds the packed `dist/host/load.js`
to carrying both bundler comments on `loadGame`'s import.

The same check covers a file the package **reads** rather than imports. The
harness bundles its page script when it starts, and runs its replay in a
child process, each from a path built off `import.meta.dir`, which resolves
to the TypeScript here and has to resolve to the compiled file in an
installed copy. Nothing that imports the package would notice either one
missing; the failure would arrive when somebody ran `vbz dev`.

And it compares the guide the tarball carries with the one git holds, file
for file, byte for byte and execute bit, because npm packs whatever is on
disk: an untracked note in the guide's folder would ship, and `vbz new` would
copy it into every game. Anything under `skill/` other than the guide fails
it too, which is what keeps the guide's tests out of the tarball.

`@clockwork2/engine` is a **peer** dependency. A game installs the engine
itself: its rules code and its page module both import it, and `/game`, which
the page module bundles, builds the engine's host from it. So the engine that
plays a run on a studio's page is the one the game was built and checked
with, and the platform's page-module check plays it too. A regular dependency
would let a game hold two copies on two versions, with `/game` driving one
engine's host while the rules code carries another's manifest types. A
studio's page needs no engine at all: `/host` and `/platform` import its
types only, which leave nothing in a bundle.

The range is `>=0.10.0 <0.11.0` rather than open-ended. clockwork2 is 0.x and
maps a breaking change to a minor, so an engine minor may move the very
things this package is about, such as what a recorded input carries or what
the host's options are. Each engine minor is a deliberate bump here.
