/**
 * Loading a game's page module onto a page.
 *
 * The module is imported by URL, from beside the page, from another host,
 * or on vbz.gg from the platform's bundle origin, and every part of it is
 * checked before anything is played, because what arrives is built by
 * somebody else, often with another release of this package: its
 * default export could be missing, a newer contract, another version of the
 * game, or a module whose own parts disagree. Each is refused here with a
 * code that names it, before a run is started, so a failure spends no run.
 *
 * The last check is about the page rather than the module. The rules code
 * runs in the page's realm and calls the page's `Math`, `Array` and `JSON`,
 * and a replay runs it in a fresh realm. A script on the page that replaced
 * one of those would make the page play a different game from the one a
 * replay plays, and every run would fail the replay. It is read
 * through `Function.prototype.toString`, which catches a library's mistake
 * and not somebody determined to hide one.
 */

import type { PlainValue } from "@clockwork2/engine"
import type { MotionAccess } from "@clockwork2/engine/host"
import {
  type ContractOneMountOptions,
  DRIVEN_CONTRACTS,
  MOUNT_ERROR,
  type MountError,
  type MountHandle,
  type MountHandlers,
  type MountOptions,
  PAGE_MODULE_PROBLEM,
  type PageModuleProblem,
  type PreparedGame,
  type PrepareOptions,
  type RunMount,
  type SeatlessHandlers,
  type SeatlessMountHandle,
} from "../game/contract.js"
import {
  type ClientErrorCode,
  PlatformClientError,
} from "../platform/errors.js"

/**
 * Where a version's page module is, the manifest hash it must report, and
 * where its files folder is: what `GET /v1/game`, a run's start and a run
 * read back each name.
 */
export interface GameAddress {
  /** Absolute: https, or http to this machine. */
  readonly presentUrl: string
  readonly manifestHash: string
  /** Absolute, ending in `/`: https, or http to this machine. */
  readonly filesUrl: string
}

/** What a page hands a loaded game to get it ready: the folder is the version's own. */
export type PagePrepareOptions = Omit<PrepareOptions, "files">

/** What a page hands a loaded game to play a run: the run, and how to get ready. */
export type GameMountOptions = RunMount & PagePrepareOptions

/**
 * A page module that passed every check, ready for a click, whichever
 * contract it speaks. A page drives all three the same way: a contract-1
 * module is handed what it was built to take, and a run on it still stops at
 * its own manifest's step limit; a module of contract 1 or 2 is a game of
 * one seat, whose handle has no remote and whose frames wait for nobody.
 */
export interface LoadedGame {
  readonly presentUrl: string
  readonly manifestHash: string
  /** The version's files folder, which the module is handed with every run. */
  readonly filesUrl: string
  readonly contract: number
  /** Whether the game reads tilt, so `playRun` asks for it in the click. */
  readonly needsMotion: boolean
  /** The game's tick rate. Null for a contract-1 module, which does not say. */
  readonly tickHz: number | null
  /**
   * How many seats a run of the game has: 1 for a game played alone, and
   * for a module of contract 1 or 2, from before seats.
   */
  readonly seats: number
  /**
   * Every declared setting at its default, what a platform serves a run.
   * Null for a contract-1 module, which does not say, and for a game with a
   * required setting that has no default.
   */
  readonly servedConfig: PlainValue | null
  /** The module's own `requestMotion`. Call it in the click, before any await. */
  requestMotion(): Promise<MotionAccess>
  /**
   * Gets the game ready in `element` before a run is asked for: its
   * presentation drawn and its start packs fetched. A contract-1 module
   * cannot be got ready ahead, and is ready at once.
   */
  prepare(element: HTMLElement, options?: PagePrepareOptions): PreparedGame
  /** The module's own `mount`. `playRun`, `watchRun` and `playLocal` call it. */
  mount(element: HTMLElement, options: GameMountOptions): MountHandle
}

export interface LoadOptions {
  /** For a test: imports a module by URL. The browser's `import()` by default. */
  readonly importModule?: (url: string) => Promise<unknown>
}

/**
 * The built-ins a simulation may call, by where they live. The engine's
 * allowed `Math` functions, and the methods of the containers and the two
 * text types a game's state is made of.
 */
