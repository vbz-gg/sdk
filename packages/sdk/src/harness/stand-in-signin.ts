/**
 * The stand-in's sign-in, framed the way the platform's is.
 *
 * A page signs a player in through a box it draws over itself, holding the
 * sign-in in a frame. The platform's sign-in lets exactly the page that
 * asked frame it, and this stand-in holds a page to the same headers, so a
 * page that works against it works against the platform:
 *
 * - every page carrying a checked request is sent with `frame-ancestors`
 *   naming that page's exact origin, `Cross-Origin-Embedder-Policy:
 *   require-corp` and `Cross-Origin-Resource-Policy: cross-origin`, which
 *   is what lets it render in a page sent with COOP and COEP, and no
 *   `X-Frame-Options`;
 * - every other answer, a refused request, the script, the stylesheet and
 *   anything not found, is sent with `frame-ancestors 'none'` and
 *   `X-Frame-Options: DENY`, so a request the sign-in cannot check frames
 *   for nobody, and the page's box reports `E_SIGNIN_UNREACHABLE`;
 * - each framed page answers its parent's `vbz.signin.ping` with
 *   `vbz.signin.ready` echoing the ping's `load`, and the hand-off posts
 *   `vbz.signin` with the code on its `load`, each to the page's exact
 *   origin and nowhere else; Escape inside the frame posts
 *   `vbz.signin.cancel`. The page pings each page its frame loads and waits
 *   for that page's answer alone, so a ready nobody asked for would say
 *   nothing;
 * - the form posts `Continue` back to the sign-in's own origin, and a post
 *   whose `Origin` is not the sign-in's is refused, as the platform's are.
 *
 * It signs in one local player with a click, so it keeps no remembered
 * sign-in and sets no cookie.
 */

import type {
  PageKey,
  SignedInPlayer,
  SignInCancel,
  SignInHandoff,
  SignInPing,
  SignInReady,
} from "../api/index.js"
import { assertOrigin } from "./csp.js"
import { escapeHtml } from "./page/document.js"

/** A code the sign-in handed a page, until it is traded. */
export interface SignInGrant {
  readonly challenge: string
  used: boolean
}

/** Where a framed page's one script is, on the sign-in's own origin. */
export const SIGN_IN_SCRIPT_PATH = "/signin.js"
/** Where its stylesheet is. */
export const SIGN_IN_STYLE_PATH = "/signin.css"

/**
 * The headers of a sign-in answer: framed for `framedFor`, the exact origin
 * of the page that asked, or for nobody.
 */
export function signInHeaders(
  framedFor: string | null,
): Record<string, string> {
  const common = {
    "cache-control": "no-store",
    "referrer-policy": "same-origin",
    "x-content-type-options": "nosniff",
  }
  const policy = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
  ]
  if (framedFor === null) {
    return {
      ...common,
      "content-security-policy": [...policy, "frame-ancestors 'none'"].join(
        "; ",
      ),
      "x-frame-options": "DENY",
    }
  }
  return {
    ...common,
    // Written into a header, where a `;` would start a directive of its own.
    "content-security-policy": [
      ...policy,
      `frame-ancestors ${assertOrigin(framedFor, "the page that asked")}`,
    ].join("; "),
    "cross-origin-embedder-policy": "require-corp",
    "cross-origin-resource-policy": "cross-origin",
  }
}

/** A request the sign-in can check, as its query or its form carries it. */
interface Asking {
  readonly redirect: string
  readonly state: string
  readonly challenge: string
}

const REQUEST_FIELDS = [
  "client_id",
  "redirect_uri",
  "state",
  "code_challenge",
  "code_challenge_method",
] as const

/**
 * Answers the framing page's ping with `vbz.signin.ready`, echoing the
 * ping's `load`, and takes a ping only from its parent, on the page's
 * origin, for its state; posts the hand-off, if the page carries one, on
 * `load`; and `vbz.signin.cancel` on Escape. Everything goes to the page's
 * origin alone. Opened in a window of its own rather than in a frame, it
 * posts nothing and says where to go back to.
 */
const SCRIPT = `"use strict";
(() => {
  const data = JSON.parse(document.getElementById("signin").textContent);
  const status = document.getElementById("status");
  if (window.parent === window) {
    status.textContent = "Go back to the page you were signing in to, and start again from there.";
    return;
  }
  const post = (message) => window.parent.postMessage(message, data.origin);
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== data.origin) return;
    const asked = event.data;
    if (!asked || asked.type !== ${JSON.stringify("vbz.signin.ping" satisfies SignInPing["type"])} || asked.state !== data.state || typeof asked.load !== "number") return;
    post({ type: ${JSON.stringify("vbz.signin.ready" satisfies SignInReady["type"])}, state: data.state, load: asked.load });
  });
  if (data.handoff) {
    window.addEventListener("load", () => post(data.handoff), { once: true });
    return;
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") post({ type: ${JSON.stringify("vbz.signin.cancel" satisfies SignInCancel["type"])}, state: data.state });
  });
  document.querySelector("button")?.focus();
})();
`

const STYLE = `:root { color-scheme: light dark; font: 16px/1.5 system-ui, sans-serif; }
body { margin: 0; padding: 24px; }
button { font: inherit; padding: .6rem 1rem; cursor: pointer; }
`

