/**
 * `vbz publish`: upload what `vbz build` wrote, then wait for the platform's
 * verdict.
 *
 * It is meant for a studio's build system, so everything it needs comes from
 * flags and the environment, and its exit code is the verdict: 0 when the
 * version passed its checks and is published, with which runs it serves
 * printed, and 1 for anything else, a version an operator took down included.
 * It prints the release line a version joined, and a refusal's `detail` where
 * the platform gives one, such as which fixed fields a patch changed. The
 * studio's secret key is read from the environment only. A flag would put it
 * in shell history and in the process list, where anybody on the machine can
 * read it.
 *
 * A version's files go first. The command sends the listing `vbz build`
 * wrote, with the version's manifest beside it, and asks which of its files
 * the platform lacks. The platform answers the version's own refusals
 * first, its version number, a patch that changes its line's rules, the
 * studio's quota, so a version it would refuse uploads nothing. Then the
 * command uploads each missing file in a request of its own, and only then
 * the version, with the listing beside its manifest and its two modules. A
 * file is stored under the SHA-256 of its bytes, so a file whose answer was
 * lost is safe to send again. A publish can still stop between the files
 * and the version, or the upload be refused after them because another
 * version arrived first; files stored ahead of a version that never arrives
 * are removed by the platform a day later, as nothing names them.
 *
 * Every decision is here rather than in the entry point, because the entry
 * point is excluded from the coverage floor.
 */

import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type {
  ApiErrorBody,
  FilesListing,
  FilesMissingDetail,
  MissingFiles,
  PageKey,
  PatchChangesRulesDetail,
  PlatformRoutes,
  PublicRefusalCode,
  SecretKey,
  StoredFile,
  UploadedVersion,
  VersionNotNewerDetail,
  VersionServing,
  VersionState,
  VersionStatus,
} from "../api/index.js"
import { sha256Hex } from "../build/digest.js"
import { DIST_DIR, DIST_FILES, DIST_FILES_DIR } from "../build/dist.js"
import { BuildRefusal } from "../build/errors.js"
import { assertListing, listingSha256 } from "../build/files.js"
import {
  CHECKS_CONTAINER_WAIT_MS,
  REPLAY_ANSWER_MARGIN_MS,
  REPLAY_WALL_BUDGET_MS,
} from "../build/limits.js"
import { SHA256 } from "../build/paths.js"

/**
 * The platform's API, unless a flag or the environment names another.
 * `https://studio.vbz.gg` is the studio dashboard, not the API.
 */
export const DEFAULT_API_ORIGIN = "https://api.vbz.gg"

/** The environment variable holding the studio's secret key. */
export const STUDIO_KEY_VARIABLE = "VBZ_STUDIO_KEY"

/** The environment variable naming another platform, under `--api`. */
export const API_ORIGIN_VARIABLE = "VBZ_API_ORIGIN"

/** How long between two reads of a version still being checked. */
export const CHECK_POLL_MS = 2_000

/** A minute, the unit the wait for a verdict is rounded up to and printed in. */
const MINUTE_MS = 60_000

/**
 * What the wait for a verdict allows the version's ingest job to sit in the
 * platform's queue before a worker claims it: 10 minutes. An allowance, not
 * a measurement.
 */
export const CHECK_QUEUE_ALLOWANCE_MS = 10 * MINUTE_MS

/**
 * What it allows for copying a published version's two modules and files
 * folder to the public store, which the platform does before it writes the
 * verdict: 5 minutes, for a folder of up to 10,000 files and 512 MiB. An
 * allowance, not a measurement: the platform has not timed the copy.
 */
export const CHECK_PUBLISH_ALLOWANCE_MS = 5 * MINUTE_MS

/** Headroom over every part of the wait, so it is never the worst case to the second. */
export const CHECK_WAIT_HEADROOM_MS = MINUTE_MS

/**
 * A wait for a verdict made of `parts` and the headroom, rounded up to
 * whole minutes, so it is never shorter than its parts and prints as a
 * whole number of minutes.
 */
export function checkWaitOf(parts: readonly number[]): number {
  const total = parts.reduce((sum, part) => sum + part, CHECK_WAIT_HEADROOM_MS)
  return Math.ceil(total / MINUTE_MS) * MINUTE_MS
}

