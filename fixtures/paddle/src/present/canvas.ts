/**
 * Paddle's renderer: the drops, the paddle, and which way the screen leans.
 *
 * Everything here works in simulation units and scales to the canvas at the
 * end, so the two never disagree about where anything is. The canvas fills
 * the element it is mounted in, as every page module's presentation does.
 */

import type { Presentation } from "@clockwork2/engine"
import { DROP_RADIUS, PADDLE_Y, PLAYFIELD, type View } from "../sim"

export function createPaddlePresentation(): Presentation<View, HTMLElement> {
  let canvas: HTMLCanvasElement | null = null
  let context: CanvasRenderingContext2D | null = null

  return {
    mount(container: HTMLElement): void {
      canvas = container.ownerDocument.createElement("canvas")
      canvas.style.width = "100%"
      canvas.style.height = "100%"
      canvas.style.display = "block"
      container.append(canvas)
      context = canvas.getContext("2d")
    },

    render(view: View): void {
      if (canvas === null || context === null) return
      const size = Math.min(
        canvas.clientWidth || PLAYFIELD,
        canvas.clientHeight || PLAYFIELD,
      )
      if (canvas.width !== size) canvas.width = size
      if (canvas.height !== size) canvas.height = size
      const unit = size / PLAYFIELD

      context.fillStyle = "#0d0e11"
      context.fillRect(0, 0, size, size)

      // A level that leans with the screen, so a player sees what the game
      // read rather than guessing at it.
      context.save()
      context.translate(size / 2, 80 * unit)
      context.rotate((view.tilt / 10) * 0.5)
      context.fillStyle = "#3a3d46"
      context.fillRect(-120 * unit, -4 * unit, 240 * unit, 8 * unit)
      context.restore()

      context.fillStyle = "#f0a028"
      for (const drop of view.drops) {
        context.beginPath()
        context.arc(
          drop.x * unit,
          drop.y * unit,
          DROP_RADIUS * unit,
          0,
          Math.PI * 2,
        )
        context.fill()
      }

      context.fillStyle = "#3bd68a"
      context.fillRect(
        (view.paddleX - view.paddleHalf) * unit,
        PADDLE_Y * unit,
        view.paddleHalf * 2 * unit,
        18 * unit,
      )
    },

    unmount(): void {
      canvas?.remove()
      canvas = null
      context = null
    },
  }
}
