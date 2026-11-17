/**
 * The page that loads the game, as a studio's page does.
 *
 * Full viewport and one floating mark. The game's page module is loaded from
 * the bundles origin with `loadGame`, the code a studio's page loads one
 * with, so a module a page would refuse is refused here first, and it is
 * played with `playLocal`, through the module's own `mount`. What it adds, which a studio's
 * page does not need, is Start and End buttons, the recording of the run,
 * published into the page for the browser suite and saved for the author,
 * and the harness's report on it: whether it replays, whether its inputs
 * are ones the platform takes, and how big it is.
 *
 * This file is bundled for the browser at harness start and served from the
 * host origin. It is the only part of the harness that runs in a page.
 */

import { MOUNT_ERROR } from "../../game/contract.js"
import {
  type LoadedGame,
  type LocalEnd,
  type LocalRun,
  loadGame,
  playLocal,
} from "../../host/index.js"
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
  /** Whether the report holds a run to a ranked run's input budget. */
  readonly ranked: boolean
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
async function publish(ended: LocalEnd): Promise<void> {
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
    reportBlock.textContent = reportLines(report, config.ranked).join("\n")
    reportBlock.dataset.passes = String(reportPasses(report, config.ranked))
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

let playing: LocalRun | null = null

/**
 * A local run, through `playLocal`, as a game played on its own page plays
 * one: called in the Start click, so a game that reads tilt asks for it
 * there, and starts nothing without it.
 */
function start(game: LoadedGame): void {
  playing?.destroy()
  stage.replaceChildren()
  reportBlock.textContent = ""
  delete reportBlock.dataset.passes
  delete document.body.dataset.run
  // Said before the run, so a refusal on the spot says why instead.
  say("playing")
  playing = playLocal(stage, {
    game,
    seed: config.seed,
    config: config.config,
    // As a ranked or practice run takes them: from the player's devices.
    scripted: "ignore",
    title: config.title,
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
      // `playLocal` asks for tilt in the click, before the run starts, and
      // a refusal arrives at its `onError`. A request that throws outright
      // is refused like one that fails.
      try {
        start(game)
      } catch (error) {
        refuseWith(error)
      }
    })
    // Ends the run where it stands, which is how an author gets a recording
    // out of a game they do not intend to lose at.
    document.getElementById("end")?.addEventListener("click", () => {
      playing?.end()
    })
  })
  .catch(refuseWith)
