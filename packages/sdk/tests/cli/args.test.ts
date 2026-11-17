/**
 * What the command line said, held here rather than in the entry point,
 * which the coverage floor does not measure.
 */

import { describe, expect, test } from "bun:test"
import {
  DEFAULT_ADDRESS,
  DEFAULT_CAPTURE_ENTRY,
  DEFAULT_PRESENT_ENTRY,
  DEFAULT_SIM_ENTRY,
  parseArgs,
} from "../../src/cli/args"
import { DEFAULT_BUNDLES_PORT, DEFAULT_HOST_PORT } from "../../src/harness"

function refusal(argv: readonly string[]): string {
  try {
    parseArgs(argv)
  } catch (error) {
    return String(error)
  }
  throw new Error(`expected ${argv.join(" ")} to be refused`)
}

describe("what the command line said", () => {
  test("a bare command builds the directory it was run in, plainly, on this machine", () => {
    const options = parseArgs(["build"])
    expect(options.command).toBe("build")
    expect(options.simEntry).toBe(DEFAULT_SIM_ENTRY)
    expect(options.presentEntry).toBe(DEFAULT_PRESENT_ENTRY)
    expect(options.captureEntry).toBe(DEFAULT_CAPTURE_ENTRY)
    expect(options.hostPort).toBe(DEFAULT_HOST_PORT)
    expect(options.bundlesPort).toBe(DEFAULT_BUNDLES_PORT)
    expect(options.address).toBe(DEFAULT_ADDRESS)
    expect(options.https).toBe(false)
    expect(options.cert).toBeUndefined()
    expect(options.key).toBeUndefined()
    expect(options.site).toBe(false)
    expect(options.ranked).toBe(false)
  })

  test("a directory is resolved, so a relative path is not held against a server's cwd", () => {
    expect(parseArgs(["dev", "./somewhere"]).dir).toMatch(/somewhere$/)
    expect(parseArgs(["dev", "./somewhere"]).dir.startsWith("/")).toBe(true)
  })

  test("every default can be overridden", () => {
    const options = parseArgs([
      "dev",
      ".",
      "--sim",
      "game/sim.ts",
      "--present",
      "game/present.ts",
      "--capture",
      "game/capture.ts",
      "--host",
      "5000",
      "--bundles-port",
      "5001",
      "--address",
      "192.168.1.20",
      "--https",
      "--cert",
      "cert.pem",
      "--key",
      "key.pem",
      "--site",
    ])
    expect(options.simEntry).toBe("game/sim.ts")
    expect(options.presentEntry).toBe("game/present.ts")
    expect(options.captureEntry).toBe("game/capture.ts")
    expect(options.hostPort).toBe(5000)
    expect(options.bundlesPort).toBe(5001)
    expect(options.address).toBe("192.168.1.20")
    expect(options.https).toBe(true)
    expect(options.cert).toBe("cert.pem")
    expect(options.key).toBe("key.pem")
    expect(options.site).toBe(true)
  })

  test("--ranked is a switch, for check and dev", () => {
    const options = parseArgs(["check", "--ranked", "./game"])
    expect(options.ranked).toBe(true)
    expect(options.dir).toMatch(/game$/)
  })

  test("a switch takes no value, so the directory after it is still the directory", () => {
    const options = parseArgs(["dev", "--site", "./somewhere", "--https"])
    expect(options.site).toBe(true)
    expect(options.https).toBe(true)
    expect(options.dir).toMatch(/somewhere$/)
  })

  test("no command at all is a command of nothing, not a crash", () => {
    expect(parseArgs([]).command).toBe("")
  })

  test("a flag with no value after it is refused rather than read as empty", () => {
    expect(refusal(["build", "--sim"])).toContain("--sim needs a value")
  })

  /**
   * `--http` for `--https` would otherwise serve plain http to a phone, which
   * then cannot load the game's code at all and says nothing about why.
   */
  test("a flag nobody declared is refused by name", () => {
    expect(refusal(["dev", "--http"])).toContain("no flag --http")
  })

  test("a port that a socket cannot bind is refused", () => {
    for (const port of ["", "-1", "65536", "80a", "1.5"]) {
      expect(refusal(["dev", "--host", port])).toContain("--host takes a port")
    }
    expect(refusal(["dev", "--bundles-port", "x"])).toContain(
      "--bundles-port takes a port",
    )
    expect(parseArgs(["dev", "--host", "0"]).hostPort).toBe(0)
    expect(parseArgs(["dev", "--host", "65535"]).hostPort).toBe(65535)
  })
})
