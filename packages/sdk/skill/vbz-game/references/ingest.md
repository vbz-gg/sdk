# From an upload to a listing

What the platform does with a submission, in order. Sections 0 to 2 run
before the first storage write, so a submission they refuse leaves nothing
behind and costs no quota: an upload is its own dry run.

`vbz publish <dir> --game <id>` is how a submission arrives. It sends the
files folder's listing and asks which files the platform lacks, uploads each
of those on its own, sends the version with the listing beside it, then
reads the version back until the checks below decide, and prints the code
and the first failed check of a rejection. A file is stored under the hash
of its bytes (`E_FILE_HASH_MISMATCH` when they are not), so a file an
earlier version sent is not sent again, and a version whose listing names a
file the platform does not hold is refused with `E_FILES_MISSING`.

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

`assertManifest` on the shape, and then one thing it does not cover:

- every name in `rankBy` is a declared counter, and `rankBy` is not empty
  (`E_RANKBY_UNDECLARED`). Without this a game lists, plays fine all day and
  can never rank anybody.

The manifest is also compared against the one the built simulation exports.
The code's copy wins: a submission whose JSON says something the simulation
does not is refused rather than believed.

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

The engine's `ranked` set from `@clockwork2/engine/validate`, run against the
built simulation laid out as a subject directory with its data packs beside
it, playing the config a run is served: every declared setting at its
default. The set is every check the engine runs on any game, the subject of
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
  (`E_RANK_UNDECLARED`), which a game played only on its own page may leave
  out.

## 4. The cross-engine sweep

The candidate's own logs replayed under JavaScriptCore and SpiderMonkey as
well as V8, once per version rather than per play.

This is the real admission boundary. `banned-apis` is a static scan and a
static scan is evadable: `Math["si"+"n"]` walks past it and straight into
here, where the engines disagree. Measured in clockwork2: 32.6% of inputs
differ for `Math.hypot` between JavaScriptCore and V8, 10.3% for `Math.exp`,
9.0% for `Math.pow`, 3.2% for `Math.cos`.

## 5. The page module

The page module is loaded in a headless browser and played for a short run
with the bot's inputs, so one that will not load, will not mount or fails as
it plays is refused before any player meets it.

## 6. Published

Nobody reviews in between: a version that passes every check is published.
Its two modules and its files folder are copied to
`https://files.vbz.gg/g/<game id>/`, and
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
