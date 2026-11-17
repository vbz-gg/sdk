/**
 * The vbz.gg platform's public routes, as types.
 *
 * Public here means what a studio's own code calls: its game page, through a
 * page key, and its build system, through a secret key. The platform imports
 * these and declares its routes' answers with them, and a studio's code and
 * this package's own client call the routes through them, so no two of them
 * can disagree about a shape without one failing to compile.
 *
 * They live here rather than in the platform so the dependency runs one way:
 * the platform depends on this package, and this package on nothing of the
 * platform's. A change to a route's shape therefore lands here first, is
 * released, and is then taken by the platform.
 *
 * Types only. This subpath compiles to an empty module and adds nothing to a
 * bundle.
 *
 * Within `/v1` a change only adds: a field, a route, a refusal code. Anything
 * that would break a page already shipped against these is a new route. That
 * holds from the day vbz-gg/platform's `AGENTS.md` marks the platform
 * deployed; until then a shape may still change in place, here first.
 */

/** The header a page sends its page key in. */
export type PageKeyHeader = "x-vbz-key"

/** A key's prefix says which kind it is. */
export type PageKey = `vbz_pk_${string}`
export type SecretKey = `vbz_sk_${string}`

/** Every refusal arrives as one of these bodies, with a stable code. */
export interface ApiErrorBody {
  readonly error: string
  readonly message: string
  /** What this refusal was about, for a log rather than a person. */
  readonly detail?: Record<string, unknown>
}

/**
 * Every refusal a public route can answer, by name.
 *
 * A client switches on the code, never on the status. The platform holds its
 * refusal tables to this union at compile time, so a code it can answer and
 * this list does not name fails the platform's build.
 */
