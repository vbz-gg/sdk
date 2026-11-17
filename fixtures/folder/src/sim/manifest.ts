/**
 * A game whose version carries a files folder, and whose rules code reads a
 * data pack from it on demand.
 *
 * The pack's path, size and SHA-256 are declared here, as every data pack
 * is, and `vbz build` holds the file in the folder to them. The rules code
 * names it in `packsNeeded()` from tick 180, so a page fetches it then and
 * not before, and the server's replay is handed the same bytes.
 */

import type { Manifest } from "@clockwork2/engine/manifest"

export const COURSE = "packs/course.json"

export const MANIFEST: Manifest = {
  schemaVersion: 3,
  id: "folder",
  version: "1.0.0",
  name: "Folder",
  kernel: { version: "0.10.0" },
  session: {
    tickHz: 60,
    hasEnding: true,
  },
  inputs: {
    left: { min: 0, max: 1, label: "Left" },
    right: { min: 0, max: 1, label: "Right" },
  },
  counters: [
    { name: "score", direction: "up", monotonic: true, label: "Score" },
    { name: "ticks", direction: "up", monotonic: true, label: "Ticks" },
  ],
  rankBy: ["score", "ticks"],
  tiePolicy: "shared",
  assets: [
    {
      path: COURSE,
      sha256:
        "23fb096cbf3910c83ed13be27dceb0d2cb186cd20a473275eec42fb75297be81",
      bytes: 126,
      requiredForSim: true,
      load: "demand",
      license: "CC0",
    },
  ],
  display: {
    orientation: "portrait",
    minViewport: { width: 240, height: 320 },
  },
  capabilities: {
    deterministic: true,
    physics: "none",
    renderer: "canvas2d",
    multiplayer: false,
  },
}
