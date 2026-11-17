/**
 * Folder: three lanes, and points for being in the lane the course names.
 *
 * The course is a data pack, `packs/course.json`, which the rules code
 * reads on demand: `packsNeeded()` names it from `COURSE_FROM`, so the
 * page fetches it then, and the tick after reads it. Before that the run
 * scores nothing. The seed decides where in the course a run starts, so
 * two seeds pass through different states on one input log.
 */

import {
  type Counters,
  type Effect,
  type GameModule,
  type InputEvent,
  type PackReader,
  Prng,
  type PrngState,
  type Snapshot,
} from "@clockwork2/engine"
import { COURSE, MANIFEST } from "./manifest"

export { MANIFEST } from "./manifest"

export const LANES = 3
/** The tick from which the course is needed: three seconds at 60 Hz. */
export const COURSE_FROM = 180
/** Where every run ends: one minute at 60 Hz. */
export const END_AT = 3_600

interface Course {
  readonly points: readonly number[]
  readonly lanes: readonly number[]
}

export interface View {
  readonly lane: number
  readonly score: number
  readonly ticks: number
}

export type Config = Readonly<Record<string, never>>

interface Saved {
  readonly rng: PrngState
  readonly offset: number
  readonly lane: number
  readonly points: number
  readonly ticks: number
}

export class Folder implements GameModule<View, Config> {
  readonly manifest = MANIFEST
  private rng!: Prng
  private packs!: PackReader
  private offset = 0
  private lane = 1
  private points = 0
  private ticks = 0
  /** Opened once it is needed, and kept outside the snapshot. */
  private course: Course | null = null

  init(seed: string, _config: Config, packs: PackReader): void {
    this.packs = packs
    this.rng = new Prng(seed)
    this.offset = this.rng.randomInt(0, 15)
    this.lane = 1
    this.points = 0
    this.ticks = 0
    this.course = null
  }

  packsNeeded(): readonly string[] {
    return this.ticks >= COURSE_FROM ? [COURSE] : []
  }

  tick(inputs: readonly InputEvent[]): void {
    for (const input of inputs) {
      if (input.value !== 1) continue
      if (input.code === "left") this.lane = Math.max(0, this.lane - 1)
      if (input.code === "right") this.lane = Math.min(LANES - 1, this.lane + 1)
    }
    if (this.ticks >= COURSE_FROM) {
      this.course ??= this.packs.json(COURSE) as unknown as Course
      const at = (this.ticks + this.offset) % this.course.points.length
      if (this.course.lanes[at] === this.lane) {
        this.points += this.course.points[at] ?? 0
      }
    }
    this.ticks += 1
  }

  view(): View {
    return { lane: this.lane, score: this.points, ticks: this.ticks }
  }

  snapshot(): Snapshot {
    const saved: Saved = {
      rng: this.rng.exportState(),
      offset: this.offset,
      lane: this.lane,
      points: this.points,
      ticks: this.ticks,
    }
    return saved as unknown as Snapshot
  }

  restore(snapshot: Snapshot): void {
    const saved = snapshot as unknown as Saved
    this.rng = new Prng("restored")
    this.rng.importState(saved.rng)
    this.offset = saved.offset
    this.lane = saved.lane
    this.points = saved.points
    this.ticks = saved.ticks
    this.course = null
  }

  score(): Counters {
    return { score: this.points, ticks: this.ticks }
  }

  isOver(): boolean {
    return this.ticks >= END_AT
  }

  effects(): readonly Effect[] {
    return []
  }
}

export default function createGame(): Folder {
  return new Folder()
}
