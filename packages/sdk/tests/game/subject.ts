/**
 * A game small enough to read in one screen, for the page module's tests: it
 * counts presses of `left`, remembers where `aimX` last was, and ends at a
 * tick its config names. Its presentation records what the host asked of it,
 * and its devices are plain event targets a test dispatches on.
 */

import {
  type Counters,
  type Effect,
  type GameModule,
  type InputEvent,
  KERNEL_VERSION,
  type Manifest,
  type Presentation,
  type PresentationContext,
  type Snapshot,
} from "@clockwork2/engine"
import type { CaptureEnvironment } from "@clockwork2/engine/host"

export const MANIFEST: Manifest = {
  schemaVersion: 2,
  id: "probe",
  version: "1.0.0",
  name: "Probe",
  // The installed engine's own, so a bump has nothing here to follow.
  kernel: { version: KERNEL_VERSION },
  session: { tickHz: 60, maxTicks: 600, maxWallSeconds: 60, hasEnding: true },
  inputs: {
    left: { min: 0, max: 1, label: "Left" },
    aimX: { min: 0, max: 9 },
  },
  counters: [{ name: "presses", direction: "up", monotonic: true }],
  rankBy: ["presses"],
  tiePolicy: "shared",
  capabilities: {
    deterministic: true,
    physics: "none",
    renderer: "dom",
    multiplayer: false,
  },
}

export interface View {
  readonly ticks: number
  readonly presses: number
}

export interface Config {
  /** The tick the game ends at. */
  readonly endAt?: number
  /** A tick at which `tick` throws, to see a game's own failure arrive. */
  readonly throwAt?: number
}

/**
 * A frame that runs one tick at 60 Hz. A shade over a sixtieth of a second,
 * and exact in binary, so a hundred frames are a hundred ticks rather than
 * ninety-nine and a frame that ran two.
 */
export const FRAME_MS = 16.75

export class Probe implements GameModule<View, Config> {
  readonly manifest = MANIFEST
  private ticks = 0
  private presses = 0
  private endAt = 300
  private throwAt = -1

  init(_seed: string, config: Config): void {
    this.ticks = 0
    this.presses = 0
    this.endAt = config.endAt ?? 300
    this.throwAt = config.throwAt ?? -1
  }

  tick(inputs: readonly InputEvent[]): void {
    if (this.ticks === this.throwAt) throw new Error("the game broke")
    for (const input of inputs) {
      if (input.code === "left" && input.value === 1) this.presses += 1
    }
    this.ticks += 1
  }

  view(): View {
    return { ticks: this.ticks, presses: this.presses }
  }

  snapshot(): Snapshot {
    return { ticks: this.ticks, presses: this.presses, endAt: this.endAt }
  }

  restore(snapshot: Snapshot): void {
    this.ticks = snapshot.ticks as number
    this.presses = snapshot.presses as number
    this.endAt = snapshot.endAt as number
  }

  score(): Counters {
    return { presses: this.presses }
  }

  isOver(): boolean {
    return this.ticks >= this.endAt
  }

  effects(): readonly Effect[] {
    return []
  }
}

/** A presentation that records what the host asked of it. */
export class Drawn implements Presentation<View, HTMLElement> {
  container: HTMLElement | null = null
  context: PresentationContext | null = null
  renders = 0
  unmounted = false

  mount(container: HTMLElement, context: PresentationContext): void {
    this.container = container
    this.context = context
  }

  render(): void {
    this.renders += 1
  }

  unmount(): void {
    this.unmounted = true
  }
}

/** Devices a test drives: keys on `window`, and nothing else plugged in. */
export function devices(): CaptureEnvironment & {
  readonly window: EventTarget
  press(code: string, down: boolean): void
  listening(): number
} {
  const window = new EventTarget()
  const document = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  })
  let listeners = 0
  const add = window.addEventListener.bind(window)
  const remove = window.removeEventListener.bind(window)
  window.addEventListener = (...args: Parameters<typeof add>) => {
    listeners += 1
    add(...args)
  }
  window.removeEventListener = (...args: Parameters<typeof remove>) => {
    listeners -= 1
    remove(...args)
  }
  return {
    window,
    document,
    gamepads: () => [],
    screenAngle: () => 0,
    press(code, down) {
      window.dispatchEvent(
        Object.assign(new Event(down ? "keydown" : "keyup"), { code }),
      )
    },
    listening: () => listeners,
  }
}