/**
 * How long to wait for the checks' verdict before giving up on the answer,
 * from the upload's answer: the queue's allowance; the checks container, for
 * as long as the platform waits for one (`CHECKS_CONTAINER_WAIT_MS`); one
 * replay on the replay service, for its whole `REPLAY_WALL_BUDGET_MS` and the
 * `REPLAY_ANSWER_MARGIN_MS` the platform waits past it for the answer; the
 * copy to the public store; and the headroom, rounded up to whole minutes.
 * The platform takes those waits and that budget from `/build`, so a change
 * to any of them moves this.
 *
 * The replays share that one allowance. The replay-service check runs the
 * rules code for a few steps, and beside it the platform replays a patch
 * against at most `PATCH_SCORE_RUNS` of its line's recent ranked runs, each
 * a replay held to the same budget. Both finish before the verdict, so a
 * patch's scores arrive with it and are printed with it.
 *
 * It covers one attempt. When the replay service gives no answer the
 * platform holds the replay to its whole wall budget and its margin, then
 * runs the version's job again, half a minute later at the soonest, which
 * this does not wait for.
 *
 * A version still pending after this is still being checked: the command
 * says so in the platform's terms, names where to read it later, and exits
 * 1, because only a published version exits 0.
 */
export const CHECK_WAIT_MS = checkWaitOf([
  CHECK_QUEUE_ALLOWANCE_MS,
  CHECKS_CONTAINER_WAIT_MS,
  REPLAY_WALL_BUDGET_MS,
  REPLAY_ANSWER_MARGIN_MS,
  CHECK_PUBLISH_ALLOWANCE_MS,
])

/** How long one upload, of the version or of one file, may take to be answered. */
export const UPLOAD_TIMEOUT_MS = 120_000

/**
 * How many times the command tries a request that is safe to send again,
 * asking which files the platform lacks and uploading one, before it stops.
 */
export const FILE_ATTEMPTS = 4

/** How long between two tries of one of those. */
export const FILE_RETRY_MS = 2_000

/** How long one read of a version may take to be answered. */
export const READ_TIMEOUT_MS = 30_000

/**
 * The prefixes that say which kind a key is. Each is held to the key types in
 * `@vbz-gg/sdk/api` below, so a prefix that moved there fails to compile here
 * rather than refusing every real key.
 */
export const SECRET_KEY_PREFIX = "vbz_sk_"
export const PAGE_KEY_PREFIX = "vbz_pk_"
const _secretKeyPrefixHeld: SecretKey = `${SECRET_KEY_PREFIX}held`
const _pageKeyPrefixHeld: PageKey = `${PAGE_KEY_PREFIX}held`
void _secretKeyPrefixHeld
void _pageKeyPrefixHeld

/** Why a publish stopped. Each code names one thing to fix or to check. */
export const PUBLISH_ERROR = {
  /** No `--game`. */
  NO_GAME: "E_PUBLISH_NO_GAME",
  /** `VBZ_STUDIO_KEY` is unset or empty. */
  NO_KEY: "E_PUBLISH_NO_KEY",
  /** The key is not a studio's secret key. */
  NOT_A_SECRET_KEY: "E_PUBLISH_NOT_A_SECRET_KEY",
  /** The platform's origin is not one a key may be sent to. */
  BAD_API_ORIGIN: "E_PUBLISH_BAD_API_ORIGIN",
  /** `dist/` is missing a file `vbz build` writes, or holds one it did not write. */
  NOT_BUILT: "E_PUBLISH_NOT_BUILT",
  /** The platform did not answer. */
  UNREACHABLE: "E_PUBLISH_UNREACHABLE",
  /** The platform answered with something that is not the route's answer. */
  ANSWER_UNREADABLE: "E_PUBLISH_ANSWER_UNREADABLE",
  /** The platform refused, with a code of its own. */
  REFUSED: "E_PUBLISH_REFUSED",
  /** The checks had not finished when the command stopped waiting. */
  STILL_CHECKING: "E_PUBLISH_STILL_CHECKING",
} as const

export type PublishErrorCode =
  (typeof PUBLISH_ERROR)[keyof typeof PUBLISH_ERROR]

/** What a `PublishError` says beyond its code and its sentence, each when there is one. */
export interface PublishErrorOptions {
  /** The platform's own code, when it refused. */
  readonly refusal?: string | undefined
  /** The HTTP status the platform answered with, when it answered. */
  readonly status?: number | undefined
  /** What the refusal was about, when the platform said. */
  readonly detail?: Readonly<Record<string, unknown>> | undefined
  /** What to do next, a line each, printed after the reason. */
  readonly next?: readonly string[] | undefined
}

