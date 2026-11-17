/**
 * The folder's entry, which the page module imports as `cw2:files/entry.js`.
 *
 * It stands in for an engine built into a version's files folder, such as
 * null3d built by Vite and its plugin, and loads the rest the way one does:
 * every file by its place beside this one, from `import.meta.url`, so the
 * folder works wherever it is served. Three loads only a browser can settle
 * under a page's policy: WebAssembly fetched from the folder and compiled,
 * a worker started from a blob that imports a module of the folder, and a
 * module of the folder imported by a name decided at run time.
 */

/** A module of the folder, by a name the code works out as it runs. */
function loadDrawing() {
  const name = ["dr", "aw"].join("")
  return import(new URL(`./${name}.js`, import.meta.url).href)
}

/** The WebAssembly core: fetched, which takes `connect-src`, and compiled. */
async function loadCore() {
  const answer = await fetch(new URL("./core.wasm", import.meta.url))
  const { instance } = await WebAssembly.instantiateStreaming(answer)
  return instance.exports.tint()
}

/**
 * A worker from a blob of the page's own making, whose one line imports
 * the worker's module from the folder, as an engine on another origin
 * starts its workers.
 */
function startWorker() {
  const module = new URL("./worker.js", import.meta.url).href
  const source = `import ${JSON.stringify(module)}\n`
  const url = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  )
  const worker = new Worker(url, { type: "module" })
  return new Promise((resolve, reject) => {
    worker.addEventListener("message", (event) => {
      if (event.data === "ready") resolve(worker)
    })
    worker.addEventListener("error", () => {
      worker.terminate()
      reject(new Error(`the worker from ${module} did not start`))
    })
  }).finally(() => URL.revokeObjectURL(url))
}

/**
 * Everything ready to draw: the drawing, the core's tint and the worker. If
 * any of the three fails, a worker the others did not stop is terminated
 * before the failure is passed on, so a start that fails leaves nothing
 * running.
 */
export async function start() {
  const [drawn, cored, started] = await Promise.allSettled([
    loadDrawing(),
    loadCore(),
    startWorker(),
  ])
  if (
    drawn.status === "rejected" ||
    cored.status === "rejected" ||
    started.status === "rejected"
  ) {
    if (started.status === "fulfilled") started.value.terminate()
    const failed = [drawn, cored, started].find(
      (outcome) => outcome.status === "rejected",
    )
    throw failed.reason
  }
  const drawing = drawn.value
  const tint = cored.value
  const worker = started.value
  return {
    tint,
    drawnBy: drawing.NAME,
    draw: (context, view, width, height) =>
      drawing.draw(context, view, tint, width, height),
    stop: () => worker.terminate(),
  }
}
