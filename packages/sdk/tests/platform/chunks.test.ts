/**
 * Where a chunk ends. Claiming the last reported tick while the run plays
 * gets the next chunk refused for an input at that tick.
 */

import { describe, expect, test } from "bun:test"
import {
  byteLengthOf,
  type ChunkBody,
  splitChunk,
  throughTickFor,
} from "../../src/platform/chunks"

describe("a chunk's throughTick", () => {
  test("while the run plays, it stops one tick short of the last reported", () => {
    expect(
      throughTickFor({
        tick: 120,
        inputTicks: [],
        ended: false,
        postedThrough: -1,
      }),
    ).toBe(119)
  })

  test("but it always reaches the highest input it carries", () => {
    expect(
      throughTickFor({
        tick: 120,
        inputTicks: [42, 120],
        ended: false,
        postedThrough: 50,
      }),
    ).toBe(120)
  })

  test("once the run has ended, it reaches the end tick", () => {
    expect(
      throughTickFor({
        tick: 300,
        inputTicks: [10],
        ended: true,
        postedThrough: 119,
      }),
    ).toBe(300)
  })

  test("nothing new complete is no chunk at all", () => {
    expect(
      throughTickFor({
        tick: 120,
        inputTicks: [],
        ended: false,
        postedThrough: 119,
      }),
    ).toBeNull()
  })
})

const input = (tick: number, code = "left") => ({ tick, code, value: 1 })

function body(inputs: ChunkBody["inputs"]): ChunkBody {
  return {
    throughTick: 119,
    checkpoints: [{ tick: 60, hash: "h60" }],
    inputs,
    counters: { motes: 3 },
  }
}

/** Every piece, as it goes on the wire with a sequence number in. */
function wire(pieces: readonly ChunkBody[], first = 0): number[] {
  return pieces.map((piece, at) => byteLengthOf({ seq: first + at, ...piece }))
}

const tickAt = (input: unknown) => (input as { tick: number }).tick

/**
 * What the platform refuses of a run's chunks in order, as its session
 * package's `assertForward` does: a chunk that reaches no further than an
 * earlier one, and a checkpoint or an input at or below the furthest tick an
 * earlier chunk committed, or an input past the chunk's own reach.
 */
function refusedInOrder(pieces: readonly ChunkBody[], previous = -1): string[] {
  const refused: string[] = []
  let through = previous
  for (const [at, piece] of pieces.entries()) {
    if (piece.throughTick <= through) {
      refused.push(
        `piece ${at} reaches ${piece.throughTick}, not past ${through}`,
      )
    }
    for (const checkpoint of piece.checkpoints) {
      if (checkpoint.tick <= through) {
        refused.push(`piece ${at} carries a checkpoint at ${checkpoint.tick}`)
      }
    }
    for (const input of piece.inputs) {
      const tick = tickAt(input)
      if (tick <= through || tick > piece.throughTick) {
        refused.push(`piece ${at} carries an input at ${tick}`)
      }
    }
    through = Math.max(through, piece.throughTick)
  }
  return refused
}

