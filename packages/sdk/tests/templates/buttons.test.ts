/**
 * The template's two buttons, measured where a thumb meets them.
 *
 * The game draws its own controls and decides in `tick` whether a finger
 * landed on one, so nothing outside the game keeps a button large enough to
 * hit. This holds it: at the smallest viewport the manifest allows, each
 * button takes a press across at least 44 CSS pixels on each axis, and over
 * the whole of the rectangle the renderer draws it in. The press goes through
 * the engine's real device helpers, which quantise a finger to the coarse
 * steps the manifest declares, and the game's real `tick`, so what is
 * measured is the path a player's thumb takes.
 */

import { describe, expect, test } from "bun:test"
import { LiveInputQueue } from "@clockwork2/engine"
import { InputCapture } from "@clockwork2/engine/host"
import { capture } from "../../templates/game/src/capture"
import {
  FIELD_HEIGHT,
  FIELD_WIDTH,
  LEFT_BUTTON,
  type Rect,
  RIGHT_BUTTON,
} from "../../templates/game/src/sim/field"
import { DEFAULT_CONFIG, LaneRunner } from "../../templates/game/src/sim/game"
import { MANIFEST } from "../../templates/game/src/sim/manifest"
import { fakeBrowser } from "./devices"

/** A thumb's width, the size every control a player touches must reach. */
const MIN_TOUCH_PX = 44

const minimum = MANIFEST.display?.minViewport ?? { width: 0, height: 0 }
const WIDTH = minimum.width
const HEIGHT = minimum.height

type Pressed = "left" | "right" | "none"

/**
 * What one tap at (x, y) CSS pixels does, on a game element of the minimum
 * size: a fresh capture and a fresh game each time, so no probe leans on
 * where the last one left a finger.
 */
function tapAt(x: number, y: number): Pressed {
  const browser = fakeBrowser(WIDTH, HEIGHT)
  const queue = new LiveInputQueue(MANIFEST.inputs)
  const helper = new InputCapture({
    ...capture,
    manifest: MANIFEST,
    queue,
    scripted: "ignore",
    element: browser.html,
    onNotice: () => {},
    environment: browser.environment,
  })
  helper.attach()
  const finger = browser.down(x, y)
  browser.up(finger, x, y)
  helper.detach()

  const game = new LaneRunner()
  game.init("buttons", DEFAULT_CONFIG)
  const before = game.view().lane
  game.tick(queue.take(0))
  const after = game.view().lane
  return after < before ? "left" : after > before ? "right" : "none"
}

/** A rectangle of the field, in CSS pixels at the minimum size. */
function drawnAt(rect: Rect) {
  const sx = WIDTH / FIELD_WIDTH
  const sy = HEIGHT / FIELD_HEIGHT
  return {
    left: rect.x * sx,
    right: (rect.x + rect.width) * sx,
    top: rect.y * sy,
    bottom: (rect.y + rect.height) * sy,
  }
}

/** Every pixel centre along one axis, and what a tap there presses. */
function sweep(length: number, at: (position: number) => Pressed) {
  return Array.from({ length }, (_, i) => at(i + 0.5))
}

/** How many pixels in a row, starting where the first one is, press `which`. */
function span(row: readonly Pressed[], which: Pressed): number {
  const first = row.indexOf(which)
  if (first === -1) return 0
  let end = first
  while (row[end] === which) end += 1
  // One unbroken run: a button with a hole in it is two buttons.
  expect(row.slice(end).includes(which)).toBe(false)
  return end - first
}

