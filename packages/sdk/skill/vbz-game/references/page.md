# The page: `@vbz-gg/sdk/platform` and `@vbz-gg/sdk/host`

A studio serves its game from a page of its own. The page signs a player in,
loads the game's page module, starts a run, sends the run to the platform as
it goes, submits the recording and reads the board. `@vbz-gg/sdk/platform`
does all of that against the platform's routes, and `@vbz-gg/sdk/host` loads
the module, plays a run through it and adds two widgets. The platform's page
guide, `docs/your-game-page.md` in vbz-gg/platform, is the protocol they
follow.

## The client

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

- `signIn()` opens the sign-in window before it awaits anything, because a
  browser opens one only in the click's own turn. Call it straight from the
  handler.
- The player's token is kept in `localStorage`, one entry per page key, and
  in memory, so a browser that keeps nothing still plays this visit. Every run
  start renews it. A token the platform stops honouring is dropped, and
  `onSignedOut` is told.
- `onPlayerChange(listener)` is told each time the player changes: a
  sign-in, a sign-out, a token refused or found expired. It returns a
  function that stops it. `mountSignIn` follows it, so the box never shows a
  player the client has let go, and the page needs no code for that.
- `signOut()` forgets the player on this page. No route signs a player out;
  the sign-in window's own page does that.

## A run

```ts
import { loadGame, mountBoard, mountSignIn, playRun } from "@vbz-gg/sdk/host"

mountSignIn(signInSlot, { client: platform }) // opens the window in the click
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
first, before anything is awaited. Once tilt is granted it gets the game ready
in `stage`, its presentation drawing and its start packs fetched, and only then
starts the run, so a device the game cannot draw on spends no run: it fails
with `E_PRESENTATION_FAILED`, and a pack that did not arrive with the
engine's code for it. A run has no step limit; it goes until the game ends it
or the player leaves. Its inputs come from the player's devices alone: an
event a script on the page made is not recorded.
Any other answer fails the run before the platform is asked for one, with
the engine's own code for it (`E_MOTION_DENIED` and the four after it under
Codes below), and `detail` is a sentence that tells the player what happened
and what to do: show it. A game that reads tilt therefore starts no run on a
device or in a browser without it, a laptop included, even when it maps keys
too. A resumed run plays the version it started on, and when that is not the
module the page loaded, `playRun` loads the run's own. When that one reads
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
origin, never the whole origin, and the API in `connect-src`:

```
script-src 'self' https://files.vbz.gg/g/<game id>/; connect-src 'self' https://api.vbz.gg
```

No `unsafe-eval` is needed, and none should be added. A game that compiles
WebAssembly adds `'wasm-unsafe-eval'` to `script-src`, one that starts workers
adds `worker-src blob:` and its path, and one that fetches files of its folder
adds its path to `connect-src`; `pageCsp` in `@vbz-gg/sdk/harness` builds the
policy from what the game names it needs. `vbz dev --site`
serves a ranked page under that policy, against a stand-in for the
platform; `references/harness.md` says what the stand-in does.

`playLocal(stage, { game, scripted: "ignore", onEnded })` plays the same
module with no platform at all: no client, no page key, no sign-in and no
request. It plays a fresh seed and the module's served config unless the page
gives others, asks for tilt in the click as `playRun` does, and hands
`onEnded` the recording. Its seed always starts `local:`, so the platform
refuses its recording as one played on a seed no run was issued
(`E_PINNED_MISMATCH`), and the client's `submit` does not take its
`LocalRecording`.

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

A `PlatformRefusal` carries the platform's own code, from `PublicRefusalCode`
in `@vbz-gg/sdk/api`. A `PlatformClientError` is the client's:

| Code | What it means |
|---|---|
| `E_POPUP_BLOCKED` | The browser blocked the sign-in window: `signIn()` ran outside a click, or after an await. |
| `E_SIGNIN_CLOSED` | The window closed without handing a code over. If it closed by itself at once, the page sends `Cross-Origin-Opener-Policy: same-origin`, which cuts it off from the window. |
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
