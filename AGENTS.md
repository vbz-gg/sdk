# Working in this repository

Guidance for coding agents. **Read `docs/sdk.md` first**: it explains how this
package works from first principles, and everything below assumes it. The rest
of the reading, in order of how far away it is: `README.md` says what the
repository is, `packages/sdk/README.md` is what a game author reads, and
clockwork2's `docs/engine.md` is required before changing anything that touches
a manifest or an input.

This repository sits between two others. [clockwork2](https://github.com/vbz-gg/clockwork2)
is the engine and owns determinism, the manifest, the host that runs a game
in a page and the device helpers that record its inputs; the
[platform](https://github.com/vbz-gg/platform) is the backend that checks an
upload, replays a run and ranks it. A game made with this SDK is one build:
played locally on its own page with no platform, and, opted in, played as
ranked and practice runs on a studio's page.

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

Never start a dev server. Ask the user to run it.

## The one rule

**Every page, a studio's, the game's own playing locally, and the harness,
loads a game through `loadGame` and plays it through the module's own
`mount`.** They run the same code, so the game an author tried in the
harness is the game a studio's page plays and the game a local page plays,
and the engine that plays it is the one the game was built and checked
with, bundled into its page module. Nothing on a page builds a `GameHost`, draws a control for a
game, or works out again what the module already decides.

That is also why the page and the module pass each other plain data behind a
contract version. They are built at different times, against different
releases of this package, and share no class.

## The platform's route shapes

`packages/sdk/src/api/` declares every public route the platform serves, as
types only, and the platform imports it. **A route's shape changes here
first**: released, then taken by the platform, never the other way round,
because the platform depends on this package and this package on nothing of
the platform's. Within `/v1` a change only adds, from the day vbz-gg/platform's
`AGENTS.md` marks the platform deployed; until then a shape may change in
place, here first. `packages/sdk/tests/api.test.ts`
holds the subpath to exporting no value, because a studio's page bundles it.
`PublicRefusalCode` is what a route answers; `VersionCheckCode` is what the
platform's own checks end a version in, read back as its `rejectedCode` and
never a refusal's body, and the platform holds its table of them to it.

## The page's client

`packages/sdk/src/platform/` is a studio page's client for those routes, and
`docs/sdk.md` describes it. What to hold while changing it:

**Every request goes through `request`**, which is keyed by `PlatformRoutes`.
A URL built by hand is a route the compiler cannot check, and a secret key's
route is not offered to a page at all. Which credential a route carries comes
from `ROUTE_AUTH`, held to each route's `auth` at compile time.

**Nothing reads the browser when the module loads.** The browser arrives
through `PageEnvironment` when a client is made, so a page may import the
subpath while rendering on a server, and `check:publishable` imports it under
plain node.

**The sign-in's box is made before anything is awaited.** `signIn()` puts
the box, a native `<dialog>` shown modal so the page behind it is inert,
its empty frame and Cancel on the page, with focus in the frame, in the
click's own turn; only then is the challenge made and the
frame pointed at the sign-in. Anything awaited first, even a resolved
promise, moves the focus out of the click's turn, and a phone opens its
keyboard only from a gesture. A message is taken only from the frame the box
holds, on the sign-in origin, carrying the state sent. **The sign-in's ready
message is the only sign the box works**, for every page the frame shows: a
frame the browser refused still fires `load`, so each load is pinged,
`vbz.signin.ping` numbered by the load and aimed at the sign-in origin
alone, and only a `vbz.signin.ready` echoing that number clears it. Never
count readies against loads or take a ready nobody asked for: a page's own
message can arrive before the iframe's `load` (Firefox under COOP and COEP,
measured), and an extra one would leave a later refused page unowed. A
page still unanswered the ready time after its load, `signInReadyMs` or
`SIGN_IN_READY_MS`, is `E_SIGNIN_UNREACHABLE`, never a fallback to a window.
Nothing calls `requestStorageAccess`.

**Every read and write of the kept player goes through `kept`, `keep` and
`forget` in `client.ts`**, which tell `onPlayerChange`'s listeners when the
player moved. A `store.read()` or `store.clear()` anywhere else changes the
player without telling, and `mountSignIn`, which follows it, then shows a
player the client has let go.

**The client's codes and the platform's never share a name.** `CLIENT_ERROR`
in `errors.ts` is the client's table, a compile-time check keeps it apart from
`PublicRefusalCode`, and the guide's `references/page.md` explains every entry,
held both ways by `packages/sdk/skill/tests/skill.test.ts`. A new code is a
new row in both.

## The server's client

`packages/sdk/src/server/` is a studio's own server's client, with its secret
key, and `docs/sdk.md` describes it. What to hold while changing it:

**It sends through the page client's `sendRoute`**, keyed by
`PlatformRoutes` and offering `ServerRoute`, the secret-key routes whose body
is JSON, so a server and a page cannot build a path or read a refusal two
ways, and a page's route is never a server's.

**The key comes from the caller alone and goes nowhere a key may not.** No
environment variable, file or storage is read for it; it is sent as
`Authorization: Bearer` with no `Origin`, to an origin `keyOriginOf` in
`src/wire/keys.ts` allows, the rule `vbz publish` holds its own origin to;
and no client is made where a page's `document` is.
`tests/server/client.test.ts` holds all three, and holds the subpath to
reaching none of the page's sign-in, run or host, nor the CLI.

## The page module

`packages/sdk/src/game/` is what every page module is built from, and
`docs/sdk.md` describes the contract a page drives it through. What to hold
while changing it:

**`./game` holds no DOM and no dynamic import.** It is bundled into every
page module, which imports its rules code as `cw2:sim` and files of its
folder as `cw2:files/<path>`, statically, and nothing else, and the platform
refuses one with a dynamic import before it stores a byte.
Nothing in it reads the browser until `mount` is called, and it imports
nothing of `./host`, `./platform` or the CLI. `tests/game/subpath.test.ts`
holds all three.

**A contract version once released is driven by every later release.**
`DRIVEN_CONTRACTS` only grows. A change that a module built by an earlier
release could not meet is a new contract version, which a page refuses by
name until it learns it, never a new meaning for one already out.
`e2e/frozen/contract-1/` is the template as the first contract-1 release
built it, and `e2e/frozen/contract-2/` as the tree that introduced contract 2
built it; the browser suite holds every later tree to playing both. Never
rebuild one once its contract is released.

**What crosses is plain data.** A failure is `{ code, message }`, never an
error object, and an engine error is recognised by its mark, because the page
holds no engine and the module's classes are not the page's.

**No tick runs before the game is ready.** The module mounts the
presentation, waits for its `prepare` and fetches the start packs, and only
then builds the run's host and attaches the device helpers; a failure to
get ready reaches `onError` before tick 0. A page that asks for a run, and
so spends one, asks only once `ready` has settled with null: `playRun`
prepares before `startRun`. Never start the clock, or a ranked run, on a
game that has not said it can draw.

## The page's host

`packages/sdk/src/host/` loads a game's page module onto a page and plays a
run through it, and the harness's page loads with it too, so a page and the
harness cannot load a game two ways. `docs/sdk.md` describes it. What to hold
while changing it:

**A page refuses before it plays.** `loadGame` checks a module in a fixed
order, and anything that fails throws a client code before a run is started,
so a failure spends no run. A new check goes into that order with a code of
its own in `CLIENT_ERROR`.

**`playRun` asks for motion before it awaits anything**, when the game reads
tilt, for the reason `signIn()` makes its box first: iOS grants it only in
the click's own turn. **Anything but a grant starts no run**: the run fails
with the engine's refusal code, a client code with a sentence for the player,
before the platform is asked for one, and the lock is let go. Never add a
path that plays a tilt game without tilt, keys or not: on iOS a refusal is
remembered, so every ranked run after it would be spent on a game nobody can
steer. The harness page reads the answer through the same `motionRefusal`.

**A game is held to one tab per mode by a Web Lock named for its page key
and the mode**, taken in the click before the run is started and let go once
the platform has the run. A browser with no Web Locks starts nothing, with
`E_BROWSER_UNSUPPORTED`. Never add a path that plays unlocked, or a start
before the lock is held: two tabs on one run post chunks that conflict, and a
second tab's start closes a run the first has committed to.

**A local run's seed always carries its prefix.** `playLocal` plays
`local:` and the page's seed, or a fresh one, through `localSeed`, and never
a seed without it: every seed the platform issues is 64 hex characters, so
the prefix is what makes a local recording one the platform refuses
(`E_PINNED_MISMATCH`). The recording's type, `LocalRecording`, is the
compile-time half; the seed is the half a page with devtools cannot get
past. `playLocal` takes no client and makes no request.

**The page never chooses a version.** A run plays what its start names, and
`playRun` loads a resumed run's own module when its manifest hash is not the
loaded module's. The hash names a module; its address can be written more
than one way.

**The widgets are plain DOM with every colour a `--gb-widget-*` custom
property**, and show a failure in the client's or the platform's own sentence
for its code.

## The files folder

`packages/sdk/src/build/files.ts` lists it, and `contract.ts` and
`loads.ts` hold the page module's loads to it. `docs/sdk.md` and the guide's `references/files.md`
describe both. What to hold while changing either:

**The folder is named by its listing's SHA-256 and nothing else.**
`canonicalListing` writes the listing, `dist/files.json` holds exactly that
text, and `listingSha256` of it is the folder's name in every address. No
version, date, path of the author's machine or option reaches the name, so
the same files are the same folder in every build and on the platform, and a
page module naming the folder names every byte in it.

**A page module loads only what its bytes name.** Its imports are static,
`cw2:sim` and `cw2:files/<path>` with each path in the listing; `import()`,
literal or computed, `importScripts` and `new SharedWorker` are refused,
found by reading the text as tokens, because Bun's scanner sees only a
literal `import()`. `new Worker` is counted and allowed only when the game
says it needs workers. Code inside the folder is not read, and the page's
policy, naming the game's own path and nothing else, is all that bounds it:
never widen that policy past the game's path.

**A need is named, and the files need is derived.** A game names `wasm` and
`workers` in `"vbz": { "needs" }`; `versionNeeds` adds `files` whenever the
listing holds a file and refuses a page module that starts a worker without
`workers`. Nothing a game needs adds `unsafe-eval`.

**Every limit is a constant in `build/limits.ts` or `/build`'s other
exports**, which the platform imports, so a build that passes `vbz build`
passes the upload; the one a build cannot check, `MAX_UNNAMED_FILES_BYTES`,
counts what the platform already holds. Each file of the folder is held to
its limits by its size on disk before a byte is read, and the manifest to
`MAX_MANIFEST_BYTES` by `assertManifestBytes`, measured as the platform
measures it. The tables in `docs/sdk.md` and the guide's
`references/files.md` name every `MAX_` constant `/build` exports, at its
value, and the guide's test holds both ways.

**A value's size as JSON has one measure**, `byteLengthOf` in
`src/wire/json.ts`, which imports nothing: a page's chunks and recording
and `vbz build`'s manifest are counted by it, and `/build` reaches none of
`/platform` for it. `tests/wire/json.test.ts` holds both.

**null3d is a recipe, never a dependency.** Nothing in `packages/sdk`
imports null3d, which is not on npm. The recipe, the guide's
`references/null3d.md`, says a vbz game creates null3d with
`input: false`, and the guide's test holds the policy it prints and the
mouse figures it quotes to the code and to the engine guide.

## The addressed build

`vbz build --addressed` writes `dist/addressed/`, the build at the
content-addressed paths a page on another origin loads it from, and
`dist/addressed.json` beside it. `docs/sdk.md` under "Serving" describes it.
What to hold while changing it:

**The layout has one implementation, `src/build/address.ts`.** The harness
serves `layoutOf`, the command writes it, the browser suite's bundles origin
holds each build through it, and nothing else rewrites a page module. It reaches nothing of `/harness`, `/host`, `/platform`, `/serve` or
the CLI. `tests/build/address.test.ts` holds both.

**`dist/addressed/` holds nothing but content-addressed files**, so a host
may give all of it the year-long immutable cache the guide tells it to.
Anything that changes from one build to the next, `addressed.json` among it,
goes beside the folder, never in it.

**It is for the root of an origin.** The page module's imports are
root-relative, and there is no base-path option: a host that serves only
under a sub-path serves `dist/` from the page's own origin instead.

**`GAME_ID_NAMESPACE` never changes.** The default game id is the version 5
UUID of the manifest's `id` in it, which a page's policy names; a new
namespace moves every game's path and refuses every page already deployed.

## What a game records

`docs/sdk.md` under "Choosing what to record" is the design: the manifest
declares inputs, `src/capture.ts` maps devices onto them through the engine's
device helpers, and the game decides in `tick`. What to hold while changing
the template, the fixture or anything that reaches them:

**A game draws its own controls, and there is no hook for controls a page
builds.** A page that drew a button and handed the game a press would decide
the result where nothing checks it. The template draws its two buttons and
hit-tests them in `tick`, against `src/sim/field.ts`, which the renderer
reads too.

**A game may not construct an input.** Only the engine's helpers record, from
real devices. Anything that would let a renderer decide which control was
pressed and hand the answer over is the hole the helpers exist to close.

**The template's buttons stay at least 44 CSS pixels across at its smallest
size.** `tests/templates/buttons.test.ts` measures the drawn button and the
area a finger lands on; moving a button means keeping it passing.

**Coarse ranges, and changes rather than streams.** The template records a
finger in steps of 30 field units, and `tests/templates/recording.test.ts`
holds a scripted session's recording under a stated size. A mapping change
that grows the recording past it is a finding to explain, not a number to
raise.

## Publishing what a consumer can actually use

**Every relative import inside `packages/sdk/src` carries `.js`**, and a
directory import carries the whole `/index.js`. `tsc` emits a relative
specifier exactly as the source wrote it, and node ESM has no extension
resolution, so `from "./load"` runs everywhere in this repository and
nowhere under plain node.

`bun run check:publishable` packs the tarball and imports every subpath the
exports map names with plain node, which is the only check that sees this. It
also asserts the files the package reads at runtime rather than imports are in
the tarball - `RUNTIME_FILES` in the script - because the harness bundles its
page script from a path built off `import.meta.dir`, and nothing importing the
package would notice that file missing. `vbz new` reads the template the same
way, and renames the files `RENAMED_IN_GAME` lists on the way into a game,
so `RUNTIME_FILES` lists each by the name it ships under, read from that
table.

**`loadGame`'s import of a game's code keeps both bundler comments**,
`webpackIgnore: true` and `@vite-ignore`, on the call itself. The URL arrives
at run time, so the import is the browser's to make, and a studio's bundler
that took it for one of its own loads no game. `check:publishable` holds the
packed `dist` to carrying both, and the browser suite's packed install
measures what they are for.

**Nothing under the template that `vbz new` never copies ships.** npm packs
whatever is on disk under a `files` entry, and the tests build the template
in place, so `files` negates `templates/game/dist` and
`templates/game/node_modules`, one entry per name in `NOT_COPIED`, and
`check:publishable` fails on any such file in the tarball.

**A command's path in `bin` is written the way `npm publish` writes it**: no
leading `./`. `npm pack` leaves the entry alone and `npm publish` rewrites
it, and npm 12 logs the rewrite as the command being removed while keeping
it. The check holds each entry to the published form, and to a file the
tarball carries.

## What a command reads

**Each command names the flags it reads, in its row of `COMMANDS`, and the
parser refuses any other**, with a sentence naming the flag, the command and
the commands that read it, so no command takes a flag and ignores it. A
new flag joins the row of every command that reads it. The usage's labels
(`dev:`, `build --addressed:`) and every call the docs, the guide and the
template's scripts show are held to the table by
`tests/cli/commands.test.ts`.

## Where a game's code runs

**Every command that evaluates a game's code does it through
`runGameProcess`**, in a process of its own with an empty environment, and
names anything the child provably needs: the bundler gets `NODE_ENV`, nothing
else gets anything. That covers the bundler, which runs a game's macros, the
manifest read out of the rules code, `vbz check`'s conformance and mapping,
and `vbz dev`'s replay. Never import a game's built output or its source into
a command's own process, and never pass `process.env` to a child: the
commands run beside a studio's secret key and cloud credentials.
`vbz publish` evaluates nothing of a game, and a test holds it to that. Each
command has a test that plants a variable and holds the game's code to never
seeing it.

## What a command loads

**Only `vbz check` loads `@clockwork2/engine/validate`, and only once it
runs**, through an `import()` in the entry point. Everything the entry point
imports statically is loaded before it reads which command it was given, and
the engine's checks import `typescript`, an optional peer of the engine. A
game has TypeScript once its own install has run, which is after `vbz new`,
and `bunx @vbz-gg/sdk new` runs from an install holding the SDK and the
engine alone. The same goes for anything importing `pixi.js` or `three`.
`tests/cli/startup.test.ts` walks what the entry point loads, as `tsc` emits
it, into the installed engine.

The SDK declares no peer on `typescript`. The engine declares it, with the
range its checks need, wherever the engine is installed, and the template's
`devDependencies` carry it, so `vbz check` finds it in any game `vbz new`
made.

## The publish command

**`vbz publish` reads the studio's secret key from `VBZ_STUDIO_KEY` only.**
Never add a flag for it: a flag puts the key in shell history and the
process list. The command sends no `Origin` header, and the platform
refuses a secret key that arrives with one.

**The version is sent once; only what is safe to repeat retries.** A second
upload of a version that did arrive is refused as `E_VERSION_EXISTS`. Asking
which files the platform lacks, each file's upload, which is stored under
the hash of its bytes, and the read-back are tried again.

**The platform is `https://api.vbz.gg`** unless `--api` or `VBZ_API_ORIGIN`
names another, and the key is sent only over https or to this machine.
`https://studio.vbz.gg` is the dashboard, not the API.

**It prints what the platform decided, in the platform's terms**: the release
line the version joined, a refusal's `detail` (the fields a patch changed and
the minor to publish instead, or the versions an upload had to be above), and
once the checks pass, which runs the version serves and how many of its
line's recent ranked runs end differently under it. A published version
always carries that count and a pending or rejected one never does, so an
answer breaking either half is `E_PUBLISH_ANSWER_UNREADABLE`. The verdict
reads `asStatus`'s `CheckedStatus`, whose type holds a published version to
its count, so no runtime check repeats it there.

