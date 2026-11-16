/**
 * A game started the way an author starts one: the kit and the engine
 * installed from their packed tarballs, `vbz new`, the game's own install,
 * `vbz guides`, `vbz check` and `vbz dev`, each run as the installed command.
 *
 * Everything an installed copy reads by path rather than imports is only
 * found here: the template, the kit's guide, and the engine's guide in the
 * engine installed beside the kit. A source tree has all three in reach
 * whether or not the tarball carries them.
 *
 * The packages come from the suite's registry, which holds the two tarballs
 * and fetches every other package from npm, through `BUN_CONFIG_REGISTRY`.
 * Each run gets its own `TMPDIR` and bun cache: `bunx` keeps its install
 * under `TMPDIR` and reuses it, and npm already has a kit and an engine at
 * these version numbers. No studio key is in the environment, since nothing
 * here should need one.
 */

import { type ChildProcess, spawn } from "node:child_process"
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { CONTROL_ORIGIN } from "../src/env"
import { studio } from "../src/studio"

/** What a command did. */
interface Ran {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

type Env = Readonly<Record<string, string | undefined>>

function started(
  command: string,
  args: readonly string[],
  cwd: string,
  env: Env,
): ChildProcess {
  return spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
}

/** Runs a command to its end, and fails the test unless it exits 0. */
async function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: Env,
): Promise<Ran> {
  const child = started(command, args, cwd, env)
  let stdout = ""
  let stderr = ""
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString()
  })
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject)
    child.on("close", resolve)
  })
  expect(code, `${command} ${args.join(" ")}\n${stdout}\n${stderr}`).toBe(0)
  return { code, stdout, stderr }
}

/**
 * The environment every command runs in: the suite's registry, a temporary
 * directory and a bun cache of the run's own, and no studio key.
 */
async function isolated(dir: string, registry: string): Promise<Env> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    BUN_CONFIG_REGISTRY: registry,
    TMPDIR: join(dir, "tmp"),
    BUN_INSTALL_CACHE_DIR: join(dir, "cache"),
  }
  delete env.VBZ_STUDIO_KEY
  delete env.VBZ_API_ORIGIN
  await mkdir(join(dir, "tmp"), { recursive: true })
  return env
}

/** Every file under `dir`, by its path inside it, with its bytes. */
async function files(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    out.set(path.slice(dir.length + 1), (await readFile(path)).toString("hex"))
  }
  return out
}

/** The registry's log since the last call, which clears it. */
async function registryLog(): Promise<string[]> {
  const log = (await (
    await fetch(`${CONTROL_ORIGIN}/requests/registry`)
  ).json()) as string[]
  await fetch(`${CONTROL_ORIGIN}/requests/registry`, { method: "DELETE" })
  return log
}

/**
 * Holds a registry log to both packages having come from the registry: each
 * one's document and its tarball. npm has a kit and an engine at the same
 * version numbers, so a request that never reached the registry would still
 * install something.
 */
function expectBothFromTheRegistry(log: readonly string[]): void {
  for (const name of ["@vbz-gg/sdk", "@clockwork2/engine"]) {
    expect(log).toContain(`GET /${name}`)
  }
  for (const file of [
    /^GET \/-\/vbz-gg-sdk-.+\.tgz$/,
    /^GET \/-\/clockwork2-engine-.+\.tgz$/,
  ]) {
    expect(log.filter((line) => file.test(line))).toHaveLength(1)
  }
}

/** Waits for `vbz dev` to say where its page is. */
function pageOf(dev: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let said = ""
    dev.stdout?.on("data", (chunk: Buffer) => {
      said += chunk.toString()
      const play = /^\s*play\s+(http:\/\/\S+)/m.exec(said)
      if (play !== null) resolve(play[1] as string)
    })
    dev.stderr?.on("data", (chunk: Buffer) => {
      said += chunk.toString()
    })
    dev.on("error", reject)
    dev.on("exit", (code) =>
      reject(new Error(`vbz dev exited ${code}:\n${said}`)),
    )
  })
}

