/**
 * Loading a page module, refused at each check in the order a page meets
 * them. What arrives is somebody else's build, so every part is read as
 * unknown until it has passed.
 */

import { afterEach, describe, expect, test } from "bun:test"
import { hashCanonical, type PlainValue } from "@clockwork2/engine"
import { definePageModule } from "../../src/game/define"
import {
  alteredBuiltins,
  type GameAddress,
  loadGame,
} from "../../src/host/load"
import { PlatformClientError } from "../../src/platform/errors"
import { Drawn, MANIFEST, Probe } from "../game/subject"

const URL_OK =
  "https://bundles.example/g/0b6f3c1e-2d4a-4e8b-9c7d-5a1f2e3b4c6d/present/abc.js"
const HASH = hashCanonical(MANIFEST as unknown as PlainValue)
const ADDRESS: GameAddress = { presentUrl: URL_OK, manifestHash: HASH }

/** A module whose every part a page reads is right. */
function good(overrides: Record<string, unknown> = {}) {
  return {
    contract: 1,
    manifestHash: HASH,
    needsMotion: false,
    check: () => [],
    requestMotion: async () => ({ granted: true }),
    mount: () => ({ recorded: () => [], stop() {}, destroy() {} }),
    ...overrides,
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
        await loadGame({ presentUrl, manifestHash: HASH }, server)
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
      const game = await loadGame({ presentUrl, manifestHash: HASH }, server)
      expect(server.asked).toEqual([presentUrl])
      expect(game.presentUrl).toBe(presentUrl)
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
        presentUrl: "http://127.0.0.1:1/g/x/present/a.js",
        manifestHash: HASH,
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
    for (const contract of [2, 0, "1", undefined]) {
      const error = await refusal(ADDRESS, { default: good({ contract }) })
      expect(error.code).toBe("E_GAME_CONTRACT_UNKNOWN")
      expect(error.cause).toMatchObject({ module: contract, driven: [1] })
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

  test("a module of another version of the game", async () => {
    const error = await refusal(ADDRESS, {
      default: good({ manifestHash: "other" }),
    })
    expect(error.code).toBe("E_WRONG_GAME")
    expect(error.cause).toMatchObject({ module: "other", expected: HASH })
  })

  test("the module's own problems, answered with the first one's code", async () => {
    for (const code of [
      "E_SIM_PACKS",
      "E_CAPTURE_INVALID",
      "E_GAME_MODULE_INVALID",
    ]) {
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

  test("a check that throws, or answers anything but problems it knows", async () => {
    for (const check of [
      () => {
        throw new Error("check broke")
      },
      () => "fine",
      () => [{ code: "E_SOMETHING_NEW", message: "?" }],
      () => [{ code: "E_SIM_PACKS" }],
      () => [null],
    ]) {
      const error = await refusal(ADDRESS, { default: good({ check }) })
      expect(error.code).toBe("E_GAME_MODULE_INVALID")
    }
  })

  /** Checked in order, so a page is told the first thing wrong. */
  test("two things wrong report the earlier", async () => {
    const error = await refusal(ADDRESS, {
      default: good({
        manifestHash: "other",
        check: () => [{ code: "E_SIM_PACKS", message: "packs" }],
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

  test("a toString that calls everything native is not believed", () => {
    Function.prototype.toString = () => "function floor() { [native code] }"
    expect(alteredBuiltins()).toEqual(["Function.prototype.toString"])
  })
})

describe("a module that passes", () => {
  test("is handed back with its own motion request and mount", async () => {
    const asked: string[] = []
    const game = await loadGame(
      ADDRESS,
      serving({
        default: good({
          needsMotion: true,
          requestMotion: async () => {
            asked.push("motion")
            return { granted: true }
          },
          mount: (_element: HTMLElement, options: { seed: string }) => {
            asked.push(`mount ${options.seed}`)
            return { recorded: () => [], stop() {}, destroy() {} }
          },
        }),
      }),
    )
    expect(game).toMatchObject({
      presentUrl: URL_OK,
      manifestHash: HASH,
      contract: 1,
      needsMotion: true,
    })
    expect(await game.requestMotion()).toEqual({ granted: true })
    game.mount({} as HTMLElement, { seed: "s" } as never)
    expect(asked).toEqual(["motion", "mount s"])
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
