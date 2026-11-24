/**
 * Which keys drive Turns' inputs. Every page of a match maps the same keys:
 * a page records only on its own seat's turn, and the host drops what the
 * keys do on another seat's.
 */

import type { CaptureMapping } from "@clockwork2/engine/host"

export const capture: CaptureMapping = {
  keys: { ArrowLeft: "left", ArrowRight: "right", Space: "shoot" },
}
