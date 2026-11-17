import type { TickRate } from "@clockwork2/engine/manifest"
import { MAX_FILE_PATH_LENGTH } from "../game/files.js"

/**
 * Every size the platform holds a version, a game's files and a run to, the
 * budget one replay of a run has, the time the platform's checks allow a
 * version, and how long the platform waits on them, in one place.
 *
 * The platform imports these, and so does everything here that checks one:
 * `vbz build`, the stand-in a studio's page runs against, and the agent
 * guide's test. `/api` exports no value, so this is where they live. Each is
 * generous enough that nothing real reaches it and small enough that a
 * runaway build is refused rather than stored.
 */

/**
 * The most the rules code may hold: 4 MiB. Code rather than level data,
 * which goes in data packs: every replay imports the rules code afresh, and
 * in V8 a 2 MiB rules code took 82 ms to start, measured.
 */
export const MAX_SIM_BYTES = 4 * 1024 * 1024

/**
 * The most the page module may hold: 16 MiB. three.js with its usual
 * loaders is 0.9 MB minified, which leaves room for a game's own code; an
 * engine larger than that goes in the files folder.
 */
export const MAX_PRESENT_BYTES = 16 * 1024 * 1024

/**
 * The most one file in a version's folder may hold: 64 MiB. Each goes to
 * the platform in a request of its own and is cached whole at the edge.
 */
export const MAX_FILE_BYTES = 64 * 1024 * 1024

/** The most a version's folder may hold, every file together: 512 MiB. */
export const MAX_FILES_BYTES = 512 * 1024 * 1024

/** The most files a version's folder may hold. */
export const MAX_FILES = 10_000

/**
 * The most a game may hold on the platform in files no version names: twice
 * what one version's folder may hold, 1 GiB, so a version's whole folder can
 * go up while the files of one that never arrived wait out their day. A file
 * sent ahead of its version counts from its upload until a version names
 * it, or until the platform removes it a day after it was last sent. A
 * file's upload past it is refused (`E_QUOTA_EXCEEDED`). It depends on what
 * the platform already holds for the game, so no build checks it.
 */
export const MAX_UNNAMED_FILES_BYTES = 2 * MAX_FILES_BYTES

/**
 * The most a version's manifest may hold, as JSON with no white space, the
 * way the platform stores it: 512 KiB. Every replay of a run carries parts
 * of it beside the run's log, the config the run is served, its counters and
 * its data packs' declarations, so a manifest this size leaves the request
 * room for a log at `MAX_RUN_BYTES`. `vbz build` refuses a larger one, and so
 * does the upload (`E_MANIFEST_INVALID`).
 */
export const MAX_MANIFEST_BYTES = 512 * 1024

/**
 * No canonical listing is longer: `MAX_FILES` entries, each with the longest
 * path, a size as long as `MAX_FILE_BYTES` written out and a SHA-256, as
 * `canonicalListing` writes them, where no path character needs escaping.
 * The listing is a request's whole body when `vbz publish` asks which files
 * the platform lacks, so that route takes a body this size: 6,170,011 bytes.
 */
export const MAX_LISTING_BYTES =
  `{"files":[]}`.length +
  MAX_FILES *
    (`{"path":"","bytes":,"sha256":""}`.length +
      MAX_FILE_PATH_LENGTH +
      String(MAX_FILE_BYTES).length +
      64) +
  (MAX_FILES - 1)

/** The most one data pack may hold: 16 MiB. */
export const MAX_PACK_BYTES = 16 * 1024 * 1024

/**
 * The most a version's data packs may hold together: 48 MiB, so the rules
 * code and every pack fit one replay inside the 64 MiB of code a Worker
 * takes.
 */
export const MAX_PACKS_BYTES = 48 * 1024 * 1024

/**
 * The most a run's recording may hold, and a run's chunks together: 31 MiB.
 * A replay request carries the log alone, its rules code and packs read
 * from storage, and the platform holds its verifier's request to fit this.
 */
export const MAX_RUN_BYTES = 31 * 1024 * 1024

/** The most one of a run's chunks may hold: 1 MiB. */
export const MAX_CHUNK_BYTES = 1024 * 1024

/**
 * The CPU time one replay may spend on the platform's replay service, where
 * every ranked and practice run is replayed, where the platform's checks run
 * a version's rules code for a few steps before it publishes, and where a
 * patch is replayed against its line's recent ranked runs: 5 minutes, the
 * most Cloudflare lets a Worker spend on one request on its paid plan. The
 * platform takes its replays' budget from here.
 */
export const REPLAY_CPU_BUDGET_MS = 5 * 60_000

/**
 * The wall time one replay may take there: the CPU time and half as much
 * again, for the isolate starting and what the machine does beside it.
 */
