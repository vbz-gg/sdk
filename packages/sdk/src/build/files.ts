/**
 * A version's files folder: what it holds, what it is called, and what it
 * may hold.
 *
 * Beside its two modules a version carries a folder of files the game's own
 * tools built: code such as a renderer's engine, art, and the data packs the
 * rules code reads. The folder is listed by path, size and SHA-256, and named
 * by the SHA-256 of that listing, so a page module that names the folder
 * names every byte in it, forever, as one naming a rules code by its hash
 * does. The platform imports these functions, so an upload is listed,
 * named and held to its limits, which `limits.ts` holds, by the code an
 * author builds with.
 */

import { readdir, readFile, stat } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import type { FileEntry, FilesListing } from "../api/index.js"
import { isFilePath } from "../game/files.js"
import { sha256Hex } from "./digest.js"
import { refuse } from "./errors.js"
import {
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_FILES_BYTES,
  MAX_PACK_BYTES,
  MAX_PACKS_BYTES,
} from "./limits.js"
import { SHA256 } from "./paths.js"

export type { FileEntry, FilesListing }

/** The listing of a game with no folder. */
export const EMPTY_LISTING: FilesListing = { files: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * `value` held to a listing's shape and the folder's limits, or a refusal:
 * `E_FILES_INVALID` for an entry that is not a path, a size and a hash,
 * `E_FILE_PATH_INVALID` for a path the folder cannot hold or one listed
 * twice, ignoring case, as macOS and Windows store them, `E_FILE_TOO_LARGE`,
 * `E_FILES_TOO_LARGE` and `E_FILES_TOO_MANY`.
 */
export function assertListing(value: unknown): FilesListing {
  if (!isRecord(value) || !Array.isArray(value.files)) {
    refuse("E_FILES_INVALID", "a files listing is { files: [...] }")
  }
  const entries: unknown[] = value.files
  if (entries.length > MAX_FILES) {
    refuse(
      "E_FILES_TOO_MANY",
      `the folder holds ${entries.length} files, over the ${MAX_FILES} a version may hold`,
    )
  }
  const files: FileEntry[] = []
  const seen = new Set<string>()
  let total = 0
  for (const [index, entry] of entries.entries()) {
    if (
      !isRecord(entry) ||
      typeof entry.path !== "string" ||
      !Number.isSafeInteger(entry.bytes) ||
      (entry.bytes as number) < 0 ||
      typeof entry.sha256 !== "string" ||
      !SHA256.test(entry.sha256)
    ) {
      refuse(
        "E_FILES_INVALID",
        `files[${index}] is not a path, a whole number of bytes and a lowercase hex SHA-256`,
      )
    }
    const { path, sha256 } = entry
    const bytes = entry.bytes as number
    if (!isFilePath(path)) {
      refuse(
        "E_FILE_PATH_INVALID",
        `${JSON.stringify(path)} is not a path a version's folder may hold: relative, with letters, digits, '.', '_', '-' and '/', and no '.' or '..' segment`,
      )
    }
    const folded = path.toLowerCase()
    if (seen.has(folded)) {
      refuse(
        "E_FILE_PATH_INVALID",
        `${JSON.stringify(path)} is listed twice, ignoring case`,
      )
    }
    seen.add(folded)
    if (bytes > MAX_FILE_BYTES) {
      refuse(
        "E_FILE_TOO_LARGE",
        `${path} is ${bytes} bytes, over the ${MAX_FILE_BYTES} one file may hold`,
      )
    }
    total += bytes
    files.push({ path, bytes, sha256 })
  }
  if (total > MAX_FILES_BYTES) {
    refuse(
      "E_FILES_TOO_LARGE",
      `the folder holds ${total} bytes, over the ${MAX_FILES_BYTES} a version's files may hold`,
    )
  }
  return { files }
}

/**
 * The listing as the text its name is the SHA-256 of: every entry as
 * `{"path","bytes","sha256"}`, in order of path, compact JSON. `vbz build`
 * writes exactly this as `dist/files.json`.
 */
export function canonicalListing(listing: FilesListing): string {
  return JSON.stringify({
    files: byPath(assertListing(listing)).map(({ path, bytes, sha256 }) => ({
      path,
      bytes,
      sha256,
    })),
  })
}

/** A listing's files in order of path, as the canonical text lists them. */
function byPath(listing: FilesListing): FileEntry[] {
  return [...listing.files].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  )
}

