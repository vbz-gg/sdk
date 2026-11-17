# Drawing with null3d

[null3d](https://github.com/null3d-engine/null3d) draws from workers with a
WebAssembly core, on WebGPU or WebGL2. This page is how a vbz game draws
with it: where its code goes, how the page module reaches it, how the run's
clock waits for its first frame, why its input stays off, how a mouse turns
a camera that changes the result, which of its maths the rules code may use,
and what a page's policy and headers need.

null3d is not on npm yet, so this kit does not depend on it, and nothing
here is a template: it is a recipe. Every figure is from a study that drew
the kit's template with null3d in Chromium 141 and 153 and Firefox 142,
unless the sentence names another source.

## What goes where

| Part | Where | What it holds |
|---|---|---|
| `src/sim/` | the rules code | the game, on clockwork2 and `dmath`; of null3d, only its maths entry |
| `src/capture.ts` | the input mapping | keys, fingers and the mouse, through clockwork2's device helpers |
| `src/present.ts` | the page module's entry | `definePageModule`, as in every game |
| `src/present/null3d.ts` | the presentation | starts null3d, waits for its first frame, sends it each frame's view, and draws the controls on an overlay |
| `src/sketch/sketch.ts` | null3d's sketch | the scene, placed from the view it is sent, and nothing that decides anything |
| `engine-entry.ts`, `vite.config.ts` | null3d's build | null3d, its workers, cores and shader modules, and the sketch, built into the files folder |

## Building null3d into the files folder

Bundled into the page module, null3d cannot work: `vbz build`'s bundler
leaves its workers, its WebAssembly cores and its shader modules behind,
7,428 files it names and cannot ship, and the bundle carries 542 computed
`import()` calls, which a page module may not (`E_PRESENT_DYNAMIC_IMPORT`).
So null3d is built by its own toolchain, Vite and its plugin, into the
game's files folder, and the page module imports the folder's entry.

Until null3d publishes its first release, a game builds against a checkout:
pin a commit, build it once (`bun run build` in the checkout took about 40
minutes on 4 cores, most of it the shader set), and build the game's folder
with Vite and `@null3d/vite-plugin` from that same checkout. null3d is
`MIT OR Apache-2.0` and ships third-party code under its own licences, listed
in `packages/engine/THIRD-PARTY-NOTICES.txt`, which a game keeps beside it or
shows in its credits.

The entry is two lines:

```ts
// engine-entry.ts
export { createEngine } from "@null3d/engine"
export const SKETCH = new URL("./src/sketch/sketch.ts", import.meta.url)
```

and the build writes the folder, never into `dist/`:

```ts
// vite.config.ts
import null3d from "@null3d/vite-plugin"
import { defineConfig } from "vite"

export default defineConfig({
  base: "./", // the folder works from any address
  plugins: [null3d()],
  build: {
    outDir: "files/engine",
    emptyOutDir: true,
    modulePreload: false, // the entry is imported by a module, not loaded by a page
    rollupOptions: {
      input: { entry: "engine-entry.ts" },
      preserveEntrySignatures: "exports-only",
      output: { entryFileNames: "entry.js" },
    },
  },
})
```

```json
{ "vbz": { "files": "files", "needs": { "wasm": true, "workers": true } } }
```

Every file null3d loads at run time is named relative to the module that
loads it, `new URL(..., import.meta.url)`, and the plugin keeps those places,
so the folder works from `files.vbz.gg` and from beside a local page alike.

**Build only the shader permutations the game draws with.** The shader
modules decide the folder's size. null3d's guide,
`docs/guides/deterministic-simulation.md` in its repository, has the steps:
record the permutation words from a run of the game's page on both GPU paths
and at the low and high presets, build the shader modules from that list in
the checkout, and build the game with `NULL3D_ENGINE_SHADERS` naming them. A
three-lane scene drew with 5 words, and its folder held 297 files and
26,057,130 bytes, 4,737,421 after Brotli. Built against null3d's 172-word
examples list it held 759 files and 225,683,678 bytes, and null3d's full
shader set is 4,117,799,356 bytes in 8,148 files, over the 512 MiB and the
10,000 files a version may hold (`references/files.md`). A page of that
scene fetched 19 or 20 of the files, 3.1 to 3.9 MB raw and 842 to 870 KB
after Brotli, by thread mode and GPU path.

## The page module and the presentation

The page module imports the folder's entry as `cw2:files/engine/entry.js`,
and the game declares the import for TypeScript:

```ts
// src/null3d.d.ts
declare module "cw2:files/engine/entry.js" {
  export { createEngine } from "@null3d/engine"
  export const SKETCH: URL
}
```

The presentation starts null3d in its `prepare`, which the engine calls
after `mount` and before the run's clock starts:

```ts
// src/present/null3d.ts
import type { Presentation, PresentationContext } from "@clockwork2/engine"
import { Canvas2dPresentation } from "@clockwork2/engine/adapter-canvas2d"
import type { Engine } from "@null3d/engine"
import { createEngine, SKETCH } from "cw2:files/engine/entry.js"
import { FIELD_HEIGHT, FIELD_WIDTH } from "../sim/field"
import type { View } from "../sim/game"
import { drawControls, frameOf } from "./draw"

export function createPresentation(): Presentation<View, HTMLElement> {
  // The controls the rules code hit-tests, drawn at the same rectangles.
  const overlay = new Canvas2dPresentation<View>({
    width: FIELD_WIDTH,
    height: FIELD_HEIGHT,
    draw: (context, { view }) => drawControls(context, view),
  })
  let wrapper: HTMLDivElement | null = null
  let canvas: HTMLCanvasElement | null = null
  let engine: Engine | null = null
  let gone = false

  return {
    mount(container: HTMLElement, context: PresentationContext): void {
      const document = container.ownerDocument
      wrapper = document.createElement("div")
      wrapper.style.position = "relative"
      wrapper.style.width = "100%"
      wrapper.style.height = "100%"
      canvas = document.createElement("canvas")
      canvas.style.position = "absolute"
      canvas.style.inset = "0"
      canvas.style.width = "100%"
      canvas.style.height = "100%"
      const top = document.createElement("div")
      top.style.position = "absolute"
      top.style.inset = "0"
      wrapper.append(canvas, top)
      container.append(wrapper)
      overlay.mount(top, context)
    },

    // The run's clock starts when this resolves: once a frame is on screen.
    async prepare(): Promise<void> {
      const started = await createEngine({
        canvas: canvas as HTMLCanvasElement,
        sketch: SKETCH,
        input: false, // always: see "Input stays off"
      })
      if (gone) {
        await started.destroy()
        return
      }
      engine = started
      await started.firstFrame
    },

    render(view, previousView, alpha, dtMs): void {
      overlay.render(view, previousView, alpha, dtMs)
      // The view between the last two ticks, as plain numbers.
      engine?.postToSketch("frame", frameOf(view, previousView, alpha))
    },

    unmount(): void {
      gone = true
      overlay.unmount()
      void engine?.destroy()
      engine = null
      wrapper?.remove()
      wrapper = null
    },
  }
}
```

- **The readiness gate.** The engine starts the run's clock only once
  `prepare` resolves, so no tick runs and no input is recorded before null3d
  has drawn. Without it the template's run was over before null3d's first
  frame: 12 to 20 frames were rendered with no engine at the low preset, and
  with null3d choosing its own preset in software rendering the run ended
  15 s before its first frame. With it, no frame came before the engine was
  ready. null3d's own figure for a small page on an iPad is about 900 ms to
  ready.
- **A device that cannot draw it** spends no run. A browser with no usable
  GPU path rejects `createEngine` with null3d's E1301, `prepare` rejects, and
  the page's `playLocal` or `playRun` fails with `E_PRESENTATION_FAILED`
  before tick 0, `playRun` before it asks the platform for a run (measured
  in headless Firefox 142, which has neither WebGL nor WebGPU).
- **The sketch draws the view.** `render` sends the sketch the interpolated
  view once a frame, and the sketch keeps the latest and places its objects
  from it in `onUpdate`. Threaded, each message is copied, so send only the
  numbers the sketch draws.

```ts
// src/sketch/sketch.ts
import { defineSketch } from "@null3d/engine"
import type { Frame } from "../present/draw"

export default defineSketch(({ scene, page }) => {
  const camera = scene.createPerspectiveCamera({ fov: 55, position: [0, 5, 7] })
  scene.setActiveCamera(camera)
  // ... meshes, lights, made once
  let latest: Frame | null = null
  page.onMessage((name, data) => {
    if (name === "frame") latest = data as Frame
  })
  return {
    onUpdate() {
      if (latest === null) return
      camera.setPosition(latest.eye[0], latest.eye[1], latest.eye[2])
      camera.lookAt(latest.at[0], latest.at[1], latest.at[2])
      // ... place each mesh where the frame says
    },
  }
})
```

## Input stays off

Every vbz game creates null3d with `input: false`. null3d's own input
reaches only the sketch, and nothing records it, so a server replaying the
run never sees it. With input off, null3d adds none of the 12 listeners it
otherwise adds to the page, captures no pointer and reads no gamepad
(measured in every thread mode), the sketch's `ctx.input` stays at rest,
`engine.requestPointerLock()` fails with null3d's E1426, and a development
build warns when the sketch reads input anyway.

None of these decide anything a run counts:

- the sketch's `ctx.input`;
- pointer events on objects, `object.on("click")`;
- `scene.raycast`, `camera.screenToRay` and `scene.pick`, which test the
  scene null3d last drew, which a replay does not have;
- `@null3d/controls`;
- `engine.requestPointerLock()`: a game that locks the mouse locks it
  through clockwork2's mapping, below.

Picking that decides a result is the rules code's own maths, on a pointer
position clockwork2 recorded, with a camera the rules code owns. Controls
the game draws go on the overlay above null3d's canvas, at the rectangles
the rules code hit-tests, as the template's buttons are. clockwork2's
helpers listen on the element the game is mounted in, so a press that lands
on null3d's canvas is still recorded (measured).

A camera a viewer orbits while watching a replay changes no result, so the
kit refuses nothing of `@null3d/controls`. With input off it hears nothing,
though, and a presentation is the same for a run played and one watched, so
a camera in a vbz game is the rules code's, in the view.

## Mouse look-around that changes the result

A game where the mouse turns the view, and what the player sees decides
what they hit, records the mouse through clockwork2 and turns the camera in
the rules code. There is no other way: a camera the sketch turned from
null3d's input would decide where the player aimed where nothing records it.

The manifest declares two amounts and the lock:

```ts
inputs: {
  lookX: { min: -32, max: 32, label: "Look across" },
  lookY: { min: -32, max: 32, label: "Look up and down" },
},
capabilities: { /* ... */ pointerLock: true },
```

The mapping records the mouse's movement while it is locked to the game, in
coarse steps:

```ts
export const capture: CaptureMapping = {
  mouseLock: { dx: "lookX", dy: "lookY", pixelsPerUnit: 4 },
}
```

The engine asks for the lock when the player presses on the game, records
the movement summed over each tick and divided into steps, and needs the
page's `onNotice`, because a browser can refuse a lock. The rules code turns
the camera with `dmath`, so every engine gets the same bits, and puts it in
the view:

```ts
import { cos, PI, sin, TWO_PI } from "@clockwork2/engine/dmath"

const TURN = PI / 512 // radians a step

tick(inputs: readonly InputEvent[]): void {
  for (const input of inputs) {
    if (input.code === "lookX") this.yaw = (this.yaw + input.value * TURN) % TWO_PI
    if (input.code === "lookY") {
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch - input.value * TURN))
    }
  }
  // Aim, pick and collide with this same forward vector.
  this.forward = [
    cos(this.pitch) * sin(this.yaw),
    sin(this.pitch),
    -cos(this.pitch) * cos(this.yaw),
  ]
}

view(): View {
  return { eye: this.eye, forward: this.forward, /* ... */ }
}
```

The presentation sends the sketch the camera from the view, interpolated
between the last two ticks the short way round, and the sketch only draws
it. A camera of the sketch's own, from null3d's controls or its input, is
never the camera a run is played with.

**What it costs a recording.** A mouse that moves records on almost every
tick it moves. The engine guide's `clockwork2/references/inputs.md`
measured a mouse under lock moving 240 pixels a second across with a slow
sweep up and down, one event a frame, for five minutes at 60 Hz:

| Steps | Inputs | Per tick | Recording |
|---|---:|---:|---:|
| 4 pixels a step, -32 to 32 a tick | 22870 | 1.271 | 917512 bytes |
| 1 pixel a step, -1000 to 1000 a tick | 33888 | 1.883 | 1355158 bytes |

Both are inside the 16 inputs a tick a ranked run may hold. What bounds a
long run is its recording: a run ends as if the player left before it
fills the last 1 MiB of its 31 MiB, so it records at most 30 MiB. At the
coarse rate that is about 2 h 51 min of a mouse moving the whole time, and
at a pixel a step about 1 h 56 min (the five-minute sizes above, scaled).
Four pixels a step recorded 32% fewer inputs and bytes than one. Choose the
coarsest step that still aims as finely as the game needs, and a range wide
enough for the fastest turn a tick needs: a tick's movement past it is
carried into the ticks after, up to one range's width, and the rest is
dropped.

## null3d's maths in the rules code

The rules code may use null3d's maths, through its maths entry and nothing
else. null3d adds it in its next release:

| Import | Holds |
|---|---|
| `@null3d/engine/math/vec3`, `/quat`, `/mat4`, `/math` | the helpers that use only exact arithmetic |
| `@null3d/engine/math` | `createMath`, which builds the helpers that need a sine, a cosine, an arc cosine or an exponential from functions it is given |

```ts
import { acos, cos, exp, sin } from "@clockwork2/engine/dmath"
import { createMath } from "@null3d/engine/math"
import * as quat from "@null3d/engine/math/quat"
import * as vec3 from "@null3d/engine/math/vec3"

// Once, at load: the turning helpers, on dmath's exact functions.
const exact = createMath({ sin, cos, acos, exp })
```

- Never import `@null3d/engine` itself in the rules code. From the main
  entry, the rules code fails clockwork2's banned-API scan with 43 findings
  and carries 86 KB of page code, measured.
- Import `dmath`'s functions by name, as above: a whole namespace passed as
  a value keeps every function of it in the bundle.
- null3d's random helpers and its colour helpers stay drawing-only: the
  rules code draws from its own `Prng`.
- The sketch keeps drawing with null3d's own helpers on the browser's
  `Math`, and draws the state the rules code computed rather than computing
  it again.

## The page's policy and its headers

A page plays a null3d game under the policy with the game's needs, which
`pageCsp` in `@vbz-gg/sdk/harness` builds from them. For ranked play:

```
default-src 'none';
script-src 'self' https://files.vbz.gg/g/<game id>/ 'wasm-unsafe-eval';
worker-src blob: https://files.vbz.gg/g/<game id>/;
style-src 'self';
img-src 'self' data: blob:;
connect-src 'self' https://files.vbz.gg/g/<game id>/ https://api.vbz.gg;
frame-src https://signin.vbz.gg;
base-uri 'none';
form-action 'none';
frame-ancestors 'none'
```

Without `'wasm-unsafe-eval'` null3d stops with E1418, without the game's path
in `connect-src` with E1422 on its core's fetch, and without
`worker-src blob:` the browser refuses its workers, measured. No
`unsafe-eval` and no inline script is needed.

**Threads need the page isolated.** null3d runs threaded, its sketch and
drawing on workers, only on a page that is `crossOriginIsolated`; on any
other it runs single-threaded, and the sketch, its core and its drawing
share the page's thread with the run's ticks. null3d's own figures for a
small scene on an iPad: 0.48 to 1.86 ms a frame on that thread, against
0.24 to 1.10 ms on its busiest worker when threaded. Three ways, each
measured with the sign-in's box over the page:

1. **No isolation headers.** Single-threaded, in every engine. The box
   works.
2. **`Document-Isolation-Policy: isolate-and-require-corp`** on the page.
   Chromium 153 isolates the page and null3d ran threaded there; Chromium
   141 and Firefox 142 ignore the header and play single-threaded. The box
   renders under it. Safari was not measured.
3. **`Cross-Origin-Opener-Policy: same-origin` with
   `Cross-Origin-Embedder-Policy: require-corp`.** The page is isolated in
   Chromium, Firefox and WebKit, and null3d ran threaded in Chromium 141. The
   box renders and the page stays isolated, because the sign-in sends COEP
   and CORP on every page it lets be framed, measured with the sign-in on
   another site from the page in all three engines. Use `require-corp`:
   null3d's hosting guide says Safari does not support `credentialless`.

## What can go wrong

| What | Where it shows |
|---|---|
| null3d bundled into the page module | `E_PRESENT_DYNAMIC_IMPORT` at `vbz build` |
| the folder built with every shader permutation | `E_FILES_TOO_LARGE` or `E_FILES_TOO_MANY` at `vbz build` |
| a device with no usable GPU path | `E_PRESENTATION_FAILED` before tick 0, no run started |
| `wasm` or `workers` left out of `"vbz": { "needs" }` | null3d's E1418, or a worker the policy refuses, so the game never gets ready |
| a decision taken in the sketch | a run that replays to another result, because nothing recorded what the sketch read |
| `@null3d/engine` imported by the rules code | `E_LINT_BANNED` from the engine's checks |
