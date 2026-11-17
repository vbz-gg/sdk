import { MAX_FILE_PATH_LENGTH } from "../game/files.js"

/**
 * Every size the platform holds a version and a run to, in one place.
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
