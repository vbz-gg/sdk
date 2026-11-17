# folder

A game whose version carries a files folder, and the SDK's subject for one.
It loads from the folder what an engine built into a files folder loads,
such as null3d built by Vite and its plugin, without the engine, so the
browser suite can hold the page's policy and the readiness gate to it on a
machine with no GPU.

The page module imports `cw2:files/entry.js`, the folder's entry, which:

- fetches `core.wasm` from the folder and compiles it, which a page's
  policy admits with the game's path in `connect-src` and
  `'wasm-unsafe-eval'` in `script-src`;
- starts a worker from a blob whose one line imports `worker.js` from the
  folder, which takes `worker-src blob:` and the game's path;
- imports `draw.js` by a name it works out as it runs, as an engine loads
  the renderer for the device it finds.

Its presentation's `prepare` waits for all three and then 600 ms more, as an
engine compiling its shaders does, so the run's clock starts late, and it
refuses a device with no 2d canvas before tick 0. Its rules code reads
`packs/course.json`, a data pack the manifest declares, on demand from tick
180: no run scores before then.

`package.json` names the folder and says the game needs WebAssembly and
workers; that it fetches files of its folder the build shows by itself.

```bash
bun run packages/sdk/src/cli/index.ts dev fixtures/folder
```
