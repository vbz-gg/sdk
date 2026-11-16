/**
 * Loading a game's page module onto a studio's page.
 *
 * The module is imported by URL, from the platform's bundle origin, and every
 * part of it is checked before anything is played, because what arrives is
 * built by somebody else, often with another release of this package: its
 * default export could be missing, a newer contract, another version of the
 * game, or a module whose own parts disagree. Each is refused here with a
 * code that names it, before a run is started, so a failure spends no run.
 *
 * The last check is about the page rather than the module. The rules code
 * runs in the page's realm and calls the page's `Math`, `Array` and `JSON`,
 * and the platform replays it in a fresh isolate. A script on the page that
 * replaced one of those would make the page play a different game from the
 * one the platform replays, and every run would fail the replay. It is read
 * through `Function.prototype.toString`, which catches a library's mistake
 * and not somebody determined to hide one.
 */

import type { MotionAccess } from "@clockwork2/engine/host"
import {
  DRIVEN_CONTRACTS,
  type MountHandle,
  type MountOptions,
  PAGE_MODULE_PROBLEM,
  type PageModuleProblem,
} from "../game/contract.js"
import {
  type ClientErrorCode,
  PlatformClientError,
} from "../platform/errors.js"

/** Where a version's page module is, and the manifest hash it must report. */
export interface GameAddress {
  /** Absolute: https, or http to this machine. */
  readonly presentUrl: string
  readonly manifestHash: string
}

/** A page module that passed every check, ready for a click. */
export interface LoadedGame {
  readonly presentUrl: string
  readonly manifestHash: string
  readonly contract: number
  /** Whether the game reads tilt, so `playRun` asks for it in the click. */
  readonly needsMotion: boolean
  /** The module's own `requestMotion`. Call it in the click, before any await. */
  requestMotion(): Promise<MotionAccess>
  /** The module's own `mount`. `playRun` and `watchRun` call it. */
  mount(element: HTMLElement, options: MountOptions): MountHandle
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

/**
 * Imports `address`'s page module and checks it, in this order: the URL is
 * absolute https, or http to this machine; the import succeeds; its default
 * export is an object; its contract is one this release drives; `mount`,
 * `check` and `requestMotion` are functions, `manifestHash` a string and
 * `needsMotion` a boolean; the manifest hash is the address's; its own
 * `check()` finds nothing; and no built-in a simulation calls has been
 * replaced on this page.
 *
 * Each failure is a `PlatformClientError`: `E_GAME_UNLOADABLE`,
 * `E_GAME_MODULE_INVALID` naming the field, `E_GAME_CONTRACT_UNKNOWN`,
 * `E_WRONG_GAME`, the module's own `E_SIM_PACKS`, `E_CAPTURE_INVALID` or
 * `E_GAME_MODULE_INVALID` with its problems, or `E_PAGE_ALTERS_BUILTINS`
 * naming the built-in.
 */
export async function loadGame(
  address: GameAddress,
  options: LoadOptions = {},
): Promise<LoadedGame> {
  const url = addressOf(address.presentUrl)

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
  if (typeof contract !== "number" || !DRIVEN_CONTRACTS.includes(contract)) {
    refuse("E_GAME_CONTRACT_UNKNOWN", {
      url,
      module: contract,
      driven: DRIVEN_CONTRACTS,
    })
  }
  for (const [field, kind] of [
    ["mount", "function"],
    ["check", "function"],
    ["requestMotion", "function"],
    ["manifestHash", "string"],
    ["needsMotion", "boolean"],
  ] as const) {
    if (typeof game[field] !== kind) {
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
    check(): unknown
    requestMotion(): Promise<MotionAccess>
    mount(element: HTMLElement, options: MountOptions): MountHandle
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

  return {
    presentUrl: url,
    manifestHash: parts.manifestHash,
    contract,
    needsMotion: parts.needsMotion,
    requestMotion: () => parts.requestMotion(),
    mount: (element, mountOptions) => parts.mount(element, mountOptions),
  }
}

function addressOf(presentUrl: string): string {
  let url: URL
  try {
    url = new URL(presentUrl)
  } catch {
    return refuse("E_GAME_UNLOADABLE", {
      url: presentUrl,
      problem: "the address is not an absolute URL",
    })
  }
  const allowed =
    url.protocol === "https:" ||
    (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
  if (!allowed) {
    refuse("E_GAME_UNLOADABLE", {
      url: presentUrl,
      problem: "a game's code is loaded over https, or http to this machine",
    })
  }
  return url.toString()
}

/** The module's own check, held to its shape: a list of problems it knows. */
function problemsOf(parts: { check(): unknown }): PageModuleProblem[] {
  let answer: unknown
  try {
    answer = parts.check()
  } catch (error) {
    return [{ code: PAGE_MODULE_PROBLEM.MODULE, message: String(error) }]
  }
  const known = new Set<string>(Object.values(PAGE_MODULE_PROBLEM))
  if (
    !Array.isArray(answer) ||
    !answer.every(
      (problem: unknown) =>
        typeof problem === "object" &&
        problem !== null &&
        known.has(String((problem as { code?: unknown }).code)) &&
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
  return answer as PageModuleProblem[]
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
