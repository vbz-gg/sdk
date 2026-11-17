/**
 * A scripted session of the template, recorded the way a page records it:
 * through `definePageModule`'s mount, the engine's device helpers and its
 * live queue, on a clock the test moves. It holds two things a page module
 * can get wrong without anything else noticing.
 *
 * The recording holds the presses made, each one released. A page that
 * silently recorded nothing, or a press it never let go, would pass every
 * comparison a replay makes, because the replay would agree with the empty
 * or stuck log it was given.
 *
 * And it stays small. Every input is stored and replayed, so a mapping that
 * records a stream rather than changes grows a run's recording until the
 * platform refuses it. The bound below came from running this script under
 * engine 0.8.0: 2,564 ticks of play, 73 presses, 203 inputs and a recording
 * of 10,136 bytes. It is that rounded up to 12 KiB, so a change to the
 * envelope does not fail it while a mapping that starts recording a stream
 * does.
 */

import { describe, expect, test } from "bun:test"
import {
  compareToRecording,
  type InputEvent,
  RecordedInputSource,
  runSession,
} from "@clockwork2/engine"
import { ManualScheduler } from "@clockwork2/engine/host"
import type { MountedEnd } from "../../src/game/contract"
import { definePageModule } from "../../src/game/define"
import { capture } from "../../templates/game/src/capture"
import {
  FIELD_HEIGHT,
  FIELD_WIDTH,
  LEFT_BUTTON,
  RIGHT_BUTTON,
} from "../../templates/game/src/sim/field"
import type { View } from "../../templates/game/src/sim/game"
import createGame, { MANIFEST } from "../../templates/game/src/sim/index"
import { fakeBrowser } from "./devices"

/** The recording's bound, and how it was produced: see the comment above. */
const MAX_RECORDING_BYTES = 12 * 1024

/** A shade over a sixtieth of a second, exact in binary: one tick a frame. */
const FRAME_MS = 16.75

const WIDTH = 320
const HEIGHT = 480

/** The middle of a button, in CSS pixels on a game element of the minimum size. */
function centreOf(rect: typeof LEFT_BUTTON) {
  return {
    x: ((rect.x + rect.width / 2) * WIDTH) / FIELD_WIDTH,
    y: ((rect.y + rect.height / 2) * HEIGHT) / FIELD_HEIGHT,
  }
}

const LEFT = centreOf(LEFT_BUTTON)
const RIGHT = centreOf(RIGHT_BUTTON)

/** The ways the script moves the runner, taken in turn. */
const WAYS = ["button", "key", "pad", "stick", "fingers"] as const
type Way = (typeof WAYS)[number]

/** A lane is safe while no rock in it is this close or closer. */
const DANGER = 40

function presses(inputs: readonly InputEvent[], code: string) {
  const of = inputs.filter((input) => input.code === code)
  return {
    down: of.filter((input) => input.value === 1).length,
    up: of.filter((input) => input.value === 0).length,
  }
}

/**
 * Up to a minute of the template, played by a script that dodges: it reads what the
 * presentation was last handed, and when a rock comes down its lane, or a
 * mote down another, it moves, each time by the next of the five ways a
 * player can: a button, a key, a controller's d-pad, its stick, or a tap on a
 * button while another finger rests on the track.
 */
