# From an upload to a listing

What the platform does with a submission, in order. Only a game opted in to
ranked play is uploaded: a game played only on its own page never meets any
of this. Sections 0 to 2 run before the first storage write, so a submission
they refuse leaves nothing behind and costs no quota: an upload is its own
dry run.

`vbz publish <dir> --game <id>` is how a submission arrives. It sends the
files folder's listing with the version's manifest and asks which files the
platform lacks. The platform answers every refusal of sections 0 and 1,
`E_RANK_UNDECLARED` included, those of section 2 that the listing and its
data packs decide, and the quota, before any file goes up, so a version it
would refuse stores nothing; only the two modules' own checks in section 2
wait for the upload that carries them. Then the command uploads each
missing file on its own, sends the version with the listing beside it, then
reads the version back until the checks below decide, and prints the code
and the first failed check of a rejection. The platform keeps a file once
per game, in its private store under the hash of its bytes
(`E_FILE_HASH_MISMATCH` when they are not), so a file an earlier version
sent is not sent again, and a version whose listing names a file the
platform does not hold is refused with `E_FILES_MISSING`. Files stored for a
version that never arrives, because the publish stopped between them or
another version arrived first, are named by nothing and removed a day later.
Until a version names them they count against what a game may hold in files
no version names, 1 GiB (`MAX_UNNAMED_FILES_BYTES`), and a file whose upload
would take the game past it is refused with `E_QUOTA_EXCEEDED` before a byte
is stored: publish the version that names them, or wait for the day to pass.

## 0. The version

The upload's `version` has to be plain `MAJOR.MINOR.PATCH`: no prerelease or
build suffix, no leading zero, and no part above 2147483647
(`E_VERSION_INVALID`). `vbz build` refuses the same versions, with the same
function. It has to move forward, counting every version of the game that was
not rejected: a new release line (a new `MAJOR.MINOR`) greater than all of
them, or a patch greater than all of them in its line (`E_VERSION_NOT_NEWER`,
whose detail names the highest of each). So 1.2.5 may follow 1.3.0. The same
version twice, a rejected one included, is `E_VERSION_EXISTS`.

A patch is then held to its line's contract, which its earliest version that
was not rejected set: `schemaVersion`, `id`, `session`, `inputs` (each one's
`min` and `max`), `counters` (each one's `name`, `direction` and
`monotonic`), `rankBy`, `tiePolicy`, `params` (all but `label` and
`description`), and of the capabilities `deterministic`, `physics` and
`multiplayer` must be unchanged (`E_PATCH_CHANGES_RULES`, whose detail names
the fields and the minor to publish instead). A patch still runs every check
below, because its rules code is new bytes. `docs/sdk.md` under "Versions and
release lines" explains what a line means for the day's runs.

## 1. The manifest

`assertManifest` on the shape. A ranking, when the manifest declares one,
has `rankBy` and `tiePolicy` together, `rankBy` not empty, and every name in
it a declared counter (`E_MANIFEST_INVALID`). Then three things
`assertManifest` does not cover:

