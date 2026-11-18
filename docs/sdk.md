# How the SDK works

This explains the SDK from first principles, for somebody who has not seen it.
`README.md` says what the repository is, `packages/sdk/README.md` is what
a game author reads, and `AGENTS.md` is the working guidance that assumes this
page.

## One build, played anywhere

A game made with this kit is one build, and it plays wherever its author
puts it. On a page, the game's own or any other, it is whatever the author
intends: a story, free play, an endless session, a page that is never
online. That needs no platform, no upload, no account and no sign-in, and
talks to nobody: `playLocal` plays the build, and `vbz new` makes a game
whose page does exactly that. `vbz build` writes the build to `dist/`, and
the author ships it any way they choose: their own site, a static host, a
game portal, or a download. "Serving" below says what a
host sends with it, and "What a page needs" what the page does.

No run has a step limit. A run goes until the game ends it or the player
leaves.

Determinism binds every run: the simulation is a pure function of its seed,
its config, its inputs and the data packs its manifest pins, on every
engine, so a run's recording replays to the state the run reached. That is
how the harness checks every run an author plays, and how a page replays a
saved run.

A game has no players' identities, sign-in or board unless its author adds
them. vbz.gg is one optional use of the same build, below.

A phone driving a game on another screen, a run that pauses when that link
drops, and messages from a game to its page are not built. They are a
proposal, [`docs/proposals/linked-devices.md`](proposals/linked-devices.md),
which says how each would fit this model.

## If you use vbz.gg: ranked and practice runs

A **ranked run** is a kind of run vbz.gg serves. The platform issues its
seed and serves its config, every setting at its default, and the same
build plays it on a studio's page and records the player's inputs. The
platform then replays those inputs on a server and ranks what the replay
computed. A **practice run** is the same kind of run, replayed the same way,
and never on a board. A player signs in to the platform for these runs
alone. A game opts in to both by naming the ranked mode in its page's
`site/config.json` and uploading with `vbz publish`; the build does not
change.

A few rules bind only ranked and practice runs, because they are what lets
a server's replay stand for the player's run:

- the seed changes the state, so a daily board is not an all-time one
  (`E_SEED_IGNORED`), and the manifest says how a run ranks
  (`E_RANK_UNDECLARED`), both checked by `vbz check --ranked` and by the
  platform on an upload;
- a run holds at most 16 inputs a tick, on average over the run
  (`E_INPUT_BUDGET`);
- inputs come only from the engine's device helpers, and an event a script
  on the page made is ignored (`scripted: "ignore"`, which `playRun` always
  passes);
- the checks play the config a run is served, every declared setting at
  its default.

A game played anywhere else may break any of these. A game that wants
ranked play has to keep them before its first upload.

## The engine, the kit, and vbz.gg

