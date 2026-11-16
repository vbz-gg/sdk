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
upload, replays a run and ranks it. A studio serves its game from its own page.

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

**A studio's page and the harness load a game through `loadGame` and play it
through the module's own `mount`.** They run the same code, so the game an
author tried in the harness is the game a studio's page plays, and the engine
that plays it is the one the game was built and checked with, bundled into
its page module. Nothing on a page builds a `GameHost`, draws a control for a
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

**`signIn()` opens the window before it awaits anything.** Anything awaited
first, even a resolved promise, moves the open out of the click's turn and the
browser blocks it.

**The client's codes and the platform's never share a name.** `CLIENT_ERROR`
in `errors.ts` is the client's table, a compile-time check keeps it apart from
`PublicRefusalCode`, and the guide's `references/page.md` explains every entry,
held both ways by `packages/sdk/skill/tests/skill.test.ts`. A new code is a
new row in both.

## The page module

`packages/sdk/src/game/` is what every page module is built from, and
`docs/sdk.md` describes the contract a page drives it through. What to hold
while changing it:

**`./game` holds no DOM and no dynamic import.** It is bundled into every
page module, which may import exactly one module by name, its rules code, and
the platform refuses one with a dynamic import before it stores a byte.
Nothing in it reads the browser until `mount` is called, and it imports
nothing of `./host`, `./platform` or the CLI. `tests/game/subpath.test.ts`
holds all three.

**A contract version once released is driven by every later release.**
`DRIVEN_CONTRACTS` only grows. A change that a module built by an earlier
release could not meet is a new contract version, which a page refuses by
name until it learns it, never a new meaning for one already out.
`e2e/frozen/contract-1/` is the template as the first contract-1 release
built it, and the browser suite holds every later tree to playing it. Never
rebuild it.

**What crosses is plain data.** A failure is `{ code, message }`, never an
error object, and an engine error is recognised by its mark, because the page
holds no engine and the module's classes are not the page's.

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
tilt, for the reason `signIn()` opens its window first: iOS grants it only in
the click's own turn.

**A game is held to one tab per mode by a Web Lock named for its page key
and the mode**, taken in the click before the run is started and let go once
the platform has the run. A browser with no Web Locks starts nothing, with
`E_BROWSER_UNSUPPORTED`. Never add a path that plays unlocked, or a start
before the lock is held: two tabs on one run post chunks that conflict, and a
second tab's start closes a run the first has committed to.

**The page never chooses a version.** A run plays what its start names, and
`playRun` loads a resumed run's own module when its manifest hash is not the
loaded module's. The hash names a module; its address can be written more
than one way.

**The widgets are plain DOM with every colour a `--gb-widget-*` custom
property**, and show a failure in the client's or the platform's own sentence
for its code.

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
way, and renames `gitignore`, `agents.md` and `claude.md` on the way into a
game, so each of those is listed by the name it ships under.

**`loadGame`'s import of a game's code keeps both bundler comments**,
`webpackIgnore: true` and `@vite-ignore`, on the call itself. The URL arrives
at run time, so the import is the browser's to make, and a studio's bundler
that took it for one of its own loads no game. `check:publishable` holds the
packed `dist` to carrying both, and the browser suite's packed install
measures what they are for.

**A command's path in `bin` is written the way `npm publish` writes it**: no
leading `./`. `npm pack` leaves the entry alone and `npm publish` rewrites
it, and npm 12 logs the rewrite as the command being removed while keeping
it. The check holds each entry to the published form, and to a file the
tarball carries.

## The publish command

**`vbz publish` reads the studio's secret key from `VBZ_STUDIO_KEY` only.**
Never add a flag for it: a flag puts the key in shell history and the
process list. The command sends no `Origin` header, and the platform
refuses a secret key that arrives with one.

**The upload is sent once; only the read-back retries.** A second upload of
a version that did arrive is refused as `E_VERSION_EXISTS`.

**The platform is `https://api.vbz.gg`** unless `--api` or `VBZ_API_ORIGIN`
names another, and the key is sent only over https or to this machine.
`https://studio.vbz.gg` is the dashboard, not the API.

**It prints what the platform decided, in the platform's terms**: the release
line the version joined, a refusal's `detail` (the fields a patch changed and
the minor to publish instead, or the versions an upload had to be above), and
once the checks pass, which runs the version serves.

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
between a conforming simulation and a game the platform can check and replay.
Determinism belongs to the engine's guide, `clockwork2`, which the engine
package ships, and this one points at it rather than repeating it - two copies
of that rulebook is how one of them goes quietly out of date.

