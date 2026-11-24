/**
 * A match of the two-seat fixture, `fixtures/turns`, played the way pages
 * play one: each page mounts the game's page module for its own seat, sends
 * what its seat recorded through `onLocalInputs`, and hands the other page's
 * inputs to its run's `remote`. A relay between them, standing in for a
 * match server, merges both seats' inputs for a page that only follows.
 *
 * Every page has a manual clock and devices of its own, so a test moves
 * each page's frames and presses each player's keys by hand.
 */

import {
  type InputEvent,
  type Presentation,
  RecordedInputSource,
  type Recording,
} from "@clockwork2/engine"
import { ManualScheduler } from "@clockwork2/engine/host"
import { capture } from "../../../../fixtures/turns/src/capture"
import createTurns, {
  MANIFEST,
  type View,
} from "../../../../fixtures/turns/src/sim/index"
import type {
  MountedRemote,
  MountHandle,
  MountOptions,
  PageModule,
  SeatMount,
} from "../../src/game/contract"
import { definePageModule } from "../../src/game/define"
import { devices } from "./subject"

export { MANIFEST }
export const FILES = "https://files.test/g/turns/t/folder/"
/** A frame that runs one tick at 60 Hz: see `FRAME_MS` in `subject.ts`. */
export const FRAME_MS = 16.75
export const SEED = "local:match-1"

/** A presentation that draws nothing and counts its frames. */
export function quiet(): Presentation<View, HTMLElement> & {
  readonly renders: () => number
} {
  let renders = 0
  return {
    mount: () => {},
    render: () => {
      renders += 1
    },
    unmount: () => {},
    renders: () => renders,
  }
}

/** The fixture's page module, drawn by a presentation that draws nothing. */
export function turnsModule(): PageModule {
  return definePageModule<View, unknown>({
    createGame: createTurns,
    manifest: MANIFEST,
    createPresentation: () => quiet(),
    capture,
  })
}

/** An element as far as a mount reads one. */
export function stage(): HTMLElement {
  return { ownerDocument: { defaultView: null } } as unknown as HTMLElement
}

/** Everything one page's run reported. */
export interface Heard {
  readonly checkpoints: Array<{ tick: number; hash: string }>
  readonly waits: Array<number | null>
  readonly ended: Array<{ tick: number; inputs: readonly InputEvent[] }>
  /** The whole recording each end carried, which says how its own page ran. */
  readonly recordings: Recording[]
  readonly errors: Array<{ code: string; message: string }>
  /** What `onLocalInputs` handed over, call by call. */
  readonly sent: Array<{ events: readonly InputEvent[]; through: number }>
}

export interface MatchPage {
  readonly handle: MountHandle
  readonly scheduler: ManualScheduler
  readonly keys: ReturnType<typeof devices>
  readonly heard: Heard
}

/**
 * One page of the match, mounted on its own clock and keys. `send` is where
 * its seat's inputs go; a page that follows sends nothing.
 */
export function matchPage(
  local: number | null,
  send: (events: readonly InputEvent[], through: number) => void,
  extra: Partial<MountOptions> = {},
): MatchPage {
  const scheduler = new ManualScheduler()
  const keys = devices()
  const heard: Heard = {
    checkpoints: [],
    waits: [],
    ended: [],
    recordings: [],
    errors: [],
    sent: [],
  }
  const seats: SeatMount =
    local === null
      ? { local: null }
      : {
          local,
          onLocalInputs: (events, through) => {
            heard.sent.push({ events: [...events], through })
            send(events, through)
          },
        }
  const module = turnsModule()
  const handle = module.mount(stage(), {
    mode: "play",
    seed: SEED,
    config: {},
    tickHz: 60,
    scripted: "ignore",
    seats,
    expect: { manifestHash: module.manifestHash },
    files: FILES,
    scheduler,
    environment: keys,
    handlers: {
      onCheckpoint: (checkpoint) => heard.checkpoints.push(checkpoint),
      onFrame: (frame) => heard.waits.push(frame.waitingForSeat),
      onEnded: (ended) => {
        heard.ended.push({ tick: ended.tick, inputs: ended.recording.inputs })
        heard.recordings.push(ended.recording)
      },
      onError: (error) => heard.errors.push(error),
    },
    ...extra,
  } as MountOptions)
  return { handle, scheduler, keys, heard }
}

