/**
 * What `vbz dev` says about a run once it ends: whether the recording
 * replays against the rules code, whether its inputs are ones the platform
 * takes, and how big it is.
 *
 * The recordings here are real ones, played through a page module's mount on
 * a clock the test moves, so what is replayed is what a page sends.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  hashCanonical,
  type PlainValue,
  type Recording,
} from "@clockwork2/engine"
import { ManualScheduler } from "@clockwork2/engine/host"
import { buildGame, writeBuild } from "../../src/cli/build"
import { isCopied, TEMPLATE_DIR } from "../../src/cli/new"
import type { MountedEnd } from "../../src/game/contract"
import { definePageModule } from "../../src/game/define"
import { startHarness } from "../../src/harness"
import {
  type DevReport,
  replayChildEntry,
  replayInChild,
  replayRecording,
} from "../../src/harness/replay"
import { reportLines, reportPasses } from "../../src/harness/report"
import { capture as templateCapture } from "../../templates/game/src/capture"
import createTemplate, {
  MANIFEST as TEMPLATE_MANIFEST,
} from "../../templates/game/src/sim/index"
import {
  type Config,
  Drawn,
  devices,
  FRAME_MS,
  MANIFEST,
  Probe,
  type View,
} from "../game/subject"
import { fakeBrowser } from "../templates/devices"

/** A run of the probe game with three presses, ended by the player at `stopAt`. */
function played(stopAt = 90): Recording {
  const keys = devices()
  const scheduler = new ManualScheduler()
  const game = definePageModule<View, Config>({
    createGame: () => new Probe(),
    manifest: MANIFEST,
    createPresentation: () => new Drawn(),
    capture: { keys: { ArrowLeft: "left" } },
  })
  let ended: MountedEnd | null = null
  const element = {
    ownerDocument: { defaultView: null },
  } as unknown as HTMLElement
  const handle = game.mount(element, {
    mode: "play",
    seed: "harness",
    config: { endAt: 300 },
    tickHz: 60,
    maxTicks: 600,
    expect: { manifestHash: hashCanonical(MANIFEST as unknown as PlainValue) },
    handlers: {
      onCheckpoint: () => {},
      onFrame: () => {},
      onEnded: (end) => {
        ended = end
      },
      onError: (error) => {
        throw new Error(error.message)
      },
    },
    scheduler,
    environment: keys,
  })
  scheduler.run(1, FRAME_MS)
  for (let press = 0; press < 3; press += 1) {
    keys.press("ArrowLeft", true)
    scheduler.run(5, FRAME_MS)
    keys.press("ArrowLeft", false)
    scheduler.run(15, FRAME_MS)
  }
  scheduler.run(Math.max(0, stopAt - 61), FRAME_MS)
  handle.stop("abandoned")
  const end = ended as MountedEnd | null
  if (end === null) throw new Error("the run never ended")
  return end.recording
}

const source = () => new Probe()

function report(recording: unknown): DevReport {
  return replayRecording(source, MANIFEST, JSON.stringify(recording))
}