**The wait for a verdict is derived, never written as a number.**
`CHECK_WAIT_MS` is `checkWaitOf` over the queue's and the public-store
copy's named allowances and `/build`'s `CHECKS_CONTAINER_WAIT_MS`,
`REPLAY_WALL_BUDGET_MS` and `REPLAY_ANSWER_MARGIN_MS`, which the platform
takes from this package, with a minute of headroom, rounded up to whole
minutes, so it is never shorter than the platform's worst case for one
attempt and a wait or budget that moves moves it. A patch's replays run
beside the replay-service check's and share its allowance, so a patch's
scores arrive with the verdict. It does not cover a retry after a replay
service that gave no answer, nor the attempts after a check that ran out of
time: `E_CHECKS_OVER_BUDGET` and `E_PAGE_MODULE_NOT_READY` are written only
once every attempt has run out, so either can arrive after the command
stopped.

**Its exit code is the verdict.** 0 means the version passed its checks and
is published, and the command has printed which runs it serves. Anything
else, including a version an operator took down, is 1. This sentence, the
package README, `docs/sdk.md`, the guide's `SKILL.md` and `cli/publish.ts`
say it together, and change together.

No template or example names a script `publish`, because npm runs one with
that name as a lifecycle hook of `npm publish`.

## The agent guide