/** The folder's name: the SHA-256 of its canonical listing. */
export function listingSha256(listing: FilesListing): string {
  return sha256Hex(new TextEncoder().encode(canonicalListing(listing)))
}

/** The entry for `path`, or undefined when the folder holds no such file. */
export function listedFile(
  listing: FilesListing,
  path: string,
): FileEntry | undefined {
  return listing.files.find((file) => file.path === path)
}

/**
 * The SHA-256 of every file `listing` names that `held` does not hold, each
 * once however many paths share its bytes, in order of path. The platform
 * answers `POST /v1/games/:gameId/files/missing` with it, against what the
 * game's store holds, and `vbz publish` uploads exactly those.
 */
export function missingFiles(
  listing: FilesListing,
  held: ReadonlySet<string>,
): string[] {
  const missing = new Set<string>()
  for (const file of byPath(assertListing(listing))) {
    if (!held.has(file.sha256)) missing.add(file.sha256)
  }
  return [...missing]
}

/**
 * Refuses a version whose listing names a file the game's store does not
 * hold, with `E_FILES_MISSING`. The platform answers the refusal's `detail`
 * with `missingFiles`.
 */
export function assertFilesHeld(
  listing: FilesListing,
  held: ReadonlySet<string>,
): void {
  const missing = missingFiles(listing, held)
  if (missing.length > 0) {
    refuse(
      "E_FILES_MISSING",
      `the listing names ${missing.length} file${missing.length === 1 ? "" : "s"} the game's store does not hold, the first ${missing[0]}; upload each one POST /v1/games/:gameId/files/missing names before the version`,
    )
  }
}

/**
 * One uploaded file held to the name it was sent under: `E_FILES_INVALID`
 * for a name that is not a lowercase hex SHA-256, `E_FILE_TOO_LARGE` over
 * `MAX_FILE_BYTES`, and `E_FILE_HASH_MISMATCH` for bytes that hash to
 * another. The platform checks the size against `Content-Length` before it
 * reads a body; this holds the bytes it read.
 */
export function assertFileBytes(sha256: string, bytes: Uint8Array): void {
  if (!SHA256.test(sha256)) {
    refuse(
      "E_FILES_INVALID",
      `${JSON.stringify(sha256)} is not a lowercase hex SHA-256, which a file is uploaded under`,
    )
  }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    refuse(
      "E_FILE_TOO_LARGE",
      `the file is ${bytes.byteLength} bytes, over the ${MAX_FILE_BYTES} one file may hold`,
    )
  }
  const actual = sha256Hex(bytes)
  if (actual !== sha256) {
    refuse(
      "E_FILE_HASH_MISMATCH",
      `the file was sent as ${sha256} and its bytes hash to ${actual}`,
    )
  }
}

/** A manifest's data pack, as far as this file reads one. */
interface DeclaredAsset {
  readonly path: string
  readonly sha256: string
  readonly bytes: number
  readonly requiredForSim: boolean
}

/**
 * Every data pack the manifest declares, the ones its rules code reads, is a
 * file in the folder, the same size and hash, and the packs fit one replay:
 * `E_PACK_UNLISTED`, `E_PACK_MISMATCH`, or `E_PACKS_TOO_LARGE` for one pack
 * over `MAX_PACK_BYTES` or all of them over `MAX_PACKS_BYTES`.
 *
 * A file the manifest declares and the rules code does not read is the
 * engine's `budgets` check's to hold, which reads it beside the rules code.
 */
