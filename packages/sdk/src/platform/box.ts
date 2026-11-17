/**
 * The sign-in's box over the page: a backdrop, a box holding the platform's
 * sign-in in a frame, and a Cancel button.
 *
 * Plain DOM, styled through CSSOM properties, which a policy of
 * `style-src 'self'` allows, so a page needs no stylesheet from this package
 * and no change to its policy beyond `frame-src`. Layout is set here, and
 * every colour comes from a `--gb-widget-*` custom property with a fallback,
 * as the widgets' do, so a page restyles the box by setting them on any
 * ancestor of `<body>`.
 *
 * Nothing here runs when the module loads: a page may import it while
 * rendering on a server.
 */

import type { SignInBox, SignInBoxHandlers } from "./environment.js"

/** The layout and colours every button the package draws shares. */
export function styleButton(button: HTMLButtonElement): void {
  button.style.font = "inherit"
  button.style.cursor = "pointer"
  button.style.padding = "var(--gb-widget-padding, 6px 12px)"
  button.style.borderRadius = "var(--gb-widget-radius, 8px)"
  button.style.border = "var(--gb-widget-border, 1px solid #3a3d46)"
  button.style.background = "var(--gb-widget-bg, #191b20)"
  button.style.color = "var(--gb-widget-fg, #ecedf0)"
}

/** What a screen reader calls the box and its frame. */
export const SIGN_IN_LABEL = "Sign in"

/**
 * Whether the frame still holds its first document, `about:blank`, which is
 * the page's own origin and so readable. A sign-in page, or the page a
 * browser shows for one it refused, is another origin's, and reading it
 * throws.
 */
function holdsBlank(frame: HTMLIFrameElement): boolean {
  try {
    return frame.contentWindow?.location.href === "about:blank"
  } catch {
    return false
  }
}

/**
 * Puts the box over `document`'s page, its frame holding nothing yet, and
 * moves focus into the frame, all in the calling turn. `onCancel` hears the
 * Cancel button, and Escape while focus is in the page rather than in the
 * frame; the sign-in tells the page about an Escape inside the frame
 * itself, with `vbz.signin.cancel`. `onFrameLoad` hears each page the frame
 * finishes loading once it is pointed at the sign-in, and never the blank
 * document it starts with, whose `load` may come after it is pointed.
 */
export function mountSignInBox(
  document: Document,
  handlers: SignInBoxHandlers,
): SignInBox {
  const { onCancel } = handlers
  const before = document.activeElement

  const backdrop = document.createElement("div")
  backdrop.className = "gb-signin-box"
  backdrop.style.position = "fixed"
  backdrop.style.inset = "0"
  backdrop.style.zIndex = "2147483647"
  backdrop.style.display = "flex"
  backdrop.style.alignItems = "center"
  backdrop.style.justifyContent = "center"
  backdrop.style.padding = "16px"
  backdrop.style.boxSizing = "border-box"
  backdrop.style.background =
    "var(--gb-widget-backdrop, rgba(10, 11, 14, 0.72))"

  const box = document.createElement("div")
  box.setAttribute("role", "dialog")
  box.setAttribute("aria-modal", "true")
  box.setAttribute("aria-label", SIGN_IN_LABEL)
  box.style.display = "flex"
  box.style.flexDirection = "column"
  box.style.gap = "var(--gb-widget-gap, 8px)"
  box.style.width = "min(440px, 100%)"
  box.style.height = "min(640px, 100%)"
  box.style.padding = "var(--gb-widget-gap, 8px)"
  box.style.boxSizing = "border-box"
  box.style.borderRadius = "var(--gb-widget-radius, 8px)"
  box.style.border = "var(--gb-widget-border, 1px solid #3a3d46)"
  box.style.background = "var(--gb-widget-bg, #191b20)"
  box.style.color = "var(--gb-widget-fg, #ecedf0)"

  const frame = document.createElement("iframe")
  frame.title = SIGN_IN_LABEL
  frame.style.flex = "1"
  frame.style.width = "100%"
  frame.style.minHeight = "0"
  frame.style.border = "0"
  frame.style.borderRadius = "var(--gb-widget-radius, 8px)"
  // Opaque, so a sign-in page whose colour scheme matches the page's, and
  // so paints no background of its own, is never drawn on the box's colour.
  frame.style.background = "var(--gb-widget-frame-bg, Canvas)"
  let pointed = false
  frame.addEventListener("load", () => {
    if (pointed && !holdsBlank(frame)) handlers.onFrameLoad()
  })

  const cancel = document.createElement("button")
  cancel.type = "button"
  cancel.textContent = "Cancel"
  styleButton(cancel)
  cancel.style.alignSelf = "flex-end"
  cancel.addEventListener("click", () => onCancel())

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    event.preventDefault()
    onCancel()
  }
  document.addEventListener("keydown", onKey, true)

  box.append(frame, cancel)
  backdrop.append(box)
  ;(document.body ?? document.documentElement).append(backdrop)
  // Into the frame in the click's own turn: a phone opens its keyboard for a
  // field only from a gesture, and the sign-in focuses its first field.
  frame.focus()

  return {
    get frame() {
      return frame.contentWindow
    },
    load(url) {
      pointed = true
      frame.src = url
    },
    remove() {
      document.removeEventListener("keydown", onKey, true)
      backdrop.remove()
      const back = before as { readonly isConnected?: boolean; focus?(): void }
      if (back?.isConnected === true) back.focus?.()
    },
  }
}
