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
  apiOrigin: API_ORIGIN, // from vbz.gg
  signInOrigin: SIGN_IN_ORIGIN, // from vbz.gg
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
  })
  // played.end() when the player leaves; played.destroy() before the next run
}
```

`loadGame` imports the module from its absolute `presentUrl` and checks it
before anything is played: its contract, its parts, that its manifest hash is
the version's, its own check of its mapping, and that no script on the page
replaced a built-in the rules code calls. Load it before the click, so a
failure spends no run.

`playRun` runs inside the click. When the game reads tilt it asks for it
first, before anything is awaited, then starts the run. A resumed run plays
the version it started on, and when that is not the module the page loaded,
`playRun` loads the run's own. When that one reads tilt the click did not ask
for, the run stops with `E_MOTION_NEEDS_TAP` having sent nothing; call
`playRun` again with `played.game` from the next tap and the same run carries
on. It moves focus to `stage`, labelled with `title`, so a key the game maps
reaches the game rather than the Play button.

`stage` is the element the game fills. The widgets take their colours from
`--gb-widget-*` custom properties.

`watchRun(stage, { client: platform, runId })` reads a settled run, loads its
own version's module and replays it to where the platform's replay stopped.

`Run`, which `playRun` drives, holds the rules a page would otherwise get
wrong:

- The module must report the run's manifest hash before a tick runs, or the
  run fails with `E_WRONG_GAME`.
- A chunk goes every two seconds of play, and each ends at the last complete
  tick: one short of the last tick the game reported while the run plays, the
  end tick once it has ended. A chunk over the run's `limits.chunkBytes` is
  cut between ticks.
- A chunk or a submit that got no answer, or that the platform or a proxy in
  front of it failed with a 5xx, goes again, unchanged. After a refusal
  nothing more is sent.
- A failure is final: nothing more is sent, and the state stays `failed`.
- A run about to reach `limits.runBytes` ends as if the player left.
- The last chunk reaches the platform before the recording.
- After the submit it waits for the replay, and `done` carries the result:
  what the replay computed, never what the page showed.
- While a run plays its page holds a Web Lock named after it, so a second
  tab handed the same run stops with `E_RUN_OPEN_ELSEWHERE`.

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
| `E_GAME_UNLOADABLE` | The page module did not load from its address: the network, the page's Content-Security-Policy, or an address that is not https. The `detail` names the address. |
| `E_GAME_MODULE_INVALID` | What the module exports is not a page module, or its own check found its parts disagree. The `detail` names the field. |
| `E_GAME_CONTRACT_UNKNOWN` | The module was built with a newer `@vbz-gg/sdk` than the page's. Update the page's. |
| `E_CAPTURE_INVALID` | The game's input mapping names an input or a device its manifest does not allow. |
| `E_PAGE_ALTERS_BUILTINS` | A script on the page replaced a built-in the rules code calls, so the page would play a different game from the one the platform replays. The `detail` names it. |
| `E_WRONG_GAME` | The page module is another version of the game than the one the run plays. |
| `E_TICK_RATE_UNSUPPORTED` | The run's tick rate is not 30, 60 or 120. |
| `E_MOTION_NEEDS_TAP` | The run's own module reads tilt and the click did not ask for it. Call `playRun` again with `played.game` from the next tap. |
| `E_RUN_OPEN_ELSEWHERE` | Another tab or window of this browser is playing the same run. |
| `E_NOTHING_TO_WATCH` | The run's replay covers no ticks. |
| `E_SIM_PACKS` | The manifest declares a data pack the simulation reads. The platform cannot store or replay one yet, and refuses such an upload too. |
| `E_UNEXPECTED` | An error the client has no code for, or a game error without a code. It is a bug; report the `detail`. |