export type PublicRefusalCode =
  // Any route.
  /** The body or a query parameter is not the shape the route takes. */
  | "E_BAD_REQUEST"
  /**
   * No route at that path, or nothing there this reader may have: a run that
   * does not exist, has not settled, is another player's or another
   * studio's, or is from a day still open and not the reader's own. Each is
   * answered alike, so the difference tells a reader nothing.
   */
  | "E_NOT_FOUND"
  /** The platform failed. The answer says nothing more, on purpose. */
  | "E_INTERNAL"
  // Keys and pages.
  /** No key, or a key that does not resolve: unknown, revoked, expired, or its studio disabled. */
  | "E_UNAUTHORIZED"
  /** A page key used from a page its game does not allow, or with no `Origin`. */
  | "E_ORIGIN_NOT_ALLOWED"
  /** A page key presented where only a secret key or a member may act. */
  | "E_PAGE_KEY_CANNOT_UPLOAD"
  /** A secret key sent from a browser. It belongs in a build system. */
  | "E_SECRET_KEY_IN_BROWSER"
  // A studio's uploads and versions.
  | "E_NO_STUDIO"
  | "E_GAME_NOT_FOUND"
  | "E_NO_VERSION"
  /** A member without the permission the route needs. */
  | "E_NOT_PERMITTED"
  /** A member writing to a studio an operator disabled. */
  | "E_STUDIO_DISABLED"
  | "E_VERSION_EXISTS"
  /**
   * A version that is not `MAJOR.MINOR.PATCH`: a prerelease or build suffix,
   * a leading zero, or a part above 2^31 - 1.
   */
  | "E_VERSION_INVALID"
  /**
   * A version that does not move forward: a new release line below a version
   * the game already has, or a patch below one already in its line. Its
   * `detail` is a `VersionNotNewerDetail`.
   */
  | "E_VERSION_NOT_NEWER"
  /**
   * A patch whose manifest changes a field its release line fixes, such as
   * `inputs`, `counters` or `rankBy`. New rules are a new minor or major. Its
   * `detail` is a `PatchChangesRulesDetail`.
   */
  | "E_PATCH_CHANGES_RULES"
  /**
   * The player sent five submissions refused as tampered on this game within
   * 24 hours, and may not start a run of it until the bar ends. Its `detail`
   * is a `PlayerBarredDetail`.
   */
  | "E_PLAYER_BARRED"
  /** The studio's uploads over the last 24 hours, all its games together. */
  | "E_QUOTA_EXCEEDED"
  | "E_MANIFEST_INVALID"
  | "E_ARTIFACT_NOT_UTF8"
  | "E_ARTIFACT_TOO_LARGE"
  | "E_SIM_NOT_SELF_CONTAINED"
  | "E_PRESENT_IMPORT_MISSING"
  | "E_PRESENT_IMPORT_UNEXPECTED"
  /** The page module calls `import()`, with a literal or a computed name. */
  | "E_PRESENT_DYNAMIC_IMPORT"
  /** The page module calls `new Worker`, `new SharedWorker` or `importScripts`. */
  | "E_PRESENT_WORKER"
  | "E_PRESENT_SPECIFIER_AMBIGUOUS"
  // A version's files folder.
  /** The files listing is not a list of paths, sizes and SHA-256s. */
  | "E_FILES_INVALID"
  /** A path a version's folder may not hold, or one listed twice, ignoring case. */
  | "E_FILE_PATH_INVALID"
  /** One file over the 64 MiB a file may hold. */
  | "E_FILE_TOO_LARGE"
  /** The folder's files together over the 512 MiB a version's files may hold. */
  | "E_FILES_TOO_LARGE"
  /** More than the 10,000 files a version's folder may hold. */
  | "E_FILES_TOO_MANY"
  /** The page module imports `cw2:files/<path>` for a file the listing does not hold. */
  | "E_FILE_UNLISTED"
  /** The manifest declares a data pack the listing does not hold. */
  | "E_PACK_UNLISTED"
  /** A data pack's size or SHA-256 in the listing is not the one the manifest declares. */
  | "E_PACK_MISMATCH"
  /** One data pack over 16 MiB, or all of them over 48 MiB together. */
  | "E_PACKS_TOO_LARGE"
  /** The platform could not rewrite the page module's import. Not reached in practice. */
  | "E_REWRITE_FAILED"
  // Player sign-in.
  | "E_SIGNIN_GRANT_INVALID"
  | "E_CODE_VERIFIER_INVALID"
  /** A run route called with no player token, or one that no longer works. */
  | "E_SIGN_IN_REQUIRED"
  // Starting a run.
  /** No version of the game is being served for this run. */
  | "E_NO_GAME"
  /** A ranked start, and the game has no round today. */
  | "E_NO_SEED_TODAY"
  /**
   * A ranked start while the day's line is paused: an operator took down its
   * highest published patch, and nothing falls back to an older one. Ranked
   * play resumes when a newer patch of the line passes its checks, or with
   * the next day's seed. A practice run may still start.
   */
  | "E_RANKED_PAUSED"
  | "E_PRACTICE_OFF"
  /**
   * A ranked run asked of a player who has started every ranked run the game
   * allows today. A practice run may still start, where the game offers one.
   */
  | "E_RANKED_RUNS_USED"
  // A run's chunks and its recording.
  | "E_NO_SESSION"
  | "E_SESSION_CLOSED"
  | "E_CHUNK_CONFLICT"
  | "E_CHUNK_NOT_FORWARD"
  | "E_RECORDING_MALFORMED"
  | "E_PINNED_MISMATCH"
  | "E_NO_CHUNKS"
  | "E_CHUNKS_INCOMPLETE"
  | "E_CHECKPOINT_CONTRADICTED"
  | "E_TIME_IMPOSSIBLE"
  /**
   * An input whose name the version's manifest does not declare, or whose
   * value is outside the range the manifest declares for it. The engine's
   * `checkInputs` and `checkInputSpan` report both as this code.
   */
  | "E_INPUT_UNDECLARED"
  /**
   * An input no recording can hold: a tick or a value that is not a whole
   * number, a value of -0, no name, or a tick past the run's end or outside
   * the span a chunk covers. Not a value outside its range, which is
   * `E_INPUT_UNDECLARED`.
   */
  | "E_INPUT_RANGE"
  /** More inputs than any player makes in the ticks the log covers. */
  | "E_INPUT_BUDGET"
  /** A request body over the route's cap, refused before it is read. */
  | "E_BODY_TOO_LARGE"
  /**
   * A chunk that would take the run's committed bytes, or a recording, over
   * `StartedRun.limits.runBytes`.
   */
  | "E_RUN_TOO_LARGE"

/** `E_VERSION_NOT_NEWER`'s detail: what the upload had to be above. */
export interface VersionNotNewerDetail {
  /** The highest version already in the upload's line, or null for a new line. */
  readonly highestInLine: string | null
  /** The highest version the game has, rejected versions not counted. */
  readonly highestInGame: string | null
}

/** `E_PATCH_CHANGES_RULES`'s detail: which fixed fields moved, against what. */
export interface PatchChangesRulesDetail {
  /** The line, `MAJOR.MINOR`. */
  readonly line: string
  /** The version that set the line's contract: its earliest not rejected. */
  readonly comparedWith: string
  /** The fixed fields this upload changes, as `lineChanges` names them. */
  readonly fields: readonly string[]
  /** The version to publish these rules as instead: the next minor, `.0`. */
  readonly nextMinor: string
}