export function assertPacksListed(
  assets: readonly DeclaredAsset[] | undefined,
  listing: FilesListing,
): void {
  let total = 0
  for (const asset of assets ?? []) {
    if (!asset.requiredForSim) continue
    const file = listedFile(listing, asset.path)
    if (file === undefined) {
      refuse(
        "E_PACK_UNLISTED",
        `the manifest declares the data pack ${asset.path}, and the files folder has no such file`,
      )
    }
    if (file.bytes !== asset.bytes || file.sha256 !== asset.sha256) {
      refuse(
        "E_PACK_MISMATCH",
        `${asset.path} is ${file.bytes} bytes hashing to ${file.sha256} in the folder, and the manifest declares ${asset.bytes} bytes hashing to ${asset.sha256}`,
      )
    }
    if (file.bytes > MAX_PACK_BYTES) {
      refuse(
        "E_PACKS_TOO_LARGE",
        `the data pack ${asset.path} is ${file.bytes} bytes, over the ${MAX_PACK_BYTES} one pack may hold`,
      )
    }
    total += file.bytes
  }
  if (total > MAX_PACKS_BYTES) {
    refuse(
      "E_PACKS_TOO_LARGE",
      `the data packs hold ${total} bytes together, over the ${MAX_PACKS_BYTES} a replay takes`,
    )
  }
}

/** A folder, listed: its listing, and where each listed file is on disk. */
export interface ListedFolder {
  readonly listing: FilesListing
  /** The absolute path on disk of each file, by its path in the listing. */
  readonly onDisk: ReadonlyMap<string, string>
}

/** How many of a folder's files are read and hashed at once. */
export const HASH_CONCURRENCY = 8

/**
 * The hash a file is listed under before its bytes are read: a listing of
 * what the folder holds by path and size alone, which is everything the
 * folder's limits look at.
 */
const UNREAD = "0".repeat(64)

/**
 * Every file under `dir`, listed and held to the folder's limits. A symbolic
 * link is refused rather than followed, because what it names is not in the
 * folder; an empty directory lists nothing.
 *
 * The folder is held to every limit by the size each file says it has
 * before a byte is read, so one over 512 MiB, or holding a file a version
 * cannot, is refused without reading it. Then the files are read and hashed,
 * `HASH_CONCURRENCY` at a time, and one that changed size meanwhile is an
 * error rather than a listing of two different folders.
 */
export async function listFolder(dir: string): Promise<ListedFolder> {
  const onDisk = new Map<string, string>()
  const walk = async (at: string): Promise<void> => {
    const entries = await readdir(at, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(at, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      const path = relative(dir, full).split(sep).join("/")
      if (!entry.isFile()) {
        throw new Error(
          `${full} is not a plain file; a version's files folder holds files and directories, and a link is not followed`,
        )
      }
      onDisk.set(path, full)
    }
  }
  await walk(dir)
  if (onDisk.size > MAX_FILES) {
    refuse(
      "E_FILES_TOO_MANY",
      `${dir} holds ${onDisk.size} files, over the ${MAX_FILES} a version may hold`,
    )
  }
  const sized: FileEntry[] = []
  for (const [path, full] of onDisk) {
    sized.push({ path, bytes: (await stat(full)).size, sha256: UNREAD })
  }
  // Every limit, on the sizes alone, before anything is read.
  assertListing({ files: sized })
  const files = await boundedMap(sized, HASH_CONCURRENCY, async (entry) => {
    const bytes = new Uint8Array(
      await readFile(onDisk.get(entry.path) as string),
    )
    if (bytes.byteLength !== entry.bytes) {
      throw new Error(
        `${entry.path} changed while the folder was listed: it was ${entry.bytes} bytes and read as ${bytes.byteLength}`,
      )
    }
    return { path: entry.path, bytes: entry.bytes, sha256: sha256Hex(bytes) }
  })
  return { listing: assertListing({ files }), onDisk }
}

/** `work` over every item, at most `limit` at once, the answers in order. */
async function boundedMap<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const answers: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      answers[index] = await work(items[index] as T)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  )
  return answers
}
