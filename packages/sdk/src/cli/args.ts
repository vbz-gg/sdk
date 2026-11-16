/**
 * What the command line said.
 *
 * Split out of the entry point because an entry point is excluded from the
 * coverage floor, and a default that quietly moved - which entry a game is
 * built from, which port it is served on - is the kind of thing a test has to
 * hold rather than a reader.
 *
 * A flag nobody declared is refused rather than ignored, so `--http` typed for
 * `--https` says so instead of serving plain http to a phone that then cannot
 * load the game.
 */

import { resolve } from "node:path"
import { DEFAULT_BUNDLES_PORT, DEFAULT_HOST_PORT } from "../harness/index.js"

/** Every command `vbz` takes, in the order its usage lists them. */
export const COMMANDS = [
  "new",
  "guides",
  "build",
  "check",
  "dev",
  "publish",
] as const

export const DEFAULT_SIM_ENTRY = "src/sim/index.ts"
export const DEFAULT_PRESENT_ENTRY = "src/present.ts"
export const DEFAULT_CAPTURE_ENTRY = "src/capture.ts"

/** Where `vbz dev` listens, and the host its origins name, unless `--address` says. */
export const DEFAULT_ADDRESS = "127.0.0.1"

/** The flags that take a value, as `--name value`. */
export const VALUE_FLAGS = [
  "sim",
  "present",
  "capture",
  "host",
  "bundles-port",
  "address",
  "cert",
  "key",
  "game",
  "api",
] as const

/** The flags that take none. */
export const SWITCH_FLAGS = ["https", "site"] as const

type ValueFlag = (typeof VALUE_FLAGS)[number]
type SwitchFlag = (typeof SWITCH_FLAGS)[number]

export interface Options {
  readonly command: string
  readonly dir: string
  readonly simEntry: string
  readonly presentEntry: string
  readonly captureEntry: string
  readonly hostPort: number
  readonly bundlesPort: number
  /** `dev`: the host the servers listen on and their origins name. */
  readonly address: string
  /** `dev`: serve over https, with `cert` and `key`. */
  readonly https: boolean
  /** `dev`: the certificate and its private key, as PEM files. */
  readonly cert: string | undefined
  readonly key: string | undefined
  /** `dev`: serve the game's `site/` against a stand-in for the platform. */
  readonly site: boolean
  /** `publish`: the game to upload to. */
  readonly game: string | undefined
  /** `publish`: the platform's origin, over the environment and the default. */
  readonly api: string | undefined
}

function isValueFlag(name: string): name is ValueFlag {
  return (VALUE_FLAGS as readonly string[]).includes(name)
}

function isSwitchFlag(name: string): name is SwitchFlag {
  return (SWITCH_FLAGS as readonly string[]).includes(name)
}

/** A port, as a whole number a socket can bind: 0 asks for any free one. */
function portOf(
  flag: string,
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined) return fallback
  const port = Number(raw)
  if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(port) || port > 65_535) {
    throw new Error(
      `--${flag} takes a port from 0 to 65535, not ${JSON.stringify(raw)}`,
    )
  }
  return port
}

export function parseArgs(argv: readonly string[]): Options {
  const positional: string[] = []
  const values = new Map<ValueFlag, string>()
  const switches = new Set<SwitchFlag>()
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string
    if (!arg.startsWith("--")) {
      positional.push(arg)
      continue
    }
    const name = arg.slice(2)
    if (isSwitchFlag(name)) {
      switches.add(name)
      continue
    }
    if (!isValueFlag(name)) {
      throw new Error(
        `there is no flag ${arg}; run vbz with no command to see them`,
      )
    }
    const value = argv[i + 1]
    if (value === undefined) throw new Error(`${arg} needs a value`)
    values.set(name, value)
    i += 1
  }
  return {
    command: positional[0] ?? "",
    dir: resolve(positional[1] ?? "."),
    simEntry: values.get("sim") ?? DEFAULT_SIM_ENTRY,
    presentEntry: values.get("present") ?? DEFAULT_PRESENT_ENTRY,
    captureEntry: values.get("capture") ?? DEFAULT_CAPTURE_ENTRY,
    hostPort: portOf("host", values.get("host"), DEFAULT_HOST_PORT),
    bundlesPort: portOf(
      "bundles-port",
      values.get("bundles-port"),
      DEFAULT_BUNDLES_PORT,
    ),
    address: values.get("address") ?? DEFAULT_ADDRESS,
    https: switches.has("https"),
    cert: values.get("cert"),
    key: values.get("key"),
    site: switches.has("site"),
    game: values.get("game"),
    api: values.get("api"),
  }
}