/**
 * A match server's part, as far as a page that follows needs it: it keeps
 * what each seat sent and how far each has confirmed, and hands the
 * follower every input through the tick both seats have confirmed, in tick
 * order, then confirms that tick.
 */
export class Relay {
  private readonly held: InputEvent[] = []
  private readonly through: number[]
  private forwarded = -1

  constructor(
    seats: number,
    private readonly follower: () => MountedRemote | null,
  ) {
    this.through = new Array<number>(seats).fill(-1)
  }

  receive(seat: number, events: readonly InputEvent[], through: number): void {
    this.held.push(...events)
    this.through[seat] = through
    const both = Math.min(...this.through)
    if (both <= this.forwarded) return
    const ready = this.held
      .filter((event) => event.tick <= both)
      .sort((a, b) => a.tick - b.tick)
    const kept = this.held.filter((event) => event.tick > both)
    this.held.splice(0, this.held.length, ...kept)
    const remote = this.follower()
    remote?.append(ready)
    remote?.confirm(both)
    this.forwarded = both
  }
}

/**
 * Whose turn each tick of a merged log was, read by replaying it through the
 * fixture's rules code: the seat `seat()` answered before each tick.
 */
export function seatsOfTicks(
  inputs: readonly InputEvent[],
  endTick: number,
): number[] {
  const game = createTurns()
  game.init(SEED)
  const source = new RecordedInputSource(inputs)
  const seats: number[] = []
  for (let tick = 0; tick < endTick; tick += 1) {
    seats.push(game.seat())
    game.tick(source.take(tick))
  }
  return seats
}

/** Presses `code` for one frame of `page`'s clock, as a key goes down and up. */
function tap(page: MatchPage, code: string): void {
  page.keys.press(code, true)
  page.scheduler.advance(FRAME_MS)
  page.keys.press(code, false)
}

/**
 * Two players and somebody following, each page a frame at a time in turn.
 * Both players keep pressing whatever the turn, as an eager player does, so
 * a press on the other seat's turn is there to be dropped. With `stallB`,
 * player B's page runs no frame for that many of A's, from A's 30th, as a
 * tab hidden or a network stalled would, so A's page waits for B.
 */
export async function playMatch(options: { readonly stallB?: number } = {}) {
  let follower: MatchPage | null = null
  const relay = new Relay(2, () => follower?.handle.remote ?? null)
  let a: MatchPage | null = null
  let b: MatchPage | null = null
  a = matchPage(0, (events, through) => {
    b?.handle.remote?.append(events)
    b?.handle.remote?.confirm(through)
    relay.receive(0, events, through)
  })
  b = matchPage(1, (events, through) => {
    a?.handle.remote?.append(events)
    a?.handle.remote?.confirm(through)
    relay.receive(1, events, through)
  })
  follower = matchPage(null, () => {})
  await Bun.sleep(0)
  const pages = [a, b, follower]
  const pressed = { a: 0, b: 0 }
  for (let frame = 0; frame < 4000; frame += 1) {
    if (pages.every((page) => page.heard.ended.length > 0)) break
    // Player A aims once and shoots, every 23 frames; player B every 31.
    if (frame % 23 === 5) {
      tap(a, "ArrowRight")
      tap(a, "Space")
      pressed.a += 2
    } else a.scheduler.advance(FRAME_MS)
    const stalled =
      options.stallB !== undefined && frame >= 30 && frame < 30 + options.stallB
    if (!stalled) {
      if (frame % 31 === 7) {
        tap(b, "ArrowRight")
        tap(b, "ArrowRight")
        tap(b, "Space")
        pressed.b += 3
      } else b.scheduler.advance(FRAME_MS)
    }
    follower.scheduler.advance(FRAME_MS)
  }
  return { a, b, follower, pressed }
}