/** `E_PLAYER_BARRED`'s detail. */
export interface PlayerBarredDetail {
  /** ISO 8601: when the player may start a run of this game again. */
  readonly until: string
}

/**
 * Every refusal whose `detail` has a declared shape, by code. A refusal not
 * named here carries a `detail` for a log, with no shape promised.
 */
export interface RefusalDetails {
  readonly E_VERSION_NOT_NEWER: VersionNotNewerDetail
  readonly E_PATCH_CHANGES_RULES: PatchChangesRulesDetail
  readonly E_PLAYER_BARRED: PlayerBarredDetail
}

/** Where a version is in being checked. */
export type VersionState = "pending" | "rejected" | "published"

/** A version a page can load before a click: its page module and its manifest. */
export interface PageGameVersion {
  readonly id: string
  readonly version: string
  /** The manifest as uploaded. */
  readonly manifest: unknown
  readonly manifestSha256: string
  /**
   * The engine's 64-bit canonical hash of the manifest, which a run pins and
   * a page module reports, so a page can check it loaded this version's.
   */
  readonly manifestHash: string
  /**
   * The version's page module, absolute: `https://<bundles host>/g/<gameId>/present/<sha256>.js`.
   * `loadGame` in `@vbz-gg/sdk/host` imports it.
   */
  readonly presentUrl: string
  /**
   * The version's files folder, absolute and ending in `/`:
   * `https://<bundles host>/g/<gameId>/t/<listing sha256>/`, named by the
   * SHA-256 of its listing. The page module finds its art and data packs
   * here, and `loadGame` hands it to the module.
   */
  readonly filesUrl: string
}

/** Whether ranked runs can start today. */
export type RankedPlay = "open" | "paused"

/** `GET /v1/game`: the game a page key names, and today's round. */
export interface PageGame {
  readonly game: {
    readonly id: string
    readonly slug: string
    readonly title: string
    /**
     * Whether a ranked run plays the day's seed, the same for everybody.
     * Off, each ranked run has a seed of its own.
     */
    readonly dailySeed: boolean
    /** Whether a page may start practice runs, which never reach a board. */
    readonly practice: boolean
    /**
     * How many ranked runs a player may start in a UTC day, or null for no
     * limit. Practice runs are not counted.
     */
    readonly rankedRunsPerDay: number | null
  }
  readonly studio: {
    readonly slug: string
    readonly name: string
  }
  /** The UTC day this answer is for. */
  readonly day: string
  /**
   * Today's round, or null when the game has none today: nothing published
   * yet, or the day's seed not written.
   */
  readonly today: {
    /**
     * A hash of the day's seed, published before play, revealed after. Null
     * for a game that does not use the day's seed.
     */
    readonly seedCommit: string | null
    /** The release line the day's seed pinned, `MAJOR.MINOR`. */
    readonly line: string
    /**
     * `paused` while an operator has taken down the line's highest published
     * patch: a ranked start answers `E_RANKED_PAUSED` until a newer patch of
     * the line passes its checks, or until the next day's seed.
     */
    readonly ranked: RankedPlay
    /**
     * The version a ranked start plays now, the line's highest published
     * patch. Null only while `ranked` is `paused`.
     */
    readonly version: PageGameVersion | null
  } | null
  /**
   * The version a practice start plays now, the newest playable version of
   * any line. Null when the game offers no practice or has nothing playable.
   */
  readonly practiceVersion: PageGameVersion | null
}

/** `POST /v1/games/:gameId/versions`: an upload, accepted for checking. */
export interface UploadedVersion {
  readonly gameVersionId: string
  /**
   * The studio that owns the game, so a build system can read the version
   * back at `GET /v1/studios/:studioId/versions/:versionId` knowing only the
   * game it uploaded to.
   */
  readonly studioId: string
  readonly version: string
  /** The release line the version joined, `MAJOR.MINOR`. */
  readonly line: string
  /** Always pending here: the checks decide, after the upload is answered. */
  readonly state: VersionState
  readonly simSha256: string
  /** The page module as stored: its `cw2:sim` import already rewritten. */
  readonly presentSha256: string
  /** The page module as uploaded, before the rewrite. */
  readonly presentSourceSha256: string
  readonly manifestHash: string
  readonly manifestSha256: string
  /** `https://<bundles host>/g/<gameId>/sim/<sha256>.js`, once published. */
  readonly simUrl: string
  /** `https://<bundles host>/g/<gameId>/present/<sha256>.js`, once published. */
  readonly presentUrl: string
}

