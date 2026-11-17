/**
 * Where `vbz dev` serves, and over what. A phone is another machine, and a
 * game's code loads there only over https, so the flags that would serve it
 * a page it cannot play are refused before anything is built.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_ADDRESS, parseArgs } from "../../src/cli/args"
import { devSettings } from "../../src/cli/dev"
import { startHarness } from "../../src/harness"
import { MANIFEST } from "../game/subject"

const PEM = {
  "cert.pem": "CERTIFICATE",
  "key.pem": "PRIVATE KEY",
  "config.json": `{ "endAt": 5 }`,
  "broken.json": "{ endAt: 5",
}
const read = async (path: string) => {
  const text = PEM[path as keyof typeof PEM]
  if (text === undefined) throw new Error(`ENOENT: ${path}`)
  return text
}

async function refusal(argv: readonly string[]): Promise<string> {
  try {
    await devSettings(parseArgs(["dev", ...argv]), read)
  } catch (error) {
    return String(error)
  }
  throw new Error(`expected ${argv.join(" ")} to be refused`)
}

describe("where vbz dev listens", () => {
  test("by default, this machine over plain http", async () => {
    const settings = await devSettings(parseArgs(["dev"]), read)
    expect(settings.listen).toEqual({ hostname: DEFAULT_ADDRESS, tls: null })
    expect(settings.site).toBe(false)
  })

  test("another name for this machine is still this machine", async () => {
    for (const address of ["localhost", "::1"]) {
      const settings = await devSettings(
        parseArgs(["dev", "--address", address]),
        read,
      )
      expect(settings.listen.hostname).toBe(address)
    }
  })

  test("https reads the certificate and its key", async () => {
    const settings = await devSettings(
      parseArgs([
        "dev",
        "--https",
        "--cert",
        "cert.pem",
        "--key",
        "key.pem",
        "--address",
        "192.168.1.20",
        "--site",
        "--host",
        "9000",
        "--bundles-port",
        "9001",
      ]),
      read,
    )
    expect(settings).toEqual({
      listen: {
        hostname: "192.168.1.20",
        tls: { cert: "CERTIFICATE", key: "PRIVATE KEY" },
      },
      hostPort: 9000,
      bundlesPort: 9001,
      site: true,
      ranked: false,
      config: undefined,
    })
  })

  /** A ranked run's budget is a figure on the harness page, red when asked. */
  test("--ranked holds the harness page's runs to a ranked run's budget, and not --site's", async () => {
    expect((await devSettings(parseArgs(["dev"]), read)).ranked).toBe(false)
    expect(
      (await devSettings(parseArgs(["dev", "--ranked"]), read)).ranked,
    ).toBe(true)
    expect(await refusal(["--site", "--ranked"])).toContain("give one")
  })

  /**
   * A game with a setting that has no default can be played here only on a
   * config its author names, which a ranked run never plays and a site
   * names for itself.
   */
  test("--config reads a JSON config for the harness page's runs", async () => {
    expect(
      (await devSettings(parseArgs(["dev", "--config", "config.json"]), read))
        .config,
    ).toEqual({ endAt: 5 })
    expect((await devSettings(parseArgs(["dev"]), read)).config).toBeUndefined()
    expect(await refusal(["--config", "gone.json"])).toContain(
      "--config gone.json could not be read",
    )
    expect(await refusal(["--config", "broken.json"])).toContain(
      "--config broken.json is not JSON",
    )
    expect(await refusal(["--config", "config.json", "--site"])).toContain(
      "give one",
    )
    expect(await refusal(["--config", "config.json", "--ranked"])).toContain(
      "plays every setting at its default",
    )
  })

  /**
   * `loadGame` loads a game's code over https or from this machine only, and
   * a browser grants tilt only to a secure page, so a phone handed plain http
   * gets a page that refuses the game.
   */
  test("another machine's address without https is refused, saying what to add", async () => {
    expect(await refusal(["--address", "192.168.1.20"])).toContain(
      "add --https --cert <file> --key <file>",
    )
  })

  test("an address meaning every interface is refused, since no page can name it", async () => {
    for (const address of ["0.0.0.0", "::"]) {
      expect(await refusal(["--address", address])).toContain(
        "would listen everywhere",
      )
    }
  })

  test("https without both files, or a file without https, is refused", async () => {
    expect(await refusal(["--https"])).toContain("--https needs --cert")
    expect(await refusal(["--https", "--cert", "cert.pem"])).toContain(
      "--https needs --cert",
    )
    expect(await refusal(["--cert", "cert.pem"])).toContain(
      "--cert and --key go with --https",
    )
    expect(await refusal(["--key", "key.pem"])).toContain(
      "--cert and --key go with --https",
    )
  })

  test("a file that cannot be read is named", async () => {
    expect(
      await refusal(["--https", "--cert", "nowhere.pem", "--key", "key.pem"]),
    ).toContain("--cert nowhere.pem could not be read")
    expect(
      await refusal(["--https", "--cert", "cert.pem", "--key", "gone.pem"]),
    ).toContain("--key gone.pem could not be read")
  })
})