`packages/sdk/skill/vbz-game/` is prose an agent follows literally, so a
stale sentence is worse than a missing one. It has one subject: everything
between a conforming simulation and a game a page plays, wherever its author
ships it, and, for a game that uses vbz.gg, runs the platform checks and
replays.

**The SDK needs no platform, and the prose says so.** A game made with it
may never upload, use vbz.gg or sign a player in. In the guide,
`docs/sdk.md`, both READMEs and the template, everything about vbz.gg sits
in sections headed "If you use vbz.gg"; the CLI's help, which has no
sections, names vbz.gg on the line that needs it ("for vbz.gg", "on
vbz.gg"). No sentence anywhere else assumes a game uploads, uses the
platform, or signs a player in. The guide's test holds its headings to
that, and its two main-path sections, "Playing it on a page" and
"Distributing the build", to naming none of the platform.

Determinism belongs to the engine's guide, `clockwork2`, which the engine
package ships, and this one points at it rather than repeating it - two copies
of that rulebook is how one of them goes quietly out of date.

Two sections are the exception, "Replays and randomness" and "Choosing what
to record". They are the two things a game author gets wrong first, a seed
taken from somewhere other than `init` and a stream of readings recorded every
frame, and an author meets both before they think to open a second guide. So
each says only what an author needs at that point, quotes only what the
engine exports, and points at the engine guide's reference for the full
rules. Nothing else in this guide restates a determinism rule. The null3d
recipe, `references/null3d.md`, comes closest: it quotes the engine guide's
measured rows for a mouse under lock, which the test holds to the engine's
copy, and says which of null3d's maths the rules code may import, which is
null3d's to say and is quoted from its guide.

The guide ships in the package, and its tests sit beside it at
`packages/sdk/skill/tests/`, outside what ships. `vbz new` copies it into a
game's `.claude/skills/vbz-game/`, with the engine's guide from the engine
installed beside the package at `.claude/skills/clockwork2/`, and `vbz guides`
copies both again from the packages a game has installed. Neither falls back:
a package or a guide that is missing is an error naming it, and nothing is
written, and `vbz guides` refuses a directory that is not a game's root,
one whose `package.json` names `@vbz-gg/sdk`, rather than making it. Both
copy the guides into temporary folders first and replace the game's only
once both copies exist, so a game never holds guides from two releases.

The game's `AGENTS.md` and `CLAUDE.md` live in the template as
`game-agents.md` and `game-claude.md`, renamed on the way in as `gitignore`
is. A name that differed from `AGENTS.md` only by case would still steer an
agent working here on macOS or Windows, whose default filesystems ignore
case. A template missing one of them is a broken install, and `vbz new`
names it and takes back what it wrote.

`check:publishable` compares the packed guide with git's copy, file for file,
byte for byte and execute bit, and fails on anything else under `skill/` in
the tarball, because npm packs the disk and not the commit.

`packages/sdk/skill/tests/skill.test.ts` measures the drift a machine can
see: the limit tables in `references/files.md` and `docs/sdk.md` name every
`MAX_` constant `/build` exports and no other, each at its value, and the
package README's table matches too; every artifact refusal named anywhere in
the guide, `docs/sdk.md` or the package README exists, and every one that
exists is explained; every code the guide's refusal list and
`references/ingest.md` name is one `PublicRefusalCode`, `VersionCheckCode`
or the engine names, the two unions read from their declarations with
TypeScript's parser and `VersionCheckCode`'s compared with a list the
compiler holds exhaustive, and every code `VersionCheckCode` names is
explained in both, a code its doc comment says is "No longer reached" as
no longer reached and no other; a manifest with no ranking goes by one name
everywhere, the engine's `E_RANK_UNDECLARED`; every figure the guide and
`docs/sdk.md` quote for one replay, and what follows from it, is `/build`'s
`REPLAY_` budget, every count of a patch's replays they, the package README
and `/api` quote is `PATCH_SCORE_RUNS`, and the publish wait `docs/sdk.md`
states is `CHECK_WAIT_MS` and its parts; every figure they quote for a
step's allowance at each tick rate, a load's start at upload or the page
module's wait to get ready is `CHECK_STEP_BUDGET_US`, `CHECK_INIT_BUDGET_MS`
or `CHECK_READY_MS`, and the refusal list,
`references/ingest.md` and `docs/sdk.md` each explain the two codes written
once every attempt has run out of time: that they come only then, the
limit and what to change; `references/page.md` explains
every client code and no other; every prose copy of what a release line
fixes (in `SKILL.md`,
`references/ingest.md` and `docs/sdk.md`) names exactly the fields
`LINE_RULES` fixes; every need the prose shows a `package.json` naming is
one `vbz` takes; the policy the null3d recipe and `docs/sdk.md` print for a
game that needs everything is `pageCsp`'s, directive for directive; the
recipe's mouse figures are the engine guide's measured row and its run
lengths follow from `MAX_RUN_BYTES`; the commands are the CLI's, the layout
it prints is the template's, and every reference is linked both ways. Every
other limit it quotes is the constant that decides it, every `Prng` method
it quotes is on the engine's `Prng`, every file of the engine's guide it
names is one the installed engine ships, and it calls that guide
`clockwork2` and nothing older. Adding a client code fails it until
`page.md` has a row, adding a limit fails it until both tables have one,
and adding a code to `VersionCheckCode` fails it until the refusal list
and `references/ingest.md` explain it.

## Tests

- Add a test for a concrete failure mode. A test that restates the
  implementation passes for as long as the implementation exists and tells you
  nothing.
- `bun run test:coverage` holds `packages/*/src` at 99% of lines and 99% of
  functions. `scripts/check-coverage.ts` measures it over `coverage/lcov.info`;
  `coverageThreshold` is absent from `bunfig.toml`, which says why. Two things
  get past a failure: a test for a concrete failure mode, or a path excluded in
  `bunfig.toml` with a written reason.
- The gate has been watched failing. Raising `MIN_LINES` above the measurement
  exits 1 and names the shortfall in lines; a gate nobody has seen fail is one
  that reports green because it is checking nothing.
- **happy-dom for the unit tests, Playwright for what a browser decides.**
  happy-dom cannot represent `max(14px, env(safe-area-inset-bottom))` at all -
  the longhand reads back empty and `setProperty` mangles it to `14px` - so
  asserting safe-area clearance there would be measuring happy-dom's CSS
  parser. Anything about real layout, a real thumb, a module imported from
  another origin or a policy that admits it belongs in the browser suite.
- Playwright runs with `retries: 0`. For a suite about determinism, flake is
  the finding.
- A record-and-replay test needs a non-triviality guard. Assert the recording
  holds the presses the test made, or a page that silently records nothing
  passes every comparison.

## The browser suite

`e2e/` drives what an author and a page actually run. One process,
`e2e/src/servers.ts`, builds the package and every subject through the real
CLI, so a stale `dist` cannot be what is tested, and serves: each subject's
harness, as `vbz dev` serves it; the suite's studio page, `e2e/page/`, on an
origin of its own under the policy the SDK recommends with each game's
needs, against a stand-in for the platform per game whose sign-in is on
another site, or playing a game locally; a bundles origin holding every
game's modules and files under the game's own path; this package packed and installed apart; a package
registry holding that tarball and one of the engine, packed from the copy
installed here, which fetches every other package from npm; and a plain file
server holding the template's `dist/addressed/`, as `vbz build --addressed`
wrote it, with a page on an origin of its own, `e2e/addressed/`, that plays
it. It keeps a request log per bundles origin, one for the file server and
one for the registry, which a spec reads to see what was actually fetched.

The subjects are the template, which draws its own two buttons, the
paddle fixture, which reads tilt and maps Space, and the folder fixture,
which carries a files folder and loads from it what an engine built into
one loads, without one. Beside them, `e2e/frozen/`
holds the template's two modules as the first release of each contract built
them. They are never rebuilt once that contract is out: a page built from
every later tree has to play them, and rebuilding them would test a release
against itself.

What only a browser can settle, and what each spec found:

- The recommended policy admits a page module and its own static import of
  its rules code, and refuses another game's path on the same origin before
  any request leaves, in Chromium, Firefox and WebKit.
- All three keep a failed module import for the life of the page and answer
  a second `import()` of that URL without asking the network, which is why
  `E_GAME_UNLOADABLE` tells the player to reload.
- Two thumbs on the template's buttons are two pointers, and lifting one
  leaves the other down. A thumb that slides off its button and off the game,
  onto the page around it, still records its release.
- With Play focused, a mapped Space reaches the game and does not press Play,
  because the helpers cancel a mapped key's default. Measured in Chromium.
- A second tab of the game and mode another tab is playing stops at the
  lock having asked the platform for nothing, before and after the first
  has committed a chunk.
- The harness page keeps a refusal on its status line: a game the browser
  cannot draw, refused before a tick runs, and a tilt request that is
  refused, fails or throws, which starts no run.
- A tilt game on a studio's page starts no run without tilt, and asks the
  platform for nothing: a refusal as iOS gives it once the player taps
  "Cancel" on its motion prompt (the button's name, measured on iPadOS 26.7),
  answered by a stand-in for `requestPermission` because Chromium has none,
  and a laptop's Chromium, which has orientation events and no sensor.
- A player signs in through the box over the page, the stand-in's sign-in
  framed as the platform's is, with focus in the frame from the click and on
  the sign-in's button once it loads, no window opened and nothing calling
  `requestStorageAccess`; and on a page sent with COOP same-origin and COEP
  require-corp, which stays `crossOriginIsolated` with the frame in it. The
  sign-in is on another site from the page, `localhost` against
  `127.0.0.1`, as the platform's is. Under COOP and COEP, Firefox 142
  renders it and its ready reaches the page, but Playwright 1.56.1 cannot
  reach into that frame there, so signing in through it is measured in the
  other engines.
  Cancel, and Escape pressed inside the frame or in the page, close the box
  with `E_SIGNIN_CANCELLED`, and while it is up Tab never reaches the
  page's controls, because the box is a modal dialog and the page is inert. A page whose policy has no `frame-src` never asks
  for the frame, reports a `frame-src` violation and gets
  `E_SIGNIN_UNREACHABLE` once the ready time runs out; the refused frame
  fired `load` in Chromium and `error` in Firefox. A later page the browser
  will not show, a form step the sign-in answers framed for nobody, gets
  `E_SIGNIN_UNREACHABLE` too, because every page the frame loads owes a
  ready. A studio's page shown inside a portal's page on another origin of
  the same site asks for the sign-in and the browser refuses to show it,
  since every ancestor is held to `frame-ancestors` by exact origin, so it
  too gets `E_SIGNIN_UNREACHABLE`. Chromium and Firefox, measured; WebKit is in the
  project and unmeasured here.
- A game played locally on a studio's page with `playLocal` asks nothing
  of any platform: every request goes to the page's own origin or the
  game's. Its recording, posted to the stand-in as a ranked run's own by a
  page that casts it past the compiler, is refused with
  `E_PINNED_MISMATCH`, and the run stays open with nothing stored and no
  board row.
- The folder fixture's page module imports `cw2:files/entry.js`, which
  fetches and compiles WebAssembly from the folder, starts a worker from a
  blob that imports a module of the folder, and imports a module of the
  folder by a computed name; its presentation is ready 600 ms after that;
  and its rules code reads a data pack from the folder on demand. Under
  the recommended policy with the game's needs, played locally, as a
  ranked run and in the harness: no frame is drawn and no press recorded
  before it is ready, the pack is fetched only once the rules code names
  it, and the run replays to its counters with the pack and fails without
  it. A device with no 2d canvas fails with `E_PRESENTATION_FAILED` before
  the platform is asked for a run. Taken down while it gets ready, or
  failing part-way, it leaves no worker running, counted through a
  stand-in for `Worker`. Under the policy with the needs left
  out, Chromium and Firefox refuse its core's fetch (`connect-src`) and its
  worker (`worker-src`), and it never gets ready.
- A build served by a host that is not this SDK's: `dist/addressed/` from a
  plain file server's root, sending only the headers the guide's
  "Distributing the build" lists, by extension, and no `ETag`, loads and
  plays with `playLocal` on a page on another origin under `pageCsp` with
  the build's game id and needs, asking that host for the two modules
  alone, and its run replays to its counters against the rules code the
  host served. The same page under a policy naming another game's path
  loads nothing and asks the host for nothing. Chromium, Firefox and WebKit.
- Watching an abandoned run stops at its end tick.
- Tilt through Chromium's orientation override: the first reading is recorded
  as it is, and after that a level only when it changes. A spec that plays
  the paddle by its keys holds the override level, because without a sensor
  the paddle starts no run.
- A recording replays to the counters the page displayed, held both by the
  harness's own report and by a replay in the spec, against the bytes the
  browser loaded.
- A page bundled from the packed package by Vite, webpack and esbuild, each
  in its production build, loads a game from another origin and plays it.
  Without its comment webpack turns `loadGame`'s import into a lookup of its
  own and the page loads nothing; Vite 8 and esbuild leave it alone either
  way.
- A game made the way an author makes one: the SDK and the engine installed
  from their tarballs, `vbz new`, the game's own install from the registry,
  `vbz guides`, `vbz check`, and `vbz dev` with no studio key, its page
  loaded and played. And `bunx @vbz-gg/sdk new`, against the registry
  through `BUN_CONFIG_REGISTRY`, which `bunx` reads and a `bunfig.toml` in
  its working directory does not. `bunx` reuses its install under `TMPDIR`
  from one run to the next, so every run gets its own `TMPDIR` and bun cache.
  Each command's environment is built up from `PATH`, the machine's proxy if
  it has one, and a home of the run's own, never copied from the suite's: a
  copied `NODE_PATH` naming a global `node_modules` let `vbz new` load
  TypeScript, which no game has before its own install, and pass here while
  it failed on a machine with nothing global. The spec holds TypeScript
  unreachable from the installed engine before `vbz new` runs.

Chromium runs every spec; Firefox and WebKit run the ones about the
policy, the sign-in's box, the files folder's loads and a build on another
origin, which are each engine's to decide. The fingers and the sensor
override are Chromium's own protocol.

**In CI the suite runs inside Playwright's own image**,
`mcr.microsoft.com/playwright`, which carries the three browsers and every
system library they load, so no run downloads a browser or installs anything
with apt. Installing those libraries from Ubuntu's mirrors on every run sat
for 15 to 25 minutes twice on 17 and 18 November, against under 4 minutes for
the whole suite. The image holds the browser builds of one Playwright version,
and any other version looks for builds that are not there, so its tag names
the version `bun.lock` installs and `scripts/release-version.test.ts` holds
the two equal. No script moves Playwright: a bump moves the tag in `ci.yml`
in the same commit, and the test fails until it does. The job runs as uid
1001, the runner's own user, because as root Firefox will not start in the
home GitHub mounts, which that user owns, and with `--ipc=host` and `--init`,
as Playwright's Docker page recommends. bun comes from npm rather than
`oven-sh/setup-bun`, which unpacks a zip with an `unzip` the image does not
carry; it is the same binary byte for byte, at the version every other job
installs, and the same test holds those equal. On a laptop,
`bun run --cwd e2e install:browsers` installs the three browsers through the
workspace's own Playwright, never `bunx playwright`, which fetches the newest
release and downloads builds the pinned one does not look for.

One thing about the tools themselves, measured rather than read:

- **A CDP `touchEnd` carries the finger being lifted**, not the ones still
  down, although the protocol describes `touchPoints` as "active touch
  points". With two fingers down, ending with the point that is still down
  releases that one. `e2e/src/fingers.ts` has the sequence that measured it.

Until engine 0.7.1 a spec could not import `@clockwork2/engine` at all, because
its built output imported its own files without extensions and Playwright's
runner is node, so the replay ran in a bun subprocess. That is what the `.js`
rule below is about, and it is why `check:publishable` imports every subpath
under plain node.

## Releasing

Patch and minor only. **No major releases for now**, here, in clockwork2 or in
the platform. On a 0.x version commit-and-tag-version maps a breaking change to a
minor, so `bun run release` cannot reach 1.0.0 on its own, there is no
`release:major` script, and the workflow's bump offers no major either.
`scripts/release-version.test.ts` holds the major at 0, so lifting the policy
means deleting a test in a diff somebody reads.

**A release is one dispatch of `release.yml`.** Pick `patch` or `minor`, leave
the dry-run box unticked, and the job does the rest: it runs the gate CI runs,
bumps the version, pushes the bump commit, rebuilds `dist` at the version being
published, publishes, and creates the tag and the GitHub release at the commit
it bumped. The release body is that version's own `CHANGELOG.md` section, so
the notes are the changelog rather than a second description of the same
commits.

The filename is the configuration. npm's trusted publisher is set up against
this repository and `release.yml` by name, so renaming the file revokes the
credential: the next release fails at the OIDC exchange rather than at a test.
There is no `NPM_TOKEN` here and nothing to rotate.

Every guard in that job is a mistake clockwork2 made and paid for, and each is
held by `scripts/release-version.test.ts` because a workflow cannot be unit
tested:

- **A dispatch bumps.** It used to publish whatever version the tree held, so
  a dispatch after a merge found that version on the registry, skipped, and
  reported success having released nothing.
- **The checkout is `fetch-depth: 0`.** commit-and-tag-version reads the
  commits since the most recent tag, and a shallow clone has none: it compared
  from the wrong tag and re-listed a release's worth of commits that had
  already shipped.
- **It rebuilds after the bump**, because `dist` is what the tarball carries.
- **It refuses a tree with nothing new since the last tag**, and
  `scripts/release-notes.ts` throws on an empty changelog section. Between
  them that is the version whose release body says nothing about itself.
- **The tag names the bump commit**, not the one the job checked out.

**The last step tells the platform.** It sends an `sdk-released` dispatch
carrying the version to vbz-gg/platform, so the platform's update job opens
its pull request in seconds. It reads `ENGINE_RELEASED_TOKEN`, the secret
clockwork2's release uses to tell this repository, and it is best-effort: a
missing token prints a line and exits 0, because the version is already out
and the platform's daily check will find it.

`.versionrc.json`'s `prerelease` hook runs the gate before the version is
bumped, so it never sees the tree a release actually ships. Anything holding
the version literal therefore has to be in `bumpFiles`; clockwork2 lost several
releases to exactly that, and `scripts/release-version.test.ts` is where the
next such file gets caught.

## Following the engine

`.github/workflows/engine-update.yml` opens a pull request when
`@clockwork2/engine` has a newer release. Two triggers reach it, and they are
not redundant.

clockwork2's release workflow dispatches an `engine-released` event as its
last step, so a release arrives here in seconds. That needs a token of its
own, `ENGINE_RELEASED_TOKEN` in the organisation's secrets, and the job here
opens its pull request with the same token. GitHub's table of fine-grained
token permissions puts the dispatch under Contents: write and opening a pull
request or requesting a review under Pull requests: write, so the token needs
both, on this repository alone. With Contents alone the dispatch arrives and
the pull request is refused. It is the only long-lived credential either
repository has. Contents: write can also push to any unprotected branch here,
which is more than the pull request needs and much less than the npm token
trusted publishing removed. Make it from an account other than the reviewer
the workflow names: the token's owner is the pull request's author, and GitHub
refuses a review request from the author.

The daily check is the backstop, and it is what makes the token's absence a
delay rather than a failure. It catches a release published from somebody's
laptop, a dispatch step that failed, a token that expired, and a version
yanked and republished. Both triggers reach the same job, and the
branch-per-version check is what stops two of them opening two pull requests
for one release. A run that pushed its branch and then could not open the pull
request leaves `engine/<version>` behind with none. The next run force-pushes
over it, because a plain push would be refused by the earlier commit on every
run until somebody deleted the branch by hand.

The registry is the authority either way. A dispatch carries the version
clockwork2 says it published and the job confirms it against npm before using
it, with a short retry: npm's read replicas lag a publish by minutes and a
dispatch arrives immediately. A claim npm never confirms falls back to
whatever npm does say is latest, so a wrong one costs two minutes and changes
nothing.

The bump itself is `scripts/bump-engine.ts`, which moves the version in all eight
places it is written - the root's pin, the peer range, the template's own
dependency, the kernel version each example manifest declares, and the range
`docs/sdk.md` quotes - and throws rather than skipping a file that does not
hold what it expected. Raising the range is still a deliberate act: the pull
request is where it is decided, not the merge.

**Whether that pull request has checks depends on which token opened it.**
GitHub starts no workflow for one opened with `GITHUB_TOKEN`, so without the
organisation's secret the pull request carries none and the body says so.
Opened with `ENGINE_RELEASED_TOKEN` it is an ordinary pull request and CI runs
on it.

Either way the gate runs in the job that opens it and the result goes in the
body with a link to the run, because that is the only signal in the first
case. A failing gate still opens the pull request: "the new engine breaks us"
is the most useful form this notification takes.

## Commit gates

Two hooks run on every commit. `pre-commit` lints. `commit-msg` runs
commitlint and demands a `Docs-Updated:` trailer. Never bypass either with
`--no-verify`.

The trailer records the pass no test can make. Most of what this package
documents is a contract rather than a behaviour - what a page module may
import, which headers and which policy let a game's code into a studio's
page, which fields a patch keeps - and nothing measures whether a paragraph
about one of those is still true. Writing
the trailer says you re-read the pages covering what you changed and brought
them back in line.

It is demanded when the commit stages anything under `packages/`, `e2e/`,
`scripts/`, `docs/` or `fixtures/`, or `README.md`, `package.json`,
`tsconfig*.json`, `biome.json`, `bunfig.toml` or `.github/`. The agent guide
and the template are under `packages/`.
Merge, revert, fixup, squash and `chore(release)` commits are exempt: git and
commit-and-tag-version write those messages themselves, some with no editor at
all.

The trailer is a line below the subject that opens a paragraph or follows
only other trailers in its paragraph. Prose that wraps onto a line starting
`Docs-Updated:` is not the record. A value under ten characters is rejected,
as is a stamp from the list in `scripts/check-docs-updated.ts`. Say what you
did, inside the 100 columns commitlint allows a trailer line:

    Docs-Updated: added the new client code to sdk.md and to the skill's page.md
    Docs-Updated: re-read sdk.md on the two artifacts; the rewrite is unchanged
    Docs-Updated: new browser test only, no documented contract moved

The trailer has to be true. A new path carrying documentation joins
`BEARING_PATTERNS` in `scripts/check-docs-updated.ts` in the same change.

## Prose

Run the `humanizer` skill over anything a person reads before committing it:
`README.md`, the package README, `docs/sdk.md`, `SKILL.md` and its references,
and release notes. Rewrite what it flags rather than patching the flagged
phrase.

The house rules it does not cover:

- Hyphens, never em dashes, in code, comments, docs and commit messages alike.
- Sentence case in headings.
- Write for a reader who has not seen this before. Explain the thing itself.
- State the measurement rather than the adjective.
