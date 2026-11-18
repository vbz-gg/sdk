/**
 * What an answer to a request for tilt means for the run it was asked for.
 *
 * A game that reads tilt is steered by it, so a run started without tilt is
 * a run nobody can steer, and on iOS, which remembers a refusal, every run
 * after it would be the same. So anything but a grant starts nothing:
 * `playLocal` starts no run, `playRun` fails the run with it before asking
 * the platform for one, and the harness page refuses the run on its status
 * line. All read the answer here, so a page and the harness cannot decide it
 * two ways.
 */

import type { MotionAccess } from "@clockwork2/engine/host"
import { CLIENT_ERROR, PlatformClientError } from "../platform/errors.js"

/**
 * Why `access` stops a run from starting, or null when tilt was granted.
 *
 * Each refusal the engine answers is a client code by the engine's own name,
 * with a sentence for the player. A page module built against a later engine
 * may answer one this page has no sentence for: it still starts nothing, and
 * arrives as `E_UNEXPECTED` naming the code it answered.
 */
export function motionRefusal(
  access: MotionAccess,
): PlatformClientError | null {
  if (access.granted) return null
  if (Object.hasOwn(CLIENT_ERROR, access.code)) {
    return new PlatformClientError(access.code)
  }
  return new PlatformClientError("E_UNEXPECTED", {
    cause: `${access.code}: ${access.detail}`,
  })
}