async function scriptedSession() {
  const browser = fakeBrowser(WIDTH, HEIGHT)
  const scheduler = new ManualScheduler()
  // Held in an object, because a closure writes them and the compiler
  // narrows a plain `let` to the null it was given.
  const last: { view: View | null; ended: MountedEnd | null } = {
    view: null,
    ended: null,
  }
  const game = definePageModule<View, unknown>({
    createGame,
    manifest: MANIFEST,
    createPresentation: () => ({
      mount: () => {},
      render: (view: View) => {
        last.view = view
      },
      unmount: () => {},
    }),
    capture,
  })
  const errors: string[] = []
  const handle = game.mount(browser.html, {
    mode: "play",
    seed: "harness",
    config: {},
    tickHz: MANIFEST.session.tickHz,
    scripted: "ignore",
    files: "https://files.test/g/lane-runner/t/none/",
    expect: { manifestHash: game.manifestHash },
    handlers: {
      onCheckpoint: () => {},
      onFrame: () => {},
      onEnded: (end) => {
        last.ended = end
      },
      onError: (error) => errors.push(`${error.code}: ${error.message}`),
      onNotice: () => {},
    },
    scheduler,
    environment: browser.environment,
  })
  const frames = (count: number) => scheduler.run(count, FRAME_MS)
  const made = { touch0: 0, touch1: 0, left: 0, right: 0, stick: 0 }
  const used = new Set<Way>()

  const safe = (view: View, lane: number) =>
    !view.rocks.some((rock) => rock.lane === lane && rock.z <= DANGER)

  /** Moves `steps` lanes one way, by `way`, holding each press a few frames. */
  function move(way: Way, direction: -1 | 1, steps: number): void {
    used.add(way)
    const at = direction === -1 ? LEFT : RIGHT
    if (way === "fingers") {
      // A thumb resting on the track, which presses nothing, while the
      // other one taps: the tapping finger is the second down, slot 1.
      const resting = browser.down(WIDTH / 2, HEIGHT / 3)
      made.touch0 += 1
      frames(2)
      for (let step = 0; step < steps; step += 1) {
        const tap = browser.down(at.x + 4, at.y - 4)
        made.touch1 += 1
        frames(3)
        browser.up(tap, at.x + 4, at.y - 4)
        frames(2)
      }
      browser.up(resting, WIDTH / 2, HEIGHT / 3)
      frames(2)
      return
    }
    for (let step = 0; step < steps; step += 1) {
      if (way === "button") {
        const finger = browser.down(at.x, at.y)
        made.touch0 += 1
        frames(3)
        browser.up(finger, at.x, at.y)
      } else if (way === "key") {
        const key = direction === -1 ? "ArrowLeft" : "ArrowRight"
        browser.key(key, true)
        made[direction === -1 ? "left" : "right"] += 1
        frames(3)
        browser.key(key, false)
      } else if (way === "pad") {
        browser.pads[0] = {
          pressed: new Set([direction === -1 ? 14 : 15]),
          stick: 0,
        }
        made[direction === -1 ? "left" : "right"] += 1
        frames(3)
        browser.pads[0] = { pressed: new Set(), stick: 0 }
      } else {
        browser.pads[0] = { pressed: new Set(), stick: direction * 0.9 }
        made.stick += 1
        frames(3)
        browser.pads[0] = { pressed: new Set(), stick: 0 }
      }
      frames(3)
    }
  }

  // The game gets ready before its clock starts.
  await Bun.sleep(0)
  frames(1)
  let turn = 0
  for (let decision = 0; decision < 600 && last.ended === null; decision++) {
    frames(6)
    const view = last.view
    if (view === null || view.over) continue
    const lanes = [0, 1, 2].filter((lane) => safe(view, lane))
    const mote = view.motes.find((m) => lanes.includes(m.lane))
    const want = safe(view, view.lane)
      ? (mote?.lane ?? view.lane)
      : lanes.sort(
          (a, b) => Math.abs(a - view.lane) - Math.abs(b - view.lane),
        )[0]
    if (want === undefined || want === view.lane) continue
    // Through a lane that is not safe is no way at all.
    const between = Math.min(want, view.lane) + 1
    if (Math.abs(want - view.lane) === 2 && !safe(view, between)) continue
    const way = WAYS[turn % WAYS.length] as Way
    turn += 1
    move(way, want < view.lane ? -1 : 1, Math.abs(want - view.lane))
  }

  handle.stop("abandoned")
  expect(errors).toEqual([])
  if (last.ended === null) throw new Error("the session never ended")
  return { ended: last.ended, made, used }
}

describe("a scripted session of the template", () => {
  test("its recording holds every press made, each one released", async () => {
    const { ended, made, used } = await scriptedSession()
    const inputs = ended.recording.inputs
    // A session that recorded nothing, or barely ran, would pass vacuously.
    expect(ended.tick).toBeGreaterThan(1500)
    expect(inputs.length).toBeGreaterThan(100)
    expect([...used].sort()).toEqual([...WAYS].sort())
    expect(made.touch1).toBeGreaterThan(0)
    for (const code of ["touch0", "touch1", "left", "right"] as const) {
      expect(`${code} ${JSON.stringify(presses(inputs, code))}`).toBe(
        `${code} ${JSON.stringify({ down: made[code], up: made[code] })}`,
      )
    }
    // The stick goes to one side and comes back to the middle, each time.
    const stick = inputs.filter((input) => input.code === "stick")
    expect(stick.filter((input) => input.value !== 0)).toHaveLength(made.stick)
    expect(stick.filter((input) => input.value === 0)).toHaveLength(made.stick)
  })

  test("its recording stays under the stated size", async () => {
    const { ended } = await scriptedSession()
    const bytes = new TextEncoder().encode(
      JSON.stringify(ended.recording),
    ).byteLength
    expect(bytes).toBeLessThanOrEqual(MAX_RECORDING_BYTES)
  })

  test("its recording replays to the state the page reached", async () => {
    const { ended } = await scriptedSession()
    const recording = ended.recording
    const replayed = runSession({
      module: createGame(),
      seed: recording.seed,
      config: recording.config,
      inputs: new RecordedInputSource(recording.inputs),
      maxTicks: recording.endTick,
      checkpointEvery: recording.tickHz,
      counters: MANIFEST.counters,
    })
    expect(compareToRecording(recording, replayed)).toEqual({
      matches: true,
      divergedAt: null,
      differences: [],
    })
  })
})
