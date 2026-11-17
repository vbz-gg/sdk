/**
 * The renderer. It reads the view and writes nothing.
 *
 * `alpha` is how far this frame sits between the last tick and the next, in
 * [0, 1). Interpolating with it is what makes a 60 Hz simulation look smooth
 * on a 144 Hz display; ignoring it makes the game look like it is running at
 * the tick rate. It is the only legitimate use of real time in a game.
 *
 * Everything the simulation may not touch is fine here: `Math.random` for a
 * purely visual flourish, `Math.sin`, `performance.now`. Nothing in this file
 * is read back by the simulation, so nothing in it can change a score.
 *
 * The canvas fills the element the game is mounted in, stretched on both
 * axes, because the device helpers measure a finger across that element. So
 * the two buttons drawn at `LEFT_BUTTON` and `RIGHT_BUTTON` are exactly where
 * `tick` hit-tests a finger, at every size the page gives the game.
 */

import { Canvas2dPresentation } from "@clockwork2/engine/adapter-canvas2d"
import {
  FIELD_HEIGHT,
  FIELD_WIDTH,
  LEFT_BUTTON,
  type Rect,
  RIGHT_BUTTON,
} from "../sim/field"
import { LANES, TRACK_LENGTH, type View } from "../sim/game"

/** Where the ship sits: above the buttons, so a thumb never covers it. */
const SHIP_Y = LEFT_BUTTON.y - 50

function laneX(lane: number): number {
  return ((lane + 0.5) / LANES) * FIELD_WIDTH
}

/** How far down the screen something `z` along the track is: 0 is the ship. */
function trackY(z: number): number {
  return SHIP_Y - (z / TRACK_LENGTH) * SHIP_Y
}

/** Straight-line interpolation between the two views this frame sits between. */
function depth(
  z: number,
  previousZ: number | undefined,
  alpha: number,
): number {
  return previousZ === undefined ? z : previousZ + (z - previousZ) * alpha
}

/** One button, lit while something holds it, with an arrow pointing `way`. */
function button(
  context: CanvasRenderingContext2D,
  rect: Rect,
  way: -1 | 1,
  held: boolean,
): void {
  const inset = 8
  context.fillStyle = held
    ? "rgba(110, 231, 255, 0.45)"
    : "rgba(27, 42, 74, 0.7)"
  context.beginPath()
  context.roundRect(
    rect.x + inset,
    rect.y + inset,
    rect.width - inset * 2,
    rect.height - inset * 2,
    18,
  )
  context.fill()
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  context.fillStyle = "#e5e7eb"
  context.beginPath()
  context.moveTo(cx + way * 22, cy)
  context.lineTo(cx - way * 14, cy - 22)
  context.lineTo(cx - way * 14, cy + 22)
  context.closePath()
  context.fill()
}

export function createPresentation(): Canvas2dPresentation<View> {
  return new Canvas2dPresentation<View>({
    width: FIELD_WIDTH,
    height: FIELD_HEIGHT,
    background: "#0b1020",
    draw: (context, { view, previousView, alpha }) => {
      const previousRocks = new Map(
        (previousView?.rocks ?? []).map((rock) => [rock.id, rock.z]),
      )
      const previousMotes = new Map(
        (previousView?.motes ?? []).map((mote) => [mote.id, mote.z]),
      )

      context.strokeStyle = "#1b2a4a"
      context.lineWidth = 2
      for (let lane = 1; lane < LANES; lane++) {
        const x = (lane / LANES) * FIELD_WIDTH
        context.beginPath()
        context.moveTo(x, 0)
        context.lineTo(x, LEFT_BUTTON.y)
        context.stroke()
      }

      for (const mote of view.motes) {
        const z = depth(mote.z, previousMotes.get(mote.id), alpha)
        context.fillStyle = "#6ee7ff"
        context.beginPath()
        context.arc(laneX(mote.lane), trackY(z), 7, 0, Math.PI * 2)
        context.fill()
      }

      for (const rock of view.rocks) {
        const z = depth(rock.z, previousRocks.get(rock.id), alpha)
        context.fillStyle = "#e05263"
        context.fillRect(laneX(rock.lane) - 16, trackY(z) - 16, 32, 32)
      }

      context.save()
      context.translate(laneX(view.lane), SHIP_Y)
      context.rotate(view.sway * 0.12)
      context.fillStyle = view.over ? "#6b7280" : "#f3f4f6"
      context.beginPath()
      context.moveTo(0, -22)
      context.lineTo(16, 18)
      context.lineTo(-16, 18)
      context.closePath()
      context.fill()
      context.restore()

      // The controls, drawn where `tick` hit-tests a finger for them.
      button(context, LEFT_BUTTON, -1, view.held.left)
      button(context, RIGHT_BUTTON, 1, view.held.right)

      context.fillStyle = "#e5e7eb"
      context.font = "16px system-ui, sans-serif"
      context.fillText(`motes ${view.motesTaken}`, 16, 28)
    },
  })
}
