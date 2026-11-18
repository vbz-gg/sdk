/**
 * The harness page, shaped like a game's page in production.
 *
 * The game gets the whole viewport and one floating mark sits over it. The
 * status line, the two run buttons and the report are what a game's page
 * does not need: an author needs to see what the game is saying, whether the
 * run's recording replays, and the recording itself, which is the evidence
 * the platform would replay.
 *
 * The page is served under the Content-Security-Policy a page loading a
 * game from another origin is meant to send, so it carries no inline script and no inline style: its
 * script is a module and its style a stylesheet, both from its own origin.
 * The config travels in a JSON script block, which is data and never runs,
 * rather than in the URL, so a seed does not end up in a referrer or a log.
 */

/** A title comes from a manifest, so it is escaped. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export interface HarnessPageInput {
  readonly title: string
  readonly config: unknown
}

/** The page's stylesheet, served at `/harness.css`. */
export const HARNESS_STYLE = `:root { color-scheme: dark; }
html, body { margin: 0; height: 100%; background: #0d0e11; color: #ecedf0;
  font: 14px system-ui, sans-serif; }
/* The stage is the element the game fills, and it is the whole viewport, as
   the play view is. */
#stage { position: fixed; inset: 0; outline: none; }
#mark { position: fixed; top: max(16px, env(safe-area-inset-top));
  left: max(16px, env(safe-area-inset-left)); z-index: 3;
  font-weight: 600; letter-spacing: 0.08em; opacity: 0.7; }
#bar { position: fixed; top: max(12px, env(safe-area-inset-top));
  right: max(12px, env(safe-area-inset-right)); z-index: 3;
  display: flex; gap: 8px; align-items: center; }
#bar button { background: #191b20; color: #ecedf0;
  border: 1px solid #3a3d46; border-radius: 8px; padding: 6px 10px;
  font: inherit; }
#status { opacity: 0.6; }
#bar a { color: #3bd68a; text-decoration: none; }
#bar a[hidden] { display: none; }
#report { position: fixed; bottom: max(12px, env(safe-area-inset-bottom));
  left: max(12px, env(safe-area-inset-left)); z-index: 3; margin: 0;
  padding: 8px 10px; border-radius: 8px; background: rgba(13, 14, 17, 0.85);
  font: 12px ui-monospace, monospace; white-space: pre-wrap; }
#report:empty { display: none; }
#report[data-passes="false"] { color: #f28b82; }
`

export function harnessPage(input: HarnessPageInput): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${escapeHtml(input.title)}</title>
    <link rel="stylesheet" href="/harness.css" />
  </head>
  <body>
    <div id="stage"></div>
    <div id="mark">vbz</div>
    <div id="bar">
      <span id="status">starting</span>
      <button id="start" type="button">Start</button>
      <button id="end" type="button">End</button>
      <a id="save" download="recording.json" hidden>Save recording</a>
    </div>
    <pre id="report" role="status"></pre>
    <script type="application/json" id="harness-config">${escapeJson(
      input.config,
    )}</script>
    <!-- Filled in by the page once a run has ended and its recording has
         arrived: what the run scored, the recording itself, and the
         harness's report on it. -->
    <script type="application/json" id="run"></script>
    <script type="module" src="/harness.js"></script>
  </body>
</html>
`
}

/**
 * JSON safe to sit inside a script element.
 *
 * `</script>` anywhere in the data would end the block early and put the rest
 * of the config into the document as markup. Escaping the slash keeps it
 * valid JSON and stops the parser seeing a closing tag.
 */
function escapeJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("</", "<\\/")
}