describe("cutting a chunk too large to send", () => {
  test("one that fits is sent as it is", () => {
    const whole = body([input(10), input(20)])
    expect(splitChunk(whole, 10_000, 7)).toEqual([{ seq: 7, ...whole }])
  })

  test("each piece fits, they hold every input in order, and none overlap", () => {
    const inputs = Array.from({ length: 40 }, (_, at) => input(at + 1))
    const pieces = splitChunk(body(inputs), 500, 0)
    expect(pieces.length).toBeGreaterThan(2)
    for (const size of wire(pieces)) expect(size).toBeLessThanOrEqual(500)
    expect(pieces.flatMap((piece) => piece.inputs)).toEqual(inputs)
    for (const [at, piece] of pieces.entries()) {
      const ticks = piece.inputs.map((i) => (i as { tick: number }).tick)
      // Each reaches its own last input and no further, and the next starts
      // after it, which is what the platform holds a slice to.
      if (at < pieces.length - 1) {
        expect(piece.throughTick).toBe(Math.max(...ticks))
        const next = pieces[at + 1] as ChunkBody
        const first = (next.inputs[0] as { tick: number } | undefined)?.tick
        if (first !== undefined)
          expect(first).toBeGreaterThan(piece.throughTick)
        expect(piece.checkpoints).toEqual([])
      }
      expect(piece.counters).toEqual({ motes: 3 })
    }
    // The chunk's own reach and its checkpoints go with the last piece.
    expect(pieces.at(-1)?.throughTick).toBe(119)
    expect(pieces.at(-1)?.checkpoints).toEqual([{ tick: 60, hash: "h60" }])
  })

  /** Two inputs of one tick in two pieces would be a second slice reaching back. */
  test("a tick's inputs are never cut apart", () => {
    const inputs = [
      ...Array.from({ length: 6 }, () => input(5, "aimX")),
      ...Array.from({ length: 6 }, () => input(9, "aimX")),
    ]
    const pieces = splitChunk(body(inputs), 400, 0)
    const ticksOf = (piece: ChunkBody) =>
      new Set(piece.inputs.map((i) => (i as { tick: number }).tick))
    for (const piece of pieces)
      expect(ticksOf(piece).size).toBeLessThanOrEqual(1)
    expect(pieces.flatMap((piece) => piece.inputs)).toEqual(inputs)
  })

  /**
   * A checkpoint is committed by the first chunk whose reach passes its
   * tick. Carried by a later one, the platform refuses that chunk as one
   * reaching back, and the run fails there.
   */
  test("each piece carries the checkpoints in its own span, so the platform takes every one", () => {
    const inputs = Array.from({ length: 80 }, (_, at) => input(at + 1))
    const whole: ChunkBody = {
      throughTick: 119,
      checkpoints: [
        { tick: 0, hash: "h0" },
        { tick: 60, hash: "h60" },
        { tick: 120, hash: "h120" },
      ],
      inputs,
      counters: { motes: 3 },
    }
    const pieces = splitChunk(whole, 500, 0)
    expect(pieces.length).toBeGreaterThan(2)
    expect(refusedInOrder(pieces)).toEqual([])
    for (const size of wire(pieces)) expect(size).toBeLessThanOrEqual(500)
    expect(pieces.flatMap((piece) => piece.checkpoints)).toEqual([
      ...whole.checkpoints,
    ])
    expect(pieces.flatMap((piece) => piece.inputs)).toEqual(inputs)
    let through = -1
    for (const [at, piece] of pieces.entries()) {
      const last = at === pieces.length - 1
      // The last piece also carries a checkpoint past the chunk's reach,
      // which no tick of the chunk is short of.
      expect(piece.checkpoints).toEqual(
        whole.checkpoints.filter(
          (checkpoint) =>
            checkpoint.tick > through &&
            (last || checkpoint.tick <= piece.throughTick),
        ),
      )
      through = piece.throughTick
    }
  })

  /**
   * The chunk's own reach is the last piece's. A piece before it reaching as
   * far would leave the last one reaching no further, which the platform
   * refuses as going nowhere.
   */
  test("no piece before the last reaches as far as the chunk does", () => {
    const heavy: ChunkBody = {
      throughTick: 101,
      checkpoints: Array.from({ length: 6 }, (_, at) => ({
        tick: at * 10,
        hash: "x".repeat(16),
      })),
      inputs: [input(100), input(101)],
    }
    const pieces = splitChunk(heavy, 300, 0)
    expect(pieces.length).toBeGreaterThan(1)
    expect(refusedInOrder(pieces)).toEqual([])
    expect(pieces.at(-1)?.throughTick).toBe(101)
    expect(pieces.flatMap((piece) => piece.inputs)).toEqual([...heavy.inputs])
  })

  /**
   * Measured with seq 0, a body within a few bytes of the cap passes the
   * check and then goes out over it with the seq it really carries.
   */
  test("a body is measured with the seq it will carry", () => {
    const seq = 1_000_000
    const whole = body([input(10), input(20)])
    const limit = byteLengthOf({ seq, ...whole }) - 1
    expect(byteLengthOf({ seq: 0, ...whole })).toBeLessThanOrEqual(limit)
    const pieces = splitChunk(whole, limit, seq)
    for (const size of wire(pieces, seq))
      expect(size).toBeLessThanOrEqual(limit)
    expect(pieces.flatMap((piece) => piece.inputs)).toEqual([...whole.inputs])
  })

  /** Sent anyway, and refused, as such a tick from anyone would be. */
  test("one tick over the limit on its own is still one piece", () => {
    const crowded = Array.from({ length: 30 }, () => input(7))
    const pieces = splitChunk(body(crowded), 200, 0)
    expect(pieces.flatMap((piece) => piece.inputs)).toEqual(crowded)
    expect(pieces.filter((piece) => piece.inputs.length > 0)).toHaveLength(1)
  })
})