export const SIMULATION_BUILTINS: Readonly<Record<string, readonly string[]>> =
  {
    Math: [
      "sqrt",
      "floor",
      "ceil",
      "round",
      "trunc",
      "abs",
      "min",
      "max",
      "sign",
      "fround",
      "imul",
      "clz32",
    ],
    Array: ["from", "isArray", "of"],
    "Array.prototype": [
      "concat",
      "copyWithin",
      "entries",
      "every",
      "fill",
      "filter",
      "find",
      "findIndex",
      "flat",
      "flatMap",
      "forEach",
      "includes",
      "indexOf",
      "join",
      "keys",
      "lastIndexOf",
      "map",
      "pop",
      "push",
      "reduce",
      "reduceRight",
      "reverse",
      "shift",
      "slice",
      "some",
      "sort",
      "splice",
      "unshift",
      "values",
    ],
    "Map.prototype": [
      "clear",
      "delete",
      "entries",
      "forEach",
      "get",
      "has",
      "keys",
      "set",
      "values",
    ],
    "Set.prototype": [
      "add",
      "clear",
      "delete",
      "entries",
      "forEach",
      "has",
      "keys",
      "values",
    ],
    Object: [
      "assign",
      "create",
      "defineProperty",
      "entries",
      "freeze",
      "fromEntries",
      "getOwnPropertyNames",
      "getPrototypeOf",
      "is",
      "keys",
      "values",
    ],
    "Object.prototype": ["hasOwnProperty", "toString"],
    JSON: ["parse", "stringify"],
    Number: [
      "isFinite",
      "isInteger",
      "isNaN",
      "isSafeInteger",
      "parseFloat",
      "parseInt",
    ],
    "Number.prototype": ["toFixed", "toString"],
    String: ["fromCharCode", "fromCodePoint"],
    "String.prototype": [
      "charAt",
      "charCodeAt",
      "codePointAt",
      "concat",
      "endsWith",
      "includes",
      "indexOf",
      "lastIndexOf",
      "padEnd",
      "padStart",
      "repeat",
      "replace",
      "slice",
      "split",
      "startsWith",
      "substring",
      "toLowerCase",
      "toUpperCase",
      "trim",
    ],
    // The constructors themselves, as `new Map()` and `Array.from` reach them.
    globalThis: ["Array", "Map", "Set", "Object", "Number", "String"],
  }

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
])