/**
 * Which runs a version serves now. `ranked`: `today` when it is the day's
 * line's ranked version, `from-next-seed` when its line is newer than the
 * day's and the next day's seed would pin it, `none` otherwise. `practice`:
 * whether a practice start plays it now.
 */
export interface VersionServing {
  readonly ranked: "today" | "from-next-seed" | "none"
  readonly practice: boolean
}

/** A version as a studio's build system reads it back. */
export interface VersionStatus {
  readonly gameVersionId: string
  readonly gameId: string
  readonly version: string
  /** The release line, `MAJOR.MINOR`. */
  readonly line: string
  readonly state: VersionState
  /** The code the checks refused it with, when they did. */
  readonly rejectedCode: string | null
  /** The first check that failed, when one did. */
  readonly firstFailure: {
    readonly check: string
    readonly code: string
    readonly message: string
  } | null
  /** ISO 8601. Null until the checks finish. */
  readonly checkedAt: string | null
  /**
   * Set while an operator has taken the version down. Nothing else takes a
   * version down: a studio supersedes one by publishing a newer one.
   */
  readonly suspended: boolean
  readonly serving: VersionServing
  /**
   * What publishing this version does to its line's scores. As a version
   * publishes, the platform replays up to 50 of its release line's most
   * recent settled ranked runs, played on the line's other versions, under
   * this version's rules code, and counts the runs whose end tick, terminal
   * or counters come out different. It decides nothing: the version
   * publishes whatever the count says, and the studio is told. `compared` is
   * 0 for a line's first version, which has no runs of its own line to
   * replay. Null while the version is pending or rejected, or when the
   * platform has not measured it.
   */
  readonly patchScores: {
    /** The line's runs replayed under this version's rules code. */
    readonly compared: number
    /** Of those, the runs that ended differently. */
    readonly differing: number
  } | null
  readonly createdAt: string
}

/** `GET /v1/studios/:studioId/games/:gameId/versions`, newest first. */
export interface VersionStatusList {
  readonly versions: readonly VersionStatus[]
}

/**
 * `POST /v1/oauth/token`, traded from a game's page: a player signed in to
 * the page key's studio. The id is the player ID that studio sees, and no
 * studio sees a player's address.
 */
export interface SignedInPlayer {
  readonly token: string
  /** Seconds until the token expires. Every run start renews it. */
  readonly expiresIn: number
  readonly player: {
    readonly id: string
    /** One name per person, the same at every studio. */
    readonly displayName: string
  }
}

/** The body of `POST /v1/oauth/token`. */
export interface TokenRequest {
  readonly code: string
  readonly codeVerifier: string
  /** `dashboard`, or the page's page key. */
  readonly clientId: string
}

/** A ranked run reaches the board; a practice run is replayed and never does. */
export type RunMode = "ranked" | "practice"

/** The body of `POST /v1/runs`. Absent, or `practice` false, is a ranked run. */
export interface StartRunRequest {
  readonly practice?: boolean
}

/**
 * The byte caps a run's writes are held to. A page splits a chunk larger
 * than `chunkBytes`, and ends a run before what it committed reaches
 * `runBytes`, rather than having either refused.
 */
export interface RunLimits {
  /** The most one `POST /v1/runs/:id/chunks` body may hold. */
  readonly chunkBytes: number
  /** The most a run's chunks may hold together, and the most a recording may. */
  readonly runBytes: number
}

/**
 * `POST /v1/runs`: a run of the key's game, started or found again.
 *
 * Starting again before any of a run has reached the server answers the same
 * run, on the version it started on, which is what a refresh is: it may be an
 * older patch than a fresh start would pick. Once part of it has, starting
 * again closes it, settles it from what it committed, and answers a new run.
 * `tickHz`, `config` and the game's manifest hash are plain JSON here; the
 * engine's own types narrow them on the page.
 */
