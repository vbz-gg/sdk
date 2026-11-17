/**
 * Loading a page module, refused at each check in the order a page meets
 * them. What arrives is somebody else's build, so every part is read as
 * unknown until it has passed.
 */

import { afterEach, describe, expect, test } from "bun:test"
import { hashCanonical, type PlainValue } from "@clockwork2/engine"
import type {
  ContractOneMountOptions,
  MountError,
  MountHandlers,
  MountOptions,
} from "../../src/game/contract"
import { definePageModule } from "../../src/game/define"
import {
  alteredBuiltins,
  type GameAddress,
  type GameMountOptions,
  loadGame,
} from "../../src/host/load"
import { PlatformClientError } from "../../src/platform/errors"
import { Drawn, MANIFEST, Probe } from "../game/subject"

const URL_OK =
  "https://bundles.example/g/0b6f3c1e-2d4a-4e8b-9c7d-5a1f2e3b4c6d/present/abc.js"
const FILES =
  "https://bundles.example/g/0b6f3c1e-2d4a-4e8b-9c7d-5a1f2e3b4c6d/t/def/"
const HASH = hashCanonical(MANIFEST as unknown as PlainValue)
const ADDRESS: GameAddress = {
  presentUrl: URL_OK,
  manifestHash: HASH,
  filesUrl: FILES,
}

const HANDLE = { recorded: () => [], stop() {}, destroy() {} }

/** A contract-1 module whose every part a page reads is right. */
function good(overrides: Record<string, unknown> = {}) {
  return {
    contract: 1,
    manifestHash: HASH,
    needsMotion: false,
    check: () => [],
    requestMotion: async () => ({ granted: true }),
    mount: () => HANDLE,
    ...overrides,
  }
}

/** A contract-2 module whose every part a page reads is right. */
function goodTwo(overrides: Record<string, unknown> = {}) {
  return good({
    contract: 2,
    tickHz: 60,
    servedConfig: { speed: 1 },
    prepare: () => ({
      ready: Promise.resolve(null),
      mount: () => HANDLE,
      release() {},
    }),
    ...overrides,
  })
}

/** A played run, as a page hands one to a loaded game. */
function run(handlers: Partial<MountHandlers> = {}): GameMountOptions {
  return {
    mode: "play",
    seed: "s",
    config: {},
    tickHz: 60,
    scripted: "ignore",
    expect: { manifestHash: HASH },
    handlers: {
      onCheckpoint() {},
      onFrame() {},
      onEnded() {},
      onError() {},
      ...handlers,
    },
  }
}

function serving(namespace: unknown) {
  const asked: string[] = []
  return {
    asked,
    importModule: async (url: string) => {
      asked.push(url)
      return namespace
    },
  }
}

/** What a promise was refused with, which has to be a client error. */
async function caught(promise: Promise<unknown>): Promise<PlatformClientError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof PlatformClientError) return error
    throw error
  }
  throw new Error("nothing was refused")
}

async function refusal(
  address: GameAddress,
  namespace: unknown,
): Promise<PlatformClientError> {
  try {
    await loadGame(address, serving(namespace))
  } catch (error) {
    if (error instanceof PlatformClientError) return error
    throw error
  }
  throw new Error("nothing was refused")
}

