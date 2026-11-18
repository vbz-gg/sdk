# The page: `@vbz-gg/sdk/host`, and `@vbz-gg/sdk/platform` on vbz.gg

A game is played on a page. The page loads the build, from beside it or
from wherever it is served, plays it with `playLocal` from
`@vbz-gg/sdk/host`, and talks to nobody. A player has no identity there
unless the page's author adds one.

If you use vbz.gg, a studio's page plays ranked and practice runs too: it
signs a player in, loads the game's page module from the platform, starts
a run, sends the run to the platform as it goes, submits the recording and
reads the board. `@vbz-gg/sdk/platform` does that against the platform's
routes, and `@vbz-gg/sdk/host` loads the module, plays a run through it and
adds two widgets. The platform's page guide, `docs/your-game-page.md` in
vbz-gg/platform, is the protocol they follow. The same build plays both.

## Playing a game on a page

`vbz build` writes `dist/game.json` beside the build. A page serves `dist/`
as it is, here as `game/`, maps the page module's two imports with an import
map, and loads and plays it:

```html
<script type="importmap">{"imports":{"cw2:sim":"./game/sim.js","cw2:files/":"./game/files/"}}</script>
```

```ts
import { loadGame, localAddress, playLocal } from "@vbz-gg/sdk/host"

const url = new URL("game/game.json", document.baseURI).href
const game = await loadGame(localAddress(await (await fetch(url)).json(), url))

playButton.onclick = () => {
  const run = playLocal(stage, {
    game,
    scripted: "ignore", // "record" lets a script of the page's own drive the game
    title: "My game",
    onEnded: (ended) => show(ended.counters, ended.recording),
    onError: (error) => tell(error.message),
    onNotice: (notice) => tell(notice.detail),
  })
  // run.end() when the player leaves; run.destroy() before the next run
}
```

- It asks nothing of any platform: no client, no page key, no sign-in, no
  lock across tabs and no request.
- It plays a fresh seed and the module's served config, every declared
  setting at its default, unless the page passes `seed` or `config`. The
  seed always starts `local:`, and a seed the page kept from an earlier run,
  `run.seed`, plays the same course again.
- A run has no step limit. `onEnded` gets the recording, which replays to
  the same counters against the build's rules code.
- Its clock starts once the game can draw, so a device that cannot draw it
  reaches `onError` with `E_PRESENTATION_FAILED` before tick 0. A game that
  reads tilt asks for it in the click and starts nothing without it.
- `playLocal` throws `E_LOCAL_PLAY_UNSUPPORTED` for a module built before
  local play, and `E_CONFIG_REQUIRED` for a game with a required setting that
  has no default when the page names no config.
- `run.end()` while the tilt prompt is still open comes before any run
  started: `onEnded` follows at once with an empty run, tick 0, no counters
  and a `recording` of null, and whatever the prompt answers afterwards,
  nothing is mounted and nothing more is reported, so the next run may take
  the element at once.
- If you use vbz.gg, a local run's recording can never pass for a ranked
  one. Its seed is no seed the platform issued, so the platform refuses it
  as played on a seed no run was issued (`E_PINNED_MISMATCH`) and stores
  nothing, and the client's `submit` does not take its `LocalRecording`.
- The page's Content-Security-Policy is `localPageCsp` from
  `@vbz-gg/sdk/harness` for a build served from the page's own origin, or
  `pageCsp` for one served from another, with the game's needs and the
  import map admitted by the SHA-256 of its exact text.

The template's `site/` is such a page while `site/config.json` says
`{ "mode": "local" }`, which a new game ships with, and `vbz dev --site`
serves it from the build.

## If you use vbz.gg: the client

For ranked and practice runs, once the game is published:

```ts
import { createPlatformClient } from "@vbz-gg/sdk/platform"

const platform = createPlatformClient({
  apiOrigin: "https://api.vbz.gg",
  signInOrigin: "https://signin.vbz.gg",
  pageKey: PAGE_KEY, // vbz_pk_..., from the dashboard
})

const page = await platform.game() // today's round, or null
signInButton.onclick = () => platform.signIn() // from the click, nothing awaited first
```

