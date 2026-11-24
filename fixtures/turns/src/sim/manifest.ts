/**
 * Two players taking turns at one table.
 *
 * `session.seats` is 2, so a run has two seats and the rules code answers
 * `seat()`, whose turn the next tick is. Each seat's inputs are the same
 * declared inputs: a tick reads only the acting seat's, so an input carries
 * no seat. `multiplayer` stays false, because nobody acts at the same time
 * as anybody else.
 */

import type { Manifest } from "@clockwork2/engine/manifest"

export const MANIFEST: Manifest = {
  schemaVersion: 3,
  id: "turns",
  version: "1.0.0",
  name: "Turns",
  kernel: { version: "0.11.0" },
  session: {
    tickHz: 60,
    hasEnding: true,
    seats: 2,
  },
  inputs: {
    left: { min: 0, max: 1, label: "Aim shorter" },
    right: { min: 0, max: 1, label: "Aim longer" },
    shoot: { min: 0, max: 1, label: "Shoot" },
  },
  counters: [
    { name: "points0", direction: "up", monotonic: true, label: "Seat 1" },
    { name: "points1", direction: "up", monotonic: true, label: "Seat 2" },
    { name: "shots", direction: "up", monotonic: true, label: "Shots" },
  ],
  display: {
    orientation: "landscape",
    minViewport: { width: 320, height: 180 },
  },
  capabilities: {
    deterministic: true,
    physics: "none",
    renderer: "dom",
    multiplayer: false,
  },
}