test("a game made from the packed kit installs, refreshes its guides, checks and plays", async ({
  page,
}) => {
  const { registry, tarballs, nodeModules } = await studio()
  const dir = await mkdtemp(join(tmpdir(), "sdk-new-game-"))
  try {
    const env = await isolated(dir, registry)
    await registryLog()

    // The kit and the engine, from their tarballs, into a directory of their
    // own, and the game made by the command that installed.
    await writeFile(join(dir, "package.json"), '{ "private": true }\n')
    await run("bun", ["add", tarballs.sdk, tarballs.engine], dir, env)
    const made = await run(
      join(dir, "node_modules", ".bin", "vbz"),
      ["new", "pocket-run"],
      dir,
      env,
    )
    expect(made.stdout).toContain(
      ".claude/skills/clockwork2  from @clockwork2/engine",
    )
    const game = join(dir, "pocket-run")

    // Both guides, as the tarballs carry them, and the files an agent reads
    // first under the names it reads them by.
    const kitGuide = join(nodeModules, "@vbz-gg", "sdk", "skill", "vbz-game")
    const engineGuide = join(
      nodeModules,
      "@clockwork2",
      "engine",
      "skill",
      "clockwork2",
    )
    expect(await files(join(game, ".claude", "skills", "vbz-game"))).toEqual(
      await files(kitGuide),
    )
    expect(await files(join(game, ".claude", "skills", "clockwork2"))).toEqual(
      await files(engineGuide),
    )
    const top = await readdir(game)
    expect(top).toEqual(
      expect.arrayContaining(["AGENTS.md", "CLAUDE.md", ".gitignore"]),
    )
    expect(top).not.toContain("game-agents.md")
    expect(top).not.toContain("game-claude.md")
    expect(await readFile(join(game, "AGENTS.md"), "utf8")).toMatch(
      /^# Pocket Run\n/,
    )

    // The game's own install, from the registry holding the two tarballs.
    await run("bun", ["install"], game, env)
    expectBothFromTheRegistry(await registryLog())

    // A guide left stale by an older release: one file too many, one edited.
    const stale = join(
      game,
      ".claude",
      "skills",
      "clockwork2",
      "references",
      "dropped.md",
    )
    await writeFile(stale, "from an older engine\n")
    await writeFile(
      join(game, ".claude", "skills", "vbz-game", "SKILL.md"),
      "old\n",
    )
    const refreshed = await run(
      join(game, "node_modules", ".bin", "vbz"),
      ["guides"],
      game,
      env,
    )
    expect(refreshed.stdout).toContain(
      ".claude/skills/vbz-game  from @vbz-gg/sdk",
    )
    expect(await files(join(game, ".claude", "skills", "vbz-game"))).toEqual(
      await files(
        join(game, "node_modules", "@vbz-gg", "sdk", "skill", "vbz-game"),
      ),
    )
    expect(await files(join(game, ".claude", "skills", "clockwork2"))).toEqual(
      await files(engineGuide),
    )

    const checked = await run("bun", ["run", "check"], game, env)
    expect(checked.stdout).toContain("all checks passed")
    expect(checked.stdout).toContain("release line 1.0")

    // The harness, with no studio key, on ports of its own.
    const dev = started(
      join(game, "node_modules", ".bin", "vbz"),
      ["dev", ".", "--host", "0", "--bundles-port", "0"],
      game,
      env,
    )
    const exited = new Promise((resolve) => dev.on("exit", resolve))
    try {
      const origin = await pageOf(dev)
      const response = await fetch(origin)
      expect(response.status).toBe(200)
      expect(await response.text()).toContain("<title>Pocket Run</title>")

      await page.goto(origin)
      await expect(page.locator("#status")).toHaveText("ready")
      await page.getByRole("button", { name: "Start" }).click()
      await expect(page.locator("#status")).toHaveText(/^tick [1-9]/)
    } finally {
      dev.kill("SIGTERM")
      await exited
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

/**
 * The command the kit's README and guide tell an author to run first, which
 * installs the kit into `bunx`'s own directory and the engine beside it as
 * its peer.
 */
test("bunx @vbz-gg/sdk new makes the same game from the registry", async () => {
  const { registry, nodeModules } = await studio()
  const dir = await mkdtemp(join(tmpdir(), "sdk-bunx-"))
  try {
    const env = await isolated(dir, registry)
    await registryLog()

    const made = await run(
      "bunx",
      ["@vbz-gg/sdk", "new", "pocket-run"],
      dir,
      env,
    )
    expect(made.stdout).toContain(
      "pocket-run, which is the id its board will be kept under",
    )
    expectBothFromTheRegistry(await registryLog())

    const game = join(dir, "pocket-run")
    expect(await files(join(game, ".claude", "skills", "vbz-game"))).toEqual(
      await files(join(nodeModules, "@vbz-gg", "sdk", "skill", "vbz-game")),
    )
    expect(await files(join(game, ".claude", "skills", "clockwork2"))).toEqual(
      await files(
        join(nodeModules, "@clockwork2", "engine", "skill", "clockwork2"),
      ),
    )
    expect(await readdir(game)).toEqual(
      expect.arrayContaining(["AGENTS.md", "CLAUDE.md"]),
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
