/**
 * Which keys, fingers and controllers drive the game's inputs.
 *
 * Kept apart from the page module and touching no DOM, so `vbz check` can
 * import it and hold it to the manifest without loading anything that draws.
 * The engine's `checkCapture` refuses a mapping naming an input the manifest
 * does not declare, or a range a press or a position cannot fit.
 *
 * The two buttons on screen are the game's own: the renderer draws them and
 * `tick` decides whether a finger landed on one. What is recorded here is
 * only where each finger is and whether it is down. Slot 0 is the first
 * finger down and slot 1 the second, so a thumb on each button works; a
 * third finger is mapped by nobody and records nothing.
 *
 * A controller's d-pad presses the same `left` and `right` the arrow keys
 * do, buttons 14 and 15 of the standard layout, and its stick is recorded as
 * left, centre or right. Mapping a controller means a page has to pass
 * `onNotice`, so a player can be told when the browser blocks it.
 */

import type { CaptureMapping } from "@clockwork2/engine/host"

export const capture: CaptureMapping = {
  keys: {
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
  },
  pointers: [
    { down: "touch0", x: "touch0X", y: "touch0Y" },
    { down: "touch1", x: "touch1X", y: "touch1Y" },
  ],
  gamepads: {
    any: { buttons: { 14: "left", 15: "right" }, axes: { 0: "stick" } },
  },
}