export class PublishError extends Error {
  override readonly name = "PublishError"
  readonly refusal: string | undefined
  readonly status: number | undefined
  readonly detail: Readonly<Record<string, unknown>> | undefined
  readonly next: readonly string[]

  constructor(
    readonly code: PublishErrorCode,
    message: string,
    options: PublishErrorOptions = {},
  ) {
    const { refusal } = options
    super(`${message} (${code}${refusal === undefined ? "" : `, ${refusal}`})`)
    this.refusal = refusal
    this.status = options.status
    this.detail = options.detail
    this.next = options.next ?? []
  }
}

export interface PublishSettings {
  /** The game's directory; the upload is its `dist/`. */
  readonly dir: string
  readonly gameId: string
  /** An origin: scheme, host and port, nothing after. */
  readonly apiOrigin: string
  readonly key: SecretKey
}

/** What the command line and the environment said, before any of it is checked. */
export interface PublishInput {
  readonly dir: string
  readonly game: string | undefined
  readonly api: string | undefined
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
])

/**
 * Checks everything a publish needs before anything is read or sent.
 *
 * The origin is `--api`, else `VBZ_API_ORIGIN`, else the default. It has to
 * be https, because the request carries the studio's secret key; plain http
 * is allowed only to this machine, which is how the platform is run locally.
 */
export function publishSettings(
  input: PublishInput,
  env: Readonly<Record<string, string | undefined>>,
): PublishSettings {
  const gameId = input.game?.trim() ?? ""
  if (gameId === "") {
    throw new PublishError(
      PUBLISH_ERROR.NO_GAME,
      "say which game to publish to with --game <id>; the dashboard shows each game's id",
    )
  }
  return {
    dir: input.dir,
    gameId,
    apiOrigin: apiOriginOf(
      input.api ??
        setOrUndefined(env[API_ORIGIN_VARIABLE]) ??
        DEFAULT_API_ORIGIN,
    ),
    key: secretKeyOf(env[STUDIO_KEY_VARIABLE]),
  }
}

/**
 * A variable set to nothing reads as unset, as a CI system's optional
 * variable usually is. A flag given with nothing is still an error: somebody
 * typed it.
 */
function setOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? ""
  return trimmed === "" ? undefined : trimmed
}

function secretKeyOf(raw: string | undefined): SecretKey {
  const key = raw?.trim() ?? ""
  if (key === "") {
    throw new PublishError(
      PUBLISH_ERROR.NO_KEY,
      `set ${STUDIO_KEY_VARIABLE} to one of the studio's secret keys; it is read from the environment only, so it stays out of shell history`,
    )
  }
  if (!key.startsWith(SECRET_KEY_PREFIX)) {
    throw new PublishError(
      PUBLISH_ERROR.NOT_A_SECRET_KEY,
      key.startsWith(PAGE_KEY_PREFIX)
        ? `${STUDIO_KEY_VARIABLE} holds a page key, which may not upload; use one of the studio's secret keys`
        : `${STUDIO_KEY_VARIABLE} does not hold a studio's secret key, which starts ${SECRET_KEY_PREFIX}`,
    )
  }
  return key as SecretKey
}

function apiOriginOf(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw badOrigin(raw, "it is not a URL")
  }
  const secure =
    url.protocol === "https:" ||
    (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
  if (!secure) {
    throw badOrigin(
      raw,
      "the request carries the studio's secret key, so it must be https, or http to this machine",
    )
  }
  if (
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw badOrigin(raw, "give the origin alone, with no path, query or login")
  }
  return url.origin
}

function badOrigin(raw: string, why: string): PublishError {
  return new PublishError(
    PUBLISH_ERROR.BAD_API_ORIGIN,
    `the platform origin ${JSON.stringify(raw)} cannot be used: ${why}`,
  )
}

/**
 * What an upload carries, as the bytes `vbz build` wrote: the version's
 * manifest, its two modules and its folder's listing. The folder's files
 * are read one at a time, only when the platform lacks them.
 */
