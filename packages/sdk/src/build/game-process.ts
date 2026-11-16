/**
 * Running a game's own code from the kit's commands.
 *
 * A game's code is a studio's, and so is everything it imports, which nobody
 * here has read. The commands run where an author or a build system keeps a
 * studio's secret key and cloud credentials in the environment, so whatever
 * evaluates a game's code - the bundler running the macros its source
 * imports, the manifest read out of its rules code, the engine's checks over
 * it, the harness's replay of a run - does it in a process of its own given
 * none of that environment. Anything a child provably needs is named by its
 * caller, and nothing else reaches it.
 *
 * `vbz publish` evaluates nothing of a game: it uploads what `vbz build`
 * wrote as bytes, so the key it holds is never beside the game's code.
 */

import { existsSync } from "node:fs"
import { join } from "node:path"

export interface GameProcessOptions {
  /** What the child reads on stdin. Nothing by default. */
  readonly stdin?: string | Uint8Array
  /** Where it runs. This process's own directory by default. */
  readonly cwd?: string
  /**
   * The child's whole environment: empty by default, and only what its
   * caller names otherwise.
   */
  readonly env?: Readonly<Record<string, string>>
}

export interface GameProcessOutput {
  readonly stdout: Uint8Array
  readonly stderr: string
  readonly code: number
}

/**
 * Runs `args` under this same Bun, in a process of its own, and answers what
 * it printed and how it ended.
 *
 * Bun is named by its own path, because an empty environment has no `PATH`
 * to find it on, and because it is the Bun the command is running under.
 */
export async function runGameProcess(
  args: readonly string[],
  options: GameProcessOptions = {},
): Promise<GameProcessOutput> {
  const child = Bun.spawn([process.execPath, ...args], {
    env: { ...options.env },
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    stdin:
      options.stdin === undefined
        ? "ignore"
        : typeof options.stdin === "string"
          ? new TextEncoder().encode(options.stdin)
          : options.stdin,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout: new Uint8Array(stdout), stderr, code }
}

/**
 * A child process's entry beside the module that starts it, wherever that
 * module is running from: the TypeScript in this repository, the compiled
 * file in `dist` once installed.
 */
export function childEntry(dir: string, name: string): string {
  for (const file of [`${name}.ts`, `${name}.js`]) {
    const candidate = join(dir, file)
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`the ${name} entry is missing from ${dir}`)
}
