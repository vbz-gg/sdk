/**
 * The config a run on this machine plays: the served config, which a game
 * with a required setting that has no default cannot be given, or one its
 * author names, held to the manifest the way the engine holds any config.
 */

import { describe, expect, test } from "bun:test"
import type { Manifest } from "@clockwork2/engine"
import {
  givenConfig,
  servedOrRefused,
  unservedSettings,
} from "../../src/harness/config"
import { CLIENT_ERROR } from "../../src/platform/errors"
import { MANIFEST } from "../game/subject"

/** Two settings with no default, one of them optional. */
const UNSERVED: Manifest = {
  ...MANIFEST,
  params: {
    endAt: { type: "int", label: "End" },
    level: { type: "int", label: "Level", min: 1, max: 9 },
    hard: { type: "bool", label: "Hard", optional: true },
    speed: { type: "int", label: "Speed", default: 2 },
  },
}

function thrown(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error("expected a refusal")
}

describe("the served config", () => {
  test("every setting at its default, when each has one", () => {
    expect(unservedSettings(MANIFEST)).toEqual([])
    expect(servedOrRefused(MANIFEST, "unused")).toEqual(
      servedOrRefused({ ...MANIFEST, params: {} }, "unused"),
    )
    expect(
      servedOrRefused(
        {
          ...MANIFEST,
          params: { speed: { type: "int", label: "Speed", default: 2 } },
        },
        "unused",
      ),
    ).toEqual({ speed: 2 })
  })

  test("a required setting with no default is refused in the client's sentence, named", () => {
    expect(unservedSettings(UNSERVED)).toEqual(["params.endAt", "params.level"])
    const said = thrown(() => servedOrRefused(UNSERVED, "do this"))
    expect(said).toBe(
      `E_CONFIG_REQUIRED: ${CLIENT_ERROR.E_CONFIG_REQUIRED} (params.endAt, params.level); do this`,
    )
  })
})

describe("a config the author names", () => {
  test("is held to the manifest, its defaults filled in", () => {
    expect(givenConfig(UNSERVED, { endAt: 5, level: 3 }, "--config")).toEqual({
      endAt: 5,
      level: 3,
      speed: 2,
    })
  })

  test("anything the engine would refuse is refused, naming where it came from", () => {
    for (const [value, said] of [
      [[1, 2], "--config is not a config: a config is a JSON object"],
      [null, "--config is not a config"],
      ["endAt=5", "--config is not a config"],
      [{ endAt: 5 }, "params.level is required"],
      [{ endAt: 5, level: 10 }, "params.level"],
      [{ endAt: 5, level: 3, typo: 1 }, "params.typo is not in the schema"],
    ] as const) {
      expect(thrown(() => givenConfig(UNSERVED, value, "--config"))).toContain(
        said,
      )
    }
  })
})
