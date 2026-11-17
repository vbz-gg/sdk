import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import {
  assertPresentImports,
  assertRewritten,
  assertSimSelfContained,
  assertSize,
  countQuoted,
  decodeArtifact,
  rewritePresentImports,
} from "../../src/build/contract"
import { BuildRefusal } from "../../src/build/errors"
import {
  EMPTY_LISTING,
  type FilesListing,
  listingSha256,
} from "../../src/build/files"
import {
  ARTIFACT_PATH,
  filePathFor,
  filesBaseFor,
  isFilePathname,
  PRESENT_PATH,
  presentPathFor,
  simPathFor,
} from "../../src/build/paths"

const GAME = "0b6f3c1e-2d4a-4e8b-9c7d-5a1f2e3b4c6d"
const HASH = "a".repeat(64)
const SIM_PATH = simPathFor(GAME, HASH)

/** A folder holding an engine's entry and one chunk. */
const LISTING: FilesListing = {
  files: [
    { path: "entry.js", bytes: 10, sha256: "b".repeat(64) },
    { path: "chunks/a.js", bytes: 20, sha256: "c".repeat(64) },
  ],
}
const FILES_BASE = filesBaseFor(GAME, listingSha256(LISTING))

/** The page module's imports checked against a folder with nothing in it. */
function onlySim(text: string): number {
  return assertPresentImports(text, EMPTY_LISTING).sim
}

function rewriteSimImport(text: string, game: string, hash: string): string {
  return rewritePresentImports(text, game, hash, EMPTY_LISTING)
}

function code(refusal: () => unknown): string {
  try {
    refusal()
  } catch (error) {
    if (error instanceof BuildRefusal) return error.code
    throw error
  }
  throw new Error("nothing was refused")
}

describe("decoding an artifact", () => {
  /**
   * A module the browser reads as UTF-8 and the hasher hashes as bytes has to
   * be the same document. Without `fatal` a bad byte becomes a replacement
   * character nobody notices until the game misbehaves.
   */
  test("bytes that are not UTF-8 are refused rather than repaired", () => {
    const bad = new Uint8Array([0xff, 0xfe, 0xfd])
    expect(code(() => decodeArtifact(bad, "simulation"))).toBe(
      "E_ARTIFACT_NOT_UTF8",
    )
  })

  test("ordinary source decodes", () => {
    const bytes = new TextEncoder().encode("export const a = 1")
    expect(decodeArtifact(bytes, "simulation")).toBe("export const a = 1")
  })
})

describe("size", () => {
  test("over the cap is refused, at the cap is not", () => {
    expect(code(() => assertSize(new Uint8Array(11), 10, "page module"))).toBe(
      "E_ARTIFACT_TOO_LARGE",
    )
    expect(() =>
      assertSize(new Uint8Array(10), 10, "page module"),
    ).not.toThrow()
  })
})

describe("the simulation is self-contained", () => {
  /**
   * It replays in an isolate with no outbound network, so an import there is
   * a guaranteed fault on every session the version ever serves rather than a
   * slow path.
   */
  test("any import at all is refused", () => {
    expect(
      code(() => assertSimSelfContained(`import x from "./other"\nexport {}`)),
    ).toBe("E_SIM_NOT_SELF_CONTAINED")
  })

  test("a simulation that imports nothing passes", () => {
    expect(() =>
      assertSimSelfContained("export const MANIFEST = {}"),
    ).not.toThrow()
  })
})

