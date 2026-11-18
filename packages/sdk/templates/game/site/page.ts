/**
 * The game's page, in either of the two modes `config.json` names.
 *
 * Played locally, the default, it is the game and a Play button: `playLocal`
 * plays the build `vbz build` wrote, served beside the page as `game/`, and
 * nothing talks to anybody. Ranked, on vbz.gg, it is sign-in, Play,
 * Practice and today's board against the platform, and the build is the
 * same one.
 *
 * Ranked, this is a studio's page in miniature, and every part of it is the SDK's:
 * `loadGame` imports the game's page module before a click, `playRun` starts
 * a run inside the click and plays it, and the two widgets sign a player in
 * and show the board. The platform says which version each run plays; the
 * page loads what `GET /v1/game` names and never chooses.
 *
 * Two days a page has to handle. When the day's ranked play is paused, a
 * ranked start answers `E_RANKED_PAUSED`; the page says so, offers practice,
 * and reads the game again on every Play, so the first Play after a newer
 * patch passes its checks is a ranked run again. When the player is barred,
 * a start answers `E_PLAYER_BARRED`, and the page says when the bar ends.
 *
 * A player's sign-in can stop working while the page is open: it expires,
 * or the platform no longer honours it. The client then forgets the player,
 * and the sign-in box follows the client by itself, so it shows nobody
 * signed in, and Play asks the player to sign in again.
 *
 * A game that reads tilt starts no run without it. `playRun` fails the run
 * before asking the platform for one, and the page shows the client's own
 * sentence, which tells the player what happened and what to do.
 */

import type { PageGame, PageGameVersion, RunMode } from "@vbz-gg/sdk/api"
import {
  type LoadedGame,
  type LocalRun,
  loadGame,
  localAddress,
  mountBoard,
  mountSignIn,
  type PlayedRun,
  playLocal,
  playRun,
} from "@vbz-gg/sdk/host"
import {
  type PlatformClient,
  type PlatformClientOptions,
  RUN_PHASE,
  type RunState,
} from "@vbz-gg/sdk/platform"
import {
  endedMessage,
  NO_ROUND_TODAY,
  pausedMessage,
  SIGN_IN_FIRST,
  stateMessage,
} from "./messages"

/** Ranked play: where the platform is, and the game's key. */
export type RankedConfig = { readonly mode: "ranked" } & Pick<
  PlatformClientOptions,
  "apiOrigin" | "signInOrigin" | "pageKey"
>

/**
 * What `config.json` beside the page says. Its mode is named, never worked
 * out from what else the file holds: `local`, which the template ships, or
 * `ranked`, which needs the platform's addresses and the game's page key.
 */
export type SiteConfig = { readonly mode: "local" } | RankedConfig

/** Where a page playing locally finds the build: `dist/` served as `game/`. */
export const LOCAL_BUILD = "game/game.json"

/**
 * `config.json`, held to what its mode needs. A file naming no mode, or
 * naming ranked play with no page key, says which file to fill in rather
 * than calling the API with nothing.
 */
export function readConfig(value: unknown): SiteConfig {
  const config = (value ?? {}) as Record<string, unknown>
  if (config.mode === "local") return { mode: "local" }
  if (config.mode !== "ranked") {
    throw new Error(
      'site/config.json names its mode: "local", to play with no platform, or "ranked", with apiOrigin, signInOrigin and the game\'s pageKey',
    )
  }
  const { apiOrigin, signInOrigin, pageKey } = config
  if (
    typeof apiOrigin !== "string" ||
    apiOrigin === "" ||
    typeof signInOrigin !== "string" ||
    signInOrigin === "" ||
    typeof pageKey !== "string" ||
    !pageKey.startsWith("vbz_pk_")
  ) {
    throw new Error(
      "site/config.json needs the game's pageKey from the dashboard, beside apiOrigin and signInOrigin",
    )
  }
  return {
    mode: "ranked",
    apiOrigin,
    signInOrigin,
    pageKey: pageKey as RankedConfig["pageKey"],
  }
}

export interface LocalSiteOptions {
  readonly document: Document
  /** For a test: the browser's by default. */
  readonly fetch?: (url: string) => Promise<Response>
  readonly load?: typeof loadGame
  readonly play?: typeof playLocal
}

export interface LocalSite {
  /** Settles once the game is loaded, or has said why it is not. */
  readonly ready: Promise<void>
}

/**
 * The page played locally: the build beside it, loaded before the click,
 * and Play starting a local run in the click. There is no sign-in, no
 * practice and no board, and nothing is sent anywhere.
 */
