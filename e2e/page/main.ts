/**
 * A studio's page, as small as the suite needs one.
 *
 * Everything that touches the game is the SDK's, as on any studio's page:
 * `loadGame` imports a page module from the bundles origin, `playRun` plays a
 * run against the stand-in for the platform inside the Play button's click,
 * and `watchRun` replays a settled one. It is served under the
 * Content-Security-Policy the SDK recommends, naming one game's path.
 *
 * Three ways in. `?game=template` (or `paddle`, or `folder`) plays that
 * game's runs through the stand-in. `?load=<module>` loads one module the
 * server holds by name, such as one built against another copy of the SDK,
 * says what `loadGame` made of it, and plays it straight through its
 * `mount` on a fixed seed, as the harness does. `?local=<module>` loads one
 * and plays it with `playLocal`, asking no platform anything, and can then
 * post the local run's recording to the stand-in as a run's own, which the
 * platform refuses. Whatever the page learns is written into the document,
 * where a spec reads it.
 */

import type {
  MountedEnd,
  MountHandle,
} from "../../packages/sdk/src/game/index.js"
import {
  type GameAddress,
  type LoadedGame,
  type LocalEnd,
  type LocalRun,
  loadGame,
  type PlayedRun,
  playLocal,
  playRun,
  watchRun,
} from "../../packages/sdk/src/host/index.js"
import {
  createPlatformClient,
  type PlatformClient,
  type PlatformClientOptions,
  RUN_PHASE,
  type RunRecording,
  type RunState,
} from "../../packages/sdk/src/platform/index.js"

/** A module the server holds, by the name a spec loads it with. */
interface Module extends GameAddress {
  readonly tickHz: number
}

interface StudioConfig
  extends Pick<
    PlatformClientOptions,
    "apiOrigin" | "signInOrigin" | "pageKey" | "signInReadyMs"
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
const local = query.get("local")
if (local !== null) await locally(local)
else if (named === null) await runs()
else await one(named)

/** The Sign in button, signing the stand-in's player in through the box. */
function signsIn(client: PlatformClient): void {
  const signedIn = () => {
    const player = client.player()
    body.dataset.player = player?.displayName ?? ""
    element("player").textContent = player?.displayName ?? ""
  }
  signedIn()
  element("signin").addEventListener("click", () => {
    body.dataset.signin = "open"
    client.signIn().then(
      () => {
        body.dataset.signin = "signed in"
        signedIn()
      },
      (error: unknown) => {
        const { code } = error as { code?: string }
        body.dataset.signin = code ?? "refused"
        say(`${code ?? "refused"}: ${String(error)}`)
      },
    )
  })
}

/**
 * `?local=`: one module, played with `playLocal`. The client is made, which
 * asks nothing, and is used only by Post, after the run.
 */
async function locally(name: string): Promise<void> {
  const module = config.modules[name]
  if (module === undefined) throw new Error(`the server holds no ${name}`)
  let game: LoadedGame | null = null
  try {
    game = await loadGame(module)
    loaded()
  } catch (error) {
    refused(error)
  }
  const client = createPlatformClient(config)
  signsIn(client)

  let played: LocalRun | null = null
  let ended: LocalEnd | null = null
  element("play").addEventListener("click", () => {
    if (game === null) return
    played?.destroy()
    stage.replaceChildren()
    body.dataset.phase = "playing"
    try {
      played = playLocal(stage, {
        game,
        scripted: "ignore",
        title: "The game",
        onFrame: (frame) => {
          body.dataset.tick = String(frame.tick)
        },
        onEnded: (end) => {
          ended = end
          publish("run", end)
          body.dataset.phase = "ended"
        },
        onError: (error) => {
          body.dataset.phase = "failed"
          body.dataset.code = error.code
          say(`${error.code}: ${error.message}`)
        },
        onNotice: (notice) => say(`${notice.code}: ${notice.detail}`),
      })
    } catch (error) {
      refused(error)
    }
  })
  element("end").addEventListener("click", () => played?.end())

  // A page with devtools can post anything: here, a local run's recording
  // as a ranked run's own, which only a cast lets through the compiler.
  element("post").addEventListener("click", async () => {
    if (ended === null) return
    const run = await client.startRun()
    let code: string | null = null
    try {
      await client.submit(run, ended.recording as unknown as RunRecording)
    } catch (error) {
      code = (error as { code?: string }).code ?? String(error)
    }
    const result = await client.result(run.sessionId, { token: run.token })
    const board = await client.board({ period: "day" })
    publish("posted", { code, state: result.state, rows: board.rows.length })
    body.dataset.posted = code ?? "accepted"
  })
}

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
      // What a platform serves a run; a contract-1 module does not say.
      config: game.servedConfig ?? {},
      tickHz: module.tickHz,
      scripted: "ignore",
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
  signsIn(client)

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
          // What the platform hands a page to watch the run: its seed,
          // config and inputs, which a spec replays away from the page.
          void client.watch(settled).then((watched) => {
            publish("watched-run", watched)
          })
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