describe("replaying a recording", () => {
  test("a run as a page recorded it replays, and every input is one the platform takes", () => {
    const recording = played()
    const answer = report(recording)
    // A run of nothing would replay vacuously.
    expect(recording.inputs.length).toBe(6)
    expect(answer.replay).toEqual({
      kind: "matches",
      endTick: recording.endTick,
      counters: { presses: 3 },
    })
    expect(answer.inputs).toEqual({
      count: 6,
      budget: 16 * (recording.endTick + 1),
      problem: null,
    })
    expect(answer.bytes).toBe(
      new TextEncoder().encode(JSON.stringify(recording)).byteLength,
    )
    expect(reportPasses(answer)).toBe(true)
  })

  test("a recording claiming another score differs, and says where", () => {
    const recording = played()
    const answer = report({ ...recording, counters: { presses: 9 } })
    expect(answer.replay.kind).toBe("differs")
    if (answer.replay.kind !== "differs") return
    expect(answer.replay.differences).toContain(
      "presses: recorded 9, replayed 3",
    )
    expect(reportPasses(answer)).toBe(false)
  })

  test("a recording whose checkpoint was changed differs from that checkpoint", () => {
    const recording = played()
    const [first, second, ...rest] = recording.checkpoints
    if (first === undefined || second === undefined)
      throw new Error("no checkpoints")
    const answer = report({
      ...recording,
      checkpoints: [first, { ...second, hash: "0".repeat(16) }, ...rest],
    })
    expect(answer.replay.kind === "differs" && answer.replay.divergedAt).toBe(
      second.tick,
    )
  })

  test("an input the manifest does not declare is refused as the platform refuses it", () => {
    const recording = played()
    const answer = report({
      ...recording,
      inputs: [...recording.inputs, { tick: 70, code: "jump", value: 1 }].sort(
        (a, b) => a.tick - b.tick,
      ),
    })
    expect(answer.inputs.problem?.code).toBe("E_INPUT_UNDECLARED")
    expect(reportPasses(answer)).toBe(false)
  })

  test("more inputs than the budget allows is refused with the budget's code", () => {
    const recording = played()
    // A hundred a tick is under the engine's per-tick net, so what refuses
    // it is the budget over the run: 16 a tick on average.
    const flood = Array.from({ length: 200 }, (_, i) => ({
      tick: Math.floor(i / 100),
      code: "aimX",
      value: i % 2,
    }))
    const answer = report({
      ...recording,
      endTick: 2,
      inputs: flood,
      checkpoints: recording.checkpoints.slice(0, 1),
    })
    expect(answer.inputs.count).toBe(200)
    expect(answer.inputs.budget).toBe(48)
    expect(answer.inputs.problem?.code).toBe("E_INPUT_BUDGET")
  })

  test("a run that ended at tick 0 has nothing to replay", () => {
    const recording = played()
    const answer = report({
      ...recording,
      inputs: [],
      endTick: 0,
      checkpoints: recording.checkpoints.slice(0, 1),
    })
    expect(answer.replay).toEqual({ kind: "nothing" })
    expect(reportLines(answer)[0]).toContain("ended at tick 0")
  })

  test("text that is not a recording fails, and says why, without throwing", () => {
    const answer = replayRecording(source, MANIFEST, "{ not json")
    expect(answer.replay.kind).toBe("failed")
    expect(answer.inputs.problem).not.toBeNull()
    const other = replayRecording(
      source,
      MANIFEST,
      JSON.stringify({ format: "x" }),
    )
    expect(other.replay.kind).toBe("failed")
  })

  test("a rules code that throws while replaying fails, with its message", () => {
    const recording = played()
    const answer = replayRecording(
      () => {
        throw new Error("no game today")
      },
      MANIFEST,
      JSON.stringify(recording),
    )
    expect(answer.replay).toEqual({
      kind: "failed",
      code: "E_UNEXPECTED",
      message: expect.stringContaining("no game today"),
    })
    // The inputs were still read, so they are still reported.
    expect(answer.inputs.problem).toBeNull()
  })
})

describe("what the page is told", () => {
  const base: DevReport = {
    replay: { kind: "matches", endTick: 1650, counters: { motes: 3 } },
    inputs: { count: 1204, budget: 26416, problem: null },
    bytes: 18234,
  }

  test("a run that matches says where it ended and what it counted", () => {
    expect(reportLines(base)).toEqual([
      "replayed: it matches, ending at tick 1,650 with motes 3",
      "inputs: 1,204, within the budget of 26,416",
      "recording: 18,234 bytes",
    ])
    expect(
      reportLines({
        ...base,
        replay: { kind: "matches", endTick: 1, counters: {} },
      })[0],
    ).toBe("replayed: it matches, ending at tick 1")
  })

  test("a run that differs names the first difference", () => {
    expect(
      reportLines({
        ...base,
        replay: {
          kind: "differs",
          divergedAt: 120,
          differences: ["tick 120: recorded a, replayed b"],
        },
      })[0],
    ).toBe(
      "replayed: it differs from tick 120: tick 120: recorded a, replayed b",
    )
    expect(
      reportLines({
        ...base,
        replay: { kind: "differs", divergedAt: null, differences: [] },
      })[0],
    ).toBe("replayed: it differs: no difference named")
  })

  test("a replay that failed, and inputs that were refused, say their codes", () => {
    const lines = reportLines({
      ...base,
      replay: { kind: "failed", code: "E_X", message: "broke" },
      inputs: {
        count: 9,
        budget: 16,
        problem: { code: "E_INPUT_RANGE", message: "too far" },
      },
    })
    expect(lines.slice(0, 2)).toEqual([
      "replayed: it failed, E_X: broke",
      "inputs: 9, refused as E_INPUT_RANGE: too far",
    ])
  })
})