export interface BuiltGame {
  readonly manifest: Uint8Array<ArrayBuffer>
  readonly sim: Uint8Array<ArrayBuffer>
  readonly present: Uint8Array<ArrayBuffer>
  /** `dist/files.json`, as written. */
  readonly listingText: Uint8Array<ArrayBuffer>
  readonly listing: FilesListing
}

/** Reads `dist/`, naming a file that is missing. */
export async function readBuild(dir: string): Promise<BuiltGame> {
  const dist = join(dir, DIST_DIR)
  const read = (name: string) => readBuilt(join(dist, name))
  const [manifest, sim, present, listingText] = await Promise.all([
    read(DIST_FILES.manifest),
    read(DIST_FILES.sim),
    read(DIST_FILES.present),
    read(DIST_FILES.listing),
  ])
  return {
    manifest,
    sim,
    present,
    listingText,
    listing: listingOf(listingText, join(dist, DIST_FILES.listing)),
  }
}

/** One file `vbz build` wrote, or `E_PUBLISH_NOT_BUILT` naming it. */
async function readBuilt(path: string): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return new Uint8Array(await readFile(path))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new PublishError(
        PUBLISH_ERROR.NOT_BUILT,
        `${path} is missing; run vbz build first`,
      )
    }
    throw error
  }
}

/** `dist/manifest.json`, parsed, or `E_PUBLISH_NOT_BUILT`. */
function manifestOf(text: Uint8Array, dir: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(text)) as unknown
  } catch (error) {
    throw new PublishError(
      PUBLISH_ERROR.NOT_BUILT,
      `${join(dir, DIST_DIR, DIST_FILES.manifest)} is not JSON (${(error as Error).message}); run vbz build again`,
    )
  }
}

function listingOf(text: Uint8Array, path: string): FilesListing {
  try {
    return assertListing(JSON.parse(new TextDecoder().decode(text)) as unknown)
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof BuildRefusal) {
      throw new PublishError(
        PUBLISH_ERROR.NOT_BUILT,
        `${path} is not a listing vbz build writes (${error.message}); run vbz build again`,
      )
    }
    throw error
  }
}

/** What a publish needs from the world, so a test can stand in for each. */
export interface PublishDeps {
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>
  readonly sleep: (ms: number) => Promise<void>
  readonly now: () => number
  /** One line of progress, for a person watching a build log. */
  readonly log: (line: string) => void
}

type ResponseOf<Route extends keyof PlatformRoutes> =
  PlatformRoutes[Route]["response"]

/**
 * Uploads `dist/` and waits until the checks decide.
 *
 * The upload is sent once. A retried upload of a version that did arrive is
 * refused as `E_VERSION_EXISTS`, which would turn a slow answer into a
 * confusing one. Reading the verdict back is safe to repeat, so a read the
 * platform fails to answer is tried again until the wait runs out.
 */
export async function publish(
  settings: PublishSettings,
  deps: PublishDeps,
): Promise<VersionStatus> {
  const built = await readBuild(settings.dir)
  deps.log(`uploading ${join(settings.dir, DIST_DIR)} to ${settings.apiOrigin}`)
  await uploadFiles(settings, deps, built)

  // Every part is a file, sent as its bytes. A text part is not: an encoder
  // following the HTML standard, as Bun 1.4's and Node's do, rewrites each
  // line feed in one as CRLF, and Bun 1.3's did not.
  const form = new FormData()
  form.append(
    "manifest",
    new Blob([built.manifest], { type: "application/json" }),
    DIST_FILES.manifest,
  )
  form.append(
    "sim",
    new Blob([built.sim], { type: "text/javascript" }),
    DIST_FILES.sim,
  )
  form.append(
    "present",
    new Blob([built.present], { type: "text/javascript" }),
    DIST_FILES.present,
  )
  form.append(
    "files",
    new Blob([built.listingText], { type: "application/json" }),
    DIST_FILES.listing,
  )

  const uploaded: ResponseOf<"POST /v1/games/:gameId/versions"> = asUploaded(
    await call(deps, `${gameUrl(settings)}/versions`, {
      method: "POST",
      headers: headersFor(settings),
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    }),
  )
  deps.log(
    `uploaded version ${uploaded.version} as ${uploaded.gameVersionId}, in release line ${uploaded.line}; the platform is checking it`,
  )

  const versionUrl = `${settings.apiOrigin}/v1/studios/${encodeURIComponent(uploaded.studioId)}/versions/${encodeURIComponent(uploaded.gameVersionId)}`
  const started = deps.now()
  for (;;) {
    const status = await readStatus(deps, settings, versionUrl)
    if (status !== undefined && status.state !== "pending") return status
    if (deps.now() - started >= CHECK_WAIT_MS) {
      throw stillChecking(uploaded, versionUrl)
    }
    await deps.sleep(CHECK_POLL_MS)
  }
}

