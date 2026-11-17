/**
 * Serving a game's two modules and its files the way the platform's edge
 * serves them.
 *
 * The harness serves a laptop from this code, and the platform's development
 * `bundles` role serves its local folder from it, so a page meets the same
 * paths and the same headers in both as from the public bucket in production.
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