- `signIn()` puts a box over the page holding the platform's sign-in in a
  frame, before it awaits anything, so focus moves into the frame from the
  click, which is when a phone opens its keyboard. Call it straight from the
  handler. In WebKit, as Playwright builds it for Linux, focus stays on the
  frame rather than on the sign-in's first control, so a player there taps
  the field first; Safari itself is not measured. The box is a modal
  `<dialog>`, so the page behind it is inert while it is up: Tab never
  reaches your Play button. A second call while the box is up answers the
  same promise.
- The player closes the box with its Cancel button or Escape, and
  `closeSignIn()` closes it from the page, even while the code is being
  traded, when the page then keeps nobody; each rejects with
  `E_SIGNIN_CANCELLED`.
- The sign-in frames only for your page's exact origin, so the page's
  policy names it in `frame-src`, and a page shown inside another page whose
  origin is not its own, the same site's included, cannot show it. Either
  way the box stays empty, and `signIn()` rejects with
  `E_SIGNIN_UNREACHABLE` after 15 seconds, or the `signInReadyMs` the client
  was made with. The client asks each page of the sign-in its frame loads
  whether it works, so a later step the browser refuses gives up the same
  way.
- A player stays signed in to the sign-in on your site alone: signing in on
  another studio's site asks for a code again. Safari may ask for one more
  often.
- The player's token is kept in `localStorage`, one entry per page key, and
  in memory, so a browser that keeps nothing still plays this visit. Every run
  start renews it. A token the platform stops honouring is dropped, and
  `onSignedOut` is told.
- `onPlayerChange(listener)` is told each time the player changes: a
  sign-in, a sign-out, a token refused or found expired. It returns a
  function that stops it. `mountSignIn` follows it, so the box never shows a
  player the client has let go, and the page needs no code for that.
- `signOut()` forgets the player on this page. No route signs a player out;
  the sign-in's own page does that.

## If you use vbz.gg: a run

```ts
import { loadGame, mountBoard, mountSignIn, playRun } from "@vbz-gg/sdk/host"

mountSignIn(signInSlot, { client: platform }) // puts the box up in the click
const board = mountBoard(boardSlot, { client: platform, period: "day" })
await board.refresh()

// Before the click: the module the next ranked start plays. Null while the
// day is paused, when page.practiceVersion is the one to offer.
const ranked = page.today?.version ?? null
const game = ranked === null ? null : await loadGame(ranked)

playButton.onclick = () => {
  if (game === null) return
  const played = playRun(stage, {
    client: platform,
    game, // loaded above
    mode: "ranked", // or "practice", with page.practiceVersion loaded
    title: page.game.title,
    onState: (state) => show(state), // loading, playing, submitting, replaying, done, failed
    onNotice: (notice) => tell(notice.detail), // a blocked controller, a refused mouse lock
  })
  // played.end() when the player leaves; played.destroy() before the next run
}
```

`loadGame` imports the module from its absolute `presentUrl` and checks it
before anything is played: its contract, its parts, that its manifest hash is
the version's, its own check of its mapping, and that no script on the page
replaced a built-in the rules code calls. The version names its files folder
too, `filesUrl`, and the loaded game hands it to the module with every run,
so the page never names one. Load it before the click, so a failure spends no
run.

`playRun` runs inside the click. When the game reads tilt it asks for it
first, before anything is awaited. Any answer but a grant fails the run
before the platform is asked for one, with the engine's own code for it
(`E_MOTION_DENIED` and the four after it under Codes below), and `detail` is
a sentence that tells the player what happened and what to do: show it. A
game that reads tilt therefore starts no run on a device or in a browser
without it, a laptop included, even when it maps keys too.

Once tilt is granted, `playRun` gets the game ready in `stage`, its
presentation drawing and its start packs fetched, and only then asks the
platform for the run, so a device the game cannot draw on spends no run: it
fails with `E_PRESENTATION_FAILED`, and a pack that did not arrive with the
engine's code for it. A run has no step limit; it goes until the game ends
it or the player leaves. Its inputs come from the player's devices alone: an
event a script on the page made is not recorded. A resumed run plays the
version it started on, and when that is not the module the page loaded,
`playRun` loads the run's own. When that one reads
tilt the click did not ask for, the run stops with `E_MOTION_NEEDS_TAP`
having sent nothing; call `playRun` again with `played.game` from the next
tap and the same run carries on. It moves focus to `stage`, labelled with
`title`, so a key the game maps reaches the game rather than the Play button.