/**
 * A version the checks had not decided when the wait ran out, in the
 * platform's terms: its state is `pending`, the platform has it, and its
 * verdict is read from the route the command was polling. Publishing the
 * same version again would be refused, so the log says not to.
 */
function stillChecking(
  uploaded: UploadedVersion,
  versionUrl: string,
): PublishError {
  return new PublishError(
    PUBLISH_ERROR.STILL_CHECKING,
    `version ${uploaded.version} (${uploaded.gameVersionId}) is still pending after ${CHECK_WAIT_MS / MINUTE_MS} minutes: the platform has it and its checks have not decided, so this exits 1 with no verdict`,
    {
      next: [
        `read its state later with the studio's secret key, GET ${versionUrl}: pending until the checks decide, then published or rejected`,
        `do not publish ${uploaded.version} again: the platform has it, and a second upload is refused as E_VERSION_EXISTS`,
      ],
    },
  )
}

function gameUrl(settings: PublishSettings): string {
  return `${settings.apiOrigin}/v1/games/${encodeURIComponent(settings.gameId)}`
}

/**
 * Makes sure the platform holds every file of the version's folder: asks
 * which it lacks, then uploads each of those, one request a file. Both are
 * safe to send again, so each is tried again when the platform did not
 * answer or asked for time.
 */
async function uploadFiles(
  settings: PublishSettings,
  deps: PublishDeps,
  built: BuiltGame,
): Promise<void> {
  const { listing } = built
  const question: PlatformRoutes["POST /v1/games/:gameId/files/missing"]["body"] =
    { manifest: manifestOf(built.manifest, settings.dir), files: listing.files }
  const body = JSON.stringify(question)
  const asked: ResponseOf<"POST /v1/games/:gameId/files/missing"> = await tried(
    deps,
    "asking which files the platform lacks",
    async () =>
      asMissing(
        await call(deps, `${gameUrl(settings)}/files/missing`, {
          method: "POST",
          headers: {
            ...headersFor(settings),
            "content-type": "application/json",
          },
          body,
          signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        }),
        listing,
      ),
  )
  const count = listing.files.length
  deps.log(
    `files: ${count} in the folder, named ${asked.filesSha256}; the platform lacks ${asked.missing.length}`,
  )
  const folder = join(settings.dir, DIST_DIR, DIST_FILES_DIR)
  for (const sha256 of asked.missing) {
    // `asMissing` holds every name to one the listing has.
    const file = listing.files.find((entry) => entry.sha256 === sha256)
    if (file === undefined) throw new Error(`${sha256} is not listed`)
    const path = join(folder, ...file.path.split("/"))
    const bytes = await readBuilt(path)
    if (sha256Hex(bytes) !== sha256) {
      throw new PublishError(
        PUBLISH_ERROR.NOT_BUILT,
        `${path} is not the file ${DIST_FILES.listing} lists; run vbz build again`,
      )
    }
    await tried(deps, `uploading ${file.path}`, async () =>
      asStored(
        await call(
          deps,
          `${gameUrl(settings)}/files/${encodeURIComponent(sha256)}`,
          {
            method: "PUT",
            headers: {
              ...headersFor(settings),
              "content-type": "application/octet-stream",
            },
            body: bytes,
            signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
          },
        ),
        sha256,
        bytes.byteLength,
      ),
    )
    deps.log(`uploaded ${file.path}, ${bytes.byteLength} bytes`)
  }
}

/**
 * `attempt`, tried again a pause apart when the platform did not answer or
 * asked for time, at most `FILE_ATTEMPTS` times. Only for a request that is
 * safe to send twice.
 */
async function tried<T>(
  deps: PublishDeps,
  what: string,
  attempt: () => Promise<T>,
): Promise<T> {
  for (let tries = 1; ; tries += 1) {
    try {
      return await attempt()
    } catch (error) {
      if (
        !(error instanceof PublishError) ||
        !worthTryingAgain(error) ||
        tries >= FILE_ATTEMPTS
      ) {
        throw error
      }
      deps.log(
        `${what}: the platform did not answer; trying again (${error.message})`,
      )
      await deps.sleep(FILE_RETRY_MS)
    }
  }
}

