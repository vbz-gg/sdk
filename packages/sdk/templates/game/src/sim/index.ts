/**
 * The simulation bundle's entry. Two exports and nothing else:
 *
 *   - a default export a host calls for a fresh game each run
 *   - `MANIFEST`, which a host and the checks read before a tick runs
 *
 * The conformance checker is pointed at this file, and it scans the import
 * graph transitively. It must not reach the renderer: a simulation that can
 * touch a canvas is a simulation that can decide a score from one.
 */

export { type Config, DEFAULT_CONFIG, LaneRunner, type View } from "./game"
export { MANIFEST } from "./manifest"

import { LaneRunner } from "./game"

export default function createGame(): LaneRunner {
  return new LaneRunner()
}
