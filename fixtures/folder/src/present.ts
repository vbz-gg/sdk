/**
 * Folder's page module entry: its rules code as `cw2:sim`, and through the
 * presentation, the folder's entry as `cw2:files/entry.js`.
 */

import createGame, { MANIFEST } from "cw2:sim"
import { definePageModule } from "@vbz-gg/sdk/game"
import { capture } from "./capture"
import { createFolderPresentation } from "./present/folder"

export default definePageModule({
  createGame,
  manifest: MANIFEST,
  createPresentation: createFolderPresentation,
  capture,
})