export function startLocalSite(options: LocalSiteOptions): LocalSite {
  const { document } = options
  const load = options.load ?? loadGame
  const play = options.play ?? playLocal
  const read = options.fetch ?? ((url: string) => fetch(url))
  const title = element(document, "title")
  const stage = element(document, "game")
  const message = element(document, "message")
  const playButton = element(document, "play") as HTMLButtonElement
  // What only ranked play has.
  for (const id of ["signin", "practice", "board"]) {
    const part = element(document, id)
    const holder = part.closest("section") ?? part
    holder.hidden = true
  }
  const say = (text: string) => {
    message.textContent = text
  }

  let game: LoadedGame | null = null
  let name = "Game"
  let played: LocalRun | null = null
  playButton.disabled = true

  const ready = (async () => {
    try {
      const url = new URL(LOCAL_BUILD, document.baseURI).href
      const build = (await (await read(url)).json()) as { name?: unknown }
      if (typeof build.name === "string" && build.name !== "") {
        name = build.name
      }
      game = await load(localAddress(build, url))
      title.textContent = name
      playButton.disabled = false
    } catch (error) {
      say(error instanceof Error ? error.message : String(error))
    }
  })()

  // Inside the click, which is what lets `playLocal` ask for tilt.
  playButton.addEventListener("click", () => {
    if (game === null) return
    played?.destroy()
    stage.replaceChildren()
    say("")
    try {
      played = play(stage, {
        game,
        // A local run takes its inputs from the player's devices, as a
        // ranked one does.
        scripted: "ignore",
        title: name,
        onEnded: (ended) => say(endedMessage(ended)),
        onError: (error) => say(error.message),
        onNotice: (notice) => say(notice.detail),
      })
    } catch (error) {
      say(error instanceof Error ? error.message : String(error))
    }
  })

  return { ready }
}

/** The page against the platform, for ranked and practice runs. */
export interface SiteOptions {
  readonly document: Document
  readonly client: Pick<
    PlatformClient,
    | "pageKey"
    | "game"
    | "player"
    | "onPlayerChange"
    | "signIn"
    | "signOut"
    | "board"
    | "startRun"
    | "sendChunk"
    | "submit"
    | "awaitResult"
  >
  /** For a test: the SDK's own by default. */
  readonly load?: typeof loadGame
  readonly play?: typeof playRun
  readonly formatTime?: (time: Date) => string
}

export interface Site {
  /** Reads the game again and loads what it names. */
  readGame(): Promise<void>
}

function element(document: Document, id: string): HTMLElement {
  const found = document.getElementById(id)
  if (found === null) throw new Error(`the page has no #${id}`)
  return found
}

export function startSite(options: SiteOptions): Site {
  const { document, client } = options
  const load = options.load ?? loadGame
  const play = options.play ?? playRun
  const title = element(document, "title")
  const stage = element(document, "game")
  const message = element(document, "message")
  const playButton = element(document, "play")
  const practiceButton = element(document, "practice")

  const say = (text: string) => {
    message.textContent = text
  }

  const board = mountBoard(element(document, "board"), {
    client,
    period: "day",
  })
  mountSignIn(element(document, "signin"), {
    client,
    onChange: () => {
      say("")
      void board.refresh().catch(() => {})
    },
  })

  let page: PageGame | null = null
  let ranked: LoadedGame | null = null
  let practice: LoadedGame | null = null
  /** The module a run that needs a second tap plays, and in which mode. */
  let again: { readonly mode: RunMode; readonly game: LoadedGame } | null = null
  let played: PlayedRun | null = null
  const loaded = new Map<string, LoadedGame>()

  const practiceOpen = () =>
    page?.game.practice === true && page.practiceVersion !== null

  /** Each module once: a version the page already loaded is the same module. */
  async function loadOnce(
    version: PageGameVersion | null,
  ): Promise<LoadedGame | null> {
    if (version === null) return null
    const known = loaded.get(version.presentUrl)
    if (known !== undefined) return known
    try {
      const game = await load(version)
      loaded.set(version.presentUrl, game)
      return game
    } catch (error) {
      say(error instanceof Error ? error.message : String(error))
      return null
    }
  }

  async function readGame(): Promise<void> {
    let read: PageGame
    try {
      read = await client.game()
    } catch (error) {
      say(error instanceof Error ? error.message : String(error))
      return
    }
    page = read
    title.textContent = read.game.title
    document.title = read.game.title
    ranked = await loadOnce(read.today?.version ?? null)
    practice = read.game.practice ? await loadOnce(read.practiceVersion) : null
    practiceButton.hidden = !read.game.practice
    // Play stays pressable with nothing loaded: a press reads the game
    // again, which is how a page finds the day's ranked play resumed.
    if (read.today === null) say(NO_ROUND_TODAY)
    else if (read.today.ranked === "paused") say(pausedMessage(practiceOpen()))
  }

  function start(mode: RunMode): void {
    if (client.player() === null) {
      say(SIGN_IN_FIRST)
      return
    }
    // A ranked run on a paused day can still be asked for: the platform may
    // have a newer patch by now, and says so with the run it starts.
    const game =
      again?.mode === mode
        ? again.game
        : mode === "ranked"
          ? (ranked ?? practice)
          : practice
    again = null
    // Read again on every Play, so what the next one loads is current.
    void readGame()
    if (game === null) return
    played?.destroy()
    stage.replaceChildren()
    const current = play(stage, {
      client,
      game,
      mode,
      title: page?.game.title ?? "Game",
      onState: (state: RunState) => {
        say(
          stateMessage(state, {
            practiceOpen: practiceOpen(),
            ...(options.formatTime === undefined
              ? {}
              : { formatTime: options.formatTime }),
          }),
        )
        if (state.errorCode === "E_MOTION_NEEDS_TAP") {
          again = { mode, game: current.game }
        }
        if (state.phase === RUN_PHASE.DONE) {
          void board.refresh().catch(() => {})
        }
      },
      onNotice: (notice) => say(notice.detail),
    })
    played = current
  }

  // Each runs inside the click, which is what lets `playRun` ask for tilt.
  playButton.addEventListener("click", () => start("ranked"))
  practiceButton.addEventListener("click", () => start("practice"))

  void board.refresh().catch(() => {})
  void readGame()
  return { readGame }
}
