/**
 * The browser suite.
 *
 * `retries: 0`. This suite is about what a browser does with a module from
 * another origin, a held button and two fingers, and every one of those is
 * either right or a bug. A retry that turns red into green throws away the
 * finding.
 *
 * One worker. The servers keep one request log per bundles origin and one
 * stand-in per game, and a parallel run would interleave two pages' requests
 * into one log.
 *
 * Chromium for everything, and Firefox and WebKit for the specs that are
 * each engine's to decide: whether the policy a studio's page is told to send
 * lets the page module and its rules code in, and keeps another game's out;
 * whether the engine frames the platform's sign-in in the box over a
 * page, under COOP and COEP too, and what it does with a frame it refuses;
 * and whether the policy, with a game's needs, admits what an engine in a
 * files folder loads: WebAssembly, a worker from a blob importing the
 * folder, and a module imported by a computed name.
 * The fingers are Chromium's own input protocol, and so is the tilt sensor's
 * override. Whether a game computes the same numbers on another engine is a
 * question clockwork2 answers with its three-engine sweep, not this suite.
 */

import { defineConfig, devices } from "@playwright/test"
import { CONTROL_ORIGIN, hostOrigin } from "./src/env"

/** The specs every engine runs. */
const EVERY_ENGINE =
  /(a-module-from-another-origin|the-sign-in-box|a-version-with-a-files-folder)\.spec\.ts$/

export default defineConfig({
  testDir: "./specs",
  retries: 0,
  workers: 1,
  fullyParallel: false,
  forbidOnly: process.env.CI === "true",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter:
    process.env.CI === "true"
      ? "list"
      : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: hostOrigin("template"),
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "firefox",
      testMatch: EVERY_ENGINE,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      testMatch: EVERY_ENGINE,
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: {
    // Everything, built and served by one process. It builds the package and
    // each game first, so a stale `dist` cannot be what is served.
    command: "bun run src/servers.ts",
    url: `${CONTROL_ORIGIN}/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    // So the process can remove the packed copy it unpacked.
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
  },
})
