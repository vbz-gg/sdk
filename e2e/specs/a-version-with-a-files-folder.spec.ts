/**
 * A version whose page module loads code and data from its files folder, as
 * a game drawn with null3d does, without null3d: the folder's entry,
 * imported as `cw2:files/entry.js`, fetches and compiles WebAssembly from
 * the folder, starts a worker from a blob that imports a module of the
 * folder, and imports the drawing by a name it works out as it runs; its
 * presentation then waits before it says it can draw; and its rules code
 * reads a data pack from the folder on demand.
 *
 * Under the policy the SDK recommends, with the game's needs added, and in
 * every engine, because what that policy admits is each engine's to decide:
 * played locally on a studio's page, as a ranked run against the stand-in,
 * in the harness, and on a device that cannot draw it.
 */

import { expect, type Page, test } from "@playwright/test"
import { STUDIO_ORIGIN } from "../src/env"
import {
  clearRequests,
  endRun,
  open,
  play,
  replayAgainst,
  replayFrom,
  requests,
  waitForTick,
} from "../src/run"
import {
  type ModuleEnd,
  openRuns,
  published,
  reach,
  routesOf,
  sentBy,
  signIn,
  simUrlOf,
  studio,
} from "../src/studio"

/** The tick the rules code needs its course from, as `src/sim` says. */
const COURSE_FROM = 180
/** How long the presentation waits after loading, as `src/present/folder.ts` says. */
const READY_AFTER_MS = 600
const COURSE = "packs/course.json"

/** The data pack, as the bundles origin serves it. */
async function course(): Promise<ReadonlyMap<string, Uint8Array>> {
  const { modules } = await studio()
  const answer = await fetch(`${modules.folder?.filesUrl ?? ""}${COURSE}`)
  return new Map([[COURSE, new Uint8Array(await answer.arrayBuffer())]])
}

/** What the presentation wrote on the element it fills. */
async function marks(
  page: Page,
): Promise<Readonly<Record<string, string | undefined>>> {
  return await page
    .locator("#stage")
    .evaluate((stage) => ({ ...(stage as HTMLElement).dataset }))
}

/** Every file of the folder the bundles origin was asked for, by its path. */
async function folderAsked(): Promise<string[]> {
  const { modules } = await studio()
  const base = new URL(modules.folder?.filesUrl ?? "").pathname
  return (await requests("studio"))
    .filter((path) => path.startsWith(base))
    .map((path) => path.slice(base.length))
}

/**
 * Counts every worker the page starts and terminates, by standing in for
 * the browser's `Worker` with one that counts, so a spec can tell a worker
 * left running from one stopped.
 */
async function countWorkers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const counted = { started: 0, terminated: 0 }
    ;(globalThis as unknown as { vbzWorkers: typeof counted }).vbzWorkers =
      counted
    const Original = globalThis.Worker
    globalThis.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        counted.started += 1
      }
      override terminate(): void {
        counted.terminated += 1
        super.terminate()
      }
    }
  })
}

async function workers(
  page: Page,
): Promise<{ readonly started: number; readonly terminated: number }> {
  return await page.evaluate(
    () =>
      (
        globalThis as unknown as {
          vbzWorkers: { started: number; terminated: number }
        }
      ).vbzWorkers,
  )
}

/** A browser whose canvases give no 2d context: a device the game cannot draw on. */
async function noCanvas(page: Page): Promise<void> {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null
  })
}