/** What `Function.prototype.toString` says of a function the engine provides. */
const NATIVE = /^function\s*[^(]*\(\)\s*\{\s*\[native code\]\s*\}$/

/** The browser's own import, which a bundler is told to leave alone. */
function browserImport(url: string): Promise<unknown> {
  return import(/* webpackIgnore: true */ /* @vite-ignore */ url)
}

function refuse(code: ClientErrorCode, cause?: unknown): never {
  throw new PlatformClientError(code, cause === undefined ? {} : { cause })
}

/** The kinds a member of a page module is held to. */
type MemberKind = "function" | "string" | "boolean" | "number" | "plain or null"

/** What each contract a module may speak has to carry, by member and kind. */
const CONTRACT_MEMBERS: Readonly<
  Record<number, ReadonlyArray<readonly [string, MemberKind]>>
> = {
  1: [
    ["mount", "function"],
    ["check", "function"],
    ["requestMotion", "function"],
    ["manifestHash", "string"],
    ["needsMotion", "boolean"],
  ],
  2: [
    ["mount", "function"],
    ["prepare", "function"],
    ["check", "function"],
    ["requestMotion", "function"],
    ["manifestHash", "string"],
    ["needsMotion", "boolean"],
    ["tickHz", "number"],
    ["servedConfig", "plain or null"],
  ],
  3: [
    ["mount", "function"],
    ["prepare", "function"],
    ["check", "function"],
    ["requestMotion", "function"],
    ["manifestHash", "string"],
    ["needsMotion", "boolean"],
    ["tickHz", "number"],
    ["seats", "number"],
    ["servedConfig", "plain or null"],
  ],
}

function isKind(value: unknown, kind: MemberKind): boolean {
  if (kind === "plain or null") {
    return (
      value === null || (typeof value === "object" && !Array.isArray(value))
    )
  }
  return typeof value === kind
}

/**
 * Imports `address`'s page module and checks it, in this order: the module's
 * and the files folder's addresses are absolute https, or http to this
 * machine; the import succeeds; its default export is an object; its
 * contract is one this release drives; every member that contract names is
 * of its kind; the manifest hash is the address's; its own `check()` finds
 * nothing; and no built-in a simulation calls has been replaced on this page.
 *
 * Each failure is a `PlatformClientError`: `E_GAME_UNLOADABLE`,
 * `E_GAME_MODULE_INVALID` naming the field, `E_GAME_CONTRACT_UNKNOWN`,
 * `E_WRONG_GAME`, the module's own `E_CAPTURE_INVALID` or
 * `E_GAME_MODULE_INVALID` with its problems, or `E_PAGE_ALTERS_BUILTINS`
 * naming the built-in.
 */
export async function loadGame(
  address: GameAddress,
  options: LoadOptions = {},
): Promise<LoadedGame> {
  const url = secureUrl(address.presentUrl, "the page module's").toString()
  const filesUrl = filesAddressOf(address.filesUrl)

  let loaded: unknown
  try {
    loaded = await (options.importModule ?? browserImport)(url)
  } catch (error) {
    refuse("E_GAME_UNLOADABLE", { url, error: String(error) })
  }

  const module =
    typeof loaded === "object" && loaded !== null
      ? (loaded as { readonly default?: unknown }).default
      : undefined
  if (typeof module !== "object" || module === null) {
    refuse("E_GAME_MODULE_INVALID", {
      url,
      field: "default",
      problem: "the module's default export is not an object",
    })
  }
  const game = module as Record<string, unknown>

  const contract = game.contract
  const members =
    typeof contract === "number" && DRIVEN_CONTRACTS.includes(contract)
      ? CONTRACT_MEMBERS[contract]
      : undefined
  if (typeof contract !== "number" || members === undefined) {
    refuse("E_GAME_CONTRACT_UNKNOWN", {
      url,
      module: contract,
      driven: DRIVEN_CONTRACTS,
    })
  }
  for (const [field, kind] of members) {
    if (!isKind(game[field], kind)) {
      refuse("E_GAME_MODULE_INVALID", {
        url,
        field,
        problem: `${field} is not a ${kind}`,
      })
    }
  }
  const parts = game as unknown as {
    readonly manifestHash: string
    readonly needsMotion: boolean
    readonly tickHz?: number
    readonly seats?: number
    readonly servedConfig?: PlainValue | null
    check(): unknown
    requestMotion(): Promise<MotionAccess>
  }

  if (parts.manifestHash !== address.manifestHash) {
    refuse("E_WRONG_GAME", {
      url,
      module: parts.manifestHash,
      expected: address.manifestHash,
    })
  }

  const problems = problemsOf(parts)
  const first = problems[0]
  if (first !== undefined) refuse(first.code, { url, problems })

  const altered = alteredBuiltins()
  if (altered.length > 0) refuse("E_PAGE_ALTERS_BUILTINS", { altered })

  const driven =
    contract === 1
      ? contractOne(game as unknown as ContractOneModule)
      : contract === 2
        ? contractTwo(game as unknown as ContractTwoModule, filesUrl)
        : contractThree(game as unknown as ContractThreeModule, filesUrl)
  return {
    presentUrl: url,
    manifestHash: parts.manifestHash,
    filesUrl,
    contract,
    needsMotion: parts.needsMotion,
    tickHz: parts.tickHz ?? null,
    seats: parts.seats ?? 1,
    servedConfig: parts.servedConfig ?? null,
    requestMotion: () => parts.requestMotion(),
    ...driven,
  }
}

interface ContractOneModule {
  mount(
    element: HTMLElement,
    options: ContractOneMountOptions,
  ): SeatlessMountHandle
}

/** What a contract-2 module's mount takes: a run with no seats, and its folder. */
type ContractTwoMountOptions = (
  | Omit<Extract<RunMount, { mode: "play" }>, "seats" | "handlers">
  | Omit<Extract<RunMount, { mode: "watch" }>, "handlers">
) &
  PrepareOptions & { readonly handlers: SeatlessHandlers }

interface ContractTwoModule {
  prepare(
    element: HTMLElement,
    options: PrepareOptions,
  ): {
    readonly ready: Promise<MountError | null>
    mount(
      options: Omit<ContractTwoMountOptions, keyof PrepareOptions>,
    ): SeatlessMountHandle
    release(): void
  }
  mount(
    element: HTMLElement,
    options: ContractTwoMountOptions,
  ): SeatlessMountHandle
}

interface ContractThreeModule {
  prepare(element: HTMLElement, options: PrepareOptions): PreparedGame
  mount(element: HTMLElement, options: MountOptions): MountHandle
}

type Driven = Pick<LoadedGame, "prepare" | "mount">

/** A handle on a run refused before it started. */
function refused(options: RunMount, error: MountError): MountHandle {
  options.handlers.onError(error)
  return {
    remote: null,
    recorded: () => (options.mode === "watch" ? (options.inputs ?? []) : []),
    stop: () => {},
    destroy: () => {},
  }
}

/**
 * A contract-1 module, driven as its own release built it. Its `mount` takes
 * a step limit for every run and clamps it to its manifest's, so a played
 * run is given the largest one it takes and still stops at the manifest's.
 * It knows nothing of a files folder, of scripted events or of watching
 * without drawing: a run asking for that last one is refused.
 */
function contractOne(module: ContractOneModule): Driven {
  const mount = (
    element: HTMLElement,
    options: GameMountOptions,
  ): MountHandle => {
    if (options.mode === "watch" && options.draw === false) {
      return refused(options, {
        code: "E_ARG_INVALID",
        message:
          "this page module speaks contract 1, which cannot be watched without drawing",
      })
    }
    const seatless = seatlessRefusal(options, 1)
    if (seatless !== null) return refused(options, seatless)
    return oneSeat(
      module.mount(element, {
        mode: options.mode,
        seed: options.seed,
        config: options.config,
        tickHz: options.tickHz,
        maxTicks:
          options.mode === "watch" ? options.maxTicks : Number.MAX_SAFE_INTEGER,
        ...(options.mode === "watch" ? { inputs: options.inputs } : {}),
        expect: options.expect,
        handlers: seatlessHandlers(options.handlers),
        ...(options.presentationContext === undefined
          ? {}
          : { presentationContext: options.presentationContext }),
        ...(options.scheduler === undefined
          ? {}
          : { scheduler: options.scheduler }),
        ...(options.environment === undefined
          ? {}
          : { environment: options.environment }),
      }),
    )
  }
  return {
    prepare: (element, prepareOptions = {}) => {
      let run: MountHandle | null = null
      return {
        ready: Promise.resolve(null),
        mount: (options) => {
          run = mount(element, { ...prepareOptions, ...options })
          return run
        },
        release: () => run?.destroy(),
      }
    },
    mount,
  }
}

/**
 * A contract-2 module, handed its own version's files folder with every run.
 * Its game has one seat: a run asking for seats is refused here, its frames
 * wait for nobody and its handle has no remote.
 */
function contractTwo(module: ContractTwoModule, files: string): Driven {
  const seatless = <T extends RunMount>(run: T) => ({
    ...run,
    handlers: seatlessHandlers(run.handlers),
  })
  return {
    prepare: (element, options = {}) => {
      const prepared = module.prepare(element, { ...options, files })
      return {
        ready: prepared.ready,
        mount: (run) => {
          const refusal = seatlessRefusal(run, 2)
          if (refusal !== null) return refused(run, refusal)
          return oneSeat(prepared.mount(seatless(run)))
        },
        release: () => prepared.release(),
      }
    },
    mount: (element, options) => {
      const refusal = seatlessRefusal(options, 2)
      if (refusal !== null) return refused(options, refusal)
      return oneSeat(module.mount(element, { ...seatless(options), files }))
    },
  }
}

/** A contract-3 module, handed its own version's files folder with every run. */
function contractThree(module: ContractThreeModule, files: string): Driven {
  return {
    prepare: (element, options = {}) =>
      module.prepare(element, { ...options, files }),
    mount: (element, options) => module.mount(element, { ...options, files }),
  }
}

/**
 * Why a module of a contract from before seats cannot play `run`: it asks
 * for seats, which its game does not have. Null when it does not.
 */
function seatlessRefusal(run: RunMount, contract: number): MountError | null {
  if (run.mode !== "play" || run.seats === undefined) return null
  return {
    code: MOUNT_ERROR.SEATS_UNEXPECTED,
    message: `this page module speaks contract ${contract}, from before seats, so its game has one seat and a played run takes no seats`,
  }
}

/** A page's handlers, as a module from before seats calls them. */
function seatlessHandlers(handlers: MountHandlers): SeatlessHandlers {
  return {
    onCheckpoint: (checkpoint) => handlers.onCheckpoint(checkpoint),
    onFrame: (frame) => handlers.onFrame({ ...frame, waitingForSeat: null }),
    onEnded: (ended) => handlers.onEnded(ended),
    onError: (error) => handlers.onError(error),
    ...(handlers.onNotice === undefined
      ? {}
      : { onNotice: (notice) => handlers.onNotice?.(notice) }),
  }
}

/** A handle from a module from before seats, as a page on this release reads one. */
function oneSeat(handle: SeatlessMountHandle): MountHandle {
  return {
    remote: null,
    recorded: () => handle.recorded(),
    stop: (reason) => handle.stop(reason),
    destroy: () => handle.destroy(),
  }
}

/** `raw` as an absolute URL, https or http to this machine, or a refusal. */
function secureUrl(raw: string, whose: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return refuse("E_GAME_UNLOADABLE", {
      url: raw,
      problem: `${whose} address is not an absolute URL`,
    })
  }
  const allowed =
    url.protocol === "https:" ||
    (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
  if (!allowed) {
    refuse("E_GAME_UNLOADABLE", {
      url: raw,
      problem: "a game's code is loaded over https, or http to this machine",
    })
  }
  return url
}

/**
 * A files folder's address: absolute, https or http to this machine, and
 * ending in `/`, or every file's address loses the folder's last segment.
 */
function filesAddressOf(filesUrl: string): string {
  const url = secureUrl(filesUrl, "the files folder's")
  if (!url.pathname.endsWith("/") || url.search !== "" || url.hash !== "") {
    refuse("E_GAME_UNLOADABLE", {
      url: filesUrl,
      problem: "the files folder's address ends in / and carries no query",
    })
  }
  return url.toString()
}

/**
 * The module's own check, held to its shape: a list of problems, each with a
 * code and a sentence. A code this page does not know, such as one an older
 * release's module answered, is still a module that cannot play, and is
 * `E_GAME_MODULE_INVALID` carrying the problem as the module said it.
 */
function problemsOf(parts: { check(): unknown }): PageModuleProblem[] {
  let answer: unknown
  try {
    answer = parts.check()
  } catch (error) {
    return [{ code: PAGE_MODULE_PROBLEM.MODULE, message: String(error) }]
  }
  if (
    !Array.isArray(answer) ||
    !answer.every(
      (problem: unknown) =>
        typeof problem === "object" &&
        problem !== null &&
        typeof (problem as { code?: unknown }).code === "string" &&
        typeof (problem as { message?: unknown }).message === "string",
    )
  ) {
    return [
      {
        code: PAGE_MODULE_PROBLEM.MODULE,
        message: "check() did not answer a list of problems",
      },
    ]
  }
  const known = new Set<string>(Object.values(PAGE_MODULE_PROBLEM))
  return (answer as Array<{ code: string; message: string }>).map((problem) =>
    known.has(problem.code)
      ? (problem as PageModuleProblem)
      : {
          code: PAGE_MODULE_PROBLEM.MODULE,
          message: `${problem.code}: ${problem.message}`,
        },
  )
}

/**
 * The built-ins in `SIMULATION_BUILTINS` that this page has replaced, by
 * name, or an empty list. One that is missing, or is not a function, is
 * replaced too: the rules code calls it. `Function.prototype.toString` is
 * checked first, since every other answer is read through it.
 */
export function alteredBuiltins(): string[] {
  const source = Function.prototype.toString
  const native = (value: unknown): boolean =>
    typeof value === "function" && NATIVE.test(source.call(value))
  // A replacement wrapping the original shows its own source when asked
  // about itself, and one answering native for everything says it of this
  // function too, which is not.
  if (!native(source) || native(alteredBuiltins)) {
    return ["Function.prototype.toString"]
  }
  const altered: string[] = []
  for (const [where, names] of Object.entries(SIMULATION_BUILTINS)) {
    let holder: unknown = globalThis
    if (where !== "globalThis") {
      for (const step of where.split(".")) {
        holder = (holder as Record<string, unknown> | undefined)?.[step]
      }
    }
    for (const name of names) {
      const value = (holder as Record<string, unknown> | undefined)?.[name]
      if (!native(value)) {
        altered.push(where === "globalThis" ? name : `${where}.${name}`)
      }
    }
  }
  return altered
}