export interface StartedRun {
  readonly sessionId: string
  readonly mode: RunMode
  readonly day: string
  /**
   * How many more ranked runs the player may start today, this one counted.
   * Null for a practice run, and for a game that sets no limit.
   */
  readonly rankedRunsLeft: number | null
  readonly seed: string
  readonly config: Readonly<Record<string, string | number | boolean>>
  readonly game: {
    /** The version this run plays. */
    readonly id: string
    /**
     * This run's own page module, absolute. A resumed run plays the version
     * it started on, which may not be the one `GET /v1/game` names, so this
     * is the module a page has to play it with.
     */
    readonly presentUrl: string
    /** Compared against the page module's own before a tick runs. */
    readonly manifestHash: string
    /** This run's own version's files folder, absolute, ending in `/`. */
    readonly filesUrl: string
    /** The manifest of the version this run plays, as uploaded. */
    readonly manifest: unknown
    readonly tickHz: number
  }
  readonly limits: RunLimits
  /** The player's token, renewed. Keep this one and drop the last. */
  readonly token: string
  readonly expiresIn: number
}

/**
 * The body of `POST /v1/runs/:id/chunks`: what happened in the run since the
 * last chunk, never the whole log so far.
 *
 * `throughTick` is the highest tick the chunk commits, and the next chunk may
 * carry nothing at or below it. The engine takes a tick's inputs before it
 * runs that tick and writes its checkpoint after, so while a run plays a page
 * commits through the tick before the last one the game reported, or its
 * highest input tick if that is higher, and through the end tick once the run
 * has ended. Committing the last reported tick while the run plays gets the
 * next chunk refused for an input at that tick.
 */
export interface RunChunk {
  /** 0 for the first chunk, then 1, 2 and on. */
  readonly seq: number
  readonly throughTick: number
  /** The run's checkpoints since the last chunk. */
  readonly checkpoints: ReadonlyArray<{
    readonly tick: number
    readonly hash: string
  }>
  /** The engine's input events since the last chunk, as the page recorded them. */
  readonly inputs: readonly unknown[]
  /** The counters the page showed. Stored, and never ranked. */
  readonly counters?: Readonly<Record<string, number>>
}

/** `POST /v1/runs/:id/chunks`: one slice of the run, taken. */
export interface ChunkAccepted {
  readonly seq: number
  readonly throughTick: number
}

/**
 * `POST /v1/runs/:id/submit`: the recording, taken for replay. The score
 * comes from the replay, never from what was submitted. Sending the same
 * recording again answers the same.
 */
export interface SubmittedRun {
  readonly sessionId: string
  readonly recordingSha256: string
}

/** Which runs a board ranks: today's, the last seven days', or all of them. */
export type BoardPeriod = "day" | "week" | "all"

export interface BoardRow {
  readonly rank: number
  /** The player ID this studio sees. */
  readonly playerId: string
  readonly displayName: string
  readonly counters: Readonly<Record<string, number>>
  readonly day: string
  readonly sessionId: string
  /**
   * The exact version the run was played on. A day's rows all come from one
   * release line, but each patch of it is its own row's version.
   */
  readonly version: string
}

/** `GET /v1/board`: one page of a game's board. */
export interface Board {
  readonly gameId: string
  readonly period: BoardPeriod
  readonly from: string | null
  readonly to: string
  readonly total: number
  readonly rows: readonly BoardRow[]
  /** The reader's own row, wherever it is. Null when they have not played. */
  readonly you: BoardRow | null
  /** What the manifest ranks by, so a page can label the columns. */
  readonly rankBy: readonly string[]
  readonly tiePolicy: string
}

/** Where a run is now. */
export type RunState = "open" | "submitted" | "settled" | "faulted" | "expired"

/**
 * Why a replay did not count. `mismatch`: the replay reached a different
 * state from the recording. `log_fault`: the inputs could not be replayed,
 * for example they ran past the replay's time budget. `platform_fault`: the
 * platform failed before the replay ran, tried five times, and stopped, so
 * the run is final. While it is still trying, the run waits at `submitted`.
 */
export type RunFault = "mismatch" | "log_fault" | "platform_fault"

/**
 * `GET /v1/runs/:id/result`: the player's own run and what its replay
 * decided. Only that player reads it, with their token; to anybody else it is
 * the 404 a missing run is, `E_NOT_FOUND`. It never carries the seed.
 *
 * `submitted` waits for a replay. `expired` is a run closed without a submit:
 * one that sent chunks is then replayed from them and moves on, and one that
 * sent none stays expired. So a page asks again until `replay` is set, or
 * until the run is `expired` with `committed` false.
 */