export const REPLAY_WALL_BUDGET_MS = REPLAY_CPU_BUDGET_MS * 1.5

/**
 * The memory one replay has there, for the rules code as loaded, its data
 * packs and the game's state together: 128, in megabytes as Cloudflare
 * writes its per-isolate limit, which does not say whether it counts them
 * in powers of ten or of two.
 */
export const REPLAY_MEMORY_MB = 128

/**
 * How long the platform waits past `REPLAY_WALL_BUDGET_MS` for the replay
 * service's answer before it counts a replay as unanswered: 10 seconds, for
 * the request and the answer on their way. The platform takes its margin
 * from here.
 */
export const REPLAY_ANSWER_MARGIN_MS = 10_000

/**
 * The most of a release line's recent settled ranked runs the platform
 * replays under a new version's rules code before its verdict: 3. They are
 * players' own recordings, replayed beside the replay-service check, and the
 * count of those that end differently decides nothing; `vbz publish` prints
 * it with the verdict. The platform takes its count from here.
 */
export const PATCH_SCORE_RUNS = 3

/** An hour, in seconds: what one replay's CPU budget is sized to play. */
const SECONDS_IN_AN_HOUR = 60 * 60

/**
 * What one step of an hour's play at `tickHz` steps a second may cost its
 * replay: `REPLAY_CPU_BUDGET_MS` over that hour's steps, in microseconds of
 * one CPU, rounded down, so the hour's steps at this cost fit the budget.
 */
function stepBudgetUs(tickHz: TickRate): number {
  return Math.floor(
    (REPLAY_CPU_BUDGET_MS * 1000) / (SECONDS_IN_AN_HOUR * tickHz),
  )
}

/**
 * The CPU time the platform's checks allow each step of a version's rules
 * code that they play at upload, by the game's tick rate, in microseconds
 * of one CPU: what one step of an hour of the game's own play at its own
 * rate may cost its replay, `REPLAY_CPU_BUDGET_MS` over that hour's steps,
 * rounded down. That is 2,777 at 30 steps a second, 1,388 at 60 and 694 at
 * 120, so an hour of the game's steps at its rate, each within its
 * allowance, fits one replay's CPU budget. The engine's checks an upload
 * runs are given this for every step they play, and start-up apart from
 * the steps, `CHECK_INIT_BUDGET_MS` for each time they load the rules code;
 * checks that run out are tried again, and only once every attempt has run
 * out is the version refused, `E_CHECKS_OVER_BUDGET`. Keyed by the engine's
 * `TickRate`, so a rate the engine adds fails to compile here until this
 * table gives it an allowance. The platform takes its allowance from here.
 */
export const CHECK_STEP_BUDGET_US: Readonly<Record<TickRate, number>> = {
  30: stepBudgetUs(30),
  60: stepBudgetUs(60),
  120: stepBudgetUs(120),
}

/**
 * The CPU time the platform's checks allow each load of a version's rules
 * code at upload, before its first step, in milliseconds of one CPU: 5
 * seconds for importing the module, reading its start packs and running
 * `init`. The engine's checks an upload runs load it afresh for every run
 * they play: the headless check once, and the seed check up to six times,
 * once for each of its three logs under each of two seeds. The platform
 * counts the loads exactly and allows each this beside the steps'
 * `CHECK_STEP_BUDGET_US`. A replay pays its start once too, from the same
 * `REPLAY_CPU_BUDGET_MS` as its steps.
 */
export const CHECK_INIT_BUDGET_MS = 5_000

/**
 * How long the platform's page-module check waits, once the checks' browser
 * has started, for the page module to load and get ready: 60 seconds.
 * Getting ready is the presentation's `prepare` settling and the start packs
 * arriving from the version's files folder, which the checks serve
 * themselves; there is no other network, nobody to press anything and no
 * permission granted. The whole check, the browser's start included, took
 * 5.3 to 6.8 seconds in the platform's checks image. A page module that is
 * not ready in time is tried again, and only once every attempt has run out
 * is the version refused, `E_PAGE_MODULE_NOT_READY`. The platform takes its
 * wait from here.
 */
export const CHECK_READY_MS = 60_000

/**
 * How long the platform waits for one checks container to answer: 10
 * minutes, over the longest one check can hold its container on the
 * platform, a game at 30 steps a second with the container's start
 * included, which a test on the platform holds under it. Every part of the
 * check is held to a timeout sized from the step allowance at the game's
 * rate, the allowance for each load and measurements in the checks image.
 * The platform takes its wait from here and keeps its container's own
 * deadline under it.
 */
export const CHECKS_CONTAINER_WAIT_MS = 10 * 60_000
