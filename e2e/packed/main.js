/**
 * The smallest studio page: it loads a game's page module from another
 * origin with `loadGame`, from `@vbz-gg/sdk` as npm installs it, and plays
 * it. The browser suite bundles it with Vite, webpack and esbuild, which is
 * how a studio's page reaches the package.
 *
 * What it is testing is one line inside the package: `loadGame` imports a
 * URL it is handed at run time, and a bundler that rewrote that import into
 * one of its own module lookups would load nothing. Two comments in the
 * package's `dist` tell webpack and Vite to leave it alone, and esbuild
 * leaves an import of a variable alone by itself.
 *
 * Plain JavaScript and no top-level await, so all three bundle it with no
 * configuration at all.
 */

import { loadGame } from "@vbz-gg/sdk/host"

const query = new URLSearchParams(location.search)
const stage = document.getElementById("stage")
// Sized from script: the page's policy refuses a style attribute.
stage.style.width = "320px"
stage.style.height = "480px"

loadGame({
  presentUrl: query.get("present") ?? "",
  manifestHash: query.get("hash") ?? "",
})
  .then((game) => {
    document.body.dataset.loaded = "ready"
    game.mount(stage, {
      mode: "play",
      seed: "packed",
      config: {},
      tickHz: Number(query.get("tickHz")),
      maxTicks: Number(query.get("maxTicks")),
      expect: { manifestHash: game.manifestHash },
      handlers: {
        onCheckpoint: () => {},
        onFrame: (frame) => {
          document.body.dataset.tick = String(frame.tick)
        },
        onEnded: () => {},
        onError: (error) => {
          document.body.dataset.failed = error.code
        },
        onNotice: () => {},
      },
    })
  })
  .catch((error) => {
    document.body.dataset.loaded = error.code ?? String(error)
  })
