# The two artifacts and the files folder

A game version is two modules and a folder of files, the folder named by
the SHA-256 of its listing. A page plays them from wherever they are
served, and if you publish to vbz.gg the platform stores each module under
the SHA-256 of its own bytes.

| Part | Built from | Imports | Loaded by |
|---|---|---|---|
| the simulation | `src/sim/index.ts` | **nothing** | the browser, and whatever replays a run |
| the page module | `src/present.ts` | `cw2:sim`, and files of the folder as `cw2:files/<path>` | a page: the game's own, or any other |
| the files folder | the game's own tools, into the folder `package.json` names | whatever its code imports, inside the folder | the page module, and a replay for data packs |

## Why the page module imports rather than embeds

A recording is worth something because replaying it reproduces the run.
That holds only if the simulation that replays it is the one the page ran,
and two copies of one source, built twice, is not the same thing as one
file.

So the page module is built with the simulation left out, and emits a real
import. A page of your own maps it to `dist/sim.js` with an import map. If
you publish to vbz.gg, the platform rewrites the specifier at upload to the
simulation's content address and takes the page module's hash **after**
that rewrite, so a stored page module's bytes already name one simulation
and can never name another.

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
`tickHz` the manifest declares, which is where a replay, the harness's or
vbz.gg's, compares them. Nothing in the page module entry sets it.

## What is checked, on the bytes

`vbz build` checks its own output, and vbz.gg, if you publish there, checks
the bytes it was sent the same way.

1. One ES module, decodable as strict UTF-8.
2. The simulation's import list is empty. The page module imports `cw2:sim`
   (`E_PRESENT_IMPORT_MISSING` without it), and besides it only files of the
   folder as `cw2:files/<path>` (`E_PRESENT_IMPORT_UNEXPECTED` for anything
   else), every entry a static import statement. Each such path is one the
   folder may hold (`E_FILE_PATH_INVALID`) and one its listing holds
   (`E_FILE_UNLISTED`).
3. The quoted literal `"cw2:sim"` occurs exactly as many times as there are
   imports of it, and `cw2:files/` exactly as many times as there are file
   imports. A higher count means the string is also data, so a text rewrite
   would change something the game reads, and the build is refused rather
   than corrupted (`E_PRESENT_SPECIFIER_AMBIGUOUS`). A file the game reads at
   run time, art or data, is found through the folder's address instead.
4. Size: 4 MiB for the simulation, 16 MiB for the page module
   (`E_ARTIFACT_TOO_LARGE`), and the folder's limits in
   `references/files.md`.

The page module loads nothing at run time by an address it decides then.
Any `import()`, literal or computed, is refused with
`E_PRESENT_DYNAMIC_IMPORT`, and `new SharedWorker` and `importScripts` with
`E_PRESENT_WORKER`. It may start a worker with `new Worker`, as pixi.js 8
does from a `blob:` URL of code it carries, or from a script in the files
folder; the page's policy, `worker-src blob:` and the game's own path, bounds
where one comes from. A game whose page module starts one says so in its
`package.json`, `"vbz": { "needs": { "workers": true } }`, or `vbz build`
stops and says to.

## The files folder

A game names its folder in `package.json`, as `"vbz": { "files": "files" }`,
and `vbz build` lists every file by path, size and SHA-256 and names the
folder by the SHA-256 of that listing. `references/files.md` has the folder
whole: naming it, reaching it from the page module, data packs, what a
page's policy needs for it, and every limit.

## If you use vbz.gg: the rewritten paths are root-relative

The rewrite `vbz dev` and the platform make: `/g/<game id>/sim/<64 hex>.js`
for the simulation and `/g/<game id>/t/<64 hex>/` for the folder, whose name
is the SHA-256 of its listing, never a full URL. Each resolves against the
page module's own URL, so the stored bytes carry no domain and the bundle
host can change without re-publishing anything, and each names the game, so
a studio's Content-Security-Policy can allow its own game's path and no
other. The listing names every file's bytes, so a page module naming the
folder names every byte in it, forever.

## What `vbz build` writes

```
dist/sim.js        the simulation
dist/present.js    the page module, with cw2:sim and cw2:files/ still intact
dist/manifest.json the manifest, read out of the built simulation
dist/files.json    the folder's listing, the text its name is the SHA-256 of
dist/files/        a copy of the folder, by its listed paths
dist/game.json     where each of those is and what they hash to, for a page
                   that plays the game locally from dist/ as it is
```

A page of your own serves all six, and reads `game.json` to find the rest.
If you publish to vbz.gg, `vbz publish` sends the first five and never
`game.json`.

The page module is written **unrewritten** on purpose. A page of your own
maps its specifiers with an import map, and the rewrite to content
addresses belongs to the platform: a page module that arrived already
pointing at an address would be one naming code nobody checked.

`dist/manifest.json` is read by evaluating the built simulation in a
subprocess, so what it holds is the manifest the code carries rather than a
second copy that can drift. That process, the bundler, which runs any macro
the source imports, and `vbz check`'s and `vbz dev`'s processes all start
with an empty environment (the bundler is given `NODE_ENV` alone), so a
game's code never sees a key or a credential the shell holds. Nothing in a
game should read `process.env`, and `vbz publish`, for vbz.gg, runs none of
the game.
