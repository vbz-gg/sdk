/**
 * The page that loads the game, as a studio's page does.
 *
 * Full viewport and one floating mark. The game's page module is loaded from
 * the bundles origin with `loadGame`, the code a studio's page loads one
 * with, so a module a page would refuse is refused here first, and it is
 * played through the module's own `mount`. What it adds, which a studio's
 * page does not need, is Start and End buttons, the recording of the run,
 * published into the page for the browser suite and saved for the author,
 * and the harness's report on it: whether it replays, whether its inputs
 * are ones the platform takes, and how big it is.
 *
 * This file is bundled for the browser at harness start and served from the
 * host origin. It is the only part of the harness that runs in a page.
 */

import type { MotionAccess } from "@clockwork2/engine/host"
import {
  MOUNT_ERROR,
  type MountedEnd,
  type MountHandle,
} from "../../game/contract.js"
import { type LoadedGame, loadGame } from "../../host/index.js"
import { motionRefusal } from "../../host/motion.js"
import type { DevReport } from "../replay.js"
import { reportLines, reportPasses } from "../report.js"

interface HarnessConfig {
  readonly presentUrl: string
  readonly manifestHash: string
  readonly filesUrl: string
  readonly title: string
  readonly seed: string
  readonly tickHz: number
  readonly config: Readonly<Record<string, string | number | boolean>>
  /** Where a run's recording goes for the harness's report. */
  readonly replayPath: string
}

const config = JSON.parse(
  document.getElementById("harness-config")?.textContent ?? "{}",
) as HarnessConfig

const stage = document.getElementById("stage") as HTMLElement
const status = document.getElementById("status") as HTMLElement
const save = document.getElementById("save") as HTMLAnchorElement
const runBlock = document.getElementById("run") as HTMLScriptElement
const reportBlock = document.getElementById("report") as HTMLElement

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

/** `refuse`, for something thrown: its own code, or `E_UNEXPECTED` without one. */
function refuseWith(error: unknown): void {
  const { code, message } = (error ?? {}) as {
    readonly code?: unknown
    readonly message?: unknown
  }
  refuse(
    typeof code === "string" ? code : MOUNT_ERROR.UNEXPECTED,
    typeof message === "string" ? message : String(error),
  )
}

/**
 * The run's result, its recording and the harness's report, published once
 * the run has ended and the report has come back.
 */
async function publish(ended: MountedEnd): Promise<void> {
  const recording = JSON.stringify(ended.recording)
  save.href = URL.createObjectURL(
    new Blob([recording], { type: "application/json" }),
  )
  save.hidden = false
  reportBlock.textContent = "replaying"
  let report: DevReport | null = null
  try {
    const answer = await fetch(config.replayPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: recording,
    })
    report = (await answer.json()) as DevReport
    reportBlock.textContent = reportLines(report).join("\n")
    reportBlock.dataset.passes = String(reportPasses(report))
  } catch (error) {
    reportBlock.textContent = `the harness did not answer: ${String(error)}`
    reportBlock.dataset.passes = "false"
  }
  runBlock.textContent = JSON.stringify({
    result: {
      tick: ended.tick,
      counters: ended.counters,
      reason: ended.reason,
    },
    recording,
    report,
  })
  // What a reader outside the page waits for: the run is over and its
  // evidence is complete.
  document.body.dataset.run = "recorded"
}

let playing: MountHandle | null = null

function start(game: LoadedGame): void {
  playing?.destroy()
  stage.replaceChildren()
  reportBlock.textContent = ""
  delete reportBlock.dataset.passes
  delete document.body.dataset.run
  if (!stage.hasAttribute("tabindex")) stage.tabIndex = 0
  stage.setAttribute("aria-label", config.title)
  stage.focus()
  // Said before the mount, so a mount refused on the spot says why instead.
  say("playing")
  playing = game.mount(stage, {
    mode: "play",
    seed: config.seed,
    config: config.config,
    tickHz: config.tickHz,
    // As a ranked or practice run takes them: from the player's devices.
    scripted: "ignore",
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
        void publish(ended)
      },
      onError: (error) => refuse(error.code, error.message),
      onNotice: (notice) => say(`${notice.code}: ${notice.detail}`),
    },
  })
}

loadGame({
  presentUrl: config.presentUrl,
  manifestHash: config.manifestHash,
  filesUrl: config.filesUrl,
})
  .then((game) => {
    say("ready")
    document.getElementById("start")?.addEventListener("click", () => {
      // Asked in the click, as a studio's page asks, before the run starts.
      // The executor runs at once, so the request is still in the click,
      // and one that throws is refused like one that fails.
      if (game.needsMotion) {
        new Promise<MotionAccess>((resolve) => resolve(game.requestMotion()))
          .then((access) => {
            // Read as `playRun` reads it: a game steered by tilt starts no
            // run without it, and the status line keeps the sentence why.
            const refused = motionRefusal(access)
            if (refused === null) start(game)
            else refuseWith(refused)
          })
          // A request that failed says why, and no run starts.
          .catch(refuseWith)
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
  .catch(refuseWith)
