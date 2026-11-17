/**
 * Paddle's page module entry.
 *
 * The presentation fills the element it is mounted in, stretched on both
 * axes, so a finger's position across that element is its position across
 * the playfield, which is what the hit test in `tick` reads.
 */

import createGame, { MANIFEST } from "cw2:sim"
import { definePageModule } from "@vbz-gg/sdk/game"
import { capture } from "./capture"
import { createPaddlePresentation } from "./present/canvas"

export default definePageModule({
  createGame,
  manifest: MANIFEST,
  createPresentation: createPaddlePresentation,
  capture,
})
