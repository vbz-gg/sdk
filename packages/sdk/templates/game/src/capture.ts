/**
 * Which keys drive the game's inputs.
 *
 * Kept apart from the page module and touching no DOM, so `vbz check` can
 * read it and hold it to the manifest without loading anything that draws.
 * The engine's `checkCapture` refuses a mapping naming an input the
 * manifest does not declare.
 */

import type { CaptureMapping } from "@clockwork2/engine/host"

export const capture: CaptureMapping = {
  keys: {
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
  },
}
