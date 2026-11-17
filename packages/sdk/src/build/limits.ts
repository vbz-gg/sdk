import { MAX_FILE_PATH_LENGTH } from "../game/files.js"

/**
 * Every size the platform holds a version and a run to, the budget one
 * replay of a run has, and how long the platform waits on its checks, in one
 * place.
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
 * every ranked and practice run is replayed and where the platform's checks
 * run a version's rules code for a few steps before it publishes: 5
 * minutes, the most Cloudflare lets a Worker spend on one request on its
 * paid plan. The platform takes its replays' budget from here.
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
 * How long the platform waits for one checks container to answer: 12
 * minutes, sized when the checks ran the cross-engine sweep and played the
 * page module, to cover the checks child's two minutes, two for each of the
 * sweep's three engines and two for the page-module check's browser running
 * out, a cold start and two bundle builds. The checks do neither now, and
 * the wait stays until the platform has measured what they take. The
 * platform takes its wait from here and keeps its container's own deadline
 * under it.
 */
export const CHECKS_CONTAINER_WAIT_MS = 12 * 60_000
