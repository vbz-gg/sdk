/**
 * The drawing, which the folder's entry imports by a name it works out as
 * it runs, as an engine loads a renderer for the device it finds.
 */

export const NAME = "draw.js"

const LANES = 3

/** The three lanes, the runner in its lane, and the score, in the core's tint. */
export function draw(context, view, tint, width, height) {
  context.fillStyle = "#0b1020"
  context.fillRect(0, 0, width, height)
  const lane = width / LANES
  for (let at = 1; at < LANES; at += 1) {
    context.fillStyle = "#1b2a4a"
    context.fillRect(at * lane - 1, 0, 2, height)
  }
  context.fillStyle = `hsl(${tint * 4} 80% 60%)`
  context.fillRect(
    view.lane * lane + lane / 4,
    height * 0.75,
    lane / 2,
    lane / 2,
  )
  context.fillStyle = "#e5e7eb"
  context.font = `${Math.round(height / 16)}px system-ui, sans-serif`
  context.fillText(String(view.score), 12, height / 12)
}