describe("where a game's code may come from", () => {
  test("an address that is not absolute https, or http here, is never imported", async () => {
    for (const presentUrl of [
      "/g/x/present/abc.js",
      "present.js",
      "http://bundles.example/present.js",
      "ftp://bundles.example/present.js",
      "data:text/javascript,export default {}",
    ]) {
      const server = serving({ default: good() })
      try {
        await loadGame({ ...ADDRESS, presentUrl }, server)
        throw new Error(`${presentUrl} was loaded`)
      } catch (error) {
        expect((error as PlatformClientError).code).toBe("E_GAME_UNLOADABLE")
      }
      expect(server.asked).toEqual([])
    }
  })

  test("https anywhere, and http on this machine, are imported", async () => {
    for (const presentUrl of [
      URL_OK,
      "http://localhost:4311/g/x/present/a.js",
      "http://127.0.0.1:4311/g/x/present/a.js",
      "http://[::1]:4311/g/x/present/a.js",
    ]) {
      const server = serving({ default: good() })
      const game = await loadGame({ ...ADDRESS, presentUrl }, server)
      expect(server.asked).toEqual([presentUrl])
      expect(game.presentUrl).toBe(presentUrl)
    }
  })

  /** A folder named without its slash would lose its last segment from every file. */
  test("a files folder that is not absolute https, or http here, ending in /, imports nothing", async () => {
    for (const filesUrl of [
      "/g/x/t/y/",
      "http://bundles.example/g/x/t/y/",
      "https://bundles.example/g/x/t/y",
      "https://bundles.example/g/x/t/y/?v=1",
    ]) {
      const server = serving({ default: good() })
      const error = await caught(loadGame({ ...ADDRESS, filesUrl }, server))
      expect(error.code).toBe("E_GAME_UNLOADABLE")
      expect(server.asked).toEqual([])
    }
  })

  /** Whatever stopped it, the network, a CSP, a 404, the page hears one code. */
  test("an import that fails is unloadable, naming the address", async () => {
    const error = await caught(
      loadGame(ADDRESS, {
        importModule: async () => {
          throw new TypeError("Failed to fetch dynamically imported module")
        },
      }),
    )
    expect(error.code).toBe("E_GAME_UNLOADABLE")
    expect(error.cause).toMatchObject({ url: URL_OK })
  })

  test("the browser's own import is what is used by default", async () => {
    const error = await caught(
      loadGame({
        ...ADDRESS,
        presentUrl: "http://127.0.0.1:1/g/x/present/a.js",
      }),
    )
    expect(error.code).toBe("E_GAME_UNLOADABLE")
  })
})

describe("what a page module has to be", () => {
  test("a default export that is not an object", async () => {
    for (const namespace of [{}, { default: null }, { default: 7 }, null]) {
      const error = await refusal(ADDRESS, namespace)
      expect(error.code).toBe("E_GAME_MODULE_INVALID")
      expect(error.cause).toMatchObject({ field: "default" })
    }
  })

  /** A newer module's shape could mean anything, so it is not guessed at. */
  test("a contract this release does not drive, naming both", async () => {
    for (const contract of [3, 0, "1", undefined]) {
      const error = await refusal(ADDRESS, { default: good({ contract }) })
      expect(error.code).toBe("E_GAME_CONTRACT_UNKNOWN")
      expect(error.cause).toMatchObject({ module: contract, driven: [1, 2] })
    }
  })

  test("each part that is the wrong kind is named", async () => {
    for (const [field, value] of [
      ["mount", undefined],
      ["check", "yes"],
      ["requestMotion", {}],
      ["manifestHash", 42],
      ["needsMotion", "no"],
    ] as const) {
      const error = await refusal(ADDRESS, {
        default: good({ [field]: value }),
      })
      expect(error.code).toBe("E_GAME_MODULE_INVALID")
      expect(error.cause).toMatchObject({ field })
    }
  })

  /** What contract 2 adds is held as well, so a page never reads a missing tick rate. */
  test("each part contract 2 adds that is the wrong kind is named", async () => {
    for (const [field, value] of [
      ["prepare", undefined],
      ["tickHz", "60"],
      ["servedConfig", undefined],
      ["servedConfig", []],
    ] as const) {
      const error = await refusal(ADDRESS, {
        default: goodTwo({ [field]: value }),
      })
      expect(error.code).toBe("E_GAME_MODULE_INVALID")
      expect(error.cause).toMatchObject({ field })
    }
  })

  test("a module of another version of the game", async () => {
    const error = await refusal(ADDRESS, {
      default: good({ manifestHash: "other" }),
    })
    expect(error.code).toBe("E_WRONG_GAME")
    expect(error.cause).toMatchObject({ module: "other", expected: HASH })
  })

  test("the module's own problems, answered with the first one's code", async () => {
    for (const code of ["E_CAPTURE_INVALID", "E_GAME_MODULE_INVALID"]) {
      const problems = [
        { code, message: "first" },
        { code: "E_CAPTURE_INVALID", message: "second" },
      ]
      const error = await refusal(ADDRESS, {
        default: good({ check: () => problems }),
      })
      expect(error.code).toBe(code as PlatformClientError["code"])
      expect(error.cause).toMatchObject({ problems })
    }
  })

  test("a check that throws, or answers anything but problems", async () => {
    for (const check of [
      () => {
        throw new Error("check broke")
      },
      () => "fine",
      () => [{ code: "E_CAPTURE_INVALID" }],
      () => [null],
    ]) {
      const error = await refusal(ADDRESS, { default: good({ check }) })
      expect(error.code).toBe("E_GAME_MODULE_INVALID")
    }
  })

  /**
   * A contract-1 module refused a data pack with a code this release no
   * longer has. It still cannot play, and the page says so in its words.
   */
  test("a problem with a code this page does not know still refuses, in the module's words", async () => {
    const error = await refusal(ADDRESS, {
      default: good({
        check: () => [{ code: "E_SIM_PACKS", message: "packs" }],
      }),
    })
    expect(error.code).toBe("E_GAME_MODULE_INVALID")
    expect(error.cause).toMatchObject({
      problems: [
        { code: "E_GAME_MODULE_INVALID", message: "E_SIM_PACKS: packs" },
      ],
    })
  })

  /** Checked in order, so a page is told the first thing wrong. */
  test("two things wrong report the earlier", async () => {
    const error = await refusal(ADDRESS, {
      default: good({
        manifestHash: "other",
        check: () => [{ code: "E_CAPTURE_INVALID", message: "keys" }],
      }),
    })
    expect(error.code).toBe("E_WRONG_GAME")
  })
})

