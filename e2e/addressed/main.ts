/**
 * A page on one origin playing a game another origin serves, as a page that
 * is not this SDK's does: it reads `addressed.json`, which
 * `vbz build --addressed` wrote and the page ships with, loads the page
 * module at the host's origin and the path the file names with `loadGame`,
 * with no import map, and plays it with `playLocal`, asking nobody
 * anything. What it learns is written into the document, where a spec
 * reads it.
 */

import type { AddressedBuild } from "../../packages/sdk/src/harness/index.js"
import {
  type LoadedGame,
  type LocalRun,
  loadGame,
  playLocal,
} from "../../packages/sdk/src/host/index.js"

/** Where the folder is served, from the root of its origin. */
interface PageConfig {
  readonly filesOrigin: string
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id)
  if (found === null) throw new Error(`the page has no #${id}`)
  return found
}

const stage = element("stage")
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

const config = (await (await fetch("/config.json")).json()) as PageConfig
const build = (await (await fetch("/addressed.json")).json()) as AddressedBuild

let game: LoadedGame | null = null
try {
  game = await loadGame({
    presentUrl: new URL(build.present, config.filesOrigin).href,
    manifestHash: build.manifestHash,
    filesUrl: new URL(build.files, config.filesOrigin).href,
  })
  body.dataset.loaded = "ready"
  say("ready")
} catch (error) {
  const { code, cause } = error as { code?: string; cause?: unknown }
  body.dataset.loaded = code ?? "refused"
  say(`${code ?? "refused"}: ${JSON.stringify(cause ?? String(error))}`)
}

let played: LocalRun | null = null
element("play").addEventListener("click", () => {
  if (game === null) return
  played?.destroy()
  stage.replaceChildren()
  body.dataset.phase = "playing"
  played = playLocal(stage, {
    game,
    scripted: "ignore",
    title: build.name,
    onFrame: (frame) => {
      body.dataset.tick = String(frame.tick)
    },
    onEnded: (ended) => {
      publish("run", ended)
      body.dataset.phase = "ended"
    },
    onError: (error) => {
      body.dataset.phase = "failed"
      say(`${error.code}: ${error.message}`)
    },
    onNotice: (notice) => say(`${notice.code}: ${notice.detail}`),
  })
})
element("end").addEventListener("click", () => played?.end())
