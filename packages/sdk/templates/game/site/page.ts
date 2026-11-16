/**
 * The game's page: sign-in, Play, Practice and today's board.
 *
 * This is a studio's page in miniature, and every part of it is the SDK's:
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
 */

import type { PageGame, PageGameVersion, RunMode } from "@vbz-gg/sdk/api"
import {
  type LoadedGame,
  loadGame,
  mountBoard,
  mountSignIn,
  type PlayedRun,
  playRun,
} from "@vbz-gg/sdk/host"
import {
  type PlatformClient,
  type PlatformClientOptions,
  RUN_PHASE,
  type RunState,
} from "@vbz-gg/sdk/platform"
import {
  NO_ROUND_TODAY,
  pausedMessage,
  SIGN_IN_FIRST,
  stateMessage,
} from "./messages"

/** What `config.json` beside the page says: where the platform is, and the game's key. */
export type SiteConfig = Pick<
  PlatformClientOptions,
  "apiOrigin" | "signInOrigin" | "pageKey"
>

/**
 * `config.json`, held to what a client needs. The template ships it with the
 * platform's API and sign-in window and no page key, so a page deployed
 * without the game's key says which file to fill in rather than calling the
 * API with nothing.
 */
export function readConfig(value: unknown): SiteConfig {
  const config = (value ?? {}) as Record<string, unknown>
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
  return { apiOrigin, signInOrigin, pageKey: pageKey as SiteConfig["pageKey"] }
}

export interface SiteOptions {
  readonly document: Document
  readonly client: Pick<
    PlatformClient,
    | "pageKey"
    | "game"
    | "player"
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
