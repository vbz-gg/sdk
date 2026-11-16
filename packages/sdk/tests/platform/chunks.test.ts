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
function wire(pieces: readonly ChunkBody[]): number[] {
  return pieces.map((piece, seq) => byteLengthOf({ seq, ...piece }))
}

describe("cutting a chunk too large to send", () => {
  test("one that fits is sent as it is", () => {
    const whole = body([input(10), input(20)])
    expect(splitChunk(whole, 10_000)).toEqual([whole])
  })

  test("each piece fits, they hold every input in order, and none overlap", () => {
    const inputs = Array.from({ length: 40 }, (_, at) => input(at + 1))
    const pieces = splitChunk(body(inputs), 500)
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
    const pieces = splitChunk(body(inputs), 400)
    const ticksOf = (piece: ChunkBody) =>
      new Set(piece.inputs.map((i) => (i as { tick: number }).tick))
    for (const piece of pieces)
      expect(ticksOf(piece).size).toBeLessThanOrEqual(1)
    expect(pieces.flatMap((piece) => piece.inputs)).toEqual(inputs)
  })

  test("inputs that fit alone but not beside the checkpoints go just before them", () => {
    const heavy: ChunkBody = {
      throughTick: 119,
      checkpoints: Array.from({ length: 6 }, (_, at) => ({
        tick: at * 10,
        hash: "x".repeat(16),
      })),
      inputs: [input(100), input(101)],
    }
    const pieces = splitChunk(heavy, 300)
    expect(pieces.at(-1)?.inputs).toEqual([])
    expect(pieces.at(-1)?.checkpoints).toHaveLength(6)
    expect(pieces.slice(0, -1).flatMap((piece) => piece.inputs)).toEqual([
      ...heavy.inputs,
    ])
    expect(pieces.at(-2)?.throughTick).toBe(101)
    expect(pieces.at(-2)).not.toHaveProperty("counters")
  })

  /** Sent anyway, and refused, as such a tick from anyone would be. */
  test("one tick over the limit on its own is still one piece", () => {
    const crowded = Array.from({ length: 30 }, () => input(7))
    const pieces = splitChunk(body(crowded), 200)
    expect(pieces.flatMap((piece) => piece.inputs)).toEqual(crowded)
    expect(pieces.filter((piece) => piece.inputs.length > 0)).toHaveLength(1)
  })
})