/**
 * The platform's answer about which files it lacks, held to the listing it
 * was asked about: it names the folder as `vbz build` did, and asks only for
 * files the listing has. A name that differs means the two disagree about
 * the folder, and the version would not be the one built.
 */
function asMissing(value: unknown, listing: FilesListing): MissingFiles {
  const listed = new Set(listing.files.map((file) => file.sha256))
  if (
    !isRecord(value) ||
    typeof value.filesSha256 !== "string" ||
    !isStrings(value.missing) ||
    !value.missing.every((sha256) => listed.has(sha256))
  ) {
    throw new PublishError(
      PUBLISH_ERROR.ANSWER_UNREADABLE,
      "the platform's answer about which files it lacks is not one naming files the listing has",
    )
  }
  const named = listingSha256(listing)
  if (value.filesSha256 !== named) {
    throw new PublishError(
      PUBLISH_ERROR.ANSWER_UNREADABLE,
      `the platform names the files folder ${value.filesSha256}, and vbz build named it ${named}`,
    )
  }
  return { filesSha256: value.filesSha256, missing: value.missing }
}

/** The answer to one file's upload, which has to be that file. */
function asStored(value: unknown, sha256: string, bytes: number): StoredFile {
  if (isRecord(value) && value.sha256 === sha256 && value.bytes === bytes) {
    return { sha256, bytes }
  }
  throw new PublishError(
    PUBLISH_ERROR.ANSWER_UNREADABLE,
    `the platform's answer to the upload of ${sha256} does not name that file and its ${bytes} bytes`,
  )
}

/**
 * One read of the version, or undefined when the platform failed to answer
 * and the read is worth trying again. A refusal the platform meant, such as a
 * revoked key, stops the publish.
 */
async function readStatus(
  deps: PublishDeps,
  settings: PublishSettings,
  url: string,
): Promise<
  ResponseOf<"GET /v1/studios/:studioId/versions/:versionId"> | undefined
> {
  try {
    return asStatus(
      await call(deps, url, {
        method: "GET",
        headers: headersFor(settings),
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      }),
    )
  } catch (error) {
    if (error instanceof PublishError && worthTryingAgain(error)) {
      deps.log(
        `the platform did not answer the read; trying again (${error.message})`,
      )
      return undefined
    }
    throw error
  }
}

/** An answer meaning "not now" rather than "no": asked to slow down. */
const TOO_MANY_REQUESTS = 429

/**
 * Refusals answered with that status that mean "no" for longer than a
 * publish waits: the studio's uploads for the last 24 hours are used up,
 * which the question about files answers before anything goes up.
 */
const NOT_WORTH_WAITING_FOR: ReadonlySet<string> = new Set<PublicRefusalCode>([
  "E_QUOTA_EXCEEDED",
])

function worthTryingAgain(error: PublishError): boolean {
  if (error.code === PUBLISH_ERROR.UNREACHABLE) return true
  if (error.refusal !== undefined && NOT_WORTH_WAITING_FOR.has(error.refusal))
    return false
  return (
    error.status !== undefined &&
    (error.status >= 500 || error.status === TOO_MANY_REQUESTS)
  )
}

function headersFor(settings: PublishSettings): Record<string, string> {
  return {
    authorization: `Bearer ${settings.key}`,
    accept: "application/json",
  }
}

/**
 * One request, answered with its parsed body, or a `PublishError` naming
 * what went wrong: no answer, a refusal with the platform's code, or an
 * answer that is not JSON.
 */
