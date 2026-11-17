/**
 * The page's entry: reads `config.json` beside the page and starts it in the
 * mode the file names.
 *
 * Bundle it for the browser with whatever builds the rest of your site;
 * `vbz dev --site` bundles it with bun and serves it as `main.js`. Played
 * locally, `{ "mode": "local" }`, the page loads the build `vbz build` wrote,
 * served beside it as `game/`, and talks to nobody. Ranked, the file names
 * the platform's API and sign-in and your game's page key from the
 * dashboard, and `vbz dev --site` answers it with a stand-in for the platform
 * on this machine.
 */

import { createPlatformClient } from "@vbz-gg/sdk/platform"
import { readConfig, startLocalSite, startSite } from "./page"

try {
  const answer = await fetch("config.json", { cache: "no-store" })
  const config = readConfig(await answer.json())
  if (config.mode === "local") startLocalSite({ document })
  else startSite({ document, client: createPlatformClient(config) })
} catch (error) {
  const message = document.getElementById("message")
  if (message !== null) message.textContent = String(error)
}