A game is a [Clockwork 2](https://github.com/vbz-gg/clockwork2)
simulation. The engine owns determinism: the seed, `dmath`, the manifest, the
recording format, the host that runs a game in a page, and the device helpers
that turn keys, fingers, controllers and tilt into recorded inputs. It knows
nothing about vbz.gg.

The [vbz.gg](https://vbz.gg) platform is an optional backend for game
studios, and a game made with the kit may never meet it. It owns studios
and their keys, player sign-in, the checks on an upload, the daily seed,
the server-side replay and the board. Its API is
`https://api.vbz.gg` and its sign-in `https://signin.vbz.gg`. Once a version
passes its checks, the platform copies the version's two modules and its
files folder to `https://files.vbz.gg`, a public bucket served through
Cloudflare's cache, and a game's code reaches players from there and never
through a platform server.

A game is played on a page, and the page's author decides where it is.
Played locally, the page serves the build itself, or loads it from another
host, and asks nobody anything. On vbz.gg, for ranked play, a studio's page
signs a player in, imports the game's page module from `files.vbz.gg`, and
plays a run through it, sending the run to the platform as it goes.

Between the engine and a page sits a set of decisions that belong to
neither: what a page module is and how a page drives it, how a page plays a
game with no platform at all, how a build is served, how an author builds
and tries all of it before it ships, and, for vbz.gg, how a page holds a run
to the platform's rules. That set is this package.

So the SDK owns seven things, one per subpath export:

| Subpath | What it is |
|---|---|
| `/api` | vbz.gg only: the shapes of the platform's public routes, as types only |
| `/platform` | vbz.gg only: a game page's client for those routes, sign-in, runs and the board |
| `/host` | The game on a page: loading its page module, a local run, and on vbz.gg a platform run through it, watching a run, and two widgets |
| `/game` | What a page module is built from: `definePageModule` and the contract a page drives it through |
| `/build` | A game's source to the two modules and the files folder a build carries, every limit `vbz build` holds them to, and what a version and a release line are |
| `/serve` | The handler that serves a game's modules and files with the headers a host serving them to another origin sends |
| `/harness` | The build and the handler, wired into a local page that loads the game from another origin, and the policies a page sends |

Beside them the package ships a CLI
(`vbz new | guides | build | check | dev | publish`, the last for vbz.gg
alone), the template `new` copies, and the agent guide at
`skill/vbz-game/`, which is the same material written for an agent to
follow literally.

A game's page module is built from `/game`. Any page loads and plays the
game with `/host`, and an author runs `/harness`, whose page loads the game
with `/host` too. On vbz.gg, a studio's page talks to the platform through
`/platform`. The platform imports `/api`, and declares each public route's
answer with its types. It imports `/build`, so it reads a version, a release
line, a patch's contract and a files folder's listing with the same
functions `vbz check` and `vbz build` use, and `/serve` for its development
bundles server.

## If you use vbz.gg: the platform's route shapes

`/api` is types only: every route a game's page or a build system calls,
keyed by method and path in `PlatformRoutes`, with its credential, its body
and its answer, and `PublicRefusalCode`, every refusal those routes answer by
name, and `VersionCheckCode`, every code the platform's own checks end a
version in, or once did, read back as its `rejectedCode` beside the engine's
codes and never a refusal's body. A route whose
credential is `secret-key` takes what a build system sends, the studio's
secret key, and the platform also takes a member's access token there, from
its dashboard, when the member's role holds the permission the route's
comment names. `/api` compiles to an empty module, so importing it adds
nothing to a bundle, and a test holds it to exporting no value.

The types live here and not in the platform so the dependency runs one way.
The platform depends on this package and this package on nothing of the
platform's, so a change to a route's shape lands here first, is released, and
is then taken by the platform. The platform's build fails when one of its
routes answers a shape, or a refusal code, these types do not name.

## The page module

A game reaches a page as one ES module, the **page module**: any page
playing it, the game's own, or on vbz.gg a studio's playing a ranked run. It
carries the game's presentation, its input mapping and the engine's host
that plays them, bundled with the game's own copy of the engine, and it
imports its rules code and, if it needs them, files of its files folder. Its
entry is a few lines:

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
check, whose Firefox has no WebGL and no WebGPU: a game drawn with them gets
ready there without drawing, and the check reports that and does not refuse
it. `mount` refuses a run issued for another manifest (`E_WRONG_GAME`), a
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
first half to a module the first release of contract 1 built, and a page to
playing a module of contract 2 as the tree that introduced it built it, each
committed under `e2e/frozen/` and never rebuilt once its contract is out.

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
input to record, and to replay, and a page that keeps a recording keeps
every one. On vbz.gg a ranked run's inputs are also sent and stored, and the
platform holds a ranked or practice run to a budget of 16 inputs per tick,
counted over the whole run, and its recording to `MAX_RUN_BYTES`. So record
changes, not a stream, in the coarsest range that still tells the game what
it needs: the template records a finger in steps of 30 field units, 0 to 16
across and 0 to 24 down, which is all it takes to tell two buttons apart. A
deadband on a stick or on tilt keeps a resting hand from recording anything.

Two things a page has to provide. A mapping that reads a controller or locks
the mouse needs the page's `onNotice`, because a browser can block either
and the player has to be told; without it the mount fails with the engine's
`E_ARG_INVALID`. And a mapping that reads tilt makes the module report
`needsMotion`, and the page has to ask for motion inside the click that
starts the run, before anything is awaited, because iOS grants it only there.

A game that reads tilt is steered by it, so it starts no run without it. On
a device or in a browser that cannot give tilt, a laptop included, Play says
why, even when the mapping also reads keys, and on vbz.gg a ranked page asks
the platform for nothing. An author tries such a game on a laptop with the
browser's sensor emulation: in Chrome, DevTools' Sensors panel (the Command
Menu's Show Sensors) sets the device's orientation.

## Hosting a game on a page

`/host` puts a game on a page: the game's own or any other, played locally,
or on vbz.gg a studio's, playing ranked runs. The harness's page uses it
too, so a page and the harness cannot load a game two ways. Nothing in it
reads the browser when it loads, and it holds no engine: it reaches the game
through the module's own `mount`.

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

Load before the click, so a failure spends no run: a page playing locally
loads what `localAddress` reads from the build's `game.json`, below, and on
vbz.gg a page playing ranked runs loads what `GET /v1/game` names. A version
names its files folder beside its page module, `filesUrl`, and the loaded
game hands it to the module with every run, so a page never names one. A
failed import is kept by the browser for the life of the page: Chromium,
Firefox and WebKit all answer a second `import()` of the same URL with the
first failure, without asking the network again, so the only retry is a
reload, and `E_GAME_UNLOADABLE` says so.

**`playLocal(element, { game, scripted, onEnded })`** plays a game on a page
with no platform at all: a story, free play, an endless session, a page that
is never online. It is the same build every page plays, a ranked run's
included, loaded with `loadGame` and played through the module's own
`mount`, and it asks nothing of anybody: no client, no page key, no sign-in,
no lock and no request. It takes an optional seed and config, a fresh seed
and the module's served config by default, says whether a scripted event is
recorded, as the engine asks every page to, and hands `onEnded` the run's
recording. A page that keeps a seed, such as `local:course-1`, plays the
same course again, and the recording replays to the same counters against
the build's rules code. The game gets ready in the element before its clock
starts, as every run's does, so a device it cannot draw on reaches `onError`
with `E_PRESENTATION_FAILED` before tick 0. A game that reads tilt asks for
it first, in the click, and starts nothing without it. A contract-1 module
cannot say its tick rate or its config, and is refused with
`E_LOCAL_PLAY_UNSUPPORTED`; a game with a required setting that has no
default, played with no config, with `E_CONFIG_REQUIRED`. `end()` ends a run
where it stands and `onEnded` follows with its recording, so a page always
hears how a run ended. An `end()` while the tilt prompt is still open comes
before any run started: `onEnded` follows at once with an empty run, tick 0,
no counters and a null recording, and whatever the prompt answers
afterwards, nothing is mounted, nothing takes focus and nothing more is
reported, so the element is the page's again at once, for the next run.

Any answer to the tilt request but a grant fails the run before it starts,
and on vbz.gg before the platform is asked for one and with the lock let go,
with the engine's own code for what happened: `E_MOTION_DENIED` when the
player did not allow it, `E_MOTION_NO_SENSOR` when no reading arrived, as on
a laptop, `E_MOTION_UNSUPPORTED` for a browser with no orientation events,
`E_MOTION_INSECURE` for a page that is not https, and `E_MOTION_BLOCKED` for
a page whose permissions policy forbids the sensors. Each is a client code
whose sentence tells the player what happened and what to do: the error's
message from `playLocal`, and on vbz.gg the run's `detail`. iOS remembers a
refusal for the site and answers every later request with it, without
asking, until the site's data is cleared in the browser's settings; the
sentence for `E_MOTION_DENIED` says so. A request whose promise is rejected
rather than answered fails the run with `E_UNEXPECTED`.

## If you use vbz.gg: a ranked run on a page

On vbz.gg, a local run can never pass for a ranked or practice run. Its seed
always starts `local:`, whatever the page passes, and every seed the
platform issues is 64 hex characters, so the platform refuses its recording
with `E_PINNED_MISMATCH`, as the stand-in does, and stores nothing (measured
in the browser suite: the run stays open and the board empty). Its recording
is a `LocalRecording`, and the client's `submit` takes a `RunRecording`,
which only `Run` hands it, so passing one compiles only behind a cast
somebody wrote. A page with devtools can still post anything through
`request`; what stops it is the seed.

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

**`watchRun(element, { client, runId })`** reads a settled run, loads its own
version's page module and replays its own inputs, to `replayTicks`, where the
platform's replay stopped: `Math.max(endTick, 1)`. An abandoned run ends where
its player left it, not wherever its rules code would have ended it. A run
whose replay covers no ticks is `E_NOTHING_TO_WATCH`.

Two widgets sit beside them. `mountSignIn` is a button that signs a player in
and out, calling `signIn()` in the click's own turn and showing a failure
beside itself in the client's own sentence, except a sign-in the player
closed, which needs no telling. When the box comes down it puts focus back
on its button, which a keyboard player pressed and the box could not focus
while the widget still held it disabled. It follows the client through
`onPlayerChange` and redraws whenever the client's player changes, whoever
changed it: a sign-out elsewhere on the page, or a token the platform stopped
honouring, so a page needs no code to keep it true. `mountBoard` is a table of
a board: rank, name and each counter the game ranks by, in the manifest's
order, with the reader's own row marked `aria-current` and shown after the
page when it is not on it. Both are plain DOM and take every colour from a
`--gb-widget-*` custom property with a fallback.

## If you use vbz.gg: the page's client

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

**Signing in** happens in a box over the page: a native `<dialog>` shown
with `showModal()` as the backdrop, a box in it holding the platform's
sign-in in an iframe, and a Cancel button, plain DOM with every colour a
`--gb-widget-*` custom property, set through CSSOM so a policy of
`style-src 'self'` admits it. A modal dialog makes the page behind it
inert, so while the box is up Tab moves among its controls and the
sign-in's and never reaches the page's own, measured in the browser suite,
and Escape with focus in the page is the dialog's `cancel`.

`signIn()` puts the box up before anything is awaited, in the click's own
turn, with focus in the frame, so a phone opens its keyboard when the
sign-in focuses its first field. Measured in the browser suite: Chromium
and Firefox let the sign-in focus its first control once it loads; WebKit,
as Playwright builds it for Linux, keeps focus on the frame and not on the
control, so a player there taps the field first. Safari and iOS Safari are
not measured here. Then it makes a PKCE
challenge and a state and points the frame at `/authorize`, naming the page's
own origin as `redirect_uri`. The sign-in frames only for that exact origin:
it sends `frame-ancestors` naming it, so a browser refuses to show it under
a page of any other origin, or under the page that asked when that page is
itself shown inside another page whose origin is not the one that asked,
since every ancestor is checked, and each against the exact origin, so
another origin on the same site is refused too.

The client takes a message only from the frame it holds, on the sign-in
origin, carrying the state it sent, and the platform posts three, declared in
`/api` as `SignInMessage`. A browser that refuses the frame still fires
`load` on the iframe (measured in Chromium 141 and 153, and in Firefox 142
for a `frame-ancestors` refusal), so the sign-in's own word is the only
sign the box works, and that holds for every page the frame shows, not only
the first: a form step answered with a page the browser will not frame
leaves the box as empty as a refused first page. So each time the frame
finishes loading a page, the client posts that page `vbz.signin.ping`,
`SignInPing` in `/api`, numbered by the load and aimed at the sign-in origin
alone, which a refused page, being another origin's, never receives. The
sign-in answers `vbz.signin.ready` echoing the number, and only that
answer clears the page: a ready for an earlier load, a second one, or one
nobody asked for changes nothing. A ready the sign-in posted of its own
accord would not do, because it can reach the page before the iframe's
`load` (measured in Firefox 142 under COOP and COEP), and then nothing says
which page it was about. While a page is unanswered, the client waits the
ready time from its load, or from asking for the first page:
`SIGN_IN_READY_MS`, 15 seconds, an estimate nobody measured on a slow
network, unless the page gives `createPlatformClient` a `signInReadyMs` of
its own, as the browser suite does with 3 seconds: a whole number of
milliseconds up to `MAX_SIGN_IN_READY_MS`, 2,147,483,647, the most a
browser's timer waits, past which it would fire at once, so a client is
not made with more. With no answer,
`signIn()` rejects with `E_SIGNIN_UNREACHABLE` and the box comes down.

`vbz.signin` carries the code, which the client trades at
`POST /v1/oauth/token`. `vbz.signin.cancel` is Escape inside the frame,
which the page cannot hear while the frame has focus. The Cancel button,
Escape in the page, the sign-in's cancel and the page's own `closeSignIn()`
reject with `E_SIGNIN_CANCELLED` and take the box down. `closeSignIn()` also
ends a sign-in whose code is still being traded: the player signed in, and
the page keeps nobody from it. A second `signIn()` while one is open
answers the first's promise and opens nothing.

The box makes three things true that a window did not. A player's remembered
sign-in is kept per site that framed it, because a cookie set in a frame on
another site is kept for that site alone (`SameSite=None; Partitioned`), so a
player who signed in on one studio's site types a code again on another's,
and Safari may ask for one more often. A framed sign-in shows no address bar.
And a page shown inside another page whose origin is not its own, such as
a portal's, cannot show the box.

A page sent with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy`, for a game that needs threads, shows the box
and stays cross-origin isolated, because the sign-in sends
`Cross-Origin-Embedder-Policy: require-corp` and
`Cross-Origin-Resource-Policy: cross-origin` on every page it lets be
framed. The browser suite measures it with the sign-in on another site from
the page, as the platform's is: in Chromium, Firefox and WebKit the sign-in
renders in the box and the page stays isolated, and in Chromium and WebKit
a player signs in through it. Playwright 1.56.1 cannot reach into that frame
in Firefox, so the sign-in itself is not driven there. A window, which the
box replaced, lost its opener under the same headers in every engine
measured.

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

## What a page needs

**A Content-Security-Policy** that lets the game's code in and keeps
everything else out. A page whose build is served from its own origin, as
the template's is, sends `localPageCsp` from `/harness`, under which
everything the game loads is `'self'` and nothing is framed:

```
default-src 'none'; script-src 'self'; style-src 'self';
img-src 'self' data: blob:; connect-src 'self';
base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

with the page's import map admitted by its hash, below. A page whose build is
served from another origin sends `pageCsp`, which names the game's own path
there, `/g/<game id>/`, never the whole origin when it serves anything else,
so such a host serves the build at the content-addressed paths
`createBlobServer` answers, below, rather than as `dist/` holds it. On vbz.gg every
studio's games are served from `files.vbz.gg`, so a ranked page names its
game's path there, the API and the sign-in:

```
default-src 'none'; script-src 'self' https://files.vbz.gg/g/<game id>/;
style-src 'self'; img-src 'self' data: blob:;
connect-src 'self' https://api.vbz.gg; frame-src https://signin.vbz.gg;
base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

`pageCsp` is the policy the harness serves its own page under, naming the
game's path on its bundles port, and the browser suite measured it in
Chromium, Firefox and WebKit: it admits the page module's dynamic import and
the module's own static import of its rules code, and refuses another game's
path on the same origin before a request leaves. It needs no `unsafe-eval`
and no inline script. A page with more of its own adds to it.

On vbz.gg, `frame-src` names the platform's sign-in, which `signIn()` frames
in its box. Measured in Chromium and Firefox: under `default-src 'none'`
with no `frame-src`, a frame on the sign-in origin is never requested, and
the box stays empty until `signIn()` gives up with `E_SIGNIN_UNREACHABLE`.
`pageCsp` takes the sign-in origin, `signInOrigin`, and a page that signs
nobody in names `null` and frames nothing.

**What the game needs of the policy.** A game may load more than its two
modules, and `pageCsp` adds each need only when it is named, in `needs`:

- a renderer that compiles WebAssembly, such as null3d, needs
  `'wasm-unsafe-eval'` in `script-src`, which compiles WebAssembly and
  evaluates no JavaScript;
- one that starts workers needs `worker-src blob:` and the game's path, and
  a game whose page module starts one does not build until it says so;
- a game that fetches files of its folder, its data packs or its art, needs
  the game's path in `connect-src`.

A game says the first two in its `package.json`, as
`"vbz": { "needs": { "wasm": true, "workers": true } }`, because its build
cannot show them: the code that compiles or starts a worker may sit in the
files folder, which nothing scans. The third is never said, because the
build shows it: a page module of contract 2 fetches every data pack its
manifest declares from the folder, which holds every one, so any version
whose folder lists a file is given it. A game that needs all three is
played under this, for ranked play on vbz.gg:

```
default-src 'none';
script-src 'self' https://files.vbz.gg/g/<game id>/ 'wasm-unsafe-eval';
worker-src blob: https://files.vbz.gg/g/<game id>/;
style-src 'self'; img-src 'self' data: blob:;
connect-src 'self' https://files.vbz.gg/g/<game id>/ https://api.vbz.gg;
frame-src https://signin.vbz.gg;
base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

The browser suite holds it to a fixture that loads what an engine built
into a files folder loads, without one: WebAssembly fetched from the folder
and compiled, a worker started from a blob that imports a module of the
folder, and a module of the folder imported by a name worked out as it
runs. Under the policy with its needs, all three load in Chromium and
Firefox, and WebKit runs the same spec in CI; with its needs left out,
Chromium and Firefox refuse its core's fetch (`connect-src`) and its worker
(`worker-src`), and the game never gets ready. Nothing a game needs adds
`unsafe-eval`.

A page carrying an inline script, such as an import map, names it in
`inlineScripts` and the policy admits it by the SHA-256 of its exact text.
`localPageCsp` takes the same `needs` and `inlineScripts`, with `'self'`
where `pageCsp` names the game's path.

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
pack's path to, and a link in the folder is not followed. The name is the
listing's hash and nothing else: no version number, no date and no path of
the author's machine reaches it, so the same files are the same folder in
every build, and a changed byte is another folder.

### Data packs

A data pack is a file the rules code reads, such as a level's layout or a
table of stats. The manifest declares it in `assets`, with its path, size,
SHA-256 and `requiredForSim: true`, and says when it arrives: a start pack,
the default, is in hand before `init`, and a demand pack arrives once the
game's `packsNeeded()` names it, so a game fetches a town's data only when
the player reaches the town. Art the rules code never reads is not
declared: it is a file of the folder the presentation finds by its address.

Every declared pack is a file of the folder at its declared path, and
`vbz build` refuses one the folder does not hold (`E_PACK_UNLISTED`), one
whose size or SHA-256 is not the manifest's (`E_PACK_MISMATCH`), and packs
over the limits below (`E_PACKS_TOO_LARGE`). On a page the module fetches
the start packs from the folder's address while the game gets ready, so one
that does not arrive spends no run, and a demand pack when the game names
it, with the engine's pack loader. The engine holds the loop while a named
pack is missing, so the tick that first reads it is the same on every
machine however long the download took, and it checks each pack's size and
SHA-256 before the game may read it. `vbz dev` hands its replay the packs in
the folder, and vbz.gg keeps each pack as it keeps every file of the folder
and hands its server's replay the same bytes. The browser suite's folder
fixture reads a demand pack from tick 180: the page fetched it only once the
rules code named it, and the recording replays to its counters with the pack
and fails without it. The engine's guide, `clockwork2`, has the rules for
reading one in `references/assets.md`.

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
   and no `new SharedWorker` or `importScripts`, each of which loads code by
   an address decided when it runs (`E_PRESENT_DYNAMIC_IMPORT`,
   `E_PRESENT_WORKER`). It may call `new Worker`: pixi.js 8 starts its
   workers from `blob:` URLs made of strings the page module carries, so the
   worker runs the module's own bytes, and what a worker may be started from
   is the page's policy to bound, `worker-src blob:` and the game's path. The
   check counts them, `PresentImports.workers`, and `vbz build` refuses a
   page module that starts one unless the game's `package.json` says it
   needs workers. Bun's scanner sees only a literal `import()`, so these are
   found by reading the text as tokens, stepping over strings, comments and
   regular expressions. Whether a `/` opens a pattern or divides is told by
   what came before it: an
   operand, a `)`, a `]` or a postfix `++` or `--` ends an expression, so it
   divides, and after a control keyword's head, `if (a)`, a statement starts,
   so it opens one. Run over pixi.js 8.21 (its published `pixi.min.mjs`, and
   bundled by bun with and without minifying), three 0.186 bundled and
   minified by bun, and both frozen template builds, it finds pixi's four
   `new Worker` calls and nothing else. A load hidden behind a computed
   property gets past that reading; the page's policy, which names the
   game's own path and nothing else, is what bounds it. Code in the files
   folder is not read at all, and loads what it likes from the folder:
   that same policy is all that bounds it.
5. Every limit below, each file of the folder held by its size on disk
   before a byte of it is read.

vbz.gg also imports what it does with a file upload from here:
`missingFiles` answers which of a listing's files the game's store lacks,
`assertFileBytes` holds an uploaded file to the SHA-256 it was sent under
(`E_FILE_HASH_MISMATCH`), and `assertFilesHeld` refuses a version whose
listing names a file the store lacks (`E_FILES_MISSING`).

Then the addressing, which `vbz dev` performs on a build and vbz.gg on an
upload. Each module is named by the SHA-256 of its own bytes. vbz.gg keeps
each file of the folder once per game, in its private store under the
SHA-256 of the file's bytes, however many versions or paths name it, and
publishes a version's folder on the public store under the listing's name
and each file's path, as "Serving" below describes. `rewritePresentImports`
replaces the page module's `cw2:sim` with `/g/<game id>/sim/<64 hex>.js` and
its `cw2:files/` with `/g/<game id>/t/<listing sha256>/`, root-relative, so
the bytes carry no domain, and re-scans to prove the result imports exactly
those paths. The page module is hashed **after** the rewrite, so a stored
page module's hash is taken over bytes that already name one game, one rules
code and one folder. A page module can name exactly one rules code and one
set of files, forever, which is what makes "the browser and the validator
ran the same code" checkable rather than asserted.

`buildAndAddress` in `/harness` performs that whole sequence, which is the
same one vbz.gg performs on an upload. `vbz build` writes the page module
**unrewritten**, with its specifiers intact, beside `dist/sim.js`,
`dist/manifest.json`, the listing as `dist/files.json`, exactly the text its
name is the hash of, and a copy of the folder as `dist/files/`, so a page
maps the specifiers with an import map and plays the bytes as built, and a
page module that arrived already pointing somewhere would be one naming code
nobody checked. It also writes `dist/game.json`, which a page playing the
build reads, and an upload to vbz.gg never carries.

## The limits

Every limit is a constant in `/build`. `vbz build` holds a build to the
sizes it can measure, and vbz.gg, which imports the same constants, holds
an upload, a game's files and a run to them, so a build that passes here
passes there:

| Limit | Value | What it holds | Past it |
|---|---|---|---|
| `MAX_SIM_BYTES` | 4 MiB | the rules code | `E_ARTIFACT_TOO_LARGE` |
| `MAX_PRESENT_BYTES` | 16 MiB | the page module | `E_ARTIFACT_TOO_LARGE` |
| `MAX_MANIFEST_BYTES` | 512 KiB | the manifest, as JSON with no white space | `E_MANIFEST_INVALID` |
| `MAX_FILE_BYTES` | 64 MiB | one file of the files folder | `E_FILE_TOO_LARGE` |
| `MAX_FILES_BYTES` | 512 MiB | every file of the folder together | `E_FILES_TOO_LARGE` |
| `MAX_FILES` | 10,000 | how many files the folder holds | `E_FILES_TOO_MANY` |
| `MAX_UNNAMED_FILES_BYTES` | 1 GiB | the files a game holds on the platform that no version names | `E_QUOTA_EXCEEDED`, on a file's upload |
| `MAX_FILE_PATH_LENGTH` | 512 | the characters of one file's path | `E_FILE_PATH_INVALID` |
| `MAX_PACK_BYTES` | 16 MiB | one data pack | `E_PACKS_TOO_LARGE` |
| `MAX_PACKS_BYTES` | 48 MiB | every data pack together | `E_PACKS_TOO_LARGE` |
| `MAX_RUN_BYTES` | 31 MiB | a run's recording, and its chunks together | `E_RUN_TOO_LARGE` |
| `MAX_CHUNK_BYTES` | 1 MiB | one chunk of a run | `E_BODY_TOO_LARGE` |
| `MAX_LISTING_BYTES` | 6,170,011 bytes | the longest listing the limits above allow | nothing: no listing within them is longer |
| `MAX_VERSION_PART` | 2,147,483,647 | each part of a version | `E_VERSION_INVALID` |

The rules code is code, and level data goes in data packs: every replay
imports the rules code afresh, and in V8 a 2 MiB rules code took 82 ms to
start, measured for the limits' design.

`MAX_LISTING_BYTES` is no limit of its own. It is the longest canonical
listing the folder's limits allow, which the platform takes as the body of
the route that asks which files it lacks.

The manifest is measured as vbz.gg stores it, the UTF-8 bytes of its JSON
with no white space, whatever spacing `dist/manifest.json` has, and
`vbz build` refuses one over `MAX_MANIFEST_BYTES` with the platform's code
and words.

### If you use vbz.gg: a run's and a replay's limits

The engine's `INPUT_BUDGET_PER_TICK`, 16, holds a ranked or practice run on
vbz.gg to 16 inputs a tick on average (`E_INPUT_BUDGET`); a local run has no
such budget.

On vbz.gg, the rules code and every pack fit one replay inside the 64 MiB of
code a Cloudflare Worker takes. A replay's request carries the recording
alone, the rules code and the packs read from storage, which is what leaves
a recording its 31 MiB. A page never meets `MAX_RUN_BYTES` as a refusal:
`Run` ends a run as if the player left before its next piece would eat into
the room the last commit needs, and the platform replays and ranks it as it
stood. How long that lets a run last is a matter of how fast it records
inputs: the engine guide's `references/inputs.md` measures each kind of
device over five minutes.

Every replay of a run on vbz.gg carries parts of the manifest beside the
run's log, so `MAX_MANIFEST_BYTES` leaves the replay's request room for a
log at `MAX_RUN_BYTES`. `MAX_UNNAMED_FILES_BYTES`, twice `MAX_FILES_BYTES`,
is the one limit no build can check, because it counts what the platform
already holds for the game: files sent ahead of their version that no
version names yet, which the platform removes a day after each was last
sent. A file whose upload would take them past it is refused before a byte
is stored, and the cap leaves room for a version's whole folder to go up
while the files of one that never arrived wait out their day.

One replay on vbz.gg has three more limits, which `/build` exports beside
these and no build can check, because only a replay measures them: 5 minutes
of CPU (`REPLAY_CPU_BUDGET_MS`), 7.5 minutes of wall time
(`REPLAY_WALL_BUDGET_MS`) and 128 MB of memory (`REPLAY_MEMORY_MB`), the
platform's figures for its replay service on Cloudflare, which the platform
takes from here. The rules code as loaded, the data packs the manifest
declares and the game's state share the memory. Before a version publishes,
the platform's checks load the rules code with its data packs on that
service and run a few steps with nothing pressed. A version whose rules code
will not load there, or whose replay dies while it loads the rules code or
its packs, ends in `E_REPLAY_MODULE`, with the service's own error text in
its first failure, and one whose replay runs out of its CPU time, its wall
time or its memory in those steps ends in `E_REPLAY_OVER_BUDGET`. Both are
the game's to fix; a service that gives no answer is the platform's, and the
check is tried again. The service is Cloudflare Workers, whose runtime
refuses some work while a module loads with an error of its own, which
Cloudflare lists on its [Hyperdrive troubleshooting
page](https://developers.cloudflare.com/hyperdrive/observability/troubleshooting/):
"Disallowed operation called within global scope. Asynchronous I/O (ex:
fetch() or connect()), setting a timeout, and generating random values are
not allowed within global scope." So the top level of the rules code, and of
every library it bundles, does none of those. A player's run is longer than
a few steps. At 60 steps a second an hour of play is 216,000 steps, and 5
minutes of CPU leaves about 1.4 ms for each; a ranked run whose replay runs
out of any of the three is a `log_fault` and never ranks.

## Drawing with null3d

[null3d](https://github.com/null3d-engine/null3d) draws from workers with a
WebAssembly core, on WebGPU or WebGL2. It is not on npm yet, so the SDK does
not depend on it, and the agent guide's `references/null3d.md` is the
recipe, file by file. In short:

- **The engine goes in the files folder.** A Vite build with null3d's
  plugin writes it there from a two-line entry exporting `createEngine` and
  the sketch's address, and the page module imports `cw2:files/entry.js`.
  Bundled into the page module instead, `vbz build` refuses it: 11,337,391
  bytes, naming 7,428 files Bun cannot ship, measured. Build only the shader
  permutations the game draws with: a three-lane scene drew with 5 words
  and a folder of 297 files and 26,057,130 bytes, where null3d's full shader
  set is 4,117,799,356 bytes, over `MAX_FILES_BYTES`.
- **Its needs**: `"vbz": { "needs": { "wasm": true, "workers": true } }`,
  and the game's path in `connect-src`, which the build adds because the
  folder lists files.
- **The readiness gate.** The presentation's `prepare` starts the engine and
  resolves on its first frame, so the run's clock starts only once a frame
  is on the screen, and a device with no usable GPU path fails with
  `E_PRESENTATION_FAILED` before a run is asked for.
- **Input off, always**: `createEngine({ input: false })`. null3d's input,
  pointer events on objects, `@null3d/controls` and `requestPointerLock`
  decide nothing a run counts, because nothing records them. A camera a
  viewer orbits while watching a replay is fine. Controls the game draws go
  on an overlay at the rectangles the rules code hit-tests.
- **Mouse look-around that changes the result** goes through the engine's
  `mouseLock` mapping in coarse steps; the rules code owns the camera's yaw
  and pitch, turned with `dmath`, and puts the camera in the view, and the
  sketch only draws it.
- **Its maths in rules code** only through its maths entry,
  `@null3d/engine/math/...`, and `createMath` given clockwork2's `dmath`,
  both coming in null3d's next release.
- **Isolation for threads**: no headers, which plays single-threaded;
  `Document-Isolation-Policy`; or COOP with COEP. All three were measured
  with the sign-in's box a ranked page on vbz.gg puts up.

## Serving

Any host that serves files serves a build: the author's own site, a static
host, a CDN, a game portal, or a local server for a page that is never
online. `dist/` holds the build as `vbz build` wrote it. A page beside it
maps the page module's `cw2:sim` and `cw2:files/` with an import map, as the
template's `site/` does with `dist/` served as `game/`, and a page on
another origin loads it from there. `/serve`'s `createBlobServer` sends the
headers a host needs, and the harness serves the game with it, so a page
meets on a laptop what it meets from a careful host:

- `Access-Control-Allow-Origin: *`, because a page on another origin
  imports the page module, and every module import is a CORS request. What
  these files hold is public, and which page may run a game is that page's
  policy to say, by its game's path. The 404 carries the header too, or a
  miss reads to the page as a network failure. A host that serves the build
  to a page on its own origin alone needs none of it.
- `Cross-Origin-Resource-Policy: cross-origin`, so a page that is
  cross-origin isolated may load the files from another origin.
- `Cache-Control: public, max-age=31536000, immutable` on the
  content-addressed paths `createBlobServer` answers,
  `/g/<game id>/sim/<sha256>.js`, `/g/<game id>/present/<sha256>.js` and
  `/g/<game id>/t/<listing sha256>/<path>`, because each module is named by
  the digest of its own bytes, and each file by the digest of a listing that
  names its bytes, so neither ever changes. `dist/sim.js` and
  `dist/present.js` keep their names from one build to the next, so a host
  serving `dist/` as it is caches them as files that change in place.
- An `ETag` of the digest, or for a file of the folder's name and its path,
  and `304` for a request that names it.
- A module as JavaScript, and a file as the type its extension names in
  `FILE_CONTENT_TYPES`: JavaScript for a module script, which a browser runs
  from no other type, `application/wasm` for WebAssembly, which a browser
  compiles by streaming only from that type, and `application/octet-stream`
  for anything it does not name, HTML among it, so a file opened on the
  bundles origin is never a page there.
- `X-Content-Type-Options: nosniff` on every answer, so a wrong type is a
  refusal in every browser rather than a guess.
- `Content-Security-Policy: default-src 'none'; sandbox` on every answer
  that is not JavaScript, `DOCUMENT_POLICY`, because an origin that serves
  more than one game's files, as `files.vbz.gg` serves every studio's, would
  run an SVG holding a `<script>` when it is opened. Measured in Chromium 141
  and Firefox 142: such an SVG opened at its address ran its script without
  the policy and not with it, and still drew as an `<img>`. A response's
  policy does nothing to a stylesheet, an image, a font or a `fetch`.
  JavaScript carries none, because a worker runs under the policy of the
  script that starts it: measured in both, a worker whose script came with
  this policy could not `fetch` anything.

### If you use vbz.gg: files.vbz.gg

The two modules of a version published on vbz.gg sit at
`https://files.vbz.gg/g/<game id>/sim/<sha256>.js` and
`https://files.vbz.gg/g/<game id>/present/<sha256>.js`, and its files under
`https://files.vbz.gg/g/<game id>/t/<listing sha256>/<path>`, copied there
when the version passes its checks, so a pending or rejected upload is never
public. Two versions with an identical listing share one folder there, such
as a patch that changed only code. A takedown deletes the version's two
modules, and its folder unless another version that is served, or still
being checked, names the same folder, and purges what it deleted from the
cache. The platform's public store sends the headers above, and its
development bundles server serves them with `createBlobServer`.

## Starting a game

`vbz new ./my-game` copies the template out of the package and renames it:
the game's id comes from the directory, because on vbz.gg an id is immutable
once published, and a placeholder somebody forgets would be a board under
the wrong name. The copy builds and plays before anything is changed, so an
author's first failure is one they caused.

The template ships inside the package rather than beside it in this
repository, at the same path relative to the CLI in the source tree and in
`dist`, which is what lets an installed copy find it. It is a game, Lane
Runner, with its own two buttons, keys and a controller, and `site/`, a page
in the mode its `site/config.json` names. `{ "mode": "local" }`, which a new
game ships with, plays the build beside the page with `playLocal` and talks
to nobody. For vbz.gg,
`{ "mode": "ranked", apiOrigin, signInOrigin, pageKey }` is a studio page
with sign-in, Play, Practice and the board. The mode is named, never worked
out from whether a page key is there, and opting in to ranked play changes
that file and nothing about the build.

`vbz build` writes `dist/game.json` beside the build: where each part is,
relative to it, and what the manifest and the files folder hash to, so a
plain static host serves `dist/` as it is to a page playing the game
locally. Such a page maps the page module's `cw2:sim` and `cw2:files/` with
an import map, so the module's bytes are the ones `vbz build` wrote, and
`localAddress` in `/host` turns `game.json` and its URL into what `loadGame`
takes.

## The agent guides

A game has two sets of rules for an agent to follow, and each package ships
its own as an agent skill under `skill/`: the engine's, `clockwork2`, on
writing a simulation that replays to the same state on a server, and this
package's, `vbz-game`, on everything between that simulation and a game a
page plays, and, if the game is published to vbz.gg, the platform checks. A
game keeps a copy of both in `.claude/skills/`, where an agent's tools look
for skills, so the guide an agent reads is the one for the versions the game
installed.

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

`vbz check ./my-game` is the check every game needs. It builds the game,
holds the manifest to its schema, runs the engine's `every-game` set of
conformance checks over the built rules code, with every file the manifest
declares laid out beside it, and holds `src/capture.ts` to the manifest with
`checkCapture`. That set plays the game: it holds it to determinism, to a
snapshot that restores, to a recording that replays to the state it
recorded, to its counters, to the cost of a step and to its declared files,
so it is how to test record and replay before a game ships. `vbz check`
prints the version, its release line and the line's contract hash,
`contractSha256`, so two builds of a line can be compared. It exits 0 only
when everything passes.

The engine's checks read the rules code with TypeScript's own parser, so
`vbz check` needs `typescript` installed in the game, and the template's
`devDependencies` carry it. No other command needs it. `vbz new` runs before
a game has installed anything, so the CLI loads the checks only when `check`
is the command it was given.

### If you use vbz.gg: the upload's checks

`vbz check --ranked` runs the engine's `ranked` set instead, which adds what
only a ranked or practice run needs: two seeds pass through different states
on one input log (`E_SEED_IGNORED`), and the manifest says how a run ranks
(`E_RANK_UNDECLARED`), which a game played only on its own page may leave
out. The platform runs only part of the ranked set on an upload: the checks
that read the rules code and the manifest (banned APIs, no asynchronous
work, the declared files and their budgets, the manifest, the served config
and the ranking), `init` and 600 steps with nothing pressed, and the seed
check. It does not run the engine's determinism, restore, counters, replay
or performance checks, play the game in more than one engine, or compare
what its page module reports with a replay, so nothing on an upload holds a
version to replaying a recording to the state it recorded. A game that is
not deterministic passes the upload and fails its players: their runs do not
replay to what they saw, and never rank. The platform refuses an upload
whose manifest declares no ranking under the same `E_RANK_UNDECLARED`,
before it stores a byte. It also runs two checks `vbz check` cannot: it
loads the page module in a browser with `loadGame` and mounts it in watch
mode on a recording with nothing pressed for a few steps, where it has to
get ready and not throw, and it loads the rules code on its replay service
and runs a few steps, which "The limits" describes. A game the checks'
browser cannot draw is mounted with `draw: false` and gets ready without
drawing, and a page module of contract 1, which has no `draw: false`, is
then loaded and not mounted.

The upload's checks are held to time as well as size, and `/build` exports
each limit. The engine's checks an upload runs are given, for every step
they play, what one step of an hour of the game's own play at its own rate
may cost its replay, `REPLAY_CPU_BUDGET_MS` over that hour's steps
(`CHECK_STEP_BUDGET_US`, keyed by tick rate): 2,777 microseconds of one CPU
a step at 30 steps a second, 1,388 at 60 and 694 at 120, so an hour of the
game's steps at its rate, each within its allowance, fits one replay's CPU
budget. Start-up is allowed apart from the steps: each time they load the
rules code, once for the headless check and up to six times for the seed
check, importing it, reading its start packs and running `init` are given 5
seconds of one CPU a load (`CHECK_INIT_BUDGET_MS`); the platform counts the
loads. The page module has to load and be ready within 60 seconds of the
checks' browser starting (`CHECK_READY_MS`), its presentation's `prepare`
settled and its start packs fetched, with the version's files folder served
beside it and nothing else: no other network, nobody to press anything and
no permission granted. A check that runs out of any of these is tried again,
and only once every attempt has run out is the version refused, with
`E_CHECKS_OVER_BUDGET` or `E_PAGE_MODULE_NOT_READY`, so a moment's slowness
on the platform's side refuses nothing, and the refusal can arrive after
`vbz publish` has stopped waiting. `vbz check --ranked` prints what a step
cost on the author's machine in its `performance` check, and a large start
pack parsed in `init` is paid for at every load. A `prepare` that waits on
something outside the game's files folder, on a permission, or on a network
the checks do not have never gets ready there.

## Where a game's code runs

A game's code is its author's, and so is everything it imports, which nobody
in the kit has read. The commands run where an author or a build system
keeps secrets in the environment, cloud credentials or a vbz.gg studio's
secret key, so every command that evaluates a game's code does it in a
process of its own, started with an empty environment, and never in its own
process:

- `vbz build`, and every command that builds, runs the bundler with nothing
  but `NODE_ENV`, because the bundler runs the macros a game's source
  imports, and reads the manifest by importing the rules code with nothing at
  all.
- `vbz check` runs the engine's conformance checks over the rules code and
  imports `src/capture.ts` in one such process, which writes what it found to
  a file, because the game's own code may print.
- `vbz dev` replays each run against the rules code in one.
- `vbz publish`, for vbz.gg, evaluates nothing of a game: it uploads what
  `vbz build` wrote as bytes, so the key it holds is never beside the game's
  code.

One function starts them all, `runGameProcess` in `build/game-process.ts`,
and a test per command plants a variable in its environment and holds the
game's code to never seeing it.

## The harness

`vbz dev ./my-game` builds the two real artifacts and the files folder and
serves them on one port at the paths and with the headers above, under the
game id `00000000-0000-4000-8000-000000000000`, and serves a page on a
**second port** that loads the page module from there with `loadGame` and
plays it with `playLocal`, through the module's own `mount`. The page is
served under `pageCsp`, naming the game's path on the first port, with the
game's needs, so a module a page loading it from another origin would refuse
is refused here first and said in the page's status line.

Two ports are two origins, which is what puts an author in front of a
cross-origin module import before the game ships. What two ports do not
reproduce is the second *registrable* domain: a page may load its game from
another site, as a studio's page on vbz.gg does, and two ports on localhost
are one site. A module import carries no cookies either way, so the gap is
named rather than closed with an `/etc/hosts` entry.

The page adds what a player's page does not need. **Start** and **End**
drive the run; Start asks for tilt first when the game reads it, and like a
page's Play starts no run without it, keeping the code and its sentence on
the status line. When the run ends, the page sends its recording back, and
the harness replays it against the built rules code, to the tick it ended,
in a process of its own with an empty environment, so a game cannot read a
key or a cloud credential from the shell `vbz dev` runs in. It holds the
run's inputs to the manifest with the engine's `checkInputs`, and measures
the recording. The page shows three lines: whether the replay matches, how
many inputs against the budget of 16 a tick a ranked or practice run on
vbz.gg is held to, and the recording's size in bytes. The budget binds only
those runs, so a run over it is said as that figure and turns the report red
only under `vbz dev --ranked`. It hands the page the recording too, so an
author can save it.

The seed is a constant, so a run an author is debugging is the run they had
a moment ago. The config is the manifest's served config, every setting at
its default, which `playLocal` plays when a page names none, and the harness
reads both it and the tick rate from the manifest `vbz build` wrote,
refusing to start without one. A game with a setting that is required and
has no default can be served no config, so the harness refuses it, in the
client's `E_CONFIG_REQUIRED` sentence naming each such setting, unless
`vbz dev --config <file>` names a config of the author's own, a JSON object
the harness holds to the manifest with the engine's `validateParams`. A
ranked run on vbz.gg always plays the served config, so `--config` with
`--ranked` is refused, and so is a manifest the stand-in would have to serve
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
`localPageCsp`, and nothing else runs. In either mode an inline script the
page carries, such as its import map, is admitted by the SHA-256 of its
text, and what the game's `package.json` says it needs of a page's policy,
`"vbz": { "needs": { "wasm": true, "workers": true } }`, is added to the
harness page's policy and the site's, with the game's path in
`connect-src` whenever the build's folder lists a file.

### If you use vbz.gg: the stand-in

Ranked, the page is served under the harness page's policy with the API
added and the sign-in in `frame-src`, against a stand-in for the platform
shipped in the package: the page routes and the sign-in on origins of their
own, as one local player, on the harness seed and the served config, at the
platform's limits from `/build`, and the harness answers the page's
`config.json` with the mode, the stand-in's origins and its page key.

The stand-in's sign-in is framed exactly as the platform's is: each page
carrying a checked request is sent with `frame-ancestors` naming the site's
exact origin, `Cross-Origin-Embedder-Policy: require-corp` and
`Cross-Origin-Resource-Policy: cross-origin`, and every other answer with
`frame-ancestors 'none'` and `X-Frame-Options: DENY`. Each framed page
answers the site's `vbz.signin.ping` with `vbz.signin.ready`, echoing its
number, to the site's origin alone, a Continue button posts a form back to
the sign-in's own origin, refused when its `Origin` is any other, and the
answer hands the code over with `vbz.signin`, from the frame to that origin
alone. It signs one local player in with that click, so it remembers nobody
and sets no cookie. A request it refuses, such as one with another page key
or for another page, is answered framed for nobody, as the platform's is,
so the page shows an empty box and hears only `E_SIGNIN_UNREACHABLE`; the
stand-in says why in the terminal.

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
`vbz build` refuses such a version with `E_VERSION_INVALID`, and vbz.gg
refuses the same versions on an upload. Every version sharing one
`MAJOR.MINOR` is one **release line**, and `vbz check` prints a line's
contract hash, so two builds of it can be compared.

### If you use vbz.gg: release lines

The platform treats a release line as one game. The day's seed pins a line,
the newest by `(major, minor)` with a published version. A ranked run plays
the line's highest published patch, highest by version number, so a patch
that passes its checks at noon reaches the next ranked start. A new minor or
major waits for the next day's seed, so nobody's ranked day changes rules
halfway through. A practice run plays the newest playable version of any
line.

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

### If you use vbz.gg: cheating bars the player

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

## If you use vbz.gg: publishing a version

`vbz publish ./my-game --game <id>` uploads what `vbz build` wrote, the
files folder first. It sends the listing, with the version's manifest beside
it, `MissingFilesRequest` in `/api`, to
`POST /v1/games/:gameId/files/missing`. The platform answers first every
refusal the version's upload would get from those two alone: its version
number, a patch that changes its line's rules, the manifest, the listing and
its data packs, and the studio's quota, so a version it would refuse uploads
no file, where before up to 512 MiB of files went up for a version that was
then refused. Otherwise it answers with the SHA-256 of each listed file the
game's store lacks, and the command uploads each of those from
`dist/files/` as its own `PUT /v1/games/:gameId/files/:sha256`, its bytes
the body. The platform keeps a file once per game, in its private store under
the hash of its bytes, so a file a version shares with an earlier one is not
sent again, two paths holding the same bytes are sent once, and the store is
the game's own, so a studio learns nothing of another's files. The command
checks each file against the listing before it sends it, and checks that the
platform names the folder as `vbz build` did.

Then it uploads the version, `manifest`, `sim`, `present` and the listing as
`files`, as one multipart `POST /v1/games/:gameId/versions`, which the
platform refuses with `E_FILES_MISSING` if its store lacks a listed file,
prints the release line the version joined, and then reads the version back
at
`GET /v1/studios/:studioId/versions/:versionId` every two seconds until the
platform's checks decide. The upload's answer names the studio, so the
command needs only the game's id. It waits up to 34 minutes,
`CHECK_WAIT_MS`, the platform's worst case for one attempt with headroom,
rounded up to whole minutes: 10 minutes for the ingest job to wait in the
platform's queue (`CHECK_QUEUE_ALLOWANCE_MS`); 10 minutes for the checks
container, as long as the platform waits for one
(`CHECKS_CONTAINER_WAIT_MS`), which the platform's worst case for one check
with the container's start, a game at 30 steps a second, stays under, held
by a test on the platform's side; the 7.5 minutes of wall
time one replay may take (`REPLAY_WALL_BUDGET_MS`), which the
replay-service check and a patch's replays share, since they run beside
each other, and the 10 seconds the
platform waits past it for the answer (`REPLAY_ANSWER_MARGIN_MS`); 5
minutes for copying a published version's files to the public store before
the verdict is written
(`CHECK_PUBLISH_ALLOWANCE_MS`), which nobody has timed; and 1 minute of
headroom (`CHECK_WAIT_HEADROOM_MS`). The platform takes its own waits and
the replay's budget from the same `/build` constants. The wait covers one
attempt: when the replay service gives no answer, the platform runs the
version's job again, which it does not cover. Nor does it cover a check
that runs out of time: the platform tries it again, and writes
`E_CHECKS_OVER_BUDGET` or `E_PAGE_MODULE_NOT_READY` only once every attempt
has run out, so that refusal can arrive after the command has stopped and
reported the version still being checked. A version still pending after
the wait is reported in the platform's terms, still pending, with the
address to read its state at later and a reminder that uploading it again is
refused as `E_VERSION_EXISTS`, and the command exits 1, because only a
published version exits 0.

Each of the four goes as a file part carrying the file's bytes as they are
on disk. A text part would not arrive that way: an encoder that follows the
HTML standard rewrites every line feed in one as CRLF, and Bun 1.4.3's and
Node 22's both do, where Bun 1.3.11's did not.

It is built for a studio's build system, so its exit code is the verdict: 0
when the version passed its checks and is published, with the release line
it joined and which runs it serves printed. A version that serves no run yet,
such as a new minor waiting for the next day's seed, still exits 0. A
rejection, a version an operator has taken down, a version still being
checked when the wait runs out, a refusal and a platform that does not
answer all exit 1 with a code that names which, and a refusal
prints its `detail`: the fields a patch changed and the minor to publish
instead, or the versions an upload had to be above.

A published version also comes back with `patchScores`. Before the
verdict, beside the replay-service check, the platform replays at most 3 of
its line's most recent settled ranked runs (`PATCH_SCORE_RUNS`), played on
the line's other versions, under the new rules code, and counts the runs
whose end tick, terminal or counters come out different. That is the part
of a patch's promise a manifest cannot show: a fix that changes what the
same play scores. They are players' own recordings, and the only players'
runs a version meets before it publishes. The count decides nothing. It is
written with the verdict, so the command waits for it as it waits for the
verdict and prints it as the platform measured it, such as
`patch check: 2 of 3 recent ranked runs on line 1.2 end differently under
this version`. A line's first version has no runs of its line to replay, and
the command says so. A published version always carries `patchScores`; it
is null only while a version is pending and for a rejected one. The command
takes an answer that breaks either half as unreadable
(`E_PUBLISH_ANSWER_UNREADABLE`), so it never prints a verdict without the
count.

The two files routes and the version's upload each take the studio's secret
key, or the access token of a member whose role may upload versions
(`versions.upload`), and reading a version back takes the key or a member
who may read versions (`versions.read`). The command sends the key, from
`VBZ_STUDIO_KEY` and nowhere else: a flag would put it in shell history and
in the process list. The request carries no `Origin` header, which is how
the platform tells a build system from a browser: a secret key sent with one
is refused. The platform's origin is `--api`, else `VBZ_API_ORIGIN`, else
`https://api.vbz.gg`, and it has to be https, or http to the same machine,
because the key travels with the request.

The version is sent once. A retry of an upload that did arrive is refused
as `E_VERSION_EXISTS`, so a slow answer would turn into a confusing one.
Asking which files the platform lacks and uploading one are safe to repeat,
since a file is stored under the hash of its bytes, and each is tried up to
four times, two seconds apart, when the platform does not answer, fails or
asks for time, except a 429 that is `E_QUOTA_EXCEEDED`, which is a "no" for
up to a day. The question answers it when the studio's uploads over the
last 24 hours are used up. A file's upload answers it when the file would
take what its game holds in files no version names past
`MAX_UNNAMED_FILES_BYTES`, 1 GiB, and goes on answering it until a version
names them or the platform removes them, a day after each was last sent. A
refusal stops the command before the version is sent. A
publish can still stop between the files and the version, or the upload be
refused after them because another version arrived in between: the files it
stored are named by no version, and the platform removes them a day after
each was last sent.
Reading the version back is safe to repeat too, and a read the platform
fails to answer is tried again until the wait runs out.

## The package

`@vbz-gg/sdk` is `"sideEffects": false` with one export per half, so
importing `/host` pulls the host, the client it drives and nothing else.
That matters because a page imports `/host`, and on vbz.gg `/platform`, into
a browser bundle: neither reaches a node built-in, the CLI, the harness or
the engine's code.

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
itself: its rules code and its page module both import it, and `/game`,
which the page module bundles, builds the engine's host from it. So the
engine that plays a run on any page is the one the game was built and
checked with, and vbz.gg's page-module check runs it too. A regular
dependency would let a game hold two copies on two versions, with `/game`
driving one engine's host while the rules code carries another's manifest
types. A page needs no engine at all: `/host` and `/platform` import its
types only, which leave nothing in a bundle.

The range is `>=0.10.0 <0.11.0` rather than open-ended. clockwork2 is 0.x and
maps a breaking change to a minor, so an engine minor may move the very
things this package is about, such as what a recorded input carries or what
the host's options are. Each engine minor is a deliberate bump here.
