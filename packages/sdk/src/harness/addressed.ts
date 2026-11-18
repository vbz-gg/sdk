/**
 * `dist/addressed.json`, which `vbz build --addressed` writes beside
 * `dist/addressed/`: what a page on another origin needs to load the build
 * from the root of the origin serving that folder.
 *
 * Its type lives here, beside `pageCsp`, because the page that reads the
 * file sends that policy: `gameId` and `needs` are what `pageCsp` takes with
 * the origin, and each path is from the origin's root, so
 * `new URL(path, origin)` is an address `loadGame` takes.
 */

import type { GameNeeds } from "./csp.js"

export interface AddressedBuild {
  /** The game's name, from its manifest. */
  readonly name: string
  /** The game id every path names, `/g/<game id>/`. */
  readonly gameId: string
  /** The page module, rewritten to import the two below. */
  readonly present: string
  /** The rules code, which the page module imports itself. */
  readonly sim: string
  /** The files folder, ending in `/`. */
  readonly files: string
  /** The engine's canonical hash of the manifest, which the page module must report. */
  readonly manifestHash: string
  /** What the version needs of the page's policy beyond its two modules. */
  readonly needs: GameNeeds
}
