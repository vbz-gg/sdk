/**
 * The page's entry: reads `config.json` beside the page and starts it.
 *
 * Bundle it for the browser with whatever builds the rest of your site;
 * `vbz dev --site` bundles it with bun and serves it as `main.js`, and
 * answers `config.json` with a stand-in for the platform on this machine.
 * In production `config.json` is the file beside this one, filled in with
 * the origins vbz.gg gives you and your game's page key from the dashboard.
 */

import { createPlatformClient } from "@vbz-gg/sdk/platform"
import { readConfig, startSite } from "./page"

try {
  const answer = await fetch("config.json", { cache: "no-store" })
  const config = readConfig(await answer.json())
  startSite({ document, client: createPlatformClient(config) })
} catch (error) {
  const message = document.getElementById("message")
  if (message !== null) message.textContent = String(error)
}
