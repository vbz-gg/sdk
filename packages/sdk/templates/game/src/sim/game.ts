/**
 * Lane Runner - the simulation.
 *
 * Three lanes, rocks coming towards you, motes to collect. You move sideways;
 * a rock ends the run; ninety seconds ends it too. Small, but it exercises
 * everything the conformance suite checks: seeded randomness, a timer,
 * `dmath`, declared counters, effects, and a snapshot that restores exactly.
 *
 * It also decides what a finger pressed. The renderer draws two buttons and
 * the device helpers record where each finger is and when it goes down; this
 * file hit-tests that against the same rectangles the renderer drew, in
 * `tick`. A renderer that worked out which button was pressed and handed the
 * answer over would replay perfectly and still have decided the result where
 * nothing checks it.
 *
 * This file is the whole simulation. It imports nothing but the kernel, it
 * touches no browser API, and it is the file `validate` is pointed at. The
 * renderer lives in `present.ts` and this file must never import it - a
 * simulation that can reach a canvas is a simulation that can decide a score
 * from one.
 *
 * Swap `present/canvas.ts` for a renderer of your own and nothing here
 * changes. That is the point of the boundary, and it is what lets a replay,
 * the harness's or a server's, run your game with no canvas at all.
 */

import {
  type Counters,
  dmath,
  type Effect,
  type GameModule,
  type InputEvent,
  Prng,
  type PrngState,
  type Snapshot,
  Timer,
  type TimerState,
} from "@clockwork2/engine"
import {
  fieldPoint,
  inside,
  LEFT_BUTTON,
  type Rect,
  RIGHT_BUTTON,
} from "./field"
import { MANIFEST } from "./manifest"

export const LANES = 3
export const TRACK_LENGTH = 100
/** A rock every 24 ticks at the start, and sooner as the run goes on. */
export const SPAWN_INTERVAL = 24
export const MIN_SPAWN_INTERVAL = 8
export const TIME_LIMIT_TICKS = 60 * 90

export type Config = {
  readonly speed: number
  readonly startingLane: number
}

export const DEFAULT_CONFIG: Config = { speed: 1, startingLane: 1 }

type Rock = { id: number; lane: number; z: number }
type Mote = { id: number; lane: number; z: number }

/** Which way a press moves the runner. */
type Direction = -1 | 1

/** What one finger is doing: where it last was, in steps, and what it holds. */
type Finger = { x: number; y: number; holding: Direction | null }

/** The two buttons, and the way each one moves. */
const BUTTONS: readonly (readonly [Rect, Direction])[] = [
  [LEFT_BUTTON, -1],
  [RIGHT_BUTTON, 1],
]

/** The fingers the manifest records, and which part of one each input is. */
const FINGERS = 2
const FINGER_INPUTS: Readonly<
  Record<string, readonly [finger: number, part: "down" | "x" | "y"]>
> = {
  touch0: [0, "down"],
  touch0X: [0, "x"],
  touch0Y: [0, "y"],
  touch1: [1, "down"],
  touch1X: [1, "x"],
  touch1Y: [1, "y"],
}

function noFingers(): Finger[] {
  // No position until one arrives: a press before it hits nothing.
  return Array.from({ length: FINGERS }, () => ({
    x: -1,
    y: -1,
    holding: null,
  }))
}

export type View = {
  readonly lane: number
  readonly rocks: readonly Rock[]
  readonly motes: readonly Mote[]
  readonly motesTaken: number
  readonly ticks: number
  readonly over: boolean
  /** A wobble the renderer can lean the ship by. Part of the simulation, so
   * every player sees the same one. */
  readonly sway: number
  /** Which buttons are held, by a finger, a key or a controller. */
  readonly held: { readonly left: boolean; readonly right: boolean }
}

