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
  type Flag,
  parseArgs,
  SWITCH_FLAGS,
  unreadFlag,
  VALUE_FLAGS,
} from "../../src/cli/args"
import { COMMANDS } from "../../src/cli/index"
import { DEFAULT_BUNDLES_PORT, DEFAULT_HOST_PORT } from "../../src/harness"

function refusal(argv: readonly string[]): string {
  try {
    parseArgs(argv, COMMANDS)
  } catch (error) {
    return String(error)
  }
  throw new Error(`expected ${argv.join(" ")} to be refused`)
}

describe("what the command line said", () => {
  test("a bare command builds the directory it was run in, plainly, on this machine", () => {
    const options = parseArgs(["build"], COMMANDS)
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
    expect(options.addressed).toBe(false)
    expect(options.game).toBeUndefined()
    expect(options.config).toBeUndefined()
  })

  test("a directory is resolved, so a relative path is not held against a server's cwd", () => {
    expect(parseArgs(["dev", "./somewhere"], COMMANDS).dir).toMatch(
      /somewhere$/,
    )
    expect(
      parseArgs(["dev", "./somewhere"], COMMANDS).dir.startsWith("/"),
    ).toBe(true)
  })

  test("every default can be overridden", () => {
    const options = parseArgs(
      [
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
        "--config",
        "config.json",
      ],
      COMMANDS,
    )
    expect(options.config).toBe("config.json")
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

  test("--addressed is a switch for build, and --game the id its paths name", () => {
    const options = parseArgs(
      [
        "build",
        "--addressed",
        "./game",
        "--game",
        "11111111-2222-4333-8444-555555555555",
      ],
      COMMANDS,
    )
    expect(options.addressed).toBe(true)
    expect(options.game).toBe("11111111-2222-4333-8444-555555555555")
    expect(options.dir).toMatch(/game$/)
  })

  test("--ranked is a switch, for check and dev", () => {
    const options = parseArgs(["check", "--ranked", "./game"], COMMANDS)
    expect(options.ranked).toBe(true)
    expect(options.dir).toMatch(/game$/)
  })

  test("a switch takes no value, so the directory after it is still the directory", () => {
    const options = parseArgs(
      ["dev", "--site", "./somewhere", "--https"],
      COMMANDS,
    )
    expect(options.site).toBe(true)
    expect(options.https).toBe(true)
    expect(options.dir).toMatch(/somewhere$/)
  })

  test("no command at all is a command of nothing, not a crash", () => {
    expect(parseArgs([], COMMANDS).command).toBe("")
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
    expect(parseArgs(["dev", "--host", "0"], COMMANDS).hostPort).toBe(0)
    expect(parseArgs(["dev", "--host", "65535"], COMMANDS).hostPort).toBe(65535)
  })
})

/** A value each flag that takes one accepts. */
function valueFor(flag: Flag): string {
  return flag === "host" || flag === "bundles-port" ? "0" : "value"
}

/** `--flag`, with a value when it takes one. */
function given(flag: Flag): string[] {
  return (VALUE_FLAGS as readonly string[]).includes(flag)
    ? [`--${flag}`, valueFor(flag)]
    : [`--${flag}`]
}

const EVERY_FLAG: readonly Flag[] = [...VALUE_FLAGS, ...SWITCH_FLAGS]

/**
 * Every command names the flags it reads, and the parser refuses any other,
 * so a flag one command reads is never taken by another and then ignored.
 */
describe("the flags each command reads", () => {
  test("a flag the command does not read is refused, naming the commands that read it", () => {
    expect(refusal(["dev", ".", "--addressed"])).toBe(
      "Error: vbz dev does not read --addressed; vbz build reads it",
    )
    expect(
      refusal(["check", ".", "--game", "11111111-2222-4333-8444-555555555555"]),
    ).toBe(
      "Error: vbz check does not read --game; vbz build and vbz publish read it",
    )
    expect(refusal(["publish", "--sim", "src/sim.ts", "--game", "g"])).toBe(
      "Error: vbz publish does not read --sim; vbz build, vbz check and vbz dev read it",
    )
  })

  test("every command takes each flag it reads and refuses every other", () => {
    for (const command of COMMANDS) {
      for (const flag of EVERY_FLAG) {
        const argv = [command.name, ".", ...given(flag)]
        if (command.flags.includes(flag)) {
          expect(parseArgs(argv, COMMANDS).command).toBe(command.name)
        } else {
          expect(refusal(argv)).toBe(
            `Error: ${unreadFlag(command, flag, COMMANDS)}`,
          )
        }
      }
    }
  })

  test("new and guides read no flag, and every flag is read by some command", () => {
    const reads = (name: string) =>
      COMMANDS.find((command) => command.name === name)?.flags
    expect(reads("new")).toEqual([])
    expect(reads("guides")).toEqual([])
    for (const flag of EVERY_FLAG) {
      expect({
        flag,
        read: COMMANDS.some((command) => command.flags.includes(flag)),
      }).toEqual({ flag, read: true })
    }
  })

  /**
   * A command the table does not hold is the entry point's to answer with
   * the usage, so its flags are nobody's to refuse.
   */
  test("a command nobody takes has no flags to refuse", () => {
    expect(parseArgs(["deploy", "--addressed"], COMMANDS).command).toBe(
      "deploy",
    )
  })
})