`stage` is the element the game fills. The widgets take their colours from
`--gb-widget-*` custom properties.

`onNotice` is required when the game's mapping reads a controller or locks
the mouse, because a browser can block either and the player has to be told.
Without it the run fails with the engine's `E_ARG_INVALID` before a tick.

A failed state carries `errorCode` and `detail`. For a refusal from the
platform it also carries `refusalDetail`, the platform's own detail, which is
where a page finds when a bar ends: `refusalDetail.until` for
`E_PLAYER_BARRED`. On `E_RANKED_PAUSED`, offer practice and read
`platform.game()` again before the next Play, because a newer patch may have
ended the pause.

The page's Content-Security-Policy has to let the game's code in and keep
every other game's out. Name your game's own path on the platform's bundles
origin, never the whole origin, the API in `connect-src`, and the sign-in in
`frame-src`, without which the sign-in's box stays empty:

```
script-src 'self' https://files.vbz.gg/g/<game id>/; connect-src 'self' https://api.vbz.gg;
frame-src https://signin.vbz.gg
```

No `unsafe-eval` is needed, and none should be added. A game that compiles
WebAssembly adds `'wasm-unsafe-eval'` to `script-src`, one that starts
workers, as pixi.js 8 does, adds `worker-src blob:` and its path, and one
that fetches files of its folder adds its path to `connect-src`; `pageCsp` in
`@vbz-gg/sdk/harness` builds the policy from what the game names it needs,
and `references/files.md` has each need.
`vbz dev --site` serves a ranked page under that policy, against a stand-in
for the platform; `references/harness.md` says what the stand-in does.

`watchRun(stage, { client: platform, runId })` reads a settled run, loads its
own version's module and replays it to where the platform's replay stopped.
A run from a day still open can be watched only by its own player. To anybody
else, as for a run that does not exist or has not settled, the platform
answers `E_NOT_FOUND`, and so does the result of a run that is not the
player's.

`Run`, which `playRun` drives, holds the rules a page would otherwise get
wrong:

- The module must report the run's manifest hash before a tick runs, or the
  run fails with `E_WRONG_GAME`.
- A chunk goes every two seconds of play, and each ends at the last complete
  tick: one short of the last tick the game reported while the run plays, the
  end tick once it has ended. A chunk over the run's `limits.chunkBytes` is
  cut between ticks, and each piece carries the checkpoints of its own ticks.
- A chunk or a submit that got no answer, or that the platform or a proxy in
  front of it failed with a 5xx, goes again, unchanged. After a refusal
  nothing more is sent.
- A failure is final: nothing more is sent, and the state stays `failed`.
- Every piece is held to `limits.runBytes` before it is sent, with one
  chunk's room kept for the last commit. A run about to eat into that room
  ends as if the player left. One whose next piece would not fit at all is
  not submitted, and the platform settles it from what it committed.
- The last chunk reaches the platform before the recording.
- After the submit it waits for the replay, and `done` carries the result:
  what the replay computed, never what the page showed.
- From the click until the platform has the run, the page holds a Web Lock
  named for the game and the mode, taken before the run is asked for. A
  second tab of the same game and mode stops with `E_RUN_OPEN_ELSEWHERE`
  having started nothing, which keeps it from closing the first tab's run. A
  browser with no Web Locks starts nothing and stops with
  `E_BROWSER_UNSUPPORTED`.

A run can also fail with one of the engine's own codes, such as
`E_ARG_INVALID` for a mapping the engine refuses, when the module reports one.

## Codes

A `PlatformClientError` is the code `playLocal`, `loadGame` and, on
vbz.gg, the client and `playRun` fail with. A `PlatformRefusal`, which only a
page playing on vbz.gg meets, carries the platform's own code, from
`PublicRefusalCode` in `@vbz-gg/sdk/api`. The client's codes:

