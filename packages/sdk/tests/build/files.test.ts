/**
 * A version's files folder: listed, named by the SHA-256 of its listing, and
 * held to the platform's limits, at each limit and one past it.
 */

import { describe, expect, spyOn, test } from "bun:test"
import * as fs from "node:fs/promises"
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assertSize } from "../../src/build/contract"
import { sha256Hex } from "../../src/build/digest"
import { BuildRefusal } from "../../src/build/errors"
import {
  assertFileBytes,
  assertFilesHeld,
  assertListing,
  assertPacksListed,
  canonicalListing,
  EMPTY_LISTING,
  type FileEntry,
  type FilesListing,
  HASH_CONCURRENCY,
  listFolder,
  listingSha256,
  missingFiles,
} from "../../src/build/files"
import {
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_FILES_BYTES,
  MAX_LISTING_BYTES,
  MAX_PACK_BYTES,
  MAX_PACKS_BYTES,
  MAX_PRESENT_BYTES,
  MAX_SIM_BYTES,
} from "../../src/build/limits"
import {
  gameFiles,
  isFilePath,
  MAX_FILE_PATH_LENGTH,
} from "../../src/game/files"

const SHA = "d".repeat(64)

function code(refusal: () => unknown): string {
  try {
    refusal()
  } catch (error) {
    if (error instanceof BuildRefusal) return error.code
    throw error
  }
  return "none"
}

async function codeOf(refusal: () => Promise<unknown>): Promise<string> {
  try {
    await refusal()
  } catch (error) {
    if (error instanceof BuildRefusal) return error.code
    throw error
  }
  return "none"
}

function entry(path: string, bytes: number, sha256 = SHA): FileEntry {
  return { path, bytes, sha256 }
}

/** `count` files of `bytes` each. */
function many(count: number, bytes = 1): FilesListing {
  return {
    files: Array.from({ length: count }, (_, i) => entry(`f/${i}.bin`, bytes)),
  }
}

describe("a path in the folder", () => {
  test("is relative, POSIX, from a fixed set of characters", () => {
    for (const path of ["entry.js", "a/b/c.wasm", "x_y-z.1.png", ".well"]) {
      expect({ path, ok: isFilePath(path) }).toEqual({ path, ok: true })
    }
    for (const path of [
      "",
      "/abs.js",
      "../up.js",
      "a/../b.js",
      "./a.js",
      "a//b.js",
      "a/",
      "a\\b.js",
      "%2e%2e/x",
      "a?b",
      "a#b",
      "C:/x",
      "a b.js",
      "é.png",
      "x".repeat(513),
    ]) {
      expect({ path, ok: isFilePath(path) }).toEqual({ path, ok: false })
    }
  })

  test("becomes an address under the folder, and a bad one never does", () => {
    const files = gameFiles("https://files.vbz.gg/g/x/t/y/")
    expect(files.url("art/ship.png")).toBe(
      "https://files.vbz.gg/g/x/t/y/art/ship.png",
    )
    expect(() => files.url("../sim/x.js")).toThrow()
    expect(() => gameFiles("https://files.vbz.gg/g/x/t/y")).toThrow()
    expect(() => gameFiles("/g/x/t/y/")).toThrow()
    expect(() => gameFiles("https://files.vbz.gg/g/x/t/y/?a=1")).toThrow()
  })
})

