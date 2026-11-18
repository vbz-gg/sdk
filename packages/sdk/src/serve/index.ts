/**
 * Serving a game's two modules and its files with the headers a host serving
 * them to a page on another origin sends.
 *
 * The harness serves a laptop from this code, and vbz.gg's development
 * `bundles` role serves its local folder from it, so a page meets the same
 * paths and the same headers in both as from vbz.gg's public bucket.
 */

export {
  BLOB_CACHE_CONTROL,
  BLOB_PATH,
  type BlobReader,
  contentTypeFor,
  createBlobServer,
  FILE_CONTENT_TYPES,
  isServedPath,
  JS_CONTENT_TYPE,
} from "./blobs.js"
