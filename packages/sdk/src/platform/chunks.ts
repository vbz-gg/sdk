/**
 * Where a chunk of a run ends, and how a chunk too large to send is cut.
 *
 * The engine takes a tick's inputs before it runs that tick and writes the
 * tick's checkpoint after. So while a run plays, the inputs of the last tick
 * the game reported may not all be in yet, and only the ticks before it are
 * complete. Claiming that last tick would get the next chunk refused for an
 * input at it, with `E_CHUNK_NOT_FORWARD`, and those inputs lost. Once the run
 * has ended, every tick up to the end is complete.
 *
 * An input already recorded is at a tick that has run, so a chunk
 * always reaches at least the highest input it carries.
 */

import type { RunChunk } from "../api/index.js"

export interface ChunkReach {
  /** The last tick the game reported, after a frame or at its end. */
  readonly tick: number
  readonly inputTicks: readonly number[]
  readonly ended: boolean
  /** The `throughTick` of the last chunk sent, or -1 before the first. */
  readonly postedThrough: number
}

/** The chunk's `throughTick`, or null when nothing new is complete yet. */
export function throughTickFor(reach: ChunkReach): number | null {
  const complete = reach.ended ? reach.tick : reach.tick - 1
  const throughTick = Math.max(complete, ...reach.inputTicks)
  return throughTick > reach.postedThrough ? throughTick : null
}

/** What a chunk holds besides its sequence number, which the sender assigns. */
export type ChunkBody = Omit<RunChunk, "seq">

/** The bytes a body takes on the wire, as JSON in UTF-8. */
export function byteLengthOf(body: unknown): number {
  return new TextEncoder().encode(JSON.stringify(body)).byteLength
}

/**
 * One chunk's body, cut into as few bodies as fit under `limitBytes`, each
 * with its own `throughTick`.
 *
 * A cut falls between two ticks, never inside one, so no two bodies hold
 * inputs of the same tick and each reaches only as far as its last input:
 * the next starts after it, as the platform requires. The checkpoints and the
 * original `throughTick` go with the last body. A tick whose inputs alone are
 * over the limit is sent as one body anyway, and the platform refuses it, as
 * it would refuse such a tick from anyone.
 *
 * Each input is measured once and a body's size is added up from them, with
 * a comma counted for every input, so a body is never larger than measured.
 */
export function splitChunk(body: ChunkBody, limitBytes: number): ChunkBody[] {
  // With a sequence number in, since that is what is measured on the wire.
  if (byteLengthOf({ seq: 0, ...body }) <= limitBytes) return [body]

  const counters =
    body.counters === undefined ? {} : { counters: body.counters }
  // A body with no inputs, at the widest a sequence number and a tick get.
  const early = (inputs: readonly unknown[], throughTick: number) => ({
    throughTick,
    checkpoints: [],
    inputs,
    ...counters,
  })
  const widest = Number.MAX_SAFE_INTEGER
  const earlyBase = byteLengthOf({ seq: widest, ...early([], widest) })
  const tailBase = byteLengthOf({ seq: widest, ...body, inputs: [] })

  const pieces: ChunkBody[] = []
  let inputs: unknown[] = []
  let bytes = 0
  let tick = -1
  for (let at = 0; at < body.inputs.length; ) {
    // One tick's inputs, which are never cut apart.
    const groupTick = tickOf(body.inputs[at])
    const group: unknown[] = []
    let groupBytes = 0
    while (at < body.inputs.length && tickOf(body.inputs[at]) === groupTick) {
      group.push(body.inputs[at])
      groupBytes += byteLengthOf(body.inputs[at]) + 1
      at += 1
    }
    if (inputs.length > 0 && earlyBase + bytes + groupBytes > limitBytes) {
      pieces.push(early(inputs, tick))
      inputs = []
      bytes = 0
    }
    inputs.push(...group)
    bytes += groupBytes
    tick = groupTick
  }
  // The last inputs go with the checkpoints and the chunk's own reach, unless
  // together they no longer fit.
  if (inputs.length > 0 && tailBase + bytes > limitBytes) {
    pieces.push(early(inputs, tick))
    inputs = []
  }
  pieces.push({ ...body, inputs })
  return pieces
}

/** An input's tick, as the engine stamped it. */
export function tickOf(input: unknown): number {
  const tick = (input as { readonly tick?: unknown } | null)?.tick
  return typeof tick === "number" ? tick : 0
}
