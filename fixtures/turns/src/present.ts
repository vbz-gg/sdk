/**
 * Turns' page module entry. It is the page module of any game: the page
 * that loads it says which seat it plays, through `seats` on the run.
 */

import createGame, { MANIFEST } from "cw2:sim"
import { definePageModule } from "@vbz-gg/sdk/game"
import { capture } from "./capture"
import { createTurnsPresentation } from "./present/dom"

export default definePageModule({
  createGame,
  manifest: MANIFEST,
  createPresentation: createTurnsPresentation,
  capture,
})
