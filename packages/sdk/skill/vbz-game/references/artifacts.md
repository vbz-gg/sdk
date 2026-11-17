# The two artifacts and the files folder

A game version is two modules, each stored under the SHA-256 of its own
bytes, and a folder of files, named by the SHA-256 of its listing.

| Part | Built from | Imports | Loaded by |
|---|---|---|---|
| the simulation | `src/sim/index.ts` | **nothing** | the browser and the validator |
| the page module | `src/present.ts` | `cw2:sim`, and files of the folder as `cw2:files/<path>` | a studio's page |
| the files folder | the game's own tools, into the folder `package.json` names | whatever its code imports, inside the folder | the page module, and the validator for data packs |

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
2. The simulation's import list is empty. The page module imports `cw2:sim`
   (`E_PRESENT_IMPORT_MISSING` without it), and besides it only files of the
   folder as `cw2:files/<path>` (`E_PRESENT_IMPORT_UNEXPECTED` for anything
   else), every entry a static import statement. Each such path is one the
   folder may hold (`E_FILE_PATH_INVALID`) and one its listing holds
   (`E_FILE_UNLISTED`).
3. The quoted literal `"cw2:sim"` occurs exactly as many times as there are
   imports of it, and `cw2:files/` exactly as many times as there are file
   imports. A higher count means the string is also data, so a text rewrite
   would change something the game reads, and the upload is refused rather
   than corrupted (`E_PRESENT_SPECIFIER_AMBIGUOUS`). A file the game reads at
   run time, art or data, is found through the folder's address instead.
4. Size: 4 MiB for the simulation, 16 MiB for the page module
   (`E_ARTIFACT_TOO_LARGE`).

The page module loads nothing at run time by a name it decides then. Any
`import()`, literal or computed, is refused with `E_PRESENT_DYNAMIC_IMPORT`,
and `new Worker`, `new SharedWorker` and `importScripts` with
`E_PRESENT_WORKER`. Code a game starts that way, such as a renderer's
workers, belongs in the files folder, where the page's policy bounds it to
the game's own path.

## The files folder

A game names its folder in `package.json`, and every command reads it from
there:

```json
{ "vbz": { "files": "files" } }
```

The game's own tools build it, a renderer's engine, art and data packs, and
`vbz build` lists every file by path, size and SHA-256. A game whose
`package.json` names no folder has an empty one; one that names a folder that
is not there stops the build, and so does one inside `dist/`.

- A path is relative and POSIX, made of letters, digits, `.`, `_`, `-` and
  `/`, with no `.` or `..` segment, listed once whatever its case
  (`E_FILE_PATH_INVALID`). A link is not followed.
- Each file holds at most 64 MiB (`E_FILE_TOO_LARGE`), all of them 512 MiB
  together (`E_FILES_TOO_LARGE`), in at most 10,000 files
  (`E_FILES_TOO_MANY`).
- Every data pack the manifest declares, a file the rules code reads, is a
  file of the folder at its declared path, of its declared size and SHA-256
  (`E_PACK_UNLISTED`, `E_PACK_MISMATCH`). One pack holds at most 16 MiB and
  all of them 48 MiB together (`E_PACKS_TOO_LARGE`), so the rules code and
  every pack fit one replay.
- A listing the platform is sent that is not paths, sizes and SHA-256s is
  `E_FILES_INVALID`.

## The rewritten paths are root-relative

`/g/<game id>/sim/<64 hex>.js` for the simulation and
`/g/<game id>/t/<64 hex>/` for the folder, whose name is the SHA-256 of its
listing, never a full URL. Each resolves against the page module's own URL,
so the stored bytes carry no domain and the bundle host can change without
re-publishing anything, and each names the game, so a studio's
Content-Security-Policy can allow its own game's path and no other. The
listing names every file's bytes, so a page module naming the folder names
every byte in it, forever.

## What `vbz build` writes

```
dist/sim.js        the simulation
dist/present.js    the page module, with cw2:sim and cw2:files/ still intact
dist/manifest.json the manifest, read out of the built simulation
dist/files.json    the folder's listing, the text its name is the SHA-256 of
dist/files/        a copy of the folder, by its listed paths
```

The page module is written **unrewritten** on purpose. The rewrite belongs to
the platform: a page module that arrived already pointing at an address would
be one naming code nobody checked.

`dist/manifest.json` is read by evaluating the built simulation in a
subprocess, so what it holds is the manifest the code carries rather than a
second copy that can drift. That process, the bundler, which runs any macro
the source imports, and `vbz check`'s and `vbz dev`'s processes all start
with an empty environment (the bundler is given `NODE_ENV` alone), so a
game's code never sees a key or a credential the shell holds. Nothing in a
game should read `process.env`; `vbz publish` runs none of the game.
