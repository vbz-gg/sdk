/**
 * Watching a settled run on a studio's page: its own version's page module,
 * replaying its own inputs to where its replay stopped.
 */

import type { InputEvent, PlainValue } from "@clockwork2/engine"
import type { WatchedRun } from "../api/index.js"
import type { MountHandle, MountHandlers } from "../game/contract.js"
import type { PlatformClient } from "../platform/client.js"
import { PlatformClientError } from "../platform/errors.js"
import { type GameAddress, type LoadedGame, loadGame } from "./load.js"

export interface WatchOptions {
  readonly client: Pick<PlatformClient, "watch">
  /** The run's session id, as a board row names it. */
  readonly runId: string
  /** What the replay reports. Each is optional for a page that only shows it. */
  readonly handlers?: Partial<MountHandlers>
  /** For a test: loads the run's module. `loadGame` by default. */
  readonly load?: (address: GameAddress) => Promise<LoadedGame>
}

export interface WatchedGame {
  readonly run: WatchedRun
  readonly game: LoadedGame
  readonly handle: MountHandle
  /** Stops the replay and takes the presentation down. */
  destroy(): void
}

/**
 * Reads the run, loads its own version's module and replays it in `element`.
 *
 * Refuses, before anything is drawn, with the platform's refusal for a run it
 * will not show, `E_NOTHING_TO_WATCH` for a run whose replay covers no ticks,
 * and whatever `loadGame` refuses, `E_WRONG_GAME` among them for a module
 * that is not the run's. Once the replay is mounted, a failure arrives at
 * `handlers.onError`. The replay stops at `replayTicks`, where the platform's
 * own replay stopped, so an abandoned run ends where its player left it.
 */
export async function watchRun(
  element: HTMLElement,
  options: WatchOptions,
): Promise<WatchedGame> {
  const run = await options.client.watch(options.runId)
  if (run.replayTicks === null) {
    throw new PlatformClientError("E_NOTHING_TO_WATCH", {
      cause: { runId: run.sessionId },
    })
  }
  const game = await (options.load ?? loadGame)({
    presentUrl: run.presentUrl,
    manifestHash: run.manifestHash,
  })
  const given = options.handlers ?? {}
  const handle = game.mount(element, {
    mode: "watch",
    seed: run.seed,
    // Plain JSON from the platform; the engine checks the inputs' shape
    // before a tick runs, and reports what it refuses at `onError`.
    config: run.config as PlainValue,
    inputs: run.inputs as readonly InputEvent[],
    tickHz: run.tickHz,
    maxTicks: run.replayTicks,
    expect: { manifestHash: run.manifestHash },
    handlers: {
      onCheckpoint: (checkpoint) => given.onCheckpoint?.(checkpoint),
      onFrame: (frame) => given.onFrame?.(frame),
      onEnded: (ended) => given.onEnded?.(ended),
      onError: (error) => given.onError?.(error),
      onNotice: (notice) => given.onNotice?.(notice),
    },
  })
  return { run, game, handle, destroy: () => handle.destroy() }
}
