/**
 * Turns' renderer: the table as a line of text and a bar, in plain DOM. It
 * fills the element it is mounted in, as every page module's presentation
 * does.
 */

import type { Presentation } from "@clockwork2/engine"
import { TABLE, type View } from "../sim"

export function createTurnsPresentation(): Presentation<View, HTMLElement> {
  let root: HTMLElement | null = null
  let status: HTMLElement | null = null
  let ball: HTMLElement | null = null
  let mark: HTMLElement | null = null

  return {
    mount(container: HTMLElement): void {
      const document = container.ownerDocument
      root = document.createElement("div")
      root.style.cssText =
        "position:relative;width:100%;height:100%;background:#0d3b24;color:#f4f1e8;font:16px system-ui"
      status = document.createElement("p")
      status.style.cssText = "margin:0;padding:8px"
      mark = document.createElement("div")
      mark.style.cssText =
        "position:absolute;bottom:20%;width:2px;height:30%;background:#f0a028"
      ball = document.createElement("div")
      ball.style.cssText =
        "position:absolute;bottom:30%;width:12px;height:12px;border-radius:50%;background:#f4f1e8"
      root.append(status, mark, ball)
      container.append(root)
    },

    render(view: View): void {
      if (status === null || ball === null || mark === null) return
      status.textContent = `Seat ${view.turn + 1} to shoot, aim ${view.aim}. ${view.points[0]} to ${view.points[1]}`
      mark.style.left = `${(view.mark / TABLE) * 100}%`
      ball.style.left = `${((view.ball?.x ?? 0) / TABLE) * 100}%`
    },

    unmount(): void {
      root?.remove()
      root = null
    },
  }
}
