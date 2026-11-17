/**
 * A page the client can run in without a browser: timers that move only
 * when a test says so, a sign-in box a test closes and whose frame it posts
 * from, messages a test posts, a `fetch` that answers from a script, and
 * storage in a Map.
 */

import type {
  MessageLike,
  PageEnvironment,
  SignInBox,
} from "../../src/platform/environment"

export interface Sent {
  readonly url: URL
  readonly method: string
  readonly headers: Record<string, string>
  readonly body: unknown
  readonly credentials: RequestCredentials | undefined
}

export type Answer =
  | { readonly status: number; readonly body: unknown }
  | { readonly status: number; readonly text: string }
  | { readonly unreachable: true }

/** The sign-in's box, as a test sees it: where its frame points, and whether it is up. */
export class FakeBox implements SignInBox {
  /** Stands in for the frame's window, which a message's `source` is compared with. */
  readonly frame = { name: "the sign-in's frame" }
  url: string | null = null
  removed = false

  constructor(
    /** The player closing it from the page: Cancel, or Escape. */
    readonly cancel: () => void,
  ) {}

  load(url: string): void {
    this.url = url
  }

  remove(): void {
    this.removed = true
  }
}

export class FakePage implements PageEnvironment {
  readonly origin = "https://lantern.example"
  readonly crypto = globalThis.crypto
  readonly sent: Sent[] = []
  /** Every box put on the page, in order. */
  readonly boxes: FakeBox[] = []
  /** What putting a box on the page throws, when set. */
  boxFails: Error | null = null
  private listeners = new Set<(event: MessageLike) => void>()
  private timers = new Map<number, { at: number; run: () => void }>()
  private nextTimer = 1
  private clock = 1_000_000
  readonly kept = new Map<string, string>()
  storageThrows = false
  /** Answers, in order, keyed by "METHOD /path". A function sees the request. */
  answers: Array<Answer | ((sent: Sent) => Answer)> = []

  fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const sent: Sent = {
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      headers: { ...(init?.headers as Record<string, string>) },
      body:
        init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      credentials: init?.credentials,
    }
    this.sent.push(sent)
    const next = this.answers.shift()
    if (next === undefined)
      throw new Error(
        `no answer scripted for ${sent.method} ${sent.url.pathname}`,
      )
    const answer = typeof next === "function" ? next(sent) : next
    if ("unreachable" in answer) throw new TypeError("Failed to fetch")
    const text = "text" in answer ? answer.text : JSON.stringify(answer.body)
    return new Response(text, { status: answer.status })
  }) as typeof fetch

  mountSignInBox(onCancel: () => void): SignInBox {
    if (this.boxFails !== null) throw this.boxFails
    const box = new FakeBox(onCancel)
    this.boxes.push(box)
    return box
  }

  /** The box last put on the page. */
  get box(): FakeBox | undefined {
    return this.boxes.at(-1)
  }

  addMessageListener(listener: (event: MessageLike) => void): void {
    this.listeners.add(listener)
  }

  removeMessageListener(listener: (event: MessageLike) => void): void {
    this.listeners.delete(listener)
  }

  /** A message to the page, as the browser would deliver it. */
  post(event: MessageLike): void {
    for (const listener of [...this.listeners]) listener(event)
  }

  get listening(): number {
    return this.listeners.size
  }

  setTimeout(run: () => void, ms: number): unknown {
    const id = this.nextTimer++
    this.timers.set(id, { at: this.clock + ms, run })
    return id
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number)
  }

  get pendingTimers(): number {
    return this.timers.size
  }

  /** Moves the clock, running every timer that comes due on the way. */
  advance(ms: number): void {
    const until = this.clock + ms
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= until)
        .sort(([, a], [, b]) => a.at - b.at)[0]
      if (due === undefined) break
      const [id, timer] = due
      this.clock = timer.at
      this.timers.delete(id)
      timer.run()
    }
    this.clock = until
  }

  storage(): Storage | undefined {
    if (this.storageThrows) throw new Error("SecurityError")
    const kept = this.kept
    return {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
      clear: () => kept.clear(),
      key: () => null,
      length: kept.size,
    }
  }

  now(): number {
    return this.clock
  }
}

/**
 * Lets queued work run: promise callbacks, and the real event-loop turns the
 * runtime's own `crypto.subtle` finishes on. The page's timers stay put.
 */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}
