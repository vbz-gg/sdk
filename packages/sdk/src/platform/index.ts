/**
 * A game page's client for the vbz.gg platform.
 *
 * Plain modules with no DOM at load time: a page's bundle may import this
 * while rendering on a server, and the browser is read only when a client is
 * made. The engine and the page module's contract are imported for their
 * types alone, so this subpath adds no engine code to a bundle.
 */

export {
  byteLengthOf,
  type ChunkBody,
  type ChunkReach,
  splitChunk,
  throughTickFor,
} from "./chunks.js"
export {
  type BoardOptions,
  createPlatformClient,
  isFinalResult,
  type PlatformClient,
  type PlatformClientOptions,
  RESULT_INTERVAL_MS,
  type ResultOptions,
  type RunRecording,
} from "./client.js"
export {
  browserEnvironment,
  type MessageLike,
  type PageEnvironment,
  type PopupWindow,
} from "./environment.js"
export {
  CLIENT_ERROR,
  type ClientErrorCode,
  PlatformClientError,
  PlatformRefusal,
  worthRetrying,
} from "./errors.js"
export {
  type KeptPlayer,
  keptPlayerKey,
  type PlayerStore,
  storagePlayerStore,
} from "./kept.js"
export type {
  PageRoute,
  Requester,
  RequestOptions,
} from "./request.js"
export {
  CHUNK_SECONDS,
  type MountRun,
  RUN_PHASE,
  Run,
  type RunOptions,
  type RunPhase,
  type RunState,
  SUBMIT_ATTEMPTS,
  SUBMIT_RETRY_MS,
} from "./run.js"
export {
  CLOSED_GRACE_MS,
  CLOSED_POLL_MS,
} from "./signin.js"