describe("the page module imports the simulation and nothing else", () => {
  /**
   * The page module carrying its own copy of the simulation is the whole
   * thing this contract exists to prevent, and it is the one case every other
   * check passes.
   */
  test("a page module with no import is refused", () => {
    expect(code(() => onlySim("console.log(1)"))).toBe(
      "E_PRESENT_IMPORT_MISSING",
    )
  })

  test("a page module importing anything else is refused", () => {
    expect(
      code(() => onlySim(`import a from "cw2:sim"\nimport b from "pixi.js"`)),
    ).toBe("E_PRESENT_IMPORT_UNEXPECTED")
  })

  /** A dynamic import chooses its module at runtime, past a static scan. */
  test("a dynamic import is refused", () => {
    expect(code(() => onlySim(`const m = await import("cw2:sim")`))).toBe(
      "E_PRESENT_DYNAMIC_IMPORT",
    )
  })

  /**
   * The check that earns the text rewrite. If the quoted specifier appears
   * more often than the scanner found imports, the string is also data, and
   * replacing it would change a value the game reads.
   */
  test("the specifier appearing as data is refused, not rewritten", () => {
    expect(
      code(() => onlySim(`import a from "cw2:sim"\nconst label = "cw2:sim"`)),
    ).toBe("E_PRESENT_SPECIFIER_AMBIGUOUS")
  })

  test("a conforming page module reports how many imports it has", () => {
    expect(onlySim(`import a from "cw2:sim"`)).toBe(1)
  })

  /**
   * Bun's scanner reports `import("./x.js")` and nothing for `import(name)`,
   * so a computed import got past the check built on it, and so did a worker.
   */
  test("a computed import is refused, which the import scan does not see", () => {
    expect(
      code(() =>
        onlySim(`import a from "cw2:sim"\nconst n = "x"; import(n).then(a)`),
      ),
    ).toBe("E_PRESENT_DYNAMIC_IMPORT")
  })

  test("a script loaded by its address is refused", () => {
    for (const text of [
      `import a from "cw2:sim"\nnew globalThis.SharedWorker(url)`,
      `import a from "cw2:sim"\nself.importScripts(url)`,
    ]) {
      expect(code(() => onlySim(text))).toBe("E_PRESENT_WORKER")
    }
  })

  /**
   * pixi.js 8 starts its workers from blob URLs made of strings it carries,
   * so every game bundling it holds `new Worker`. The code is the module's
   * own bytes, named by its hash; the page's policy bounds where a worker
   * comes from. The fixture is pixi.js 8.21.0's own bundled form, published
   * and minified.
   */
  test("a worker started from the module's own code passes, and is counted", async () => {
    const published = await readFile(
      join(import.meta.dir, "fixtures", "pixi-8.21.0-worker.mjs"),
      "utf8",
    )
    const minified = await readFile(
      join(import.meta.dir, "fixtures", "pixi-8.21.0-worker.min.js"),
      "utf8",
    )
    for (const worker of [published, minified]) {
      expect(
        assertPresentImports(
          `import a from "cw2:sim"\n${worker.replace(/^export .*$/m, "")}`,
          EMPTY_LISTING,
        ),
      ).toEqual({ sim: 1, files: [], workers: 1 })
    }
    expect(
      assertPresentImports(
        `import a from "cw2:sim"\nnew Worker(a);new self.Worker(b, {type:"module"})`,
        EMPTY_LISTING,
      ).workers,
    ).toBe(2)
  })

  test("a message mentioning a load is data, not a load", () => {
    expect(
      onlySim(
        `import a from "cw2:sim"\nconst m = "use import(x) or new Worker(u)"`,
      ),
    ).toBe(1)
  })

  test("counting a quoted literal sees both quote styles", () => {
    expect(countQuoted(`"cw2:sim" and 'cw2:sim'`, "cw2:sim")).toBe(2)
    expect(countQuoted("cw2:sim unquoted", "cw2:sim")).toBe(0)
  })
})