export interface RunResult {
  readonly sessionId: string
  readonly mode: RunMode
  readonly day: string
  readonly state: RunState
  /**
   * True when part of the run has reached the server. An open run with this
   * set cannot be played again from its first tick: starting again closes it
   * and settles it from what it committed.
   */
  readonly committed: boolean
  /**
   * Set once a replay has run. `fault` is null when it agreed, and then
   * `counters` and `endTick` are what it computed, which is what a board row
   * is written from. A run settled with nothing to replay, because what it
   * committed reached no tick, has neither. `code` names a log fault's cause.
   */
  readonly replay: {
    readonly fault: RunFault | null
    readonly code: string | null
    readonly counters: Readonly<Record<string, number>> | null
    readonly endTick: number | null
  } | null
}

/**
 * `GET /v1/runs/:id`: a settled run, with what a page module needs to play it
 * back. A run from a day still open is its player's alone; to anybody else,
 * as for a run that does not exist or has not settled, the answer is
 * `E_NOT_FOUND`. `inputs` are the engine's own input events, which the
 * engine reads.
 */
export interface WatchedRun {
  readonly sessionId: string
  readonly gameSlug: string
  readonly gameTitle: string
  readonly gameVersionId: string
  readonly day: string
  readonly counters: Readonly<Record<string, number>> | null
  readonly endTick: number | null
  readonly tickHz: number
  readonly seed: string
  readonly config: unknown
  readonly inputs: readonly unknown[]
  /** The run's own version's page module, absolute. */
  readonly presentUrl: string
  /** The run's own version's manifest hash, which its page module must report. */
  readonly manifestHash: string
  /** The run's own version's files folder, absolute, ending in `/`. */
  readonly filesUrl: string
  /**
   * How many ticks to replay: the validator's `max(endTick, 1)`, so an
   * abandoned run stops where its player left it. Null when the run has
   * nothing to replay.
   */
  readonly replayTicks: number | null
}

/**
 * What a route needs. `page-key`: the page key in `x-vbz-key`, from one of the
 * game's allowed pages, and a player token in `Authorization: Bearer` where
 * the route reads one. `player`: both, the token required. `secret-key`: a
 * studio's secret key in `Authorization: Bearer`, never from a browser.
 * `public`: neither header.
 */
export type RouteAuth = "page-key" | "player" | "secret-key" | "public"

/**
 * Every public route, keyed by method and path, with what it takes and what
 * it answers. A path parameter is written `:name`.
 */
export interface PlatformRoutes {
  readonly "GET /v1/game": {
    readonly auth: "page-key"
    readonly body: never
    readonly response: PageGame
  }
  readonly "POST /v1/games/:gameId/versions": {
    readonly auth: "secret-key"
    /** Multipart: `manifest` (JSON), `sim` and `present` (JavaScript). */
    readonly body: "multipart"
    readonly response: UploadedVersion
  }
  readonly "GET /v1/studios/:studioId/games/:gameId/versions": {
    readonly auth: "secret-key"
    readonly body: never
    readonly response: VersionStatusList
  }
  readonly "GET /v1/studios/:studioId/versions/:versionId": {
    readonly auth: "secret-key"
    readonly body: never
    readonly response: VersionStatus
  }
  readonly "POST /v1/oauth/token": {
    /** No key header: the page key travels in the body, as `clientId`. */
    readonly auth: "public"
    readonly body: TokenRequest
    readonly response: SignedInPlayer
  }
  readonly "POST /v1/runs": {
    readonly auth: "player"
    readonly body: StartRunRequest
    readonly response: StartedRun
  }
  readonly "POST /v1/runs/:id/chunks": {
    readonly auth: "player"
    readonly body: RunChunk
    readonly response: ChunkAccepted
  }
  readonly "POST /v1/runs/:id/submit": {
    readonly auth: "player"
    readonly body: { readonly recording: unknown }
    readonly response: SubmittedRun
  }
  readonly "GET /v1/runs/:id/result": {
    readonly auth: "player"
    readonly body: never
    readonly response: RunResult
  }
  readonly "GET /v1/runs/:id": {
    readonly auth: "page-key"
    readonly body: never
    readonly response: WatchedRun
  }
  readonly "GET /v1/board": {
    readonly auth: "page-key"
    readonly body: never
    readonly response: Board
  }
}

export type PlatformRoute = keyof PlatformRoutes

/**
 * `PlatformRoutes`, held to its own shape: this fails to compile when a route
 * names an `auth` that `RouteAuth` does not.
 */
export type CheckedRoutes = HeldTo<PlatformRoutes>
type HeldTo<
  T extends {
    readonly [Route in keyof T]: {
      readonly auth: RouteAuth
      readonly response: unknown
    }
  },
> = T
