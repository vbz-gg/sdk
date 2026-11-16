/**
 * Paddle - a game steered by tilting the device.
 *
 * Drops fall, a paddle catches them, and the paddle slides the way the
 * screen leans, faster the further it leans. Three misses end the run.
 *
 * Tilt arrives as a level: the device helpers record it when it changes,
 * merged to one value a tick, so `tick` keeps the last value it was given and
 * moves the paddle by it every tick until a new one arrives. A replay feeds
 * the same values on the same ticks, so the paddle goes where it went.
 */

import {
  type Counters,
  type Effect,
  type GameModule,
  type InputEvent,
  Prng,
  type PrngState,
  type Snapshot,
} from "@clockwork2/engine"
import { MANIFEST } from "./manifest"

/** The simulation's own width and height. Not pixels, and never pixels. */
export const PLAYFIELD = 1000
export const PADDLE_HALF = 90
export const DROP_RADIUS = 22
export const PADDLE_Y = 900
export const DROP_EVERY = 40
export const FALL_PER_TICK = 6
/** How far a tick moves the paddle, per step of tilt. */
export const TILT_SPEED = 2
/** How far an arrow key moves it, once per press. */
export const KEY_STEP = 40

export interface Drop {
  readonly id: number
  x: number
  y: number
}

export interface View {
  readonly paddleX: number
  readonly paddleHalf: number
  readonly drops: readonly Drop[]
  /** The last tilt recorded, from -10 to 10. */
  readonly tilt: number
  readonly caught: number
}

export interface Config {
  readonly dropEvery: number
}

export const DEFAULT_CONFIG: Config = { dropEvery: DROP_EVERY }

export class Paddle implements GameModule<View, Config> {
  readonly manifest = MANIFEST
  private config: Config = DEFAULT_CONFIG
  private rng!: Prng
  private paddleX = PLAYFIELD / 2
  private drops: Drop[] = []
  private nextId = 1
  private ticks = 0
  private caught = 0
  private missed = 0
  private over = false
  private tilt = 0
  private pending: Effect[] = []

  init(seed: string, config: Config = DEFAULT_CONFIG): void {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.rng = new Prng(seed)
    this.paddleX = PLAYFIELD / 2
    this.drops = []
    this.nextId = 1
    this.ticks = 0
    this.caught = 0
    this.missed = 0
    this.over = false
    this.tilt = 0
    this.pending = []
  }

  tick(inputs: readonly InputEvent[]): void {
    if (this.over) return

    for (const input of inputs) this.apply(input)
    this.paddleX = this.clamp(this.paddleX + this.tilt * TILT_SPEED)

    this.ticks += 1
    if (this.ticks % this.config.dropEvery === 0) {
      this.drops.push({
        id: this.nextId++,
        x: this.rng.randomInt(DROP_RADIUS, PLAYFIELD - DROP_RADIUS),
        y: -DROP_RADIUS,
      })
    }

    const kept: Drop[] = []
    for (const drop of this.drops) {
      drop.y += FALL_PER_TICK
      if (drop.y < PADDLE_Y) {
        kept.push(drop)
        continue
      }
      if (Math.abs(drop.x - this.paddleX) <= PADDLE_HALF + DROP_RADIUS) {
        this.caught += 1
        this.pending.push({ type: "catch" })
      } else {
        this.missed += 1
        this.pending.push({ type: "miss" })
      }
    }
    this.drops = kept

    if (this.missed >= 3) this.over = true
  }

  private apply(input: InputEvent): void {
    if (input.code === "tilt") this.tilt = input.value
    if (input.code === "left" && input.value === 1) {
      this.paddleX = this.clamp(this.paddleX - KEY_STEP)
    }
    if (input.code === "right" && input.value === 1) {
      this.paddleX = this.clamp(this.paddleX + KEY_STEP)
    }
  }

  private clamp(x: number): number {
    return Math.max(PADDLE_HALF, Math.min(PLAYFIELD - PADDLE_HALF, x))
  }

  view(): View {
    return {
      paddleX: this.paddleX,
      paddleHalf: PADDLE_HALF,
      drops: this.drops,
      tilt: this.tilt,
      caught: this.caught,
    }
  }

  snapshot(): Snapshot {
    return {
      rng: this.rng.exportState(),
      paddleX: this.paddleX,
      drops: this.drops.map((drop) => ({ ...drop })),
      nextId: this.nextId,
      ticks: this.ticks,
      caught: this.caught,
      missed: this.missed,
      over: this.over,
      tilt: this.tilt,
      config: { ...this.config },
    } as unknown as Snapshot
  }

  restore(snapshot: Snapshot): void {
    const s = snapshot as unknown as {
      rng: PrngState
      paddleX: number
      drops: Drop[]
      nextId: number
      ticks: number
      caught: number
      missed: number
      over: boolean
      tilt: number
      config: Config
    }
    this.rng = new Prng("restored")
    this.rng.importState(s.rng)
    this.paddleX = s.paddleX
    this.drops = s.drops.map((drop) => ({ ...drop }))
    this.nextId = s.nextId
    this.ticks = s.ticks
    this.caught = s.caught
    this.missed = s.missed
    this.over = s.over
    this.tilt = s.tilt
    this.config = { ...s.config }
    this.pending = []
  }

  score(): Counters {
    return { caught: this.caught, ticksSurvived: this.ticks }
  }

  isOver(): boolean {
    return this.over
  }

  effects(): readonly Effect[] {
    const out = this.pending
    this.pending = []
    return out
  }
}

export { MANIFEST } from "./manifest"

export default function createGame(): Paddle {
  return new Paddle()
}
