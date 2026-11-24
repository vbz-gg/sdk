/**
 * Turns - two players taking turns rolling a ball at a mark.
 *
 * The acting seat steps its aim with `left` and `right` and presses `shoot`.
 * The ball rolls, slowing by one unit a tick, and the seat scores by how near
 * it stops to a mark drawn from the seed; then the turn passes. A seat that
 * has not shot within `TURN_TICKS` loses the shot. The run ends when both
 * seats have taken `SHOTS` turns.
 *
 * `shoot` is a press the game holds: a seat fires again only after it lets
 * go. When the turn passes the game lets go itself, because a turn's held
 * inputs end with it and the host records no release for them.
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

/** The table's length, in the simulation's own units. */
export const TABLE = 200
/** How long a seat has to shoot before it loses the shot: four seconds. */
export const TURN_TICKS = 240
/** Shots each seat takes. */
export const SHOTS = 3
/**
 * The highest aim. A ball leaves at `4 + 2 * aim` units a tick and slows by
 * one a tick, so it stops between 10 units out, at aim 0, and 171, at 7.
 */
export const MAX_AIM = 7

export interface Ball {
  x: number
  v: number
}

export interface View {
  /** Whose turn it is: 0 or 1. */
  readonly turn: number
  readonly aim: number
  readonly ball: Ball | null
  readonly mark: number
  readonly points: readonly [number, number]
  readonly shots: readonly [number, number]
  /** Ticks left on the acting seat's clock. */
  readonly clock: number
}

export class Turns implements GameModule<View> {
  readonly manifest = MANIFEST
  private rng!: Prng
  private turn = 0
  private aim = 0
  private held = false
  private ball: Ball | null = null
  private mark = 0
  private turnTicks = 0
  private shots: [number, number] = [0, 0]
  private points: [number, number] = [0, 0]
  private pending: Effect[] = []

  init(seed: string): void {
    this.rng = new Prng(seed).stream("table")
    this.turn = 0
    this.aim = 0
    this.held = false
    this.ball = null
    this.mark = this.rng.randomInt(20, 180)
    this.turnTicks = 0
    this.shots = [0, 0]
    this.points = [0, 0]
    this.pending = []
  }

  /** The seat whose inputs the next tick reads. */
  seat(): number {
    return this.turn
  }

  tick(inputs: readonly InputEvent[]): void {
    if (this.isOver()) return
    for (const input of inputs) this.apply(input)
    this.turnTicks += 1
    const ball = this.ball
    if (ball !== null) {
      ball.x += ball.v
      ball.v -= 1
      if (ball.v === 0) {
        const off = Math.abs(ball.x - this.mark)
        const seat = this.turn as 0 | 1
        this.points[seat] += Math.max(0, 20 - Math.floor(off / 5))
        this.pending.push({ type: "sound", data: "stop" })
        this.pass()
      }
    } else if (this.turnTicks >= TURN_TICKS) {
      this.pass()
    }
  }

  private apply(input: InputEvent): void {
    if (this.ball !== null) return
    if (input.code === "left" && input.value === 1) {
      this.aim = Math.max(0, this.aim - 1)
    }
    if (input.code === "right" && input.value === 1) {
      this.aim = Math.min(MAX_AIM, this.aim + 1)
    }
    if (input.code === "shoot") {
      if (input.value === 0) this.held = false
      else if (!this.held) {
        this.held = true
        this.ball = { x: 0, v: 4 + 2 * this.aim }
      }
    }
  }

  /** The shot is taken; the other seat's turn begins with nothing held. */
  private pass(): void {
    this.shots[this.turn as 0 | 1] += 1
    this.turn = 1 - this.turn
    this.aim = 0
    this.held = false
    this.ball = null
    this.turnTicks = 0
    this.mark = this.rng.randomInt(20, 180)
  }

  view(): View {
    return {
      turn: this.turn,
      aim: this.aim,
      ball: this.ball,
      mark: this.mark,
      points: this.points,
      shots: this.shots,
      clock: TURN_TICKS - this.turnTicks,
    }
  }

  snapshot(): Snapshot {
    return {
      rng: this.rng.exportState(),
      turn: this.turn,
      aim: this.aim,
      held: this.held,
      ball: this.ball === null ? null : { ...this.ball },
      mark: this.mark,
      turnTicks: this.turnTicks,
      shots: [...this.shots],
      points: [...this.points],
    } as unknown as Snapshot
  }

  restore(snapshot: Snapshot): void {
    const s = snapshot as unknown as {
      rng: PrngState
      turn: number
      aim: number
      held: boolean
      ball: Ball | null
      mark: number
      turnTicks: number
      shots: [number, number]
      points: [number, number]
    }
    this.rng = new Prng("restored")
    this.rng.importState(s.rng)
    this.turn = s.turn
    this.aim = s.aim
    this.held = s.held
    this.ball = s.ball === null ? null : { ...s.ball }
    this.mark = s.mark
    this.turnTicks = s.turnTicks
    this.shots = [...s.shots]
    this.points = [...s.points]
    this.pending = []
  }

  score(): Counters {
    return {
      points0: this.points[0],
      points1: this.points[1],
      shots: this.shots[0] + this.shots[1],
    }
  }

  isOver(): boolean {
    return this.shots[0] >= SHOTS && this.shots[1] >= SHOTS
  }

  effects(): readonly Effect[] {
    const out = this.pending
    this.pending = []
    return out
  }
}

export { MANIFEST } from "./manifest"

export default function createGame(): Turns {
  return new Turns()
}