| Code | What it means |
|---|---|
| `E_SIGNIN_CANCELLED` | The sign-in's box was closed before a player signed in: its Cancel button, Escape, or the page's `closeSignIn()`. `mountSignIn` shows nothing for it. |
| `E_SIGNIN_UNREACHABLE` | A page of the sign-in, the first or a later step, did not say it loaded in its box within 15 seconds of loading, or the `signInReadyMs` the client was made with. The browser refused to frame it, which it shows as an empty box and tells the page nothing of: the page's policy has no `frame-src` naming the sign-in origin, the page is shown inside another page whose origin is not its own, the page key is not the game's, or the page's origin is not one the game allows. `vbz dev --site` says in its terminal which, for the stand-in's sign-in. |
| `E_NOT_SIGNED_IN` | A run route, and no player is signed in on this page. Nothing was sent. |
| `E_UNREACHABLE` | No answer. The request may or may not have arrived; a run write can be sent again. |
| `E_ANSWER_UNREADABLE` | An answer that is not JSON, or a failure without a code. |
| `E_GAME_UNLOADABLE` | The page module did not load from its address: the network, the page's Content-Security-Policy, or an address that is not https. The `detail` names the address. Chromium, Firefox and WebKit all keep a failed load for the life of the page, so loading it again fails at once: reload the page to try again. |
| `E_GAME_MODULE_INVALID` | What the module exports is not a page module, or its own check found its parts disagree. The `detail` names the field. |
| `E_GAME_CONTRACT_UNKNOWN` | The module was built with a newer `@vbz-gg/sdk` than the page's. Update the page's. |
| `E_CAPTURE_INVALID` | The game's input mapping names an input or a device its manifest does not allow. |
| `E_PAGE_ALTERS_BUILTINS` | A script on the page replaced a built-in the rules code calls, so the page would play a different game from the one the platform replays. The `detail` names it. |
| `E_WRONG_GAME` | The page module is another version of the game than the one the run plays. |
| `E_TICK_RATE_UNSUPPORTED` | The run's tick rate is not 30, 60 or 120. |
| `E_MOTION_NEEDS_TAP` | The run's own module reads tilt and the click did not ask for it. Call `playRun` again with `played.game` from the next tap. |
| `E_MOTION_DENIED` | The game reads tilt and the player did not allow it, or it was asked outside a tap. No run was started. iOS remembers the refusal and answers every later request with it without asking, until the site's data is cleared in the browser's settings, which the sentence tells the player. |
| `E_MOTION_NO_SENSOR` | The game reads tilt and no reading arrived: a laptop or a desktop, or a device whose browser keeps its sensors from the site. No run was started. |
| `E_MOTION_UNSUPPORTED` | The game reads tilt and the browser has no orientation events, or cannot say which way its screen is turned. No run was started. |
| `E_MOTION_INSECURE` | The game reads tilt and the page is not https, or localhost, so the browser gives it no sensor. No run was started. |
| `E_MOTION_BLOCKED` | The game reads tilt and the page's own `Permissions-Policy` forbids `accelerometer` or `gyroscope`. No run was started; the page has to allow both. |
| `E_BROWSER_UNSUPPORTED` | The browser has no Web Locks, so it cannot keep a run to one tab: Safari before 15.4, or a page not on https. Nothing was started. |
| `E_RUN_OPEN_ELSEWHERE` | Another tab or window of this browser is playing this game in this mode. Nothing was started. |
| `E_NOTHING_TO_WATCH` | The run's replay covers no ticks. |
| `E_LOCAL_PLAY_UNSUPPORTED` | `playLocal` was handed a module built by a release from before local play, which cannot say its tick rate or its config and stops every run at its manifest's step limit. Build the game again. |
| `E_CONFIG_REQUIRED` | `playLocal` was given no config, and the game declares a setting that is required and has no default, so there is none to serve. Give it one. |
| `E_PRESENTATION_FAILED` | The engine's code for a game that cannot draw on this device, such as a renderer that finds no GPU it can use. The game gets ready before a run is asked for, so no run was started. |
| `E_UNEXPECTED` | An error the client has no code for, or a game error without a code. It is a bug; report the `detail`. |
