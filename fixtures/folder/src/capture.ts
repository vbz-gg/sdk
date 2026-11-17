/**
 * The arrow keys move between the lanes. Touching no DOM, so `vbz check`
 * can hold it to the manifest.
 */

import type { CaptureMapping } from "@clockwork2/engine/host"

export const capture: CaptureMapping = {
  keys: { ArrowLeft: "left", ArrowRight: "right" },
}