describe("what the page has done to the built-ins", () => {
  const floor = Math.floor
  const original = Function.prototype.toString
  const NativeMap = globalThis.Map

  afterEach(() => {
    Math.floor = floor
    Function.prototype.toString = original
    globalThis.Map = NativeMap
  })

  test("a page that replaced nothing", () => {
    expect(alteredBuiltins()).toEqual([])
  })

  /**
   * The rules code calls the page's `Math`, and the platform replays it in a
   * fresh isolate. A page that patched `Math.floor` would play every run
   * differently from its replay.
   */
  test("a replaced built-in is refused by name", async () => {
    Math.floor = (value: number) => floor(value)
    const error = await refusal(ADDRESS, { default: good() })
    expect(error.code).toBe("E_PAGE_ALTERS_BUILTINS")
    expect(error.cause).toEqual({ altered: ["Math.floor"] })
  })

  test("a replaced constructor is named on its own", () => {
    globalThis.Map = class extends NativeMap {} as MapConstructor
    expect(alteredBuiltins()).toEqual(["Map"])
  })

  /** Every other answer is read through it, so it is the one answer. */
  test("a replaced toString is named first and alone", () => {
    Math.floor = (value: number) => floor(value)
    // A library wrapping it, which is the usual way it is replaced. Every
    // other answer it gives is the original's.
    Function.prototype.toString = function wrapped(this: unknown) {
      return original.call(this)
    }
    expect(alteredBuiltins()).toEqual(["Function.prototype.toString"])
  })

  /**
   * The rules code calls each of these. One set to something that is not a
   * function, or taken away, throws on the page where the replay's isolate
   * computes, so the page plays a different game from the one replayed.
   */
  test("a built-in that is not a function, or is missing, is named", () => {
    const sqrt = Object.getOwnPropertyDescriptor(Math, "sqrt")
    const flat = Object.getOwnPropertyDescriptor(Array.prototype, "flat")
    const padEnd = Object.getOwnPropertyDescriptor(String.prototype, "padEnd")
    let altered: string[]
    try {
      Object.defineProperty(Math, "sqrt", { value: 0, configurable: true })
      Object.defineProperty(Array.prototype, "flat", {
        value: undefined,
        configurable: true,
      })
      Reflect.deleteProperty(String.prototype, "padEnd")
      altered = alteredBuiltins()
    } finally {
      for (const [holder, name, descriptor] of [
        [Math, "sqrt", sqrt],
        [Array.prototype, "flat", flat],
        [String.prototype, "padEnd", padEnd],
      ] as const) {
        if (descriptor !== undefined) {
          Object.defineProperty(holder, name, descriptor)
        }
      }
    }
    expect(altered).toEqual([
      "Math.sqrt",
      "Array.prototype.flat",
      "String.prototype.padEnd",
    ])
    expect(alteredBuiltins()).toEqual([])
  })

  test("a toString that calls everything native is not believed", () => {
    Function.prototype.toString = () => "function floor() { [native code] }"
    expect(alteredBuiltins()).toEqual(["Function.prototype.toString"])
  })
})

