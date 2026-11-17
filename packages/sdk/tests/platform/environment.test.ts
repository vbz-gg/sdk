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
    const mount = () =>
      browserEnvironment().mountSignInBox(() => {
        cancelled += 1
      })
    const backdrop = () =>
      document.querySelector(".gb-signin-box") as HTMLElement | null

    beforeEach(() => {
      cancelled = 0
      document.body.replaceChildren()
    })

    /**
     * A dialog over the whole page, holding a frame with nothing in it yet
     * and a Cancel button, and focus already in the frame: all of it before
     * the call returns, in the click's own turn.
     */
    test("is over the page with its frame focused, when the call returns", () => {
      const before = document.createElement("button")
      document.body.append(before)
      before.focus()
      const box = mount()
      const dialog = document.querySelector('[role="dialog"]')
      expect(dialog?.getAttribute("aria-modal")).toBe("true")
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
      const dialog = document.querySelector('[role="dialog"]') as HTMLElement
      const frame = dialog.querySelector("iframe") as HTMLIFrameElement
      const cancel = dialog.querySelector("button") as HTMLButtonElement
      for (const value of [
        backdrop()?.style.background,
        dialog.style.background,
        dialog.style.color,
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

    test("Cancel and Escape are the player closing it; another key is not", () => {
      const box = mount()
      ;(document.querySelector('[role="dialog"] button') as HTMLElement).click()
      expect(cancelled).toBe(1)
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
      expect(cancelled).toBe(1)
      const pressed = new KeyboardEvent("keydown", {
        key: "Escape",
        cancelable: true,
      })
      document.dispatchEvent(pressed)
      expect(cancelled).toBe(2)
      expect(pressed.defaultPrevented).toBe(true)
      box.remove()
    })

    test("taken down, it leaves nothing behind, and focus goes back where it was", () => {
      const before = document.createElement("button")
      document.body.append(before)
      before.focus()
      const box = mount()
      box.remove()
      expect(backdrop()).toBeNull()
      expect(document.activeElement).toBe(before)
      // Escape no longer reaches it.
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
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
