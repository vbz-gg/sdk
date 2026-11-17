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
it a declared counter (`E_MANIFEST_INVALID`). Then one thing
`assertManifest` does not cover:

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

Then the engine's `ranked` set from `@clockwork2/engine/validate`, run
against the built simulation laid out as a subject directory with its data
packs beside it, playing the config a run is served: every declared setting
at its default. The set is every check the engine runs on any game, the subject of
the engine's guide, clockwork2 (determinism, banned APIs, no async, restore,
counters, headless, assets and the rest), and two that only a ranked or
practice run needs. Each check plays its logs to the game's own end or to a
fixed window; no run has a step limit.

- **Seed sensitivity**: two different seeds on the same input log must pass
  through different states (`E_SEED_IGNORED`). A game that ignores its seed
  passes every other check - determinism compares same-seed runs to each
  other, so a seed-blind generator is perfectly deterministic - and turns a
  daily board into an all-time board.
- **Ranking**: the manifest declares `rankBy` and `tiePolicy`
  (`E_RANK_UNDECLARED`), which the upload already held it to in section 1.

## 4. The cross-engine sweep

The candidate's own logs replayed under JavaScriptCore and SpiderMonkey as
well as V8, once per version rather than per play. Engines that reach
different states refuse the version with `E_ENGINE_DIVERGED`.

This is the real admission boundary. `banned-apis` is a static scan and a
static scan is evadable: `Math["si"+"n"]` walks past it and straight into
here, where the engines disagree. Measured in clockwork2: 32.6% of inputs
differ for `Math.hypot` between JavaScriptCore and V8, 10.3% for `Math.exp`,
9.0% for `Math.pow`, 3.2% for `Math.cos`.

## 5. The page module

The page module is loaded in a headless browser and played for a short run
with the bot's inputs, so one that will not load (`E_PAGE_MODULE_UNLOADABLE`),
is not one a page plays or will not mount (`E_PAGE_MODULE_INVALID`), fails as
it plays (`E_PAGE_MODULE_THREW`), or plays the log to another state than the
replay of it (`E_PAGE_MODULE_DIVERGED`) is refused before any player meets
it. The checks' browser has no
WebGL and no WebGPU, so a game drawn with them cannot get ready there; a
watched run's `draw: false` is the SDK's way to play a page module without
its presentation, so its checkpoints can still be compared with the
replay's.

## 6. One replay on the replay service

The checks above run on a machine of their own, which is not where a run is
replayed and has more memory than a replay gets. So before the version
publishes, the platform replays the bot's log the checks play once more, on
the replay service that replays every ranked and practice run. One replay
there has 5 minutes of CPU, 7.5 minutes of wall time and 128 MB of memory,
the platform's figures for its replay service on Cloudflare, and a version
whose replay runs out of its CPU time, its wall time or its memory is
refused with `E_REPLAY_OVER_BUDGET`, before any player's run fails the same
way. That is the game's to fix. A replay service that gives
no answer is the platform's: the check is tried again, and the version stays
pending.

Passing says the bot's run fits, and a player's run can be longer. Every
run's replay starts the rules code afresh, holds the data packs the manifest
declares, and plays every step the run took, so:

- **Make a step cheaper.** At 60 steps a second an hour of play is 216,000
  steps, and 5 minutes of CPU leaves about 1.4 ms for each. A ranked run
  whose replay runs out of any of the three is a `log_fault` and never
  ranks.
- **Hold less at once.** The rules code as loaded, its data packs and the
  game's state share the 128 MB of memory. Keep level data in packs rather
  than in the rules code, and let the state drop what no later step reads.

## 7. Published

Nobody reviews in between: a version that passes every check is published.
Its two modules are copied to `https://files.vbz.gg/g/<game id>/`, and its
files folder to `https://files.vbz.gg/g/<game id>/t/<listing sha256>/`,
each file under its path, from where a studio's page loads them, and
`vbz publish` prints which runs it serves. A patch of the day's release line
reaches the next ranked start, because a ranked run plays the line's highest
published patch. A new minor or major waits for the next day's seed. Practice
plays the newest playable version of any line.

As it publishes, the platform replays up to 50 of the line's most recent
settled ranked runs under the new rules code and counts the runs whose end
tick, terminal or counters come out different. The version publishes
whatever the count is. `vbz publish` prints it, for example
`patch check: 3 of 50 recent ranked runs on line 1.2 end differently under
this version`, and prints nothing while the platform has not measured it.
It measures the part of a patch's promise no manifest shows, whether the same
play still scores the same; `docs/sdk.md` under "Versions and release lines"
says what a patch may change.

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

A verified score means the server recomputed it from your own inputs. It does
not mean the game is fair, and the platform should never be read as saying
otherwise.

## Source is never asked for

A submission is a built bundle. Every property that matters is behavioural -
two seeds reach different states, the same log replays identically, three
engines agree, the isolate has no network - so source would add nothing to the
checking and cost an author their code.