describe("a listing", () => {
  test("is named by the SHA-256 of its canonical text, whatever order it came in", () => {
    const a = { files: [entry("b.js", 2), entry("a.js", 1)] }
    const b = { files: [entry("a.js", 1), entry("b.js", 2)] }
    const text = canonicalListing(a)
    expect(text).toBe(
      `{"files":[{"path":"a.js","bytes":1,"sha256":"${SHA}"},{"path":"b.js","bytes":2,"sha256":"${SHA}"}]}`,
    )
    expect(canonicalListing(b)).toBe(text)
    expect(listingSha256(a)).toBe(sha256Hex(new TextEncoder().encode(text)))
  })

  test("of nothing has a name of its own", () => {
    expect(canonicalListing(EMPTY_LISTING)).toBe(`{"files":[]}`)
    expect(listingSha256(EMPTY_LISTING)).toMatch(/^[0-9a-f]{64}$/)
  })

  test("a field outside an entry's three is not part of its name", () => {
    const plain = { files: [entry("a.js", 1)] }
    const extra = {
      files: [{ ...entry("a.js", 1), note: "ignored" } as FileEntry],
    }
    expect(listingSha256(extra)).toBe(listingSha256(plain))
  })

  test("that is not paths, sizes and hashes is refused", () => {
    for (const bad of [
      null,
      [],
      { files: "x" },
      { files: [{ path: "a.js", bytes: -1, sha256: SHA }] },
      { files: [{ path: "a.js", bytes: 1.5, sha256: SHA }] },
      { files: [{ path: "a.js", bytes: 1, sha256: SHA.toUpperCase() }] },
      { files: [{ path: 1, bytes: 1, sha256: SHA }] },
    ]) {
      expect(code(() => assertListing(bad))).toBe("E_FILES_INVALID")
    }
  })

  test("a path listed twice, ignoring case, is refused", () => {
    expect(
      code(() =>
        assertListing({
          files: [entry("Art/a.png", 1), entry("art/A.png", 1)],
        }),
      ),
    ).toBe("E_FILE_PATH_INVALID")
    expect(code(() => assertListing({ files: [entry("../a.png", 1)] }))).toBe(
      "E_FILE_PATH_INVALID",
    )
  })

  test(`holds ${MAX_FILES} files, and is refused at one more`, () => {
    expect(assertListing(many(MAX_FILES)).files).toHaveLength(MAX_FILES)
    expect(code(() => assertListing(many(MAX_FILES + 1)))).toBe(
      "E_FILES_TOO_MANY",
    )
  })

  test("holds a file at the file limit, and is refused at one byte past it", () => {
    expect(() =>
      assertListing({ files: [entry("big.bin", MAX_FILE_BYTES)] }),
    ).not.toThrow()
    expect(
      code(() =>
        assertListing({ files: [entry("big.bin", MAX_FILE_BYTES + 1)] }),
      ),
    ).toBe("E_FILE_TOO_LARGE")
  })

  test("holds the folder's limit together, and is refused at one byte past it", () => {
    const full = MAX_FILES_BYTES / MAX_FILE_BYTES
    const atLimit = many(full, MAX_FILE_BYTES)
    expect(() => assertListing(atLimit)).not.toThrow()
    expect(
      code(() =>
        assertListing({ files: [...atLimit.files, entry("one.bin", 1)] }),
      ),
    ).toBe("E_FILES_TOO_LARGE")
  })
})

describe("the longest listing", () => {
  /** A path of the longest length, distinct for each `i`, ignoring case. */
  const longest = (i: number) =>
    `${String(i).padStart(5, "0")}/${"a".repeat(MAX_FILE_PATH_LENGTH - 6)}`

  /**
   * The platform takes the listing as a request's whole body, so the bound
   * has to be the text of the worst entries, written as the canonical
   * listing writes them, and not a guess at it.
   */
  test("is MAX_LISTING_BYTES: every file at the longest path and size", () => {
    const sizeDigits = Number(
      `1${"0".repeat(String(MAX_FILE_BYTES).length - 1)}`,
    )
    const text = JSON.stringify({
      files: Array.from({ length: MAX_FILES }, (_, i) => ({
        path: longest(i),
        bytes: sizeDigits,
        sha256: SHA,
      })),
    })
    expect(longest(0)).toHaveLength(MAX_FILE_PATH_LENGTH)
    expect(String(sizeDigits)).toHaveLength(String(MAX_FILE_BYTES).length)
    expect(new TextEncoder().encode(text).byteLength).toBe(MAX_LISTING_BYTES)
    expect(MAX_LISTING_BYTES).toBe(6_170_011)
  })

  test("a listing the folder's limits allow is never longer", () => {
    const listing = {
      files: Array.from({ length: MAX_FILES }, (_, i) =>
        entry(longest(i), Math.floor(MAX_FILES_BYTES / MAX_FILES)),
      ),
    }
    const text = canonicalListing(listing)
    expect(text.length).toBeLessThanOrEqual(MAX_LISTING_BYTES)
    expect(text.length).toBeGreaterThan(MAX_LISTING_BYTES - 4 * MAX_FILES)
  })
})

describe("which files a game's store lacks", () => {
  const ONE = "1".repeat(64)
  const TWO = "2".repeat(64)

  test("each once, in order of path, however many paths share its bytes", () => {
    const listing = {
      files: [
        entry("z.bin", 1, ONE),
        entry("b.bin", 1, TWO),
        entry("a.bin", 1, ONE),
        entry("c.bin", 1, SHA),
      ],
    }
    expect(missingFiles(listing, new Set([SHA]))).toEqual([ONE, TWO])
    expect(missingFiles(listing, new Set([ONE, TWO, SHA]))).toEqual([])
    expect(missingFiles(EMPTY_LISTING, new Set())).toEqual([])
  })

  test("a version naming a file the store lacks is refused", () => {
    const listing = { files: [entry("a.bin", 1, ONE)] }
    expect(code(() => assertFilesHeld(listing, new Set()))).toBe(
      "E_FILES_MISSING",
    )
    expect(() => assertFilesHeld(listing, new Set([ONE]))).not.toThrow()
    expect(() => assertFilesHeld(EMPTY_LISTING, new Set())).not.toThrow()
  })

  test("a listing that is not one is refused before anything is looked up", () => {
    expect(code(() => missingFiles({ files: [{}] } as never, new Set()))).toBe(
      "E_FILES_INVALID",
    )
  })
})

