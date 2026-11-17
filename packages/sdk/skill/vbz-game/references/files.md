# The files folder, data packs and needs

A game's build is two modules, the rules code and the page module, and
beside them a folder of files the game's own tools built: a renderer's
engine, art, sounds, fonts, and the data packs the rules code reads. This
page is that folder: how a game names it, how the page module reaches it,
which files the rules code may read, and what a page's policy has to allow
for it.

## Naming the folder

A game names its folder in its `package.json`, and every command reads it
from there, so a build and `vbz dev` never disagree about it:

```json
{ "vbz": { "files": "files" } }
```

- A game that names none has an empty folder.
- One that names a folder that is not there stops the command, and so does
  one inside `dist/`, which every build replaces. Build the folder first,
  with whatever the game's own tools are, then `vbz build`.
- `vbz build` lists every file by path, size and SHA-256 and copies the
  folder to `dist/files/`. The listing goes to `dist/files.json`, and the
  folder's name is the SHA-256 of that exact text, so
  `sha256sum dist/files.json` prints it. Nothing else goes into the name: the
  same files are the same folder in every build, and one changed byte is
  another folder.
- A path is relative and POSIX, made of letters, digits, `.`, `_`, `-` and
  `/`, with no `.` or `..` segment, listed once whatever its case
  (`E_FILE_PATH_INVALID`). A link in the folder is not followed.

## Reaching it from the page module

The page module imports a file of the folder by the prefix `cw2:files/`, in
a static import, and nowhere else:

```ts
import { start } from "cw2:files/entry.js"
```

At upload the platform rewrites the prefix to `/g/<game id>/t/<listing
sha256>/`, the way it rewrites `cw2:sim`, and a page playing locally maps it
with its import map. A path the listing does not hold is refused
(`E_FILE_UNLISTED`), and so is the string `cw2:files/` used as data
(`E_PRESENT_SPECIFIER_AMBIGUOUS`). TypeScript needs a declaration for each
such import, in a `.d.ts` of the game's own.

Everything else in the folder is found at run time by its address:

- the presentation is made with the folder, `createPresentation(files)`, and
  `files.url("art/ship.png")` is that file's absolute address;
- code inside the folder finds its neighbours from `import.meta.url`, as a
  Vite build does, so the folder works wherever it is served.

The page module itself loads nothing by an address it decides as it runs:
`import()` is refused (`E_PRESENT_DYNAMIC_IMPORT`), and so are
`importScripts` and `new SharedWorker` (`E_PRESENT_WORKER`). Code in the
folder is not read by anything and may load what it likes, from the folder
or anywhere else; the page's policy, which names the game's own path and
nothing else, is what keeps it there.

## Data packs

A data pack is a file the rules code reads, such as a level's layout or a
table of stats. Declare it in the manifest's `assets`, at the path it has in
the folder:

```ts
assets: [
  {
    path: "packs/harbor.json",
    sha256: "<64 hex>",
    bytes: 90210,
    requiredForSim: true,
    load: "demand", // or "start", the default
    license: "CC0",
  },
],
```

- A **start** pack is in hand before `init`. A **demand** pack is fetched
  once the rules code's `packsNeeded()` names it, and the tick after may read
  it, so a game fetches a town's data when the player reaches the town. The
  engine holds the loop while a named pack is missing, so the tick that first
  reads it is the same on every machine.
- `vbz build` refuses a pack the folder does not hold (`E_PACK_UNLISTED`),
  one whose size or SHA-256 is not the manifest's (`E_PACK_MISMATCH`), and
  packs over the limits below (`E_PACKS_TOO_LARGE`). Take the size and hash
  from the file: `wc -c` and `sha256sum` print them.
- On a page, the start packs are fetched while the game gets ready, so a
  pack that does not arrive spends no run. The platform keeps every pack as
  it keeps any file of the folder, and its replay reads the same bytes;
  `vbz dev` hands its replay the packs in the folder.
- Art the rules code never reads is not declared. It is a file of the
  folder, and the presentation fetches it.
- Split level data into one pack per area rather than one large pack, and
  prefer a binary layout for large tables. The engine's JSON reader is the
  simulation's own, so it gives the same value on every engine, and it is
  slower than the browser's: on a 16,777,048-byte pack of 332,575 small
  objects it took 357 to 402 ms against `JSON.parse`'s 67 to 97 ms under
  Bun 1.3.11, and 377 to 564 ms against 89 to 131 ms under Node 22.23.4,
  five runs each.

How a game reads a pack, `packsNeeded()` included, is the engine's subject:
`clockwork2/references/assets.md`.

## What a page's policy needs

A page sends a Content-Security-Policy that admits the game's own path and
nothing else. A folder may need more of it, and each need is added only when
it is named:

