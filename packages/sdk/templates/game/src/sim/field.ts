/**
 * Where everything is, in the simulation's own units.
 *
 * The playfield is `FIELD_WIDTH` by `FIELD_HEIGHT` whatever size the player's
 * screen is. The renderer stretches it over the whole element the game is
 * mounted in, and the device helpers measure a finger across that same
 * element, so a position here, a pixel drawn and a finger on the glass all
 * agree. The two buttons are drawn by the renderer at these rectangles and
 * hit-tested by `tick` against them: one set of numbers, read by both.
 */

export const FIELD_WIDTH = 480
export const FIELD_HEIGHT = 720

/**
 * How finely a finger's position is recorded: 0 to `POINTER_X_MAX` across
 * the field and 0 to `POINTER_Y_MAX` down it, one step for every 30 units.
 * The range is the recording's resolution, and a thumb resting on a button
 * only records a move when it crosses a step, so the coarsest range that can
 * still tell the buttons apart keeps a recording small.
 */
export const POINTER_X_MAX = 16
export const POINTER_Y_MAX = 24

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Each button is five steps wide and four tall. At the smallest viewport the
 * manifest allows, 320 by 480 CSS pixels, that is 100 by 80 pixels drawn, and
 * a finger lands on it across 110 by 90: well over the 44 pixels a thumb
 * needs, which a test measures.
 */
export const BUTTON_WIDTH = 150
export const BUTTON_HEIGHT = 120

export const LEFT_BUTTON: Rect = {
  x: 0,
  y: FIELD_HEIGHT - BUTTON_HEIGHT,
  width: BUTTON_WIDTH,
  height: BUTTON_HEIGHT,
}

export const RIGHT_BUTTON: Rect = {
  x: FIELD_WIDTH - BUTTON_WIDTH,
  y: FIELD_HEIGHT - BUTTON_HEIGHT,
  width: BUTTON_WIDTH,
  height: BUTTON_HEIGHT,
}

/** A recorded position, in steps, as a point on the field. */
export function fieldPoint(
  x: number,
  y: number,
): { readonly x: number; readonly y: number } {
  return {
    x: (x * FIELD_WIDTH) / POINTER_X_MAX,
    y: (y * FIELD_HEIGHT) / POINTER_Y_MAX,
  }
}

export function inside(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  )
}
