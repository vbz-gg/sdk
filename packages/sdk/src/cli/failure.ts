/**
 * The one line a command prints when it stops.
 *
 * A refusal carries a code a build script can grep for, so the line leads
 * with it. An engine error's message already does, and a publish error puts
 * its codes in its own message; a build refusal's message is its detail
 * alone, so its code is put in front here.
 */

import { BuildRefusal } from "../build/errors.js"

export function failureLine(error: unknown): string {
  if (error instanceof BuildRefusal) return `${error.code}: ${error.message}`
  return error instanceof Error ? error.message : String(error)
}