async function call(
  deps: PublishDeps,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  // The body is read inside the same guard as the request: the timeout covers
  // both, and an answer that breaks off halfway is no more an answer than one
  // that never started.
  let response: Response
  let text: string
  try {
    response = await deps.fetch(url, init)
    text = await response.text()
  } catch (error) {
    throw new PublishError(
      PUBLISH_ERROR.UNREACHABLE,
      `no answer from ${new URL(url).origin}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  let body: unknown
  try {
    body = JSON.parse(text) as unknown
  } catch {
    throw new PublishError(
      PUBLISH_ERROR.ANSWER_UNREADABLE,
      `the platform answered ${response.status} with something that is not JSON`,
      { status: response.status },
    )
  }
  if (!response.ok) {
    if (isErrorBody(body)) {
      throw new PublishError(
        PUBLISH_ERROR.REFUSED,
        `the platform refused: ${body.message}`,
        { refusal: body.error, status: response.status, detail: body.detail },
      )
    }
    throw new PublishError(
      PUBLISH_ERROR.ANSWER_UNREADABLE,
      `the platform answered ${response.status} without saying why`,
      { status: response.status },
    )
  }
  return body
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    isRecord(value) &&
    typeof value.error === "string" &&
    typeof value.message === "string" &&
    (value.detail === undefined || isRecord(value.detail))
  )
}

/**
 * The upload's answer, which has to name the version and its studio for the
 * verdict to be read back. When it does not, the version was still stored,
 * so the error names it: sending the same build again would be refused as a
 * version that exists.
 */
function asUploaded(value: unknown): UploadedVersion {
  if (
    isRecord(value) &&
    typeof value.gameVersionId === "string" &&
    typeof value.studioId === "string" &&
    typeof value.version === "string" &&
    typeof value.line === "string"
  ) {
    return value as unknown as UploadedVersion
  }
  const stored =
    isRecord(value) && typeof value.gameVersionId === "string"
      ? ` It was stored as ${value.gameVersionId}; its verdict is on the dashboard.`
      : ""
  throw new PublishError(
    PUBLISH_ERROR.ANSWER_UNREADABLE,
    `the platform accepted the upload but its answer does not name the version and its studio, so the verdict cannot be read back.${stored}`,
  )
}

const VERSION_STATES: ReadonlySet<string> = new Set<VersionState>([
  "pending",
  "rejected",
  "published",
])

const RANKED_SERVING: ReadonlySet<string> = new Set<VersionServing["ranked"]>([
  "today",
  "from-next-seed",
  "none",
])

/**
 * A version's state, checked in every field the verdict reads. A missing
 * `suspended` would otherwise read as served, a missing `serving` would print
 * nothing about which runs play it, a missing `firstFailure` would crash the
 * line that prints it, and a `patchScores` that is not two counts would
 * print a measurement the platform never made.
 */
function asStatus(value: unknown): VersionStatus {
  if (
    isRecord(value) &&
    typeof value.gameVersionId === "string" &&
    typeof value.version === "string" &&
    typeof value.line === "string" &&
    typeof value.state === "string" &&
    VERSION_STATES.has(value.state) &&
    typeof value.suspended === "boolean" &&
    isRecord(value.serving) &&
    typeof value.serving.ranked === "string" &&
    RANKED_SERVING.has(value.serving.ranked) &&
    typeof value.serving.practice === "boolean" &&
    (value.rejectedCode === null || typeof value.rejectedCode === "string") &&
    (value.firstFailure === null || isFailure(value.firstFailure)) &&
    (value.patchScores === null || isPatchScores(value.patchScores))
  ) {
    return value as unknown as VersionStatus
  }
  throw new PublishError(
    PUBLISH_ERROR.ANSWER_UNREADABLE,
    "the platform's answer about the version is not a version's state",
  )
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isPatchScores(value: unknown): boolean {
  if (!isRecord(value)) return false
  const { compared, differing } = value
  return isCount(compared) && isCount(differing) && differing <= compared
}

function isFailure(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.check === "string" &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  )
}

/** What to print for a decided version, and the exit code it means. */
export interface Verdict {
  readonly lines: readonly string[]
  readonly exitCode: 0 | 1
}

/** Which runs a published version serves, as a build log says it. */
const RANKED_LINES: Readonly<Record<VersionServing["ranked"], string>> = {
  today:
    "ranked runs: today's, from the next start, since it is the highest published patch of the day's release line",
  "from-next-seed":
    "ranked runs: from the next day's seed, which pins its line; today's ranked runs stay on the day's line",
  none: "ranked runs: none, because its line is not the day's and a newer line is published, or a higher patch of its line is",
}

function practiceLine(practice: boolean): string {
  return practice
    ? "practice runs: from the next start, since it is the newest playable version"
    : "practice runs: none, because a newer version is playable or the game offers no practice"
}

/**
 * What the platform measured of a published version against its line's
 * recent ranked runs, in its own terms, or nothing when it has not measured
 * it. The count decides nothing; it is printed for the studio to read.
 */
function patchScoreLines(status: VersionStatus): string[] {
  const scores = status.patchScores
  if (scores === null) return []
  if (scores.compared === 0) {
    return [
      `patch check: line ${status.line} has no settled ranked runs yet to compare this version with`,
    ]
  }
  const runs = scores.compared === 1 ? "run" : "runs"
  const end = scores.differing === 1 ? "ends" : "end"
  return [
    `patch check: ${scores.differing} of ${scores.compared} recent ranked ${runs} on line ${status.line} ${end} differently under this version`,
  ]
}

/**
 * The verdict a build log shows. A version that passed its checks and is
 * published exits 0, with which runs it serves and what the platform
 * measured of it against its line's runs; one an operator has taken down is
 * published and still exits 1, because no player is served it.
 */
export function verdictOf(status: VersionStatus): Verdict {
  if (status.state === "pending") {
    throw new Error("a version still being checked has no verdict yet")
  }
  if (status.state === "published") {
    if (status.suspended) {
      return {
        lines: [
          `published version ${status.version}, but an operator has taken it down, so no player is served it`,
          ...patchScoreLines(status),
        ],
        exitCode: 1,
      }
    }
    return {
      lines: [
        `published version ${status.version}, in release line ${status.line}`,
        RANKED_LINES[status.serving.ranked],
        practiceLine(status.serving.practice),
        ...patchScoreLines(status),
      ],
      exitCode: 0,
    }
  }
  const lines = [
    `rejected version ${status.version}: ${status.rejectedCode ?? "no code given"}`,
  ]
  if (status.firstFailure !== null) {
    const { check, code, message } = status.firstFailure
    lines.push(`first failure: ${check}, ${code}: ${message}`)
  }
  return { lines, exitCode: 1 }
}

function isStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
}

function isFilesMissing(
  detail: Readonly<Record<string, unknown>>,
): detail is Readonly<Record<string, unknown>> & FilesMissingDetail {
  return (
    isStrings(detail.missing) &&
    detail.missing.every((sha256) => SHA256.test(sha256))
  )
}

function isPatchChangesRules(
  detail: Readonly<Record<string, unknown>>,
): detail is Readonly<Record<string, unknown>> & PatchChangesRulesDetail {
  return (
    typeof detail.line === "string" &&
    typeof detail.comparedWith === "string" &&
    isStrings(detail.fields) &&
    typeof detail.nextMinor === "string"
  )
}

function isVersionNotNewer(
  detail: Readonly<Record<string, unknown>>,
): detail is Readonly<Record<string, unknown>> & VersionNotNewerDetail {
  const versionOrNull = (value: unknown) =>
    value === null || typeof value === "string"
  return (
    versionOrNull(detail.highestInLine) && versionOrNull(detail.highestInGame)
  )
}

/**
 * What a refusal's `detail` says, for the two refusals whose detail tells an
 * author what to do next. Any other detail is printed as the platform sent
 * it, for a log; a detail that is not the shape its code promises is printed
 * that way too, rather than read half right.
 */
function detailLines(
  refusal: string | undefined,
  detail: Readonly<Record<string, unknown>> | undefined,
): string[] {
  if (detail === undefined) return []
  if (refusal === "E_PATCH_CHANGES_RULES" && isPatchChangesRules(detail)) {
    return [
      `release line ${detail.line} fixes ${detail.fields.join(", ")}, as ${detail.comparedWith} set them`,
      `publish these rules as ${detail.nextMinor} instead`,
    ]
  }
  if (refusal === "E_FILES_MISSING" && isFilesMissing(detail)) {
    return [
      `the platform does not hold ${detail.missing.length} of the folder's files: ${detail.missing.join(", ")}; publish again to upload them`,
    ]
  }
  if (refusal === "E_VERSION_NOT_NEWER" && isVersionNotNewer(detail)) {
    return [
      `the highest version in its release line is ${detail.highestInLine ?? "none yet"}, and the highest the game has is ${detail.highestInGame ?? "none yet"}`,
    ]
  }
  return [`detail: ${JSON.stringify(detail)}`]
}

/**
 * What a publish that stopped prints: why, what the platform's detail says,
 * and what to do next.
 */
export function failureLines(error: PublishError): string[] {
  return [
    error.message,
    ...detailLines(error.refusal, error.detail),
    ...error.next,
  ]
}
