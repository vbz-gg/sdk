/**
 * Where and how `vbz dev` serves, from what the command line said.
 *
 * By default both origins are this machine over plain http, which is all a
 * desktop browser needs. A phone is another machine, and two things refuse
 * plain http there: `loadGame` loads a game's code over https or from this
 * machine only, and a browser grants tilt only to a secure page. So an
 * address other than this machine's needs `--https`, with a certificate the
 * phone trusts, and the command refuses rather than serving a page the phone
 * cannot play.
 */

import { readFile } from "node:fs/promises"
import type { Listen, Tls } from "../harness/servers.js"
import type { Options } from "./args.js"

/** The hosts that name this machine, where plain http is enough. */
export const LOOPBACK_ADDRESSES: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
])

/** Addresses that mean every interface, which no browser can be sent to. */
const EVERY_INTERFACE: ReadonlySet<string> = new Set(["0.0.0.0", "::"])

export interface DevSettings {
  readonly listen: Listen
  readonly hostPort: number
  readonly bundlesPort: number
  /** Serve the game's `site/` against the stand-in rather than the harness page. */
  readonly site: boolean
  /** Hold the harness page's runs to the input budget of a ranked run. */
  readonly ranked: boolean
}

/** Reads a PEM file; a test stands in for the disk. */
export type ReadText = (path: string) => Promise<string>

const readText: ReadText = (path) => readFile(path, "utf8")

async function pem(
  flag: "cert" | "key",
  path: string,
  read: ReadText,
): Promise<string> {
  try {
    return await read(path)
  } catch (error) {
    throw new Error(
      `--${flag} ${path} could not be read: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** Checks the flags `vbz dev` was given and reads the certificate, if any. */
export async function devSettings(
  options: Pick<
    Options,
    | "address"
    | "https"
    | "cert"
    | "key"
    | "hostPort"
    | "bundlesPort"
    | "site"
    | "ranked"
  >,
  read: ReadText = readText,
): Promise<DevSettings> {
  const { address } = options
  if (options.site && options.ranked) {
    throw new Error(
      "--ranked holds the harness page's runs to a ranked run's input budget, and --site serves your own page instead; give one",
    )
  }
  if (EVERY_INTERFACE.has(address)) {
    throw new Error(
      `--address ${address} would listen everywhere, and a page has to name one host a browser can reach; give this machine's address on the network, such as 192.168.1.20`,
    )
  }
  if (!options.https) {
    if (options.cert !== undefined || options.key !== undefined) {
      throw new Error("--cert and --key go with --https")
    }
    if (!LOOPBACK_ADDRESSES.has(address)) {
      throw new Error(
        `--address ${address} is another machine's way in, and a game's code loads there only over https, as tilt does; add --https --cert <file> --key <file>, with a certificate the phone trusts for ${address}`,
      )
    }
    return {
      listen: { hostname: address, tls: null },
      hostPort: options.hostPort,
      bundlesPort: options.bundlesPort,
      site: options.site,
      ranked: options.ranked,
    }
  }
  if (options.cert === undefined || options.key === undefined) {
    throw new Error(
      "--https needs --cert <file> and --key <file>: a certificate for the address, and its private key, as PEM",
    )
  }
  const tls: Tls = {
    cert: await pem("cert", options.cert, read),
    key: await pem("key", options.key, read),
  }
  return {
    listen: { hostname: address, tls },
    hostPort: options.hostPort,
    bundlesPort: options.bundlesPort,
    site: options.site,
    ranked: options.ranked,
  }
}
