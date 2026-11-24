/**
 * A studio's secret key, and where this package will send one.
 *
 * `vbz publish` and `/server`'s client both carry the studio's secret key on
 * every request, so both hold a key and the platform's origin to these, and
 * neither sends a key somewhere the other would refuse to: over https, or
 * over plain http to this machine, which is how the platform is run locally.
 *
 * It imports nothing at run time, so `/server` brings none of the CLI with
 * it and the CLI none of `/server`.
 */

import type { PageKey, SecretKey } from "../api/index.js"

/**
 * The prefixes that say which kind a key is. Each is held to the key types
 * in `/api` below, so a prefix that moved there fails to compile here rather
 * than refusing every real key.
 */
export const SECRET_KEY_PREFIX = "vbz_sk_"
export const PAGE_KEY_PREFIX = "vbz_pk_"
const _secretKeyPrefixHeld: SecretKey = `${SECRET_KEY_PREFIX}held`
const _pageKeyPrefixHeld: PageKey = `${PAGE_KEY_PREFIX}held`
void _secretKeyPrefixHeld
void _pageKeyPrefixHeld

/** The hosts plain http may reach: this machine, by each of its names. */
export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
])

/** The platform's origin a key may be sent to, or why it may not be. */
export type KeyOrigin =
  | { readonly ok: true; readonly origin: string }
  | { readonly ok: false; readonly problem: string }

/**
 * Holds the platform's origin to being one a secret key may travel to:
 * https, or http to this machine, and the origin alone, with no path, query
 * or login, because every route's path is added to it.
 */
export function keyOriginOf(raw: string): KeyOrigin {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, problem: "it is not a URL" }
  }
  const secure =
    url.protocol === "https:" ||
    (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
  if (!secure) {
    return {
      ok: false,
      problem:
        "the request carries the studio's secret key, so it must be https, or http to this machine",
    }
  }
  if (
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return {
      ok: false,
      problem: "give the origin alone, with no path, query or login",
    }
  }
  return { ok: true, origin: url.origin }
}
