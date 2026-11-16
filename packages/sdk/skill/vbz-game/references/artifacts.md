# The two artifacts

A game version is two files, each stored under the SHA-256 of its own bytes.

| File | Built from | Imports | Loaded by |
|---|---|---|---|
| the simulation | `src/sim/index.ts` | **nothing** | the browser and the validator |
| the page module | `src/present.ts` | exactly `cw2:sim` | a studio's page |

## Why the page module imports rather than embeds

The claim the platform rests on is that replaying your input log reproduces your
score. That is worth nothing if the simulation your browser ran is not the
simulation the server runs, and two copies of one source, built twice, is not
the same thing as one file.

So the page module is built with the simulation left out, and emits a real
import. At upload the platform rewrites the specifier to the simulation's
content address and takes the page module's hash **after** that rewrite, so a
stored page module's bytes already name one simulation and can never name
another.

## Why `cw2:sim` and no other name

Three reasons, measured on bun rather than assumed:

- **Bun ignores `external` for a relative import.** A relative sim import
  cannot be externalised under a name we choose; it stays compiled in.
- **Two spellings of one module emit two imports.** A page module reaching the
  simulation through `./index` in one file and `./sim` in another would load it
  twice, which is two `MANIFEST` objects in one page.
- **`cw2:` is not resolvable by a browser.** An unrewritten page module fails
  at load with "Failed to resolve module specifier" rather than half-working.

Import it in `src/present.ts` and nowhere else:

```ts
import createGame, { MANIFEST } from "cw2:sim"
```

## A checkpoint each second

`definePageModule` writes one checkpoint per second of play, at whatever
`tickHz` the manifest declares, which is where the platform's replay compares
them. Nothing in the page module entry sets it.

## What is checked, on the bytes

1. One ES module, decodable as strict UTF-8.
2. The simulation's import list is empty. The page module's distinct import
   set is exactly `{"cw2:sim"}`, every entry a static import statement.
3. The quoted literal `"cw2:sim"` occurs exactly as many times as there are
   import entries. A higher count means the string is also data, so a text
   rewrite would change something the game reads, and the upload is refused
   rather than corrupted.
4. Size: 2 MiB for the simulation, 8 MiB for the page module.

A dynamic `import("cw2:sim")` is refused: it chooses its module at runtime,
past the scan.

## The rewritten path is root-relative

`/g/<game id>/sim/<64 hex>.js`, never a full URL. It resolves against the page
module's own URL, so the stored bytes carry no domain and the bundle host can
change without re-publishing anything, and it names the game, so a studio's
Content-Security-Policy can allow its own game's path and no other.

## What `vbz build` writes

```
dist/sim.js        the simulation
dist/present.js    the page module, with cw2:sim still intact
dist/manifest.json the manifest, read out of the built simulation
```

The page module is written **unrewritten** on purpose. The rewrite belongs to
the platform: a page module that arrived already pointing at an address would
be one naming a module nobody checked.

`dist/manifest.json` is read by evaluating the built simulation in a
subprocess, so what it holds is the manifest the code carries rather than a
second copy that can drift. That process, the bundler, which runs any macro
the source imports, and `vbz check`'s and `vbz dev`'s processes all start
with an empty environment (the bundler is given `NODE_ENV` alone), so a
game's code never sees a key or a credential the shell holds. Nothing in a
game should read `process.env`; `vbz publish` runs none of the game.