test("played locally, it loads from its folder, starts its clock only once it can draw, and reads its pack on demand", async ({
  page,
}) => {
  const body = page.locator("body")
  const stage = page.locator("#stage")
  await clearRequests("studio")
  await page.goto(`${STUDIO_ORIGIN}/?game=folder&local=folder`)
  await expect(body).toHaveAttribute("data-loaded", "ready")

  await page.getByRole("button", { name: "Play" }).click()
  await expect(stage).toHaveAttribute("data-prepare-started", /.+/)
  // Getting ready: a press now is nobody's, because no clock runs yet.
  expect(await stage.getAttribute("data-prepare-ready")).toBeNull()
  await page.keyboard.press("ArrowLeft")
  await expect(stage).toHaveAttribute("data-prepare-ready", /.+/)
  await expect(body).toHaveAttribute("data-tick", /^[1-9]/)

  // Before the course is needed, nothing has asked for it.
  const early = Number(await body.getAttribute("data-tick"))
  const beforeCourse = await folderAsked()
  expect(early).toBeLessThan(COURSE_FROM)
  expect(beforeCourse).not.toContain(COURSE)
  for (const file of ["entry.js", "draw.js", "core.wasm", "worker.js"]) {
    expect(beforeCourse).toContain(file)
  }

  await page.keyboard.press("ArrowRight")
  await page.waitForFunction(
    (at) => Number(document.body.dataset.tick ?? "0") >= at,
    COURSE_FROM + 60,
  )
  await page.getByRole("button", { name: "End" }).click()
  await expect(body).toHaveAttribute("data-phase", "ended")
  const ended = await published<ModuleEnd>(page, "run")

  expect(await folderAsked()).toContain(COURSE)
  expect(await published(page, "violations")).toEqual([])
  const seen = await marks(page)
  expect(seen.tint).toBe("42")
  expect(seen.drawnBy).toBe("draw.js")
  expect(seen.worker).toBe("ready")
  // The readiness gate: nothing drawn, and no tick run, before it was ready.
  expect(seen.framesBeforeReady).toBe("0")
  expect(
    Number(seen.prepareReady) - Number(seen.prepareStarted),
  ).toBeGreaterThanOrEqual(READY_AFTER_MS)
  expect(Number(seen.firstFrame)).toBeGreaterThanOrEqual(
    Number(seen.prepareReady),
  )

  // The press made while it got ready is not in the log; the one after is.
  expect(
    ended.recording.inputs.map((input) => `${input.code}=${input.value}`),
  ).toEqual(["right=1", "right=0"])
  // The course scored, so the pack was read, and a replay with the same
  // bytes reaches the same counters; one without them cannot.
  expect(ended.counters.score).toBeGreaterThan(0)
  const encoded = JSON.stringify(ended.recording)
  const replayed = await replayAgainst(
    await simUrlOf("folder"),
    encoded,
    await course(),
  )
  expect(replayed.comparison.matches).toBe(true)
  expect(replayed.counters).toEqual(ended.counters)
  let withoutCourse: unknown = null
  try {
    await replayAgainst(await simUrlOf("folder"), encoded)
  } catch (error) {
    withoutCourse = error
  }
  expect(String(withoutCourse)).toContain(COURSE)
})

test("as a ranked run, it gets ready before the platform is asked for a run, and its run replays with its pack", async ({
  page,
}) => {
  const stage = page.locator("#stage")
  await openRuns(page, "folder")
  await signIn(page)
  const sent = sentBy(page)
  await page.getByRole("button", { name: "Play" }).click()
  await reach(page, "playing")
  // Ready by the time the run was asked for.
  expect(await stage.getAttribute("data-prepare-ready")).not.toBeNull()
  expect(routesOf(sent)).toContain("POST /v1/runs")
  await page.keyboard.press("ArrowRight")
  await page.waitForFunction(
    (at) =>
      Number(
        (document.getElementById("stage") as HTMLElement).dataset.tick ?? "0",
      ) >= at,
    COURSE_FROM + 60,
  )
  await page.getByRole("button", { name: "End" }).click()
  await reach(page, "done")
  const result = await published<{
    readonly replay: { readonly counters: Record<string, number> } | null
  }>(page, "run")
  const counters = result.replay?.counters ?? {}
  expect(counters.score).toBeGreaterThan(0)
  expect(await published(page, "violations")).toEqual([])
  const seen = await marks(page)
  expect(seen.framesBeforeReady).toBe("0")
  expect(Number(seen.firstFrame)).toBeGreaterThanOrEqual(
    Number(seen.prepareReady),
  )

  // What the stand-in hands a page to watch the run, replayed away from
  // the page with the pack the bundles origin serves. A refusal is
  // published with its code, which the assertion then names.
  await expect(page.locator("body")).toHaveAttribute("data-watched-run", /.+/)
  expect(await page.locator("body").getAttribute("data-watched-run")).toBe(
    "read",
  )
  const watched = await published<{
    readonly seed: string
    readonly config: unknown
    readonly inputs: readonly {
      readonly tick: number
      readonly code: string
      readonly value: number
    }[]
    readonly tickHz: number
    readonly replayTicks: number
  }>(page, "watched-run")
  expect(watched.inputs.map((input) => input.code)).toEqual(["right", "right"])
  const replayed = await replayFrom(
    await simUrlOf("folder"),
    {
      seed: watched.seed,
      config: watched.config,
      inputs: watched.inputs,
      maxTicks: watched.replayTicks,
      tickHz: watched.tickHz,
    },
    await course(),
  )
  expect(replayed.counters).toEqual(counters)

  // And watched on the page, which loads the pack from the folder again.
  await page.getByRole("button", { name: "Watch" }).click()
  await expect(page.locator("body")).toHaveAttribute("data-watched", "ended")
  const shown = await published<{ readonly counters: Record<string, number> }>(
    page,
    "watched",
  )
  expect(shown.counters).toEqual(counters)
})