export class LaneRunner implements GameModule<View, Config> {
  /** The game's manifest, which a host reads before a tick runs. */
  readonly manifest = MANIFEST
  private config: Config = DEFAULT_CONFIG
  private rng!: Prng
  private spawnRng!: Prng
  private timer = new Timer()
  private lane = 1
  private rocks: Rock[] = []
  private motes: Mote[] = []
  private nextId = 1
  private ticks = 0
  private motesTaken = 0
  private over = false
  private pending: Effect[] = []
  private fingers: Finger[] = noFingers()
  /** Where the stick last was: -1, 0 or 1. */
  private stick = 0
  /** Whether `left` and `right` are held, from a key or a d-pad. */
  private keys = { left: false, right: false }

  init(seed: string, config: Config = DEFAULT_CONFIG): void {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.rng = new Prng(seed)
    // A named sub-stream, so adding a draw to one system cannot shift the
    // other's sequence and quietly change every recorded session.
    this.spawnRng = this.rng.stream("spawn")
    this.timer = new Timer()
    // A one-shot that re-arms itself, rather than `every`: the interval
    // shrinks as the run goes on, and `every` would leave the old schedule
    // running beside the new one. One pending entry at a time, always.
    this.timer.define("spawn", () => {
      this.spawn()
      this.timer.after("spawn", this.spawnInterval())
    })
    this.timer.after("spawn", SPAWN_INTERVAL)
    this.lane = Math.min(Math.max(this.config.startingLane, 0), LANES - 1)
    this.rocks = []
    this.motes = []
    this.nextId = 1
    this.ticks = 0
    this.motesTaken = 0
    this.over = false
    this.pending = []
    this.fingers = noFingers()
    this.stick = 0
    this.keys = { left: false, right: false }
  }

  tick(inputs: readonly InputEvent[]): void {
    if (this.over) return

    for (const input of inputs) this.apply(input)

    const speed = this.config.speed
    for (const rock of this.rocks) rock.z -= speed
    for (const mote of this.motes) mote.z -= speed

    for (const rock of this.rocks) {
      if (rock.z <= 0 && rock.z > -speed && rock.lane === this.lane) {
        this.over = true
        this.pending.push({ type: "sound", data: "hit" })
      }
    }
    this.motes = this.motes.filter((mote) => {
      if (mote.z <= 0 && mote.z > -speed && mote.lane === this.lane) {
        this.motesTaken++
        this.pending.push({ type: "sound", data: "mote" })
        return false
      }
      return mote.z > -speed
    })
    this.rocks = this.rocks.filter((rock) => rock.z > -speed)

    this.timer.advance()
    this.ticks++
    if (this.ticks >= TIME_LIMIT_TICKS) this.over = true
  }

  /**
   * One input, in the order it was recorded. A finger's position arrives
   * before its press, in the same tick, so the press is hit-tested against
   * where it landed.
   */
  private apply(input: InputEvent): void {
    const { code, value } = input
    if (code === "left" || code === "right") {
      this.keys[code] = value === 1
      if (value === 1) this.move(code === "left" ? -1 : 1)
      return
    }
    if (code === "stick") {
      // A push to either side moves once; holding it there moves no more.
      if (value !== 0 && value !== this.stick) this.move(value < 0 ? -1 : 1)
      this.stick = value
      return
    }
    const [index, part] = FINGER_INPUTS[code] ?? [-1, "down"]
    const finger = this.fingers[index]
    if (finger === undefined) return
    if (part === "x") finger.x = value
    else if (part === "y") finger.y = value
    else if (value === 1) {
      finger.holding = this.buttonAt(finger)
      if (finger.holding !== null) this.move(finger.holding)
    } else {
      finger.holding = null
    }
  }

  /** The button under a finger, if it is on one. */
  private buttonAt(finger: Finger): Direction | null {
    if (finger.x < 0 || finger.y < 0) return null
    const at = fieldPoint(finger.x, finger.y)
    for (const [rect, direction] of BUTTONS) {
      if (inside(rect, at.x, at.y)) return direction
    }
    return null
  }

