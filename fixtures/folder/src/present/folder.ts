/**
 * A presentation that has to get ready before it can draw, as a renderer
 * built into the files folder does.
 *
 * Its `prepare` starts the folder's entry, which fetches and compiles the
 * WebAssembly core, starts a worker and imports the drawing by a computed
 * name, and then waits `READY_AFTER_MS` more, as an engine compiling its
 * shaders does. The engine starts the run's clock only once `prepare`
 * resolves, so no tick runs and no input is recorded before the game can be
 * drawn, and a device without a 2d canvas fails before tick 0. Taken down
 * while it gets ready, it stops what getting ready started as soon as that
 * arrives, so nothing it started outlives it.
 *
 * What it did is written on the element it fills, as data attributes the
 * browser suite reads: when getting ready started and ended, when the first
 * frame was drawn, how many frames came before it was ready, what the core
 * answered, which module drew, that the worker answered, and the tick it
 * last drew.
 */

import { type Started, start } from "cw2:files/entry.js"
import type { Presentation, PresentationContext } from "@clockwork2/engine"
import type { View } from "../sim"

/** How long getting ready takes after everything has loaded. */
export const READY_AFTER_MS = 600

/** The engine's presentation with the `prepare` a renderer that starts late has. */
export interface PreparedPresentation extends Presentation<View, HTMLElement> {
  prepare(container: HTMLElement, context: PresentationContext): Promise<void>
}

export function createFolderPresentation(): PreparedPresentation {
  let container: HTMLElement | null = null
  let canvas: HTMLCanvasElement | null = null
  let context: CanvasRenderingContext2D | null = null
  let engine: Started | null = null
  let framesBeforeReady = 0
  let drawnOnce = false
  /** Taken down: whatever getting ready starts after this is stopped. */
  let gone = false

  const mark = (name: string, value: string | number) => {
    if (container !== null) container.dataset[name] = String(value)
  }

  return {
    mount(into: HTMLElement): void {
      container = into
      canvas = into.ownerDocument.createElement("canvas")
      canvas.style.width = "100%"
      canvas.style.height = "100%"
      canvas.style.display = "block"
      into.append(canvas)
    },

    async prepare(): Promise<void> {
      mark("prepareStarted", performance.now())
      context = canvas?.getContext("2d") ?? null
      if (context === null) {
        throw new Error("this browser gives the game no 2d canvas to draw on")
      }
      const started = await start()
      if (gone) {
        started.stop()
        return
      }
      await new Promise((resolve) => setTimeout(resolve, READY_AFTER_MS))
      if (gone) {
        started.stop()
        return
      }
      engine = started
      mark("tint", started.tint)
      mark("drawnBy", started.drawnBy)
      mark("worker", "ready")
      mark("prepareReady", performance.now())
    },

    render(view: View): void {
      if (canvas === null || context === null || engine === null) {
        framesBeforeReady += 1
        mark("framesBeforeReady", framesBeforeReady)
        return
      }
      if (!drawnOnce) {
        drawnOnce = true
        mark("firstFrame", performance.now())
        mark("framesBeforeReady", framesBeforeReady)
      }
      const width = canvas.clientWidth || 240
      const height = canvas.clientHeight || 320
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      engine.draw(context, view, width, height)
      mark("tick", view.ticks)
    },

    unmount(): void {
      gone = true
      engine?.stop()
      engine = null
      canvas?.remove()
      canvas = null
      context = null
    },
  }
}