describe("a file uploaded on its own", () => {
  const BYTES = new TextEncoder().encode("a file of the folder\n")

  test("is held to the SHA-256 it was sent under", () => {
    expect(() => assertFileBytes(sha256Hex(BYTES), BYTES)).not.toThrow()
    expect(code(() => assertFileBytes(SHA, BYTES))).toBe("E_FILE_HASH_MISMATCH")
  })

  test("a name that is not a lowercase hex SHA-256 is refused", () => {
    for (const name of [
      sha256Hex(BYTES).toUpperCase(),
      sha256Hex(BYTES).slice(1),
      "../present.js",
    ]) {
      expect(code(() => assertFileBytes(name, BYTES))).toBe("E_FILES_INVALID")
    }
  })

  test("a file at the file limit is held, one byte past it refused", () => {
    const atLimit = new Uint8Array(MAX_FILE_BYTES)
    expect(() => assertFileBytes(sha256Hex(atLimit), atLimit)).not.toThrow()
    const over = new Uint8Array(MAX_FILE_BYTES + 1)
    expect(code(() => assertFileBytes(sha256Hex(over), over))).toBe(
      "E_FILE_TOO_LARGE",
    )
  })
})

describe("the artifacts' limits", () => {
  test("hold the rules code and the page module at their limits, and refuse one byte more", () => {
    for (const [limit, what] of [
      [MAX_SIM_BYTES, "simulation"],
      [MAX_PRESENT_BYTES, "page module"],
    ] as const) {
      expect(() => assertSize(new Uint8Array(limit), limit, what)).not.toThrow()
      expect(
        code(() => assertSize(new Uint8Array(limit + 1), limit, what)),
      ).toBe("E_ARTIFACT_TOO_LARGE")
    }
  })
})

describe("data packs in the folder", () => {
  const pack = (path: string, bytes: number, sha256 = SHA) => ({
    path,
    bytes,
    sha256,
    requiredForSim: true,
  })

  test("a declared pack is a listed file of the same size and hash", () => {
    const listing = { files: [entry("packs/a.json", 5)] }
    expect(() =>
      assertPacksListed([pack("packs/a.json", 5)], listing),
    ).not.toThrow()
    expect(
      code(() => assertPacksListed([pack("packs/b.json", 5)], listing)),
    ).toBe("E_PACK_UNLISTED")
    expect(
      code(() => assertPacksListed([pack("packs/a.json", 6)], listing)),
    ).toBe("E_PACK_MISMATCH")
    expect(
      code(() =>
        assertPacksListed([pack("packs/a.json", 5, "e".repeat(64))], listing),
      ),
    ).toBe("E_PACK_MISMATCH")
  })

  /** A file the rules code never reads is not a pack, and nothing here holds it. */
  test("a declared file the rules code does not read is left to the engine", () => {
    expect(() =>
      assertPacksListed(
        [{ ...pack("art/a.png", 5), requiredForSim: false }],
        EMPTY_LISTING,
      ),
    ).not.toThrow()
  })

  test("a pack at its limit is held, one byte past it refused", () => {
    const at = { files: [entry("p.bin", MAX_PACK_BYTES)] }
    expect(() =>
      assertPacksListed([pack("p.bin", MAX_PACK_BYTES)], at),
    ).not.toThrow()
    const over = { files: [entry("p.bin", MAX_PACK_BYTES + 1)] }
    expect(
      code(() => assertPacksListed([pack("p.bin", MAX_PACK_BYTES + 1)], over)),
    ).toBe("E_PACKS_TOO_LARGE")
  })

  test("packs at their limit together are held, one byte more refused", () => {
    const count = MAX_PACKS_BYTES / MAX_PACK_BYTES
    const packs = Array.from({ length: count }, (_, i) =>
      pack(`p${i}.bin`, MAX_PACK_BYTES),
    )
    const listing = {
      files: packs.map((p) => entry(p.path, p.bytes)),
    }
    expect(() => assertPacksListed(packs, listing)).not.toThrow()
    expect(
      code(() =>
        assertPacksListed([...packs, pack("one.bin", 1)], {
          files: [...listing.files, entry("one.bin", 1)],
        }),
      ),
    ).toBe("E_PACKS_TOO_LARGE")
  })
})

