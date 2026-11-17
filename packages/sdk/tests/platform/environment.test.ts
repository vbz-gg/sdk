/**
 * The client's view of a real page, under happy-dom: the page's own origin,
 * its storage, its messages and timers, a `fetch` that still runs as the
 * window's once it is taken off it, and the sign-in's box over the page.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { browserEnvironment } from "../../src/platform/environment"

describe("with no window", () => {
  test("making a client's environment says it needs a browser page", () => {
    expect(() => browserEnvironment()).toThrow("runs in a browser page")
  })
})

describe("in a page", () => {
  beforeAll(() => {
    GlobalRegistrator.register({ url: "https://lantern.example/play" })
  })
  afterAll(async () => {
    await GlobalRegistrator.unregister()
  })

  test("reads the page's origin and storage", () => {
    const page = browserEnvironment()
    expect(page.origin).toBe("https://lantern.example")
    expect(page.storage()).toBe(window.localStorage)
    expect(page.now()).toBeGreaterThan(0)
    expect(typeof page.crypto.getRandomValues).toBe("function")
  })

  test("a storage the browser refuses reads as none", () => {
    const page = browserEnvironment()
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError")
      },
    })
    try {
      expect(page.storage()).toBeUndefined()
    } finally {
      if (original !== undefined)
        Object.defineProperty(window, "localStorage", original)
    }
  })

  test("hears the page's messages until it stops listening", () => {
    const page = browserEnvironment()
    const heard: unknown[] = []
    const listener = (event: { data: unknown }) => heard.push(event.data)
    page.addMessageListener(listener)
    window.dispatchEvent(new MessageEvent("message", { data: "one" }))
    page.removeMessageListener(listener)
    window.dispatchEvent(new MessageEvent("message", { data: "two" }))
    expect(heard).toEqual(["one"])
  })

  test("runs and cancels the page's timers", async () => {
    const page = browserEnvironment()
    const ran: string[] = []
    page.setTimeout(() => ran.push("timeout"), 0)
    page.clearTimeout(page.setTimeout(() => ran.push("cancelled"), 0))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(ran).toEqual(["timeout"])
  })

  test("a fetch taken off the window still runs as the window's", async () => {
    // A browser refuses a fetch called on anything but the window.
    const original = window.fetch
    let owner: unknown
    window.fetch = function (this: unknown) {
      owner = this
      return Promise.resolve(new Response("{}"))
    } as unknown as typeof window.fetch
    try {
      const { fetch } = browserEnvironment()
      await fetch("https://api.vbz.example/v1/game")
    } finally {
      window.fetch = original
    }
    expect(owner).toBe(window)
  })

  describe("the sign-in's box", () => {
    let cancelled = 0
    const mount = (onFrameLoad = () => {}) =>
      browserEnvironment().mountSignInBox({
        onCancel: () => {
          cancelled += 1
        },
        onFrameLoad,
      })
    const backdrop = () =>
      document.querySelector(".gb-signin-box") as HTMLElement | null

    beforeEach(() => {
      cancelled = 0
      document.body.replaceChildren()
    })

    /**
     * A modal dialog over the whole page, holding a frame with nothing in it
     * yet and a Cancel button, and focus already in the frame: all of it
     * before the call returns, in the click's own turn. Shown with
     * `showModal`, which is what makes the page behind it inert in a
     * browser; that Tab cannot reach the page is the browser suite's to
     * measure.
     */
    test("is a modal dialog over the page with its frame focused, when the call returns", () => {
      const before = document.createElement("button")
      document.body.append(before)
      before.focus()
      const shown: string[] = []
      const showModal = HTMLDialogElement.prototype.showModal
      HTMLDialogElement.prototype.showModal = function (
        this: HTMLDialogElement,
      ) {
        shown.push(this.className)
        showModal.call(this)
      }
      let box: ReturnType<typeof mount>
      try {
        box = mount()
      } finally {
        HTMLDialogElement.prototype.showModal = showModal
      }
      expect(shown).toEqual(["gb-signin-box"])
      const dialog = document.querySelector("dialog")
      expect(dialog?.open).toBe(true)
      expect(dialog?.getAttribute("aria-label")).toBe("Sign in")
      const frame = dialog?.querySelector("iframe") as HTMLIFrameElement
      expect(frame.title).toBe("Sign in")
      expect(frame.getAttribute("src")).toBeNull()
      expect(document.activeElement).toBe(frame)
      expect(box.frame).toBe(frame.contentWindow)
      expect(backdrop()?.style.position).toBe("fixed")
      expect(dialog?.querySelector("button")?.textContent).toBe("Cancel")
      box.remove()
    })

    /** A page restyles it by setting the custom properties, and needs no stylesheet. */
    test("takes every colour from a --gb-widget-* custom property, set through CSSOM", () => {
      const box = mount()
      const dialog = document.querySelector("dialog") as HTMLElement
      const frame = dialog.querySelector("iframe") as HTMLIFrameElement
      const cancel = dialog.querySelector("button") as HTMLButtonElement
      // The box: what holds the frame and Cancel, inside the backdrop.
      const held = frame.parentElement as HTMLElement
      for (const value of [
        backdrop()?.style.background,
        held.style.background,
        held.style.color,
        frame.style.background,
        cancel.style.background,
        cancel.style.color,
      ]) {
        expect(value).toStartWith("var(--gb-widget-")
      }
      // No stylesheet of its own, so a policy of style-src 'self' admits it.
      expect(document.querySelector("style")).toBeNull()
      box.remove()
    })

    /**
     * Pointed at a blank page here, which loads nothing from anywhere: what
     * a frame on the sign-in loads is the browser suite's question.
     */
    test("points its frame where it is told", () => {
      const box = mount()
      box.load("about:blank#authorize")
      expect(document.querySelector("iframe")?.getAttribute("src")).toBe(
        "about:blank#authorize",
      )
      box.remove()
    })

    /**
     * The ping goes to the page the frame holds, aimed at one origin, so a
     * page of any other origin, such as the one a browser shows for a
     * refused frame, never receives it.
     */
    test("posts to the page its frame holds, to the origin it is given alone", () => {
      const box = mount()
      const frame = document.querySelector("iframe") as HTMLIFrameElement
      const posted: unknown[] = []
      const window = frame.contentWindow as Window
      window.postMessage = ((message: unknown, origin: string) => {
        posted.push([message, origin])
      }) as Window["postMessage"]
      box.post(
        { type: "vbz.signin.ping", load: 1 },
        "https://signin.vbz.example",
      )
      expect(posted).toEqual([
        [{ type: "vbz.signin.ping", load: 1 }, "https://signin.vbz.example"],
      ])
      box.remove()
      // Off the page, the frame holds no page to post to.
      box.post(
        { type: "vbz.signin.ping", load: 2 },
        "https://signin.vbz.example",
      )
      expect(posted).toHaveLength(1)
    })

    /**
     * Each page the frame finishes once it is pointed at the sign-in is
     * told, and the blank document it starts with is not, even when that
     * one's `load` comes late: counted, it would be a page owing a ready
     * that never comes.
     */
    test("tells each page its frame loads once pointed, and never the blank one it starts with", async () => {
      let loads = 0
      const box = mount(() => {
        loads += 1
      })
      const frame = document.querySelector("iframe") as HTMLIFrameElement
      frame.dispatchEvent(new Event("load"))
      await Bun.sleep(5)
      expect(loads).toBe(0)
      box.load("about:blank#authorize")
      await Bun.sleep(5)
      expect(loads).toBe(1)
      // The first document's load, arriving after the frame was pointed.
      frame.src = "about:blank"
      await Bun.sleep(5)
      expect(loads).toBe(1)
      box.remove()
    })

    /**
     * Escape in the page is the dialog's `cancel`, which the box turns into
     * the player closing it rather than letting the dialog close itself. A
     * browser that closes it anyway is heard through `close`.
     */
    test("Cancel, the dialog's cancel and a close the browser made are the player closing it", () => {
      const box = mount()
      const dialog = document.querySelector("dialog") as HTMLDialogElement
      ;(dialog.querySelector("button") as HTMLElement).click()
      expect(cancelled).toBe(1)
      const escaped = new Event("cancel", { cancelable: true })
      dialog.dispatchEvent(escaped)
      expect(cancelled).toBe(2)
      expect(escaped.defaultPrevented).toBe(true)
      expect(dialog.open).toBe(true)
      dialog.close()
      expect(cancelled).toBe(3)
      box.remove()
      expect(cancelled).toBe(3)
    })

    test("taken down, it leaves nothing behind, and focus goes back where it was", () => {
      const before = document.createElement("button")
      document.body.append(before)
      before.focus()
      const box = mount()
      const dialog = document.querySelector("dialog") as HTMLDialogElement
      box.remove()
      // Closed and gone, which is no player closing it.
      expect(dialog.open).toBe(false)
      expect(backdrop()).toBeNull()
      expect(cancelled).toBe(0)
      expect(document.activeElement).toBe(before)
      // Nothing it heard reaches anybody, and taking it down again is nothing.
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }))
      box.remove()
      expect(cancelled).toBe(0)
      // A frame off the page has no window, so no message can be its.
      expect(box.frame).toBeNull()
    })

    test("focus that was nowhere stays nowhere", () => {
      const before = document.createElement("button")
      document.body.append(before)
      before.focus()
      const box = mount()
      before.remove()
      box.remove()
      expect(document.activeElement).not.toBe(before)
    })
  })
})
