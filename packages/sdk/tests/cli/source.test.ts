/**
 * A game names its files folder in its `package.json`, and every command
 * reads the same one. A folder is named, never guessed, and one named and
 * not there stops the command.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { filesDirOf, sourceOf } from "../../src/cli/source"

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vbz-source-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function packageJson(value: unknown): Promise<void> {
  await writeFile(join(root, "package.json"), JSON.stringify(value))
}

describe("the files folder a game names", () => {
  test("is none for a game whose package.json names none, or that has none", async () => {
    expect(await filesDirOf(root)).toBeNull()
    await packageJson({ name: "g" })
    expect(await filesDirOf(root)).toBeNull()
    await packageJson({ name: "g", vbz: {} })
    expect(await filesDirOf(root)).toBeNull()
  })

  test("is the folder it names, inside the game", async () => {
    await mkdir(join(root, "build", "files"), { recursive: true })
    await packageJson({ vbz: { files: "build/files" } })
    expect(await filesDirOf(root)).toBe(join(root, "build", "files"))
    const source = await sourceOf({
      dir: root,
      simEntry: "s",
      presentEntry: "p",
      captureEntry: "c",
    })
    expect(source.filesDir).toBe(join(root, "build", "files"))
  })

  test("named and not there, the command stops rather than listing nothing", async () => {
    await packageJson({ vbz: { files: "files" } })
    await expect(filesDirOf(root)).rejects.toThrow(/build it first/)
  })

  test("outside the game, the game itself, or in dist/, is refused", async () => {
    await mkdir(join(root, "dist", "files"), { recursive: true })
    for (const [files, why] of [
      ["../elsewhere", /not a folder inside the game/],
      [".", /not a folder inside the game/],
      ["dist", /every build replaces/],
      ["dist/files", /every build replaces/],
    ] as const) {
      await packageJson({ vbz: { files } })
      await expect(filesDirOf(root)).rejects.toThrow(why)
    }
  })

  test("an entry that is not a folder's name is refused", async () => {
    for (const vbz of ["files", [], { files: "" }, { files: 3 }]) {
      await packageJson({ vbz })
      await expect(filesDirOf(root)).rejects.toThrow(/package\.json/)
    }
  })
})