describe("listing a folder on disk", () => {
  async function folder(run: (dir: string) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "vbz-files-"))
    try {
      await run(dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  test("lists every file by its path, size and hash", async () => {
    await folder(async (dir) => {
      await mkdir(join(dir, "art", "ships"), { recursive: true })
      await mkdir(join(dir, "empty"))
      await writeFile(join(dir, "entry.js"), "export const a = 1\n")
      await writeFile(
        join(dir, "art", "ships", "one.png"),
        new Uint8Array([1, 2]),
      )
      const listed = await listFolder(dir)
      const sorted = [...listed.listing.files].sort((a, b) =>
        a.path.localeCompare(b.path),
      )
      expect(sorted).toEqual([
        {
          path: "art/ships/one.png",
          bytes: 2,
          sha256: sha256Hex(new Uint8Array([1, 2])),
        },
        {
          path: "entry.js",
          bytes: 19,
          sha256: sha256Hex(new TextEncoder().encode("export const a = 1\n")),
        },
      ])
      expect(listed.onDisk.get("art/ships/one.png")).toBe(
        join(dir, "art", "ships", "one.png"),
      )
    })
  })

  test("a link is refused rather than followed", async () => {
    await folder(async (dir) => {
      await writeFile(join(dir, "real.js"), "x")
      await symlink(join(dir, "real.js"), join(dir, "link.js"))
      await expect(listFolder(dir)).rejects.toThrow(/link is not followed/)
    })
  })

  test("a file whose name the folder cannot hold is refused", async () => {
    await folder(async (dir) => {
      await writeFile(join(dir, "a b.js"), "x")
      expect(await codeOf(() => listFolder(dir))).toBe("E_FILE_PATH_INVALID")
    })
  })

  /**
   * Nine sparse files of 60 MiB, each under the one-file limit and together
   * over the folder's 512 MiB. Refused on their sizes alone: reading 540 MiB
   * to refuse it would be the whole cost of the refusal.
   */
  test("a folder past its total is refused before any file is read", async () => {
    await folder(async (dir) => {
      const each = 60 * 1024 * 1024
      const count = Math.floor(MAX_FILES_BYTES / each) + 1
      expect(each).toBeLessThan(MAX_FILE_BYTES)
      for (let index = 0; index < count; index += 1) {
        const path = join(dir, `part-${index}.bin`)
        await writeFile(path, "")
        await truncate(path, each)
      }
      const read = spyOn(fs, "readFile")
      try {
        expect(await codeOf(() => listFolder(dir))).toBe("E_FILES_TOO_LARGE")
        expect(read).not.toHaveBeenCalled()
      } finally {
        read.mockRestore()
      }
    })
  })

  test("many files are read a few at a time, each hashed as it was read", async () => {
    await folder(async (dir) => {
      const count = HASH_CONCURRENCY * 3 + 1
      for (let index = 0; index < count; index += 1) {
        await writeFile(join(dir, `f-${index}.txt`), String(index))
      }
      const original = fs.readFile
      let reading = 0
      let most = 0
      const read = spyOn(fs, "readFile").mockImplementation((async (
        ...args: Parameters<typeof fs.readFile>
      ) => {
        reading += 1
        most = Math.max(most, reading)
        await Bun.sleep(1)
        try {
          return await original(...args)
        } finally {
          reading -= 1
        }
      }) as typeof fs.readFile)
      try {
        const listed = await listFolder(dir)
        expect(read).toHaveBeenCalledTimes(count)
        expect(most).toBe(HASH_CONCURRENCY)
        expect(listed.listing.files).toHaveLength(count)
        for (const file of listed.listing.files) {
          const index = file.path.slice(2, -4)
          expect(file.sha256).toBe(sha256Hex(new TextEncoder().encode(index)))
          expect(file.bytes).toBe(index.length)
        }
      } finally {
        read.mockRestore()
      }
    })
  })

  /** Listed by one size and read as another is two folders, not one listing. */
  test("a file that changed size between its size and its read is an error", async () => {
    await folder(async (dir) => {
      await writeFile(join(dir, "grows.txt"), "abc")
      const read = spyOn(fs, "readFile").mockImplementation((async () =>
        Buffer.from("abcd")) as unknown as typeof fs.readFile)
      try {
        await expect(listFolder(dir)).rejects.toThrow(
          "grows.txt changed while the folder was listed: it was 3 bytes and read as 4",
        )
      } finally {
        read.mockRestore()
      }
    })
  })

  test("a file one byte past the limit is refused before it is read", async () => {
    await folder(async (dir) => {
      const path = join(dir, "huge.bin")
      await writeFile(path, "")
      // Sparse: the size is there without the bytes.
      await truncate(path, MAX_FILE_BYTES + 1)
      expect(await codeOf(() => listFolder(dir))).toBe("E_FILE_TOO_LARGE")
    })
  })
})