describe("a module that passes", () => {
  test("is handed back with its own motion request, and its version's folder", async () => {
    const asked: string[] = []
    const game = await loadGame(
      ADDRESS,
      serving({
        default: goodTwo({
          needsMotion: true,
          requestMotion: async () => {
            asked.push("motion")
            return { granted: true }
          },
        }),
      }),
    )
    expect(game).toMatchObject({
      presentUrl: URL_OK,
      manifestHash: HASH,
      filesUrl: FILES,
      contract: 2,
      needsMotion: true,
      tickHz: 60,
      servedConfig: { speed: 1 },
    })
    expect(await game.requestMotion()).toEqual({ granted: true })
    expect(asked).toEqual(["motion"])
  })

  /** The page never names a folder: every run is handed its version's own. */
  test("a contract-2 module is handed its own files folder, prepared or mounted", async () => {
    const given: string[] = []
    const game = await loadGame(
      ADDRESS,
      serving({
        default: goodTwo({
          prepare: (_element: HTMLElement, options: { files: string }) => {
            given.push(`prepare ${options.files}`)
            return {
              ready: Promise.resolve(null),
              mount: () => HANDLE,
              release() {},
            }
          },
          mount: (_element: HTMLElement, options: MountOptions) => {
            given.push(`mount ${options.files}`)
            return HANDLE
          },
        }),
      }),
    )
    game.prepare({} as HTMLElement)
    game.mount({} as HTMLElement, run())
    expect(given).toEqual([`prepare ${FILES}`, `mount ${FILES}`])
  })

  /**
   * A contract-1 module takes a step limit for every run and stops at its
   * manifest's: a played run is handed the largest it takes, and a watched
   * one where its replay stops. It knows no folder and no scripted events.
   */
  test("a contract-1 module is driven the way its own release built it", async () => {
    const given: ContractOneMountOptions[] = []
    const game = await loadGame(
      ADDRESS,
      serving({
        default: good({
          mount: (_element: HTMLElement, options: ContractOneMountOptions) => {
            given.push(options)
            return HANDLE
          },
        }),
      }),
    )
    expect(game).toMatchObject({
      contract: 1,
      tickHz: null,
      servedConfig: null,
    })
    game.mount({} as HTMLElement, run())
    expect(given[0]).toMatchObject({
      mode: "play",
      maxTicks: Number.MAX_SAFE_INTEGER,
    })
    expect(given[0]).not.toHaveProperty("scripted")
    expect(given[0]).not.toHaveProperty("files")
    const watched: GameMountOptions = {
      ...run(),
      mode: "watch",
      inputs: [{ tick: 1, code: "left", value: 1 }],
      maxTicks: 90,
    }
    game.mount({} as HTMLElement, watched)
    expect(given[1]).toMatchObject({
      mode: "watch",
      maxTicks: 90,
      inputs: [{ tick: 1, code: "left", value: 1 }],
    })

    // Got ready at once: it has no way to be got ready ahead.
    const prepared = game.prepare({} as HTMLElement)
    expect(await prepared.ready).toBeNull()
    prepared.mount(run())
    expect(given).toHaveLength(3)

    // It cannot be watched without drawing, and is refused, not misread.
    const errors: MountError[] = []
    const handle = game.mount({} as HTMLElement, {
      ...watched,
      draw: false,
      handlers: { ...run().handlers, onError: (error) => errors.push(error) },
    })
    expect(errors.map((e) => e.code)).toEqual(["E_ARG_INVALID"])
    expect(handle.recorded()).toEqual(
      watched.mode === "watch" ? watched.inputs : [],
    )
    expect(given).toHaveLength(3)
  })

  /** The module this package builds is one this package loads. */
  test("a real page module passes every check", async () => {
    const module = definePageModule({
      createGame: () => new Probe(),
      manifest: MANIFEST,
      createPresentation: () => new Drawn(),
      capture: { keys: { ArrowLeft: "left" } },
    })
    const game = await loadGame(ADDRESS, serving({ default: module }))
    expect(game.manifestHash).toBe(module.manifestHash)
  })
})
