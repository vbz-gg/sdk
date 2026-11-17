/**
 * The page module's entry: what a studio's page loads to play this game.
 *
 * It bundles the presentation, the input mapping and, through
 * `definePageModule`, the engine's host that plays them, so the engine that
 * plays a run is the one this game was built with. It imports the rules code
 * by the one name `cw2:sim` and by no other, because the platform serves the
 * rules code it checked and points this import at it.
 */

import createGame, { MANIFEST } from "cw2:sim"
import { definePageModule } from "@vbz-gg/sdk/game"
import { capture } from "./capture"
import { createPresentation } from "./present/canvas"

export default definePageModule({
  createGame,
  manifest: MANIFEST,
  createPresentation,
  capture,
})