describe("replaying in a process of its own", () => {
  let dir: string
  let sim: Uint8Array

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sdk-replay-"))
    // The probe game as a rules code: one self-contained module with a
    // factory as its default export, as `vbz build` writes one.
    const entry = join(dir, "entry.ts")
    await writeFile(
      entry,
      `import { Probe } from ${JSON.stringify(join(import.meta.dir, "..", "game", "subject.ts"))}\n` +
        "export default () => new Probe()\n",
    )
    const built = await Bun.build({ entrypoints: [entry], target: "browser" })
    const output = built.outputs[0]
    if (output === undefined) throw new Error("the probe did not build")
    sim = new Uint8Array(await output.arrayBuffer())
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("the built rules code replays a page's recording to the same answer", async () => {
    const recording = played()
    const answer = await replayInChild(sim, MANIFEST, JSON.stringify(recording))
    expect(answer).toEqual(report(recording))
    expect(answer.replay.kind).toBe("matches")
  })

  test("a rules code that will not load is a failed replay, with what the child said", async () => {
    const broken = new TextEncoder().encode(`throw new Error("will not load")`)
    const answer = await replayInChild(
      broken,
      MANIFEST,
      JSON.stringify(played()),
    )
    expect(answer.replay.kind).toBe("failed")
    if (answer.replay.kind !== "failed") return
    expect(answer.replay.message).toContain("will not load")
    expect(answer.bytes).toBeGreaterThan(0)
  })

  /**
   * The rules code is somebody's game, and `vbz dev` runs where an author
   * keeps a studio's secret key and cloud credentials in the environment. A
   * game that reads them at load would have them; the child is given none.
   */
  test("the rules code runs with none of the harness's environment", async () => {
    const reading = new TextEncoder().encode(
      `throw new Error("environment: " + JSON.stringify(process.env))`,
    )
    process.env.VBZ_STUDIO_KEY = "vbz_sk_not_for_a_game"
    try {
      const answer = await replayInChild(
        reading,
        MANIFEST,
        JSON.stringify(played()),
      )
      expect(answer.replay.kind).toBe("failed")
      if (answer.replay.kind !== "failed") return
      expect(answer.replay.message).toContain("environment: {}")
      expect(answer.replay.message).not.toContain("vbz_sk_not_for_a_game")
    } finally {
      delete process.env.VBZ_STUDIO_KEY
    }
  })

  test("a child that answers with something other than a report is a failed replay", async () => {
    const entry = join(dir, "chatty.ts")
    await writeFile(entry, `process.stdout.write("hello")\n`)
    const answer = await replayInChild(sim, MANIFEST, "{}", entry)
    expect(answer.replay.kind).toBe("failed")
    if (answer.replay.kind !== "failed") return
    expect(answer.replay.message).toContain("hello")
  })

  test("the child's entry is found as source here and as built output once installed", async () => {
    const both = join(dir, "entries")
    await mkdir(both, { recursive: true })
    expect(() => replayChildEntry(both)).toThrow(
      /replay-child entry is missing/,
    )
    await writeFile(join(both, "replay-child.js"), "")
    expect(replayChildEntry(both)).toBe(join(both, "replay-child.js"))
    await writeFile(join(both, "replay-child.ts"), "")
    expect(replayChildEntry(both)).toBe(join(both, "replay-child.ts"))
    expect(replayChildEntry()).toMatch(/replay-child\.ts$/)
  })
})

describe("the harness, asked about a run its page played", () => {
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "sdk-replay-template-"))
    await cp(TEMPLATE_DIR, root, {
      recursive: true,
      filter: (path) => isCopied(TEMPLATE_DIR, path),
    })
    await symlink(resolve("node_modules"), join(root, "node_modules"))
    await writeBuild(
      root,
      await buildGame({
        root,
        simEntry: "src/sim/index.ts",
        presentEntry: "src/present.ts",
        captureEntry: "src/capture.ts",
      }),
    )
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  /** Three seconds of the template with a tap on each button, as its page records it. */
  function templateRun(): Recording {
    const browser = fakeBrowser(320, 480)
    const scheduler = new ManualScheduler()
    const game = definePageModule({
      createGame: createTemplate,
      manifest: TEMPLATE_MANIFEST,
      createPresentation: () => new Drawn(),
      capture: templateCapture,
    })
    let ended: MountedEnd | null = null
    const handle = game.mount(browser.html, {
      mode: "play",
      seed: "harness",
      config: {},
      tickHz: 60,
      maxTicks: TEMPLATE_MANIFEST.session.maxTicks,
      expect: { manifestHash: game.manifestHash },
      handlers: {
        onCheckpoint: () => {},
        onFrame: () => {},
        onEnded: (end) => {
          ended = end
        },
        onError: (error) => {
          throw new Error(error.message)
        },
        onNotice: () => {},
      },
      scheduler,
      environment: browser.environment,
    })
    scheduler.run(10, FRAME_MS)
    for (const x of [50, 270]) {
      const finger = browser.down(x, 440)
      scheduler.run(5, FRAME_MS)
      browser.up(finger, x, 440)
      scheduler.run(40, FRAME_MS)
    }
    scheduler.run(80, FRAME_MS)
    handle.stop("abandoned")
    const end = ended as MountedEnd | null
    if (end === null) throw new Error("the run never ended")
    return end.recording
  }

  test("a run of the template replays against its own build, and its inputs pass", async () => {
    const harness = await startHarness({
      source: {
        root,
        simEntry: "src/sim/index.ts",
        presentEntry: "src/present.ts",
        captureEntry: "src/capture.ts",
      },
      hostPort: 0,
      bundlesPort: 0,
    })
    try {
      const recording = templateRun()
      expect(recording.inputs.length).toBeGreaterThanOrEqual(6)
      const answer = await fetch(`${harness.hostOrigin}/replay`, {
        method: "POST",
        body: JSON.stringify(recording),
      })
      const report = (await answer.json()) as DevReport
      expect(report.replay).toEqual({
        kind: "matches",
        endTick: recording.endTick,
        counters: recording.counters,
      })
      expect(report.inputs.problem).toBeNull()
      expect(reportPasses(report)).toBe(true)
    } finally {
      await harness.stop()
    }
  }, 120_000)
})