| Need | What the page's policy gains | Who says so |
|---|---|---|
| `wasm` | `'wasm-unsafe-eval'` in `script-src`, which compiles WebAssembly and evaluates no JavaScript | the game, in `package.json` |
| `workers` | `worker-src blob:` and the game's path | the game, in `package.json`; `vbz build` refuses a page module that calls `new Worker` without it |
| files | the game's path in `connect-src` | the build, whenever the folder lists a file |

```json
{ "vbz": { "files": "files", "needs": { "wasm": true, "workers": true } } }
```

A game says the first two because its build cannot show them: the code that
compiles WebAssembly or starts a worker may sit in the folder, which nothing
reads. Naming `files` there is refused, because the build already shows it.
`vbz dev` serves its pages under the policy with the game's needs, and
`pageCsp` and `localPageCsp` in `@vbz-gg/sdk/harness` build a page's policy
from them.

The browser suite holds this to a game that loads what an engine built into
a folder loads: WebAssembly fetched from the folder and compiled, a worker
started from a blob that imports a module of the folder, and a module of the
folder imported by a name worked out as it runs. With its needs it plays in
Chromium, Firefox and WebKit; with its needs left out, Chromium and Firefox
refuse the fetch (`connect-src`) and the worker (`worker-src`), and the game
never gets ready.

## The limits

Every size the platform holds a build, a game's files and a run to, as
`@vbz-gg/sdk/build` exports it:

| Limit | Value | What it holds |
|---|---|---|
| `MAX_SIM_BYTES` | 4 MiB | the rules code |
| `MAX_PRESENT_BYTES` | 16 MiB | the page module |
| `MAX_MANIFEST_BYTES` | 512 KiB | the manifest, as JSON with no white space |
| `MAX_FILE_BYTES` | 64 MiB | one file of the folder |
| `MAX_FILES_BYTES` | 512 MiB | every file of the folder together |
| `MAX_FILES` | 10,000 | how many files the folder holds |
| `MAX_UNNAMED_FILES_BYTES` | 1 GiB | the files a game holds on the platform that no version names |
| `MAX_FILE_PATH_LENGTH` | 512 | the characters of one file's path |
| `MAX_PACK_BYTES` | 16 MiB | one data pack |
| `MAX_PACKS_BYTES` | 48 MiB | every data pack together |
| `MAX_RUN_BYTES` | 31 MiB | a run's recording, and its chunks together |
| `MAX_CHUNK_BYTES` | 1 MiB | one chunk of a run |
| `MAX_LISTING_BYTES` | 6,170,011 bytes | the longest listing the limits above allow |
| `MAX_VERSION_PART` | 2,147,483,647 | each part of a version |

A file over its limit is `E_FILE_TOO_LARGE`, a folder over its limits
`E_FILES_TOO_LARGE` or `E_FILES_TOO_MANY`, and `vbz build` holds each file
to them by its size on disk before it reads a byte. A manifest over its
limit is `E_MANIFEST_INVALID`, from `vbz build` and the upload alike. The
files a game holds that no version names depend on what the platform
already has, so no build checks them: a file whose upload would take them
past their limit is refused with `E_QUOTA_EXCEEDED`, and "Where it goes"
below says when they leave. The rules code and every pack together fit one
replay, which is why level data goes in packs and not in the rules code:
every replay starts the rules code afresh. A replay also has a budget of
CPU time, wall time and memory, which only a replay measures, so no build
checks it: `@vbz-gg/sdk/build` exports it as `REPLAY_CPU_BUDGET_MS`,
`REPLAY_WALL_BUDGET_MS` and `REPLAY_MEMORY_MB`, and `references/ingest.md`
under "5. The rules code on the replay service" has the figures and what
the platform checks there before a version publishes.

## Where it goes

`vbz dev` serves the folder beside the two modules, at
`/g/<game id>/t/<listing sha256>/<path>`, the path `files.vbz.gg` uses.
`vbz publish` sends the listing first, with the manifest, and uploads only
the files the platform does not already hold for the game, one request
each. The platform keeps each file once per game, in its private store under
the SHA-256 of its bytes, however many versions or paths name it, so a file
a version shares with an earlier one is not sent again. Files uploaded for a
version that never arrives are named by no version, and the platform removes
them a day after each was last sent. Until then they count against the 1 GiB
a game may hold in files no version names (`MAX_UNNAMED_FILES_BYTES`), and
a file whose upload would pass it is refused with `E_QUOTA_EXCEEDED` until
a version names them or they are removed.

Only the public store holds a version's folder under its name. When a
version passes its checks, each file of its listing is copied to
`files.vbz.gg` under the listing's name and the file's path. Two versions
with an identical listing share that folder, so a takedown removes a
version's folder only when no other version that is served, or still being
checked, names it. `references/ingest.md` has what the platform checks.