describe("files of the folder, imported as cw2:files/", () => {
  test("a listed file may be imported, and is reported", () => {
    expect(
      assertPresentImports(
        `import a from "cw2:sim"\nimport {e} from "cw2:files/entry.js"\nimport "cw2:files/chunks/a.js"`,
        LISTING,
      ),
    ).toEqual({ sim: 1, files: ["entry.js", "chunks/a.js"], workers: 0 })
  })

  test("a file the folder does not hold is refused", () => {
    expect(
      code(() =>
        assertPresentImports(
          `import a from "cw2:sim"\nimport "cw2:files/missing.js"`,
          LISTING,
        ),
      ),
    ).toBe("E_FILE_UNLISTED")
  })

  test("a path that leaves the folder is refused", () => {
    expect(
      code(() =>
        assertPresentImports(
          `import a from "cw2:sim"\nimport "cw2:files/../present.js"`,
          LISTING,
        ),
      ),
    ).toBe("E_FILE_PATH_INVALID")
  })

  /**
   * Data and art are found through the folder's address at run time. A
   * `cw2:files/` string that is not an import is something the game reads,
   * which the rewrite would change.
   */
  test("the prefix appearing anywhere but an import is refused", () => {
    expect(
      code(() =>
        assertPresentImports(
          `import a from "cw2:sim"\nimport "cw2:files/entry.js"\nconst u = \`cw2:files/\${n}\``,
          LISTING,
        ),
      ),
    ).toBe("E_PRESENT_SPECIFIER_AMBIGUOUS")
  })

  test("files alone, with no rules code, are refused", () => {
    expect(
      code(() => assertPresentImports(`import "cw2:files/entry.js"`, LISTING)),
    ).toBe("E_PRESENT_IMPORT_MISSING")
  })

  test("the rewrite points every file at the folder named by its listing", () => {
    const out = rewritePresentImports(
      `import a from "cw2:sim";import {e} from "cw2:files/entry.js";import "cw2:files/chunks/a.js"`,
      GAME,
      HASH,
      LISTING,
    )
    expect(out).toBe(
      `import a from "${SIM_PATH}";import {e} from "${FILES_BASE}entry.js";import "${FILES_BASE}chunks/a.js"`,
    )
    expect(out).not.toContain("cw2:")
  })

  /** A folder with another listing is another folder, under another name. */
  test("a changed file renames the folder the page module names", () => {
    const changed: FilesListing = {
      files: [
        { ...(LISTING.files[0] as FilesListing["files"][number]), bytes: 11 },
        LISTING.files[1] as FilesListing["files"][number],
      ],
    }
    const text = `import a from "cw2:sim";import "cw2:files/entry.js"`
    expect(rewritePresentImports(text, GAME, HASH, changed)).not.toBe(
      rewritePresentImports(text, GAME, HASH, LISTING),
    )
  })
})

describe("rewriting the simulation import", () => {
  test("the specifier becomes the game's content address", () => {
    const out = rewriteSimImport(`import a from "cw2:sim"`, GAME, HASH)
    expect(out).toBe(`import a from "/g/${GAME}/sim/${HASH}.js"`)
  })

  /**
   * Two imports of the one specifier both have to move. A `replace` instead
   * of `replaceAll` leaves a second unresolvable specifier that throws in the
   * browser and nowhere else.
   */
  test("every occurrence moves, not just the first", () => {
    const out = rewriteSimImport(
      `import a from "cw2:sim"\nimport {b} from "cw2:sim"`,
      GAME,
      HASH,
    )
    expect(out).not.toContain("cw2:sim")
    expect(countQuoted(out, SIM_PATH)).toBe(2)
  })

  test("a single-quoted import moves too", () => {
    const out = rewriteSimImport(`import a from 'cw2:sim'`, GAME, HASH)
    expect(out).toContain(SIM_PATH)
  })

  /**
   * The path is built here, from a game id and a hash the caller computed.
   * Parts taken from a submission would let a bundle name some other module,
   * or another game's.
   */
  test("a game id or a hash that is not one is refused", () => {
    for (const [game, hash] of [
      ["../other", HASH],
      [GAME.toUpperCase(), HASH],
      ["", HASH],
      [GAME, "short"],
      [GAME, HASH.toUpperCase()],
      [GAME, `${HASH}/../x`],
    ] as const) {
      expect(
        code(() => rewriteSimImport(`import a from "cw2:sim"`, game, hash)),
      ).toBe("E_REWRITE_FAILED")
    }
  })

  test("a content address is root-relative, so the bytes carry no domain", () => {
    expect(SIM_PATH).toBe(`/g/${GAME}/sim/${HASH}.js`)
    expect(SIM_PATH.startsWith("/")).toBe(true)
  })

  /** The rewrite is re-scanned, so the transform is verified not trusted. */
  test("a page module that could not be rewritten is refused", () => {
    expect(
      code(() => rewriteSimImport("export const nothing = 1", GAME, HASH)),
    ).toBe("E_PRESENT_IMPORT_MISSING")
  })
})