  private move(direction: Direction): void {
    this.lane = Math.min(Math.max(this.lane + direction, 0), LANES - 1)
  }

  private spawn(): void {
    const lane = this.spawnRng.randomInt(0, LANES - 1)
    this.rocks.push({ id: this.nextId++, lane, z: TRACK_LENGTH })
    if (this.spawnRng.randomBoolean(0.5)) {
      // One of the two lanes the rock is not in, so there is always somewhere
      // to go.
      const free = (lane + 1 + this.spawnRng.randomInt(0, LANES - 2)) % LANES
      this.motes.push({ id: this.nextId++, lane: free, z: TRACK_LENGTH })
    }
  }

  /**
   * Rocks arrive faster as the run goes on, so every run ends. A game that a
   * good player can hold forever has a recording, and a replay, that grow
   * for as long as they play.
   */
  private spawnInterval(): number {
    return Math.max(
      MIN_SPAWN_INTERVAL,
      SPAWN_INTERVAL - Math.floor(this.ticks / 600),
    )
  }

  view(): View {
    return {
      lane: this.lane,
      rocks: this.rocks.map((rock) => ({ ...rock })),
      motes: this.motes.map((mote) => ({ ...mote })),
      motesTaken: this.motesTaken,
      ticks: this.ticks,
      over: this.over,
      // dmath, never Math.sin: the host and the validator have to agree on
      // this number, and `Math.sin` is implementation-defined.
      sway: dmath.sin(this.ticks / 30),
      held: {
        left: this.holds(-1),
        right: this.holds(1),
      },
    }
  }

  private holds(direction: Direction): boolean {
    return (
      (direction === -1 ? this.keys.left : this.keys.right) ||
      this.stick === direction ||
      this.fingers.some((finger) => finger.holding === direction)
    )
  }

  snapshot(): Snapshot {
    return {
      config: { ...this.config },
      lane: this.lane,
      rocks: this.rocks.map((rock) => ({ ...rock })),
      motes: this.motes.map((mote) => ({ ...mote })),
      nextId: this.nextId,
      ticks: this.ticks,
      motesTaken: this.motesTaken,
      over: this.over,
      rng: this.rng.exportState() as unknown as Snapshot,
      timer: this.timer.exportState() as unknown as Snapshot,
      fingers: this.fingers.map((finger) => ({ ...finger })),
      stick: this.stick,
      keys: { ...this.keys },
    }
  }

  restore(snapshot: Snapshot): void {
    const s = snapshot as unknown as {
      config: Config
      lane: number
      rocks: Rock[]
      motes: Mote[]
      nextId: number
      ticks: number
      motesTaken: number
      over: boolean
      rng: PrngState
      timer: TimerState
      fingers: Finger[]
      stick: number
      keys: { left: boolean; right: boolean }
    }
    // init() first, so the timer's handlers exist to be restored onto. A
    // restored timer holds names, not functions; nothing can serialise a
    // closure.
    this.init("restored", s.config)
    this.lane = s.lane
    this.rocks = s.rocks.map((rock) => ({ ...rock }))
    this.motes = s.motes.map((mote) => ({ ...mote }))
    this.nextId = s.nextId
    this.ticks = s.ticks
    this.motesTaken = s.motesTaken
    this.over = s.over
    // One call restores the sub-streams too, in place, so `this.spawnRng`
    // still points at the right generator and must not be re-derived.
    this.rng.importState(s.rng)
    this.timer.importState(s.timer)
    this.fingers = s.fingers.map((finger) => ({ ...finger }))
    this.stick = s.stick
    this.keys = { ...s.keys }
    this.pending = []
  }

  score(): Counters {
    return { motes: this.motesTaken, ticksSurvived: this.ticks }
  }

  isOver(): boolean {
    return this.over
  }

  effects(): readonly Effect[] {
    const drained = this.pending
    this.pending = []
    return drained
  }
}