describe("the harness over https", () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sdk-https-"))
    // A throwaway certificate for this machine, made for this test alone.
    // The curve is written by name. Left to the default, OpenSSL 3 names it
    // and LibreSSL 3.3.6, which macOS ships as `openssl`, spells out its
    // parameters, which Bun's TLS refuses as an EC decode error.
    const made = Bun.spawnSync([
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-pkeyopt",
      "ec_param_enc:named_curve",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-keyout",
      join(dir, "key.pem"),
      "-out",
      join(dir, "cert.pem"),
    ])
    if (made.exitCode !== 0) {
      throw new Error(`openssl made no certificate: ${made.stderr.toString()}`)
    }
    await mkdir(join(dir, "game", "src", "sim"), { recursive: true })
    await writeFile(
      join(dir, "game", "src", "sim", "index.ts"),
      `export const MANIFEST = ${JSON.stringify(MANIFEST)}\n`,
    )
    await writeFile(
      join(dir, "game", "src", "present.ts"),
      `import { MANIFEST } from "cw2:sim"\nexport default MANIFEST\n`,
    )
    // What `vbz build` writes beside the artifacts, which the harness plays.
    await mkdir(join(dir, "game", "dist"), { recursive: true })
    await writeFile(
      join(dir, "game", "dist", "manifest.json"),
      JSON.stringify(MANIFEST),
    )
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("both origins are https, and answer with the certificate given", async () => {
    const settings = await devSettings(
      parseArgs([
        "dev",
        "--https",
        "--cert",
        join(dir, "cert.pem"),
        "--key",
        join(dir, "key.pem"),
      ]),
    )
    const harness = await startHarness({
      source: {
        root: join(dir, "game"),
        simEntry: "src/sim/index.ts",
        presentEntry: "src/present.ts",
        captureEntry: "src/capture.ts",
        filesDir: null,
      },
      hostPort: 0,
      bundlesPort: 0,
      listen: settings.listen,
      ranked: settings.ranked,
    })
    try {
      expect(harness.hostOrigin).toMatch(/^https:\/\/127\.0\.0\.1:\d+$/)
      expect(harness.bundlesOrigin).toMatch(/^https:\/\/127\.0\.0\.1:\d+$/)
      expect(harness.presentUrl.startsWith("https://")).toBe(true)
      const ca = await readFile(join(dir, "cert.pem"), "utf8")
      const page = await fetch(harness.hostOrigin, { tls: { ca } })
      expect(await page.text()).toContain(
        `"presentUrl":"${harness.presentUrl}"`,
      )
      const module = await fetch(harness.presentUrl, { tls: { ca } })
      expect(module.status).toBe(200)
    } finally {
      await harness.stop()
    }
  })
})