describe("where a game's modules and files are served", () => {
  test("a file sits under its game and its folder's name", () => {
    const path = filePathFor(GAME, HASH, "art/ship.png")
    expect(path).toBe(`/g/${GAME}/t/${HASH}/art/ship.png`)
    expect(isFilePathname(path)).toBe(true)
    expect(ARTIFACT_PATH.test(path)).toBe(false)
    for (const bad of [
      `/g/${GAME}/t/${HASH}/`,
      `/g/${GAME}/t/${HASH}/../sim/${HASH}.js`,
      `/g/${GAME}/t/${HASH}/a//b`,
      `/g/${GAME}/t/short/a.js`,
      `/g/other/t/${HASH}/a.js`,
    ]) {
      expect({ bad, served: isFilePathname(bad) }).toEqual({
        bad,
        served: false,
      })
    }
  })

  /**
   * Every path names its game, so a studio's CSP can name its own game's
   * path and no other game's file loads into its page.
   */
  test("each kind sits under its game", () => {
    expect(presentPathFor(GAME, HASH)).toBe(`/g/${GAME}/present/${HASH}.js`)
    expect(PRESENT_PATH.test(presentPathFor(GAME, HASH))).toBe(true)
    expect(PRESENT_PATH.test(SIM_PATH)).toBe(false)
    expect(ARTIFACT_PATH.test(SIM_PATH)).toBe(true)
    expect(ARTIFACT_PATH.test(presentPathFor(GAME, HASH))).toBe(true)
    expect(ARTIFACT_PATH.test(`/g/${GAME}/frame/${HASH}.js`)).toBe(false)
    expect(ARTIFACT_PATH.test(`/sim/${HASH}.js`)).toBe(false)
  })
})

describe("verifying the rewrite", () => {
  /**
   * Unreachable through `rewritePresentImports`: by the time it runs the input has
   * passed the scan, the path has matched `SIM_PATH`, and swapping one quoted
   * literal for another cannot change how many imports a module has. Called
   * directly it is testable, which is the only way this guard is ever seen to
   * work - and the next person to change the replacement is who it is for.
   */
  test("a result with the wrong import count is refused", () => {
    expect(
      code(() =>
        assertRewritten(`import a from "${SIM_PATH}"`, SIM_PATH, FILES_BASE, {
          sim: 2,
          files: [],
          workers: 0,
        }),
      ),
    ).toBe("E_REWRITE_FAILED")
  })

  test("a result naming some other module is refused", () => {
    expect(
      code(() =>
        assertRewritten(`import a from "/sim/other.js"`, SIM_PATH, FILES_BASE, {
          sim: 1,
          files: [],
          workers: 0,
        }),
      ),
    ).toBe("E_REWRITE_FAILED")
  })

  test("a result whose files are not the ones imported before is refused", () => {
    expect(
      code(() =>
        assertRewritten(
          `import a from "${SIM_PATH}";import "${FILES_BASE}chunks/a.js"`,
          SIM_PATH,
          FILES_BASE,
          { sim: 1, files: ["entry.js"], workers: 0 },
        ),
      ),
    ).toBe("E_REWRITE_FAILED")
  })

  /** What it compares against has to be a game's sim path in the first place. */
  test("a result checked against a path that is not a sim path is refused", () => {
    expect(
      code(() =>
        assertRewritten(
          `import a from "/sim/${HASH}.js"`,
          `/sim/${HASH}.js`,
          FILES_BASE,
          { sim: 1, files: [], workers: 0 },
        ),
      ),
    ).toBe("E_REWRITE_FAILED")
  })

  test("a result whose import became dynamic is refused", () => {
    expect(
      code(() =>
        assertRewritten(
          `const m = await import("${SIM_PATH}")`,
          SIM_PATH,
          FILES_BASE,
          { sim: 1, files: [], workers: 0 },
        ),
      ),
    ).toBe("E_REWRITE_FAILED")
  })

  test("a result importing nothing at all is refused", () => {
    expect(
      code(() =>
        assertRewritten("export const a = 1", SIM_PATH, FILES_BASE, {
          sim: 1,
          files: [],
          workers: 0,
        }),
      ),
    ).toBe("E_REWRITE_FAILED")
  })

  test("what the rewrite actually produces passes", () => {
    expect(() =>
      assertRewritten(
        `import a from "${SIM_PATH}";import "${FILES_BASE}entry.js"`,
        SIM_PATH,
        FILES_BASE,
        { sim: 1, files: ["entry.js"], workers: 0 },
      ),
    ).not.toThrow()
  })
})
