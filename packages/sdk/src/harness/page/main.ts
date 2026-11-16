/**
 * The page that loads the game, as a studio's page does.
 *
 * Full viewport and one floating mark. The game's page module is loaded from
 * the bundles origin with `loadGame`, the code a studio's page loads one
 * with, so a module a page would refuse is refused here first, and it is
 * played through the module's own `mount`. What it adds, which a studio's
 * page does not need, is Start and End buttons and the recording of the run,
 * published into the page for the browser suite and saved for the author.
 *
 * This file is bundled for the browser at harness start and served from the
 * host origin. It is the only part of the harness that runs in a page.
 */

import type { MountedEnd, MountHandle } from "../../game/contract.js"
import { type LoadedGame, loadGame } from "../../host/index.js"

interface HarnessConfig {
  readonly presentUrl: string
  readonly manifestHash: string
  readonly title: string
  readonly seed: string
  readonly tickHz: number
  readonly maxTicks: number
  readonly config: Readonly<Record<string, string | number | boolean>>
}

const config = JSON.parse(
  document.getElementById("harness-config")?.textContent ?? "{}",
) as HarnessConfig

const stage = document.getElementById("stage") as HTMLElement
const status = document.getElementById("status") as HTMLElement
const save = document.getElementById("save") as HTMLAnchorElement
const runBlock = document.getElementById("run") as HTMLScriptElement

function say(message: string): void {
  status.textContent = message
}

/**
 * What a page would refuse, said in the status line and marked on the body,
 * the same way for a module refused at load and a run refused at mount.
 */
function refuse(code: string, message: string): void {
  say(`${code}: ${message}`)
  document.body.dataset.refused = code
}

/** The run's result and its recording, published once the run has ended. */
function publish(ended: MountedEnd): void {
  const recording = JSON.stringify(ended.recording)
  runBlock.textContent = JSON.stringify({
    result: {
      tick: ended.tick,
      counters: ended.counters,
      reason: ended.reason,
    },
    recording,
  })
  save.href = URL.createObjectURL(
    new Blob([recording], { type: "application/json" }),
  )
  save.hidden = false
  // What a reader outside the page waits for: the run is over and its
  // evidence is complete.
  document.body.dataset.run = "recorded"
}

let playing: MountHandle | null = null

function start(game: LoadedGame): void {
  playing?.destroy()
  stage.replaceChildren()
  if (!stage.hasAttribute("tabindex")) stage.tabIndex = 0
  stage.setAttribute("aria-label", config.title)
  stage.focus()
  playing = game.mount(stage, {
    mode: "play",
    seed: config.seed,
    config: config.config,
    tickHz: config.tickHz,
    maxTicks: config.maxTicks,
    expect: { manifestHash: config.manifestHash },
    handlers: {
      onCheckpoint: () => {},
      onFrame: (frame) => say(`tick ${frame.tick}`),
      onEnded: (ended) => {
        const counters = Object.entries(ended.counters)
          .map(([name, value]) => `${name} ${value}`)
          .join(", ")
        say(
          `${ended.reason} at tick ${ended.tick}${counters === "" ? "" : ` - ${counters}`}`,
        )
        publish(ended)
      },
      onError: (error) => refuse(error.code, error.message),
      onNotice: (notice) => say(`${notice.code}: ${notice.detail}`),
    },
  })
  say("playing")
}

loadGame({ presentUrl: config.presentUrl, manifestHash: config.manifestHash })
  .then((game) => {
    say("ready")
    document.getElementById("start")?.addEventListener("click", () => {
      // Asked in the click, as a studio's page asks, before the run starts.
      if (game.needsMotion) {
        game.requestMotion().then((access) => {
          if (!access.granted) say(`${access.code}: ${access.detail}`)
          start(game)
        })
        return
      }
      start(game)
    })
    // Ends the run where it stands, which is how an author gets a recording
    // out of a game they do not intend to lose at.
    document.getElementById("end")?.addEventListener("click", () => {
      playing?.stop("abandoned")
    })
  })
  .catch((error: unknown) => {
    const { code, message } = error as { code?: string; message?: string }
    refuse(code ?? "refused", message ?? String(error))
  })
