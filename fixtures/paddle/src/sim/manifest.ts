/**
 * A game steered by tilting the device.
 *
 * Tilt is recorded as one small number, how far the screen leans left or
 * right, from -10 to 10, rather than three raw gravity axes: a game-sized
 * value records less and replays the same. The arrow keys move the paddle
 * too, so the fixture plays on a desktop with no sensor.
 */

import type { Manifest } from "@clockwork2/engine/manifest"

export const MANIFEST: Manifest = {
  schemaVersion: 2,
  id: "paddle",
  version: "1.0.0",
  name: "Paddle",
  kernel: { version: "0.8.0" },
  session: {
    tickHz: 60,
    maxTicks: 60 * 120,
    maxWallSeconds: 180,
    hasEnding: true,
  },
  inputs: {
    // Which way the screen leans, and how far: 0 is flat, 10 is fully over.
    tilt: { min: -10, max: 10, label: "Tilt" },
    left: { min: 0, max: 1, label: "Left" },
    right: { min: 0, max: 1, label: "Right" },
  },
  counters: [
    { name: "caught", direction: "up", monotonic: true, label: "Caught" },
    { name: "ticksSurvived", direction: "up", monotonic: true, label: "Ticks" },
  ],
  rankBy: ["caught", "ticksSurvived"],
  tiePolicy: "shared",
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
