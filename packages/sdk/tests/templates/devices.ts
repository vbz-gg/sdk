/**
 * A browser around the template's input mapping, every part of it a fake a
 * test drives by hand: an element of a size the test chooses, a window for
 * keys, and controllers a test plugs in. The device helpers run against it
 * exactly as they run on a page, so what they record is what a page would.
 */

import type { CaptureEnvironment } from "@clockwork2/engine/host"

/** An event target that hands each listener the plain object it is sent. */
export class FakeTarget implements EventTarget {
  private readonly listeners = new Map<
    string,
    Set<EventListenerOrEventListenerObject>
  >()

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
  ): void {
    if (listener === null) return
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
  ): void {
    if (listener === null) return
    this.listeners.get(type)?.delete(listener)
  }

  dispatchEvent(): boolean {
    return true
  }

  /** How many listeners it has, across every type. */
  listening(): number {
    let total = 0
    for (const set of this.listeners.values()) total += set.size
    return total
  }

  send(type: string, event: Record<string, unknown> = {}): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      const call =
        typeof listener === "function" ? listener : listener.handleEvent
      call.call(listener, {
        type,
        isTrusted: true,
        preventDefault: () => undefined,
        ...event,
      } as unknown as Event)
    }
  }
}

/** A controller in the standard layout, with the buttons and stick a test sets. */
export interface FakePad {
  pressed: Set<number>
  stick: number
}

/** The element a game is mounted in, `width` by `height` CSS pixels at the origin. */
export function fakeBrowser(width: number, height: number) {
  const element = new FakeTarget()
  const window = new FakeTarget()
  const document = Object.assign(new FakeTarget(), {
    visibilityState: "visible",
    pointerLockElement: null,
  })
  const pads: FakePad[] = []
  const html = Object.assign(element, {
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    style: { touchAction: "" },
    setPointerCapture: () => undefined,
    ownerDocument: { defaultView: { devicePixelRatio: 1 } },
  }) as unknown as HTMLElement
  const environment: CaptureEnvironment = {
    window,
    document: document as unknown as CaptureEnvironment["document"],
    gamepads: () =>
      pads.map(
        (pad, index) =>
          ({
            index,
            id: "Fake controller",
            connected: true,
            mapping: "standard",
            axes: [pad.stick, 0, 0, 0],
            buttons: Array.from({ length: 17 }, (_, b) => ({
              pressed: pad.pressed.has(b),
              value: pad.pressed.has(b) ? 1 : 0,
            })),
          }) as unknown as Gamepad,
      ),
    screenAngle: () => 0,
  }

  let nextPointer = 1
  return {
    element,
    html,
    window,
    environment,
    pads,
    /** A finger down at (x, y) CSS pixels; its id, for moving and lifting it. */
    down(x: number, y: number): number {
      const pointerId = nextPointer++
      element.send("pointerdown", {
        pointerId,
        pointerType: "touch",
        clientX: x,
        clientY: y,
        button: 0,
        buttons: 1,
      })
      return pointerId
    },
    move(pointerId: number, x: number, y: number): void {
      element.send("pointermove", {
        pointerId,
        pointerType: "touch",
        clientX: x,
        clientY: y,
        buttons: 1,
      })
    },
    up(pointerId: number, x: number, y: number): void {
      element.send("pointerup", {
        pointerId,
        pointerType: "touch",
        clientX: x,
        clientY: y,
        button: 0,
        buttons: 0,
      })
    },
    key(code: string, down: boolean): void {
      window.send(down ? "keydown" : "keyup", { code, repeat: false })
    },
  }
}