export interface SignInPagesOptions {
  /** The only page key the stand-in takes. */
  readonly pageKey: PageKey
  /** The only page the stand-in lets frame its sign-in: the site's. */
  readonly siteOrigin: string
  /** The sign-in's own origin, once its socket is bound. */
  readonly signInOrigin: () => string
  readonly player: SignedInPlayer["player"]
  /** Where a code is kept until it is traded. */
  readonly grants: Map<string, SignInGrant>
  /**
   * A line for the terminal. A refused request's page is framed for nobody,
   * so the page that asked shows an empty box and learns only
   * `E_SIGNIN_UNREACHABLE`; the reason is said here, where an author
   * running `vbz dev` reads it.
   */
  readonly log?: (line: string) => void
}

/** The sign-in's every answer. */
export function signInPages(
  options: SignInPagesOptions,
): (request: Request) => Promise<Response> {
  const html = (body: string, status: number, framedFor: string | null) =>
    new Response(body, {
      status,
      headers: {
        ...signInHeaders(framedFor),
        "content-type": "text/html; charset=utf-8",
      },
    })

  /**
   * A page; a framed one carries what its script reads, as data that never
   * runs, and the script.
   */
  const page = (title: string, body: string, read?: unknown) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="${SIGN_IN_STYLE_PATH}" />
  </head>
  <body>
${body}${
  read === undefined
    ? ""
    : `
    <script type="application/json" id="signin">${JSON.stringify(read).replaceAll("</", "<\\/")}</script>
    <script src="${SIGN_IN_SCRIPT_PATH}"></script>`
}
  </body>
</html>
`

  const log = options.log ?? (() => {})
  const refused = (why: string) => {
    log(
      `stand-in sign-in: refused, so the page's box stays empty and signIn() ends in E_SIGNIN_UNREACHABLE: ${why}`,
    )
    return html(
      page(
        "Sign-in refused",
        `    <p id="status">Refused: ${escapeHtml(why)}.</p>`,
      ),
      400,
      null,
    )
  }

  /** The request a query or a form carries, or why it cannot be checked. */
  const check = (fields: URLSearchParams | FormData): Asking | string => {
    const field = (name: (typeof REQUEST_FIELDS)[number]) => {
      const value = fields.get(name)
      return typeof value === "string" ? value : null
    }
    const redirect = field("redirect_uri")
    const state = field("state")
    const challenge = field("code_challenge")
    const pageKey = field("client_id")
    if (pageKey !== options.pageKey) {
      return `the page key ${JSON.stringify(pageKey)} is not the stand-in's, ${options.pageKey}`
    }
    if (redirect !== options.siteOrigin) {
      return `the page asking, ${JSON.stringify(redirect)}, is not ${options.siteOrigin}, the one origin the stand-in lets frame its sign-in`
    }
    if (
      field("code_challenge_method") !== "S256" ||
      challenge === null ||
      challenge === ""
    ) {
      return "the request carries no S256 challenge"
    }
    if (state === null || state === "") return "the request carries no state"
    return { redirect, state, challenge }
  }

  const asking = (request: Asking) => {
    // The form carries the request again, and `/continue` checks it again.
    const values: Record<(typeof REQUEST_FIELDS)[number], string> = {
      client_id: options.pageKey,
      redirect_uri: request.redirect,
      state: request.state,
      code_challenge: request.challenge,
      code_challenge_method: "S256",
    }
    const fields = REQUEST_FIELDS.map(
      (name) =>
        `      <input type="hidden" name="${name}" value="${escapeHtml(values[name])}" />`,
    )
    return html(
      page(
        "Sign in",
        `    <main>
    <p>The vbz platform's sign-in, stood in for on this machine.</p>
    <form method="post" action="/continue">
${fields.join("\n")}
      <button type="submit">Sign in as ${escapeHtml(options.player.displayName)}</button>
    </form>
    <p id="status" role="status"></p>
    </main>`,
        { origin: request.redirect, state: request.state },
      ),
      200,
      request.redirect,
    )
  }

  const handOff = (request: Asking) => {
    const code = crypto.randomUUID()
    options.grants.set(code, { challenge: request.challenge, used: false })
    const handoff: SignInHandoff = {
      type: "vbz.signin",
      code,
      state: request.state,
    }
    return html(
      page(
        "Signed in",
        `    <p id="status" role="status">Signed in as ${escapeHtml(options.player.displayName)}.</p>`,
        { origin: request.redirect, state: request.state, handoff },
      ),
      200,
      request.redirect,
    )
  }

  return async (request) => {
    const url = new URL(request.url)
    const key = `${request.method} ${url.pathname}`
    if (key === `GET ${SIGN_IN_SCRIPT_PATH}`) {
      return new Response(SCRIPT, {
        headers: {
          ...signInHeaders(null),
          "content-type": "text/javascript; charset=utf-8",
        },
      })
    }
    if (key === `GET ${SIGN_IN_STYLE_PATH}`) {
      return new Response(STYLE, {
        headers: {
          ...signInHeaders(null),
          "content-type": "text/css; charset=utf-8",
        },
      })
    }
    if (key === "GET /authorize") {
      const checked = check(url.searchParams)
      return typeof checked === "string" ? refused(checked) : asking(checked)
    }
    if (key === "POST /continue") {
      // A form posted from the sign-in's own page carries its origin; a
      // post from anywhere else is no step of this sign-in.
      if (request.headers.get("origin") !== options.signInOrigin()) {
        return refused("the form was not posted from the sign-in's own page")
      }
      const checked = check(
        await request.formData().catch(() => new FormData()),
      )
      return typeof checked === "string" ? refused(checked) : handOff(checked)
    }
    return html(page("Not here", `    <p>Nothing here.</p>`), 404, null)
  }
}