describe("the template's buttons at its minimum size", () => {
  test("the manifest names a minimum size to measure at", () => {
    expect(WIDTH).toBeGreaterThan(0)
    expect(HEIGHT).toBeGreaterThan(0)
  })

  const left = drawnAt(LEFT_BUTTON)
  const right = drawnAt(RIGHT_BUTTON)
  const rowY = (left.top + left.bottom) / 2

  test("across the bottom, each button takes a press over at least 44 px, and the middle none", () => {
    const row = sweep(WIDTH, (x) => tapAt(x, rowY))
    expect(span(row, "left")).toBeGreaterThanOrEqual(MIN_TOUCH_PX)
    expect(span(row, "right")).toBeGreaterThanOrEqual(MIN_TOUCH_PX)
    expect(row[Math.floor(WIDTH / 2)]).toBe("none")
  })

  test("up each button, a press lands over at least 44 px, and above them none", () => {
    for (const [button, which] of [
      [left, "left"],
      [right, "right"],
    ] as const) {
      const column = sweep(HEIGHT, (y) =>
        tapAt((button.left + button.right) / 2, y),
      )
      expect(span(column, which)).toBeGreaterThanOrEqual(MIN_TOUCH_PX)
      expect(column[0]).toBe("none")
    }
  })

  /**
   * A press inside the drawn rectangle that missed would be a control drawn
   * somewhere the game does not believe it is, which a player presses to no
   * effect.
   */
  test("anywhere inside each drawn button presses it", () => {
    for (const [button, which] of [
      [left, "left"],
      [right, "right"],
    ] as const) {
      for (let x = Math.ceil(button.left); x < button.right; x += 4) {
        for (let y = Math.ceil(button.top); y < button.bottom; y += 4) {
          expect(`${x},${y} ${tapAt(x + 0.5, y + 0.5)}`).toBe(
            `${x},${y} ${which}`,
          )
        }
      }
    }
  })

  test("the buttons are drawn at least 44 px on each side", () => {
    for (const button of [left, right]) {
      expect(button.right - button.left).toBeGreaterThanOrEqual(MIN_TOUCH_PX)
      expect(button.bottom - button.top).toBeGreaterThanOrEqual(MIN_TOUCH_PX)
    }
  })
})

describe("two thumbs and a slide", () => {
  function rig() {
    const browser = fakeBrowser(WIDTH, HEIGHT)
    const queue = new LiveInputQueue(MANIFEST.inputs)
    const helper = new InputCapture({
      ...capture,
      manifest: MANIFEST,
      queue,
      scripted: "ignore",
      element: browser.html,
      onNotice: () => {},
      environment: browser.environment,
    })
    helper.attach()
    const game = new LaneRunner()
    game.init("thumbs", DEFAULT_CONFIG)
    let tick = 0
    return {
      browser,
      game,
      step() {
        game.tick(queue.take(tick))
        tick += 1
      },
    }
  }

  const left = drawnAt(LEFT_BUTTON)
  const right = drawnAt(RIGHT_BUTTON)
  const middle = (r: typeof left) => ({
    x: (r.left + r.right) / 2,
    y: (r.top + r.bottom) / 2,
  })

  test("a thumb held on the left and a second on the right each press their own", () => {
    const { browser, game, step } = rig()
    const a = middle(left)
    const b = middle(right)
    const first = browser.down(a.x, a.y)
    step()
    expect(game.view().lane).toBe(0)
    expect(game.view().held).toEqual({ left: true, right: false })

    const second = browser.down(b.x, b.y)
    step()
    expect(game.view().lane).toBe(1)
    expect(game.view().held).toEqual({ left: true, right: true })

    // Lifting the first leaves the second held: two fingers are two slots.
    browser.up(first, a.x, a.y)
    step()
    expect(game.view().held).toEqual({ left: false, right: true })
    browser.up(second, b.x, b.y)
    step()
    expect(game.view().held).toEqual({ left: false, right: false })
  })

  test("a thumb that lands on a button and slides onto the other presses once", () => {
    const { browser, game, step } = rig()
    const a = middle(left)
    const b = middle(right)
    const finger = browser.down(a.x, a.y)
    step()
    browser.move(finger, b.x, b.y)
    step()
    browser.up(finger, b.x, b.y)
    step()
    expect(game.view().lane).toBe(0)
    expect(game.view().held).toEqual({ left: false, right: false })
  })
})