- the config every run is served, the engine's `servedConfig`: a setting
  the manifest requires and gives no default, or a default its own
  definition refuses, has no value a run could be served, so the manifest
  is refused (`E_MANIFEST_INVALID`, in the engine's words). `vbz check`
  stops on it too, because its checks play the same config.
- its size: at most 512 KiB as JSON with no white space
  (`MAX_MANIFEST_BYTES`), or it is refused (`E_MANIFEST_INVALID`).
  `vbz build` holds it to the same size first, measured the same way.
- the manifest declares `rankBy` and `tiePolicy` at all
  (`E_RANK_UNDECLARED`, the engine's own code, which `vbz check --ranked`
  reports for the same manifest). A game played only on its own page may
  leave both out, and one uploaded without them would give a ranked run
  nothing to be ordered by.

## 2. The artifacts and the files folder

The contract in `references/artifacts.md`, on the uploaded bytes:
`E_ARTIFACT_NOT_UTF8`, `E_ARTIFACT_TOO_LARGE`, `E_SIM_NOT_SELF_CONTAINED`,
`E_PRESENT_IMPORT_MISSING`, `E_PRESENT_IMPORT_UNEXPECTED`,
`E_PRESENT_DYNAMIC_IMPORT`, `E_PRESENT_WORKER`,
`E_PRESENT_SPECIFIER_AMBIGUOUS`, and for the files folder's listing
`E_FILES_INVALID`, `E_FILE_PATH_INVALID`, `E_FILE_TOO_LARGE`,
`E_FILES_TOO_LARGE`, `E_FILES_TOO_MANY`, `E_FILE_UNLISTED`,
`E_PACK_UNLISTED`, `E_PACK_MISMATCH` and `E_PACKS_TOO_LARGE`.

Then the addressing: the simulation is hashed, the folder is named by the
SHA-256 of its listing, the page module's `cw2:sim` is rewritten to the
simulation's address and its `cw2:files/` to the folder's, both under the
game's path, and the page module is hashed afterwards.

## 3. The conformance suite

First the manifest is compared with the one the built simulation exports.
The code's copy wins: a simulation that exports no `MANIFEST` is refused
(`E_SIM_NO_MANIFEST`), and so is a submission whose JSON says something the
simulation does not (`E_MANIFEST_MISMATCH`), rather than believed.

Then part of the engine's `ranked` set from `@clockwork2/engine/validate`,
run against the built simulation laid out as a subject directory with its
data packs beside it, under the config a run is served: every declared
setting at its default. The engine's guide, clockwork2, explains each check.

- **What the code and the manifest say**: no banned API named anywhere in
  the rules code, no asynchronous work, every file the manifest declares
  present and inside its budget, a valid manifest, a config the platform can
  serve, and a ranking (`E_RANK_UNDECLARED`), which the upload already held
  it to in section 1.
- **Headless**: `init` and 600 steps with nothing pressed, and no browser
  present.
- **Seed sensitivity**: two different seeds on the same input log must pass
  through different states (`E_SEED_IGNORED`). A game that ignores its seed
  passes every other check the engine has - determinism compares same-seed
  runs to each other, so a seed-blind generator is perfectly deterministic -
  and turns a daily board into an all-time board.

These checks play the game: `init` and 600 steps for the headless check, and
the seed check's runs under two seeds. The platform gives them 1,389
microseconds of one CPU for every step they play (`CHECK_STEP_BUDGET_US`):
what one step of an hour's run may cost its replay, 5 minutes of CPU over an
hour of play at 60 steps a second. Checks that run out of that time are
tried again, and only once every attempt has run out is the version refused,
with `E_CHECKS_OVER_BUDGET`, so a moment's slowness on the platform's side
refuses nothing. `vbz check --ranked` prints what a step cost on your
machine in its `performance` check. Make the step cheaper, as section 5 says
for a player's run.

The platform does not run the engine's determinism, restore, counters,
replay or performance checks, and nothing at upload holds a version to
replaying a recording to the state it recorded. `vbz check --ranked` runs
all of them, and it is how to test record and replay before you publish. A
game that is not deterministic now passes the upload and fails its players
instead: their runs do not replay to what they saw, and never rank.

## 4. The page module

The page module is loaded in a headless browser, Firefox, with `loadGame`,
as a studio's page loads it. Then it is mounted in watch mode on a recording
with nothing pressed, for a few steps, and it has to get ready and not
throw. One that will not load (`E_PAGE_MODULE_UNLOADABLE`), is not one a
page plays or refuses the run it is mounted with (`E_PAGE_MODULE_INVALID`),
or fails while it is mounted, gets ready or steps (`E_PAGE_MODULE_THREW`) is
refused before any player meets it.

Getting ready has a limit. The page module has to load and be ready within
60 seconds of the checks' browser starting (`CHECK_READY_MS`): its
presentation's `prepare` settled and its start packs fetched. The checks
serve the version's files folder themselves, and the browser reaches
nothing else: there is no other network, nobody to press anything, and no
permission granted. A page module still not ready then is tried again, and
only once every attempt has run out is the version refused, with
`E_PAGE_MODULE_NOT_READY`, so a moment's slowness on the platform's side
refuses nothing. A `prepare` that waits on something outside the game's
files folder, on a permission, or on a network the checks do not have never
gets ready there, so have it wait on the folder's own files and on nothing
a person has to do.

The checks' browser draws a 2d canvas and the DOM, and has no WebGL and no
WebGPU. A game it cannot draw, one whose manifest names `pixi`, `three` or
`null3d` as its renderer or asks for WebGPU, is mounted with `draw: false`
instead. That builds no presentation, so the game gets ready without drawing
anything and its steps run as they would on a page; the platform reports
that it was not drawn and does not refuse it. A page module built by the
first contract has no `draw: false`, so one of those that the browser
cannot draw is loaded and not mounted.

The checks compare nothing the page module reports.
`E_PAGE_MODULE_DIVERGED`, a page module that played the bot's log to another
state than the platform's replay of it, is no longer reached. A page module
that plays a run to another state than its replay reaches is found in the
harness, which replays every run you play (`references/harness.md`), or by
its players' runs failing the replay.

## 5. The rules code on the replay service

The checks above run on a machine of their own, which is not where a run is
replayed. So before the version publishes, the platform loads the rules code
with the data packs the manifest declares on the replay service that
replays every ranked and practice run, and runs a few steps with nothing
pressed. The service is Cloudflare Workers. One replay there has 5 minutes
of CPU, 7.5 minutes of wall time and 128 MB of memory, the platform's
figures for its replay service on Cloudflare, and the rules code as loaded,
its data packs and the game's state share the memory.

A version whose rules code will not load there, or whose replay dies while
it loads the rules code or its data packs, is refused with
`E_REPLAY_MODULE`, and the first failure's message carries the service's
own error text. The Workers runtime refuses some work while a module loads,
with an error of its own, which Cloudflare lists on its Hyperdrive
troubleshooting page
(https://developers.cloudflare.com/hyperdrive/observability/troubleshooting/):
"Disallowed operation called within global scope. Asynchronous I/O (ex:
fetch() or connect()), setting a timeout, and generating random values are
not allowed within global scope." Global scope is a module's top-level code,
which runs as it is imported, so the rules code's top level does none of
those, and nor does the top level of any library it bundles. Keep the rules
code and its data packs well inside the memory, since the game's state
needs room beside them.

Once the replay is running, one that runs out of its CPU time, its wall
time or its memory in those steps is refused with `E_REPLAY_OVER_BUDGET`,
such as a game whose `init` builds more data than fits. One that fails for
another reason is refused under the code the replay service gave, which
every player's run would meet too: the rules code threw (`E_REPLAY_THREW`)
or reached for something the service's isolate does not have, such as the
network (`E_REPLAY_REACHED_OUT`). Each is the game's to fix. A replay
service that gives no answer is the platform's: the check is tried again,
and the version stays pending.

`E_REPLAY_MALFORMED`, a replay the service could not take, is no longer
reached: the check sends no inputs, so there is no log for the service to
refuse.

Passing says the rules code loads and runs there, and nothing about a
player's run, which is longer than a few steps. Every run's replay starts
the rules code afresh, holds the data packs the manifest declares, and plays
every step the run took, so:

- **Make a step cheaper.** At 60 steps a second an hour of play is 216,000
  steps, and 5 minutes of CPU leaves about 1.4 ms for each. A ranked run
  whose replay runs out of any of the three is a `log_fault` and never
  ranks.
- **Hold less at once.** The rules code as loaded, its data packs and the
  game's state share the 128 MB of memory. Keep level data in packs rather
  than in the rules code, and let the state drop what no later step reads.

## 6. Published

Nobody reviews in between: a version that passes every check is published.
Its two modules are copied to `https://files.vbz.gg/g/<game id>/`, and its
files folder to `https://files.vbz.gg/g/<game id>/t/<listing sha256>/`,
each file under its path, from where a studio's page loads them, and
`vbz publish` prints which runs it serves. A patch of the day's release line
reaches the next ranked start, because a ranked run plays the line's highest
published patch. A new minor or major waits for the next day's seed. Practice
plays the newest playable version of any line.

Before the verdict, beside the replay-service check, the platform replays at
most 3 of the line's most recent settled ranked runs under the new rules
code and counts the runs whose end tick, terminal or counters come out
different. They are players' own recordings, and the only players' runs a
version meets before it publishes. The version publishes whatever the count
is. `vbz publish` waits for the count as it waits for the verdict and prints
it with the verdict, for example `patch check: 2 of 3 recent ranked runs on
line 1.2 end differently under this version`. A published version always
carries the count, and for a line's first version, which has no runs of its
line to replay, the command says so. It measures the part of a patch's
promise no manifest shows, whether the same play still scores the same;
`docs/sdk.md` under "Versions and release lines" says what a patch may
change.

A studio never takes a version down. It supersedes one by publishing a newer
version, so a broken patch is fixed by the next patch, which today's ranked
runs reach once it passes. Only a vbz operator takes a version down. When
that is the patch today's ranked runs play, nothing falls back to an older
one: a ranked start answers `E_RANKED_PAUSED` and `GET /v1/game` says the day
is paused until a newer patch in the line passes or the next day's seed.
Practice carries on.

A takedown removes the version's two modules from `files.vbz.gg`, and its
files folder too, unless another version that is served, or still being
checked, names the same folder. Two versions with an identical listing share
one folder, so a patch that changed only code keeps the folder up when the
version before it is taken down.

## What is not checked, and cannot be

A game with a backdoor keyed on a magic input satisfies every check here: the
replay agrees with the client because both run the same code, and both are
wrong together. No amount of determinism fixes that and no reading of a
minified bundle finds it. What answers it is that a studio is invited, the
alert the platform mails a studio's admins and the operators when many
players' runs fail the replay on one version, and watching a new game's score
distribution against its peers.

Nothing at upload plays a game in more than one engine any more, and
`E_ENGINE_DIVERGED`, two engines reaching different states from the same
bytes, is no longer reached. A simulation that computes differently on
JavaScriptCore, V8 and SpiderMonkey publishes, and its players' runs fail
the replay. The banned-APIs check is a static scan, and a static scan is
evadable: `Math["si"+"n"]` walks past it. Measured in clockwork2: 32.6% of
inputs differ for `Math.hypot` between JavaScriptCore and V8, 10.3% for
`Math.exp`, 9.0% for `Math.pow`, 3.2% for `Math.cos`. Play the game in the
harness in more than one browser before you publish: a run there is computed
by the browser's engine and replayed under bun, which is JavaScriptCore, so a
run whose replay matches says the two agreed (`references/harness.md`).

A verified score means the server recomputed it from your own inputs. It does
not mean the game is fair, and the platform should never be read as saying
otherwise.

## Source is never asked for

A submission is a built bundle. Every property that matters is behavioural -
two seeds reach different states, the rules code loads and runs in an
isolate with no network, a player's run replays to what their page
reported - so source would add nothing to the checking and cost an author
their code.