test("in the harness, its run replays to what the page showed, pack and all", async ({
  page,
}) => {
  await open(page, "folder")
  await play(page)
  await page.keyboard.press("ArrowRight")
  await waitForTick(page, COURSE_FROM + 60)
  const run = await endRun(page)
  expect(run.result.counters.score).toBeGreaterThan(0)
  expect(run.report.replay.kind).toBe("matches")
})

/**
 * The same page with the policy left as it is for a game that needs
 * nothing: the core's fetch, its compile and the worker are each refused,
 * so the game cannot get ready, and says so before a tick.
 */
test("under a policy that leaves out what it needs, it cannot get ready, and plays nothing", async ({
  page,
}) => {
  const body = page.locator("body")
  await page.goto(`${STUDIO_ORIGIN}/?game=folder&local=folder&needs=none`)
  await expect(body).toHaveAttribute("data-loaded", "ready")
  await page.getByRole("button", { name: "Play" }).click()
  await expect(body).toHaveAttribute("data-phase", "failed")
  await expect(body).toHaveAttribute("data-code", "E_PRESENTATION_FAILED")
  await expect(page.locator("#run")).toBeEmpty()
  const refused = await published<{ readonly directive: string }[]>(
    page,
    "violations",
  )
  const directives = [...new Set(refused.map((one) => one.directive))].sort()
  test.info().annotations.push({
    type: "the policy refused",
    description: JSON.stringify(directives),
  })
  expect(directives).toContain("connect-src")
  expect(directives.length).toBeGreaterThan(1)
})

test("a device that cannot draw it starts nothing, locally or ranked, and the platform is asked for no run", async ({
  page,
}) => {
  await noCanvas(page)
  const body = page.locator("body")
  await openRuns(page, "folder")
  await signIn(page)
  const sent = sentBy(page)
  await page.getByRole("button", { name: "Play" }).click()
  await expect(body).toHaveAttribute("data-phase", "failed")
  await expect(body).toHaveAttribute("data-code", "E_PRESENTATION_FAILED")
  expect(routesOf(sent)).not.toContain("POST /v1/runs")

  await page.goto(`${STUDIO_ORIGIN}/?game=folder&local=folder`)
  await expect(body).toHaveAttribute("data-loaded", "ready")
  await page.getByRole("button", { name: "Play" }).click()
  await expect(body).toHaveAttribute("data-phase", "failed")
  await expect(body).toHaveAttribute("data-code", "E_PRESENTATION_FAILED")
  await expect(page.locator("#run")).toBeEmpty()
})

/**
 * Its presentation starts a worker while it gets ready. A run taken down
 * then, here by Play pressed again, which takes the first run down, stops
 * that worker once it has started; and a start that fails part-way, here
 * because the core cannot be fetched, stops the worker the rest started.
 * Nothing it started outlives it.
 */
test("taken down while it gets ready, or failing part-way, it leaves no worker running", async ({
  page,
}) => {
  await countWorkers(page)
  const body = page.locator("body")
  const stage = page.locator("#stage")
  await page.goto(`${STUDIO_ORIGIN}/?game=folder&local=folder`)
  await expect(body).toHaveAttribute("data-loaded", "ready")
  await page.getByRole("button", { name: "Play" }).click()
  await expect(stage).toHaveAttribute("data-prepare-started", /.+/)
  // Again while the first is getting ready: the first is taken down.
  await page.getByRole("button", { name: "Play" }).click()
  await expect(body).toHaveAttribute("data-tick", /^[1-9]/)
  // The first run's worker, started after it was taken down, is stopped;
  // the second's draws the run that is playing.
  await expect
    .poll(async () => await workers(page))
    .toEqual({
      started: 2,
      terminated: 1,
    })

  // The core that will not arrive: the worker that did start is stopped.
  await page.route("**/core.wasm", (route) => route.abort())
  await page.reload()
  await expect(body).toHaveAttribute("data-loaded", "ready")
  await page.getByRole("button", { name: "Play" }).click()
  await expect(body).toHaveAttribute("data-code", "E_PRESENTATION_FAILED")
  await expect
    .poll(async () => await workers(page))
    .toEqual({
      started: 1,
      terminated: 1,
    })
})
