/**
 * The commands `vbz` takes, as one table's rows, and the usage text they make.
 *
 * The dispatcher finds a command by its row, the usage lists every row, and
 * the agent guide's test reads the same rows, so a command added is one row
 * and none of the three can leave it out. The table itself is in the entry
 * point, beside what each command does; what decides how the usage reads is
 * here, where the coverage floor measures it.
 */

import type { Options } from "./args.js"

/** One command: how the usage names it, and what it does. */
export interface Command {
  readonly name: string
  /** What follows the name on its usage line, such as `[dir]`. */
  readonly args: string
  /** What it does, one entry per line of the usage. */
  readonly summary: readonly string[]
  /** Runs it, and answers the exit code. */
  readonly run: (options: Options) => Promise<number>
}

/** The widest command name the usage lines up, `publish`. */
const NAME_WIDTH = 7

/** The usage's opening line, every command's lines, then `rest`. */
export function usageText(commands: readonly Command[], rest: string): string {
  const lines = ["vbz - build and run a game for vbz.gg", ""]
  for (const command of commands) {
    const lead = `  vbz ${command.name.padEnd(NAME_WIDTH)} ${command.args}   `
    const indent = " ".repeat(lead.length)
    command.summary.forEach((line, at) => {
      lines.push(`${at === 0 ? lead : indent}${line}`)
    })
  }
  return `${lines.join("\n")}\n\n${rest}`
}
