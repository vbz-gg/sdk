/**
 * The paddle fixture, the SDK's subject for tilt: a lean of the device read
 * through the engine's device helpers, recorded as one small number, and
 * steering the paddle in `tick`.
 */

import { describe, expect, test } from "bun:test"
import { LiveInputQueue } from "@clockwork2/engine"
import { InputCapture } from "@clockwork2/engine/host"
import { capture } from "../../../../fixtures/paddle/src/capture"
import {
  DEFAULT_CONFIG,
  Paddle,
  PLAYFIELD,
} from "../../../../fixtures/paddle/src/sim/index"
import { MANIFEST } from "../../../../fixtures/paddle/src/sim/manifest"
import { fakeBrowser } from "./devices"

function rig() {
  const browser = fakeBrowser(240, 320)
  const queue = new LiveInputQueue(MANIFEST.inputs)
  const helper = new InputCapture({
    ...capture,
    manifest: MANIFEST,
    queue,
    environment: browser.environment,
  })
  helper.attach()
  const game = new Paddle()
  game.init("tilt", DEFAULT_CONFIG)
  let tick = 0
  return {
    game,
    queue,
    /** The device leaning `gamma` degrees to the right, held upright otherwise. */
    lean(gamma: number) {
      browser.window.send("deviceorientation", { alpha: 0, beta: 0, gamma })
    },
    step() {
      const inputs = queue.take(tick)
      game.tick(inputs)
      tick += 1
      return inputs
    },
  }
}

describe("tilt on the paddle fixture", () => {
  test("a lean to the right records a tilt, and the paddle slides right while it holds", () => {
    const { game, lean, step } = rig()
    const start = game.view().paddleX
    expect(start).toBe(PLAYFIELD / 2)
    lean(30)
    const [input] = step()
    // Thirty degrees is full deflection, the top of the declared range.
    expect(input).toEqual({ tick: 0, code: "tilt", value: 10 })
    for (let i = 0; i < 10; i += 1) expect(step()).toEqual([])
    expect(game.view().paddleX).toBeGreaterThan(start)
    expect(game.view().tilt).toBe(10)
  })

  test("a lean the other way slides it left, and level again stops it", () => {
    const { game, lean, step } = rig()
    lean(-15)
    step()
    const leaning = game.view().paddleX
    step()
    expect(game.view().paddleX).toBeLessThan(leaning)
    lean(0)
    step()
    const level = game.view().paddleX
    step()
    expect(game.view().paddleX).toBe(level)
    expect(game.view().tilt).toBe(0)
  })

  test("a hand held still records nothing more", () => {
    const { lean, step } = rig()
    lean(12)
    expect(step()).toHaveLength(1)
    lean(12)
    lean(12.2)
    expect(step()).toEqual([])
  })
})
