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

/** A checkpoint, as a chunk carries it. */
type Checkpoint = RunChunk["checkpoints"][number]

/** What a chunk holds at one tick, which is never cut apart. */
interface TickGroup {
  readonly tick: number
  readonly inputs: unknown[]
  readonly checkpoints: Checkpoint[]
  /** Each entry measured once, with a comma counted for it. */
  bytes: number
}

/**
 * One chunk's body, as the chunks that go on the wire: numbered from `seq`,
 * each under `limitBytes` measured with the number it carries, and as few as
 * fit.
 *
 * A cut falls between two ticks, never inside one, so no two pieces hold
 * anything of the same tick, and each piece carries the inputs and the
 * checkpoints of its own ticks: the next starts after it, as the platform
 * requires, and a checkpoint is never carried by a piece after one that
 * already reached its tick. Every piece before the last reaches the last
 * tick it holds; the last reaches the chunk's own `throughTick` and also
 * carries anything past it, such as the checkpoint of the tick the game last
 * reported. Whatever is at or past the chunk's reach goes with the last piece
 * whatever its size, and so does a tick over the limit on its own: the
 * platform refuses it, as it would refuse such a tick from anyone.
 *
 * A body that fits whole is measured with the number it carries. Once it is
 * cut, each piece is measured with the widest number and tick a piece can
 * carry, so none is larger than measured.
 */
export function splitChunk(
  body: ChunkBody,
  limitBytes: number,
  seq: number,
): RunChunk[] {
  const whole: RunChunk = { seq, ...body }
  if (byteLengthOf(whole) <= limitBytes) return [whole]

  const counters =
    body.counters === undefined ? {} : { counters: body.counters }
  const widest = Number.MAX_SAFE_INTEGER
  const groups = groupsOf(body)

  // The last piece first: whatever is at or past the chunk's reach, then as
  // many ticks before it as still fit beside the chunk's own fields.
  let first = groups.length
  let tailBytes = byteLengthOf({
    seq: widest,
    ...body,
    inputs: [],
    checkpoints: [],
  })
  for (
    let group = groups[first - 1];
    group !== undefined;
    group = groups[first - 1]
  ) {
    const reached = group.tick >= body.throughTick
    if (!reached && tailBytes + group.bytes > limitBytes) break
    tailBytes += group.bytes
    first -= 1
  }

  // Then the ticks before it, in as few pieces as hold them.
  const earlyBase = byteLengthOf({
    seq: widest,
    throughTick: widest,
    checkpoints: [],
    inputs: [],
    ...counters,
  })
  const pieces: ChunkBody[] = []
  let held: TickGroup[] = []
  let bytes = 0
  const cut = () => {
    const last = held.at(-1)
    if (last === undefined) return
    pieces.push({
      throughTick: last.tick,
      checkpoints: held.flatMap((group) => group.checkpoints),
      inputs: held.flatMap((group) => group.inputs),
      ...counters,
    })
    held = []
    bytes = 0
  }
  for (const group of groups.slice(0, first)) {
    if (earlyBase + bytes + group.bytes > limitBytes) cut()
    held.push(group)
    bytes += group.bytes
  }
  cut()

  const tail = groups.slice(first)
  pieces.push({
    ...body,
    checkpoints: tail.flatMap((group) => group.checkpoints),
    inputs: tail.flatMap((group) => group.inputs),
  })
  return pieces.map((piece, at) => ({ seq: seq + at, ...piece }))
}

/**
 * The body's inputs and checkpoints by tick, in tick order. An input and a
 * checkpoint of one tick are one group: two pieces holding them would be a
 * second piece reaching back to a tick the first committed.
 */
function groupsOf(body: ChunkBody): TickGroup[] {
  const groups: TickGroup[] = []
  const at = (tick: number): TickGroup => {
    const last = groups.at(-1)
    if (last !== undefined && last.tick === tick) return last
    const group: TickGroup = { tick, inputs: [], checkpoints: [], bytes: 0 }
    groups.push(group)
    return group
  }
  let input = 0
  let checkpoint = 0
  while (input < body.inputs.length || checkpoint < body.checkpoints.length) {
    const nextInput = body.inputs[input]
    const nextCheckpoint = body.checkpoints[checkpoint]
    if (
      nextCheckpoint === undefined ||
      (input < body.inputs.length && tickOf(nextInput) <= nextCheckpoint.tick)
    ) {
      const group = at(tickOf(nextInput))
      group.inputs.push(nextInput)
      group.bytes += byteLengthOf(nextInput) + 1
      input += 1
    } else {
      const group = at(nextCheckpoint.tick)
      group.checkpoints.push(nextCheckpoint)
      group.bytes += byteLengthOf(nextCheckpoint) + 1
      checkpoint += 1
    }
  }
  return groups
}

/** An input's tick, as the engine stamped it. */
export function tickOf(input: unknown): number {
  const tick = (input as { readonly tick?: unknown } | null)?.tick
  return typeof tick === "number" ? tick : 0
}