Two sections are the exception, "Replays and randomness" and "Choosing what
to record". They are the two things a game author gets wrong first, a seed
taken from somewhere other than `init` and a stream of readings recorded every
frame, and an author meets both before they think to open a second guide. So
each says only what an author needs at that point, quotes only what the
engine exports, and points at the engine guide's reference for the full
rules. Nothing else in this guide restates a determinism rule.

The guide ships in the package, and its tests sit beside it at
`packages/sdk/skill/tests/`, outside what ships. `vbz new` copies it into a
game's `.claude/skills/vbz-game/`, with the engine's guide from the engine
installed beside the package at `.claude/skills/clockwork2/`, and `vbz guides`
copies both again from the packages a game has installed. Neither falls back:
a package or a guide that is missing is an error naming it, and nothing is
written. The game's `AGENTS.md` and `CLAUDE.md` live in the template as
`agents.md` and `claude.md`, renamed on the way in as `gitignore` is, so they
never steer an agent working here. `check:publishable` compares
the packed guide with git's copy, file for file, byte for byte and execute
bit, and fails on anything else under `skill/` in the tarball, because npm
packs the disk and not the commit.

`packages/sdk/skill/tests/skill.test.ts` measures the drift a machine can
see: the size caps match the code, every artifact refusal named exists and
every one that exists is explained, `references/page.md` explains every
client code and no other, every prose copy of what a release line fixes (in
`SKILL.md`, `references/ingest.md` and `docs/sdk.md`) names exactly the
fields `LINE_RULES` fixes, the commands are the CLI's, the layout it prints is
the template's, and every reference is linked both ways. Every limit it quotes
is the constant that decides it, every `Prng` method it quotes is on the
engine's `Prng`, every file of the engine's guide it names is one the
installed engine ships, and it calls that guide `clockwork2` and nothing
older. Adding a client code fails it until `page.md` has a row.

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

`e2e/` drives what an author and a studio's page actually run. One process,
`e2e/src/servers.ts`, builds the package and both subjects through the real
CLI, so a stale `dist` cannot be what is tested, and serves: each subject's
harness, as `vbz dev` serves it; the suite's studio page, `e2e/page/`, on an
origin of its own under the policy the SDK recommends, against a stand-in for
the platform per game; a bundles origin holding every game's modules under
the game's own path; this package packed and installed apart; and a package
registry holding that tarball and one of the engine, packed from the copy
installed here, which fetches every other package from npm. It keeps a
request log per bundles origin and one for the registry, which a spec reads
to see what was actually fetched.

The subjects are the template, which draws its own two buttons, and the
paddle fixture, which reads tilt and maps Space. Beside them, `e2e/frozen/`
holds the template's two modules as the first release of contract 1 built
them. They are never rebuilt: a page built from every later tree has to play
them, and rebuilding them would test a release against itself.

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
- The harness page keeps a refusal on its status line: a run the module
  refuses at mount, and a tilt request that fails or throws, which starts no
  run.
- Watching an abandoned run stops at its end tick.
- Tilt through Chromium's orientation override: the first reading is recorded
  as it is, and after that a level only when it changes.
- A recording replays to the counters the page displayed, held both by the
  harness's own report and by a replay in the spec, against the bytes the
  browser loaded.
- A page bundled from the packed package by Vite, webpack and esbuild, each
  in its production build, loads a game from another origin and plays it.
  Without its comment webpack turns `loadGame`'s import into a lookup of its
  own and the page loads nothing; Vite 8 and esbuild leave it alone either
  way.
- A game made the way an author makes one: the kit and the engine installed
  from their tarballs, `vbz new`, the game's own install from the registry,
  `vbz guides`, `vbz check`, and `vbz dev` with no studio key, its page
  loaded and played. And `bunx @vbz-gg/sdk new`, against the registry
  through `BUN_CONFIG_REGISTRY`, which `bunx` reads and a `bunfig.toml` in
  its working directory does not. `bunx` reuses its install under `TMPDIR`
  from one run to the next, so every run gets its own `TMPDIR` and bun cache.

Chromium runs every spec; Firefox and WebKit run the one about the policy,
which is each engine's to decide. The fingers and the sensor override are
Chromium's own protocol.

One thing about the tools themselves, measured rather than read:

- **A CDP `touchEnd` carries the finger being lifted**, not the ones still
  down, although the protocol describes `touchPoints` as "active touch
  points". With two fingers down, ending with the point that is still down
  releases that one. `e2e/src/fingers.ts` has the sequence that measured it.
- **A window that closes itself inside a click can close before Chromium
  answers the click's `mouseup`**, and Playwright then reports the click as
  failed with the page closed. The stand-in's sign-in window does exactly
  that, as the platform's does, so `signIn` in `e2e/src/studio.ts` takes a
  click that failed because the window closed as the click working.

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

The bump itself is `scripts/bump-engine.ts`, which moves the version in all six
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
