/**
 * Which way the device leans, and which keys, drive Paddle's inputs.
 *
 * Tilt is read through the engine's device helpers: the direction of gravity
 * across the screen, turned with the screen, mapped onto the input's range,
 * with full deflection at 30 degrees and a deadband so a hand holding still
 * records nothing. A mapping that reads tilt is what makes the page module
 * report `needsMotion`, so a page asks for motion in the Play button's click,
 * the one place iOS lets it.
 *
 * Space is mapped as well as the arrows, which is what the browser suite
 * needs: a page's Play button is activated by Space, so a game mapping it is
 * where a key reaching the button instead of the game would show.
 */

import type { CaptureMapping } from "@clockwork2/engine/host"

export const capture: CaptureMapping = {
  tilt: { x: "tilt", fullAt: 30 },
  keys: { ArrowLeft: "left", ArrowRight: "right", Space: "centre" },
}
