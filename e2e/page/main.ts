/**
 * A studio's page, as small as the suite needs one.
 *
 * Everything that touches the game is the SDK's, as on any studio's page:
 * `loadGame` imports a page module from the bundles origin, `playRun` plays a
 * run against the stand-in for the platform inside the Play button's click,
 * and `watchRun` replays a settled one. It is served under the
 * Content-Security-Policy the SDK recommends, naming one game's path.
 *
 * Two ways in. `?game=template` (or `paddle`) plays that game's runs through
 * the stand-in. `?load=<module>` loads one module the server holds by name,
 * such as one built against another copy of the SDK, says what `loadGame`
 * made of it, and plays it straight through its `mount` on a fixed seed, as
 * the harness does. Whatever the page learns is written into the document,
 * where a spec reads it.
 */

import type {
  MountedEnd,
  MountHandle,
} from "../../packages/sdk/src/game/index.js"
import {
  type GameAddress,
  type LoadedGame,
  loadGame,
  type PlayedRun,
  playRun,
  watchRun,
} from "../../packages/sdk/src/host/index.js"
import {
  createPlatformClient,
  type PlatformClientOptions,
  RUN_PHASE,
  type RunState,
} from "../../packages/sdk/src/platform/index.js"

/** A module the server holds, by the name a spec loads it with. */
interface Module extends GameAddress {
  readonly tickHz: number
  readonly maxTicks: number
}

interface StudioConfig
  extends Pick<
    PlatformClientOptions,
    "apiOrigin" | "signInOrigin" | "pageKey"
  > {
  readonly seed: string
  readonly modules: Readonly<Record<string, Module>>
}

const query = new URLSearchParams(location.search)
const subject = query.get("game") ?? "template"
const config = (await (
  await fetch(`/config.json?game=${encodeURIComponent(subject)}`)
).json()) as StudioConfig

function element(id: string): HTMLElement {
  const found = document.getElementById(id)
  if (found === null) throw new Error(`the page has no #${id}`)
  return found
}

const stage = element("stage")
const watchStage = element("watch-stage")
const state = element("state")
const body = document.body

function say(text: string): void {
  state.textContent = text
}

function publish(id: string, value: unknown): void {
  element(id).textContent = JSON.stringify(value)
}

// Every script or connection the policy refused, so a spec can tell a
// module the policy kept out from one that failed for another reason.
const violations: { blockedURI: string; directive: string }[] = []
document.addEventListener("securitypolicyviolation", (event) => {
  violations.push({
    blockedURI: event.blockedURI,
    directive: event.effectiveDirective,
  })
  publish("violations", violations)
})

/** What `loadGame` refused, as the page shows it: the code and its detail. */
function refused(error: unknown): void {
  const { code, cause } = error as { code?: string; cause?: unknown }
  body.dataset.loaded = code ?? "refused"
  say(`${code ?? "refused"}: ${JSON.stringify(cause ?? String(error))}`)
}

function loaded(): void {
  body.dataset.loaded = "ready"
  say("ready")
}

const named = query.get("load")
if (named === null) await runs()
else await one(named)

/** `?load=`: one module, loaded and played on its own. */
async function one(name: string): Promise<void> {
  const module = config.modules[name]
  if (module === undefined) throw new Error(`the server holds no ${name}`)
  let game: LoadedGame | null = null
  let attempts = 0
  const attempt = async () => {
    try {
      game = await loadGame(module)
      loaded()
    } catch (error) {
      refused(error)
    }
    attempts += 1
    body.dataset.attempts = String(attempts)
  }
  element("retry").addEventListener("click", () => void attempt())
  await attempt()

  let playing: MountHandle | null = null
  element("play").addEventListener("click", () => {
    if (game === null) return
    playing?.destroy()
    stage.replaceChildren()
    stage.tabIndex = 0
    stage.focus()
    playing = game.mount(stage, {
      mode: "play",
      seed: config.seed,
      config: {},
      tickHz: module.tickHz,
      maxTicks: module.maxTicks,
      expect: { manifestHash: module.manifestHash },
      handlers: {
        onCheckpoint: () => {},
        onFrame: (frame) => {
          body.dataset.tick = String(frame.tick)
        },
        onEnded: (ended: MountedEnd) => {
          publish("run", ended)
          body.dataset.phase = "ended"
        },
        onError: (error) => {
          body.dataset.phase = "failed"
          say(`${error.code}: ${error.message}`)
        },
        onNotice: (notice) => say(`${notice.code}: ${notice.detail}`),
      },
    })
    body.dataset.phase = "playing"
  })
  element("end").addEventListener("click", () => playing?.stop("abandoned"))
}

/** `?game=`: runs against the stand-in, the way a studio's page plays them. */
async function runs(): Promise<void> {
  const client = createPlatformClient(config)
  const signedIn = () => {
    const player = client.player()
    body.dataset.player = player?.displayName ?? ""
    element("player").textContent = player?.displayName ?? ""
  }
  signedIn()
  element("signin").addEventListener("click", () => {
    client.signIn().then(signedIn, refused)
  })

  let game: LoadedGame | null = null
  try {
    const page = await client.game()
    const version = page.today?.version ?? null
    if (version === null) throw new Error("the stand-in serves no ranked run")
    game = await loadGame(version)
    loaded()
  } catch (error) {
    refused(error)
  }

  // The interval between chunks, which the second-tab spec sets: long, so
  // the first tab has committed nothing when the second presses Play, or
  // short, so it has.
  const chunkSeconds = query.get("chunkSeconds")
  let played: PlayedRun | null = null
  let settled: string | null = null

  element("play").addEventListener("click", () => {
    if (game === null) return
    played?.destroy()
    stage.replaceChildren()
    const current = playRun(stage, {
      client,
      game,
      mode: "ranked",
      title: "The game",
      // Required by a game that maps a controller, as the template does: a
      // browser can block one, and the player has to be told.
      onNotice: (notice) => say(`${notice.code}: ${notice.detail}`),
      ...(chunkSeconds === null ? {} : { chunkSeconds: Number(chunkSeconds) }),
      onState: (next: RunState) => {
        body.dataset.phase = next.phase
        body.dataset.code = next.errorCode ?? ""
        say(
          next.errorCode === null
            ? next.phase
            : `${next.phase} ${next.errorCode}: ${next.detail ?? ""}`,
        )
        if (next.phase === RUN_PHASE.DONE && next.result !== null) {
          settled = next.result.sessionId
          publish("run", next.result)
        }
      },
    })
    played = current
  })
  element("end").addEventListener("click", () => played?.end())

  element("watch").addEventListener("click", () => {
    if (settled === null) return
    let lastFrame = -1
    watchStage.replaceChildren()
    watchRun(watchStage, {
      client,
      runId: settled,
      handlers: {
        onFrame: (frame) => {
          lastFrame = Math.max(lastFrame, frame.tick)
        },
        onEnded: (ended) => {
          publish("watched", {
            tick: ended.tick,
            reason: ended.reason,
            counters: ended.counters,
            lastFrame,
          })
          body.dataset.watched = "ended"
        },
        onError: (error) => {
          body.dataset.watched = error.code
        },
      },
    }).catch((error: unknown) => {
      const { code } = error as { code?: string }
      body.dataset.watched = code ?? "refused"
    })
  })
}
