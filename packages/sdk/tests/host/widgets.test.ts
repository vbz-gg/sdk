/**
 * The two widgets, against a document: the sign-in button opens the box in
 * the click, says why when it did not work, and follows the client's
 * player, and the board table shows the board the platform answered, the
 * reader's own row included.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import type { Board, BoardRow } from "../../src/api/index"
import { mountBoard, mountSignIn } from "../../src/host/widgets"
import { mountSignInBox } from "../../src/platform/box"
import {
  type BoardOptions,
  createPlatformClient,
} from "../../src/platform/client"
import {
  CLIENT_ERROR,
  PlatformClientError,
  PlatformRefusal,
} from "../../src/platform/errors"
import { FakePage, settle as settlePage } from "../platform/fake-page"

beforeAll(() => {
  GlobalRegistrator.register()
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

let place: HTMLElement

beforeEach(() => {
  document.body.replaceChildren()
  place = document.createElement("div")
  document.body.append(place)
})

type Player = { readonly id: string; readonly displayName: string }

/**
 * A client whose sign-in answers when the test says. It tells nobody when
 * its player changes, so what the widget draws after its own clicks is the
 * widget's own doing.
 */
function signInClient(start: Player | null = null) {
  let player = start
  let answer: { resolve: (p: Player) => void; reject: (e: unknown) => void } = {
    resolve: () => {},
    reject: () => {},
  }
  const calls: string[] = []
  let following = 0
  return {
    calls,
    following: () => following,
    finish: (next: Player) => {
      player = next
      answer.resolve(next)
    },
    fail: (error: unknown) => answer.reject(error),
    client: {
      player: () => player,
      onPlayerChange: () => {
        following += 1
        return () => {
          following -= 1
        }
      },
      signIn: () => {
        calls.push("signIn")
        return new Promise<Player>((resolve, reject) => {
          answer = { resolve, reject }
        })
      },
      signOut: () => {
        calls.push("signOut")
        player = null
      },
    },
  }
}

const button = () => place.querySelector("button") as HTMLButtonElement

/** The sign-in, from the box's frame: loaded, then handing over a code. */
function handOff(page: FakePage, signInOrigin: string): void {
  const state = new URL(page.box?.url ?? "").searchParams.get("state")
  for (const data of [
    { type: "vbz.signin.ready", state },
    { type: "vbz.signin", code: "c", state },
  ]) {
    page.post({ origin: signInOrigin, source: page.box?.frame, data })
  }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("the sign-in button", () => {
  test("opens the box in the click, and shows the player once signed in", async () => {
    const fake = signInClient()
    const changes: Array<Player | null> = []
    mountSignIn(place, {
      client: fake.client,
      onChange: (player) => changes.push(player),
    })
    expect(button().textContent).toBe("Sign in")

    button().click()
    // In the click's own turn, before anything was awaited.
    expect(fake.calls).toEqual(["signIn"])
    expect(button().disabled).toBe(true)

    fake.finish({ id: "p-1", displayName: "Ada" })
    await settle()
    expect(button().textContent).toBe("Sign out")
    expect(button().disabled).toBe(false)
    expect(place.querySelector(".gb-signin-name")?.textContent).toBe("Ada")
    expect(changes).toEqual([{ id: "p-1", displayName: "Ada" }])
  })

  test("says why when the sign-in did not work, in the client's own words", async () => {
    const fake = signInClient()
    mountSignIn(place, { client: fake.client })
    button().click()
    fake.fail(new PlatformClientError("E_SIGNIN_UNREACHABLE"))
    await settle()
    expect(place.querySelector('[role="status"]')?.textContent).toBe(
      CLIENT_ERROR.E_SIGNIN_UNREACHABLE,
    )
    expect(button().textContent).toBe("Sign in")
    expect(button().disabled).toBe(false)

    // And the next try starts with the old reason gone.
    button().click()
    expect(place.querySelector('[role="status"]')?.textContent).toBe("")
    fake.fail("a string, not an error")
    await settle()
    expect(place.querySelector('[role="status"]')?.textContent).toBe(
      "a string, not an error",
    )
  })

  /** The player closed the box: there is nothing to tell them. */
  test("a sign-in the player closed shows nothing, and the button is back", async () => {
    const fake = signInClient()
    mountSignIn(place, { client: fake.client })
    button().click()
    fake.fail(new PlatformClientError("E_SIGNIN_UNREACHABLE"))
    await settle()
    button().click()
    fake.fail(new PlatformClientError("E_SIGNIN_CANCELLED"))
    await settle()
    expect(place.querySelector('[role="status"]')?.textContent).toBe("")
    expect(button().textContent).toBe("Sign in")
    expect(button().disabled).toBe(false)
  })

  test("signs a signed-in player out, and redraws when told", () => {
    const fake = signInClient({ id: "p-1", displayName: "Ada" })
    const changes: Array<Player | null> = []
    const widget = mountSignIn(place, {
      client: fake.client,
      onChange: (player) => changes.push(player),
    })
    button().click()
    expect(fake.calls).toEqual(["signOut"])
    expect(changes).toEqual([null])
    expect(button().textContent).toBe("Sign in")

    fake.finish({ id: "p-2", displayName: "Grace" })
    widget.update()
    expect(place.querySelector(".gb-signin-name")?.textContent).toBe("Grace")
    expect(fake.following()).toBe(1)
    widget.destroy()
    expect(place.children).toHaveLength(0)
    expect(fake.following()).toBe(0)
  })

  /**
   * A keyboard player: Enter on the button, the box up over the page, then
   * the box closed, by Cancel or by signing in. The box gives focus back to
   * the button while the button is still disabled, which a browser refuses,
   * so the widget puts focus back on its button once it is enabled again,
   * rather than leaving the player at the top of the page.
   */
  test("gives focus back to its button once the box comes down, however it closed", async () => {
    const SIGN_IN = "https://signin.vbz.example"
    const page = new FakePage()
    // The real box, over this document, for a client otherwise scripted,
    // whose frame is told where to go and goes nowhere: what loads in it is
    // the browser suite's question.
    let pointed = ""
    page.mountSignInBox = (handlers) => {
      const box = mountSignInBox(document, handlers)
      return {
        get frame() {
          return box.frame
        },
        load: (url) => {
          pointed = url
        },
        remove: () => box.remove(),
      }
    }
    const client = createPlatformClient({
      apiOrigin: "https://api.vbz.example",
      signInOrigin: SIGN_IN,
      pageKey: "vbz_pk_widget",
      environment: page,
    })
    mountSignIn(place, { client })
    const frame = () =>
      document.querySelector("dialog iframe") as HTMLIFrameElement | null

    button().focus()
    button().click()
    expect(document.activeElement).toBe(frame())
    ;(document.querySelector("dialog button") as HTMLButtonElement).click()
    await settlePage()
    expect(frame()).toBeNull()
    expect(document.activeElement).toBe(button())
    expect(button().textContent).toBe("Sign in")

    page.answers.push({
      status: 200,
      body: {
        token: "t-1",
        expiresIn: 7_776_000,
        player: { id: "p-1", displayName: "Ada" },
      },
    })
    button().click()
    await settlePage()
    const shown = frame()
    const state = new URL(pointed).searchParams.get("state")
    for (const data of [
      { type: "vbz.signin.ready", state },
      { type: "vbz.signin", code: "c", state },
    ]) {
      page.post({ origin: SIGN_IN, source: shown?.contentWindow, data })
    }
    await settlePage()
    expect(button().textContent).toBe("Sign out")
    expect(document.activeElement).toBe(button())
  })

  /**
   * The page calls nothing: the widget follows the client. A run started
   * with a token the platform no longer honours makes the client forget the
   * player, as a stand-in that restarted and lost the sign-in does, and the
   * box shows nobody signed in, so Play's "sign in first" matches it.
   */
  test("follows the client: a player whose token stopped working shows signed out", async () => {
    const SIGN_IN = "https://signin.vbz.example"
    const page = new FakePage()
    const client = createPlatformClient({
      apiOrigin: "https://api.vbz.example",
      signInOrigin: SIGN_IN,
      pageKey: "vbz_pk_widget",
      environment: page,
    })
    mountSignIn(place, { client })
    page.answers.push({
      status: 200,
      body: {
        token: "t-1",
        expiresIn: 7_776_000,
        player: { id: "p-1", displayName: "Ada" },
      },
    })
    button().click()
    await settlePage()
    handOff(page, SIGN_IN)
    await settlePage()
    expect(button().textContent).toBe("Sign out")
    expect(place.querySelector(".gb-signin-name")?.textContent).toBe("Ada")

    page.answers.push({
      status: 401,
      body: { error: "E_SIGN_IN_REQUIRED", message: "sign in" },
    })
    await client.startRun().catch(() => {})
    expect(button().textContent).toBe("Sign in")
    expect(place.querySelector(".gb-signin-name")?.hasAttribute("hidden")).toBe(
      true,
    )

    // And a sign-out the page makes itself, with no widget click.
    page.answers.push({
      status: 200,
      body: {
        token: "t-2",
        expiresIn: 7_776_000,
        player: { id: "p-1", displayName: "Ada" },
      },
    })
    button().click()
    await settlePage()
    handOff(page, SIGN_IN)
    await settlePage()
    expect(button().textContent).toBe("Sign out")
    client.signOut()
    expect(button().textContent).toBe("Sign in")
  })
})

const row = (rank: number, name: string, score: number): BoardRow => ({
  rank,
  playerId: `p-${name}`,
  displayName: name,
  counters: { score, ticks: 100 * rank },
  day: "2026-11-12",
  sessionId: `s-${name}`,
  version: "1.2.0",
})

const BOARD: Board = {
  gameId: "g-1",
  period: "day",
  from: "2026-11-12",
  to: "2026-11-13",
  total: 3,
  rows: [row(1, "Ada", 30), row(2, "Grace", 20)],
  you: row(2, "Grace", 20),
  rankBy: ["score", "ticks"],
  tiePolicy: "first",
}

function boardClient(answer: Board | Error) {
  const asked: BoardOptions[] = []
  return {
    asked,
    client: {
      board: async (options?: BoardOptions) => {
        asked.push(options ?? {})
        if (answer instanceof Error) throw answer
        return answer
      },
    },
  }
}

const cells = () =>
  [...place.querySelectorAll("tr")].map((tr) =>
    [...tr.children].map((td) => td.textContent),
  )

describe("the board table", () => {
  test("shows rank, name and each counter the game ranks by, in its order", async () => {
    const fake = boardClient(BOARD)
    const board = mountBoard(place, {
      client: fake.client,
      period: "week",
      limit: 10,
      offset: 20,
      format: (counter, value) =>
        counter === "score" ? `${value} pts` : `${value}`,
    })
    expect(await board.refresh()).toEqual(BOARD)
    expect(fake.asked).toEqual([{ period: "week", limit: 10, offset: 20 }])
    expect(cells()).toEqual([
      ["#", "Player", "score", "ticks"],
      ["1", "Ada", "30 pts", "100"],
      ["2", "Grace", "20 pts", "200"],
    ])
    const mine = place.querySelector('[aria-current="true"]')
    expect(mine?.getAttribute("data-player")).toBe("p-Grace")
  })

  test("shows the reader's own row after the page when it is not on it", async () => {
    const fake = boardClient({ ...BOARD, you: row(40, "Linus", 2) })
    await mountBoard(place, { client: fake.client }).refresh()
    expect(fake.asked).toEqual([{}])
    expect(cells().at(-1)).toEqual(["40", "Linus", "2", "4000"])
    expect(
      place.querySelector('[aria-current="true"]')?.getAttribute("data-player"),
    ).toBe("p-Linus")
  })

  test("leaves a counter a row does not carry empty", async () => {
    const odd = { ...row(1, "Ada", 1), counters: { score: 1 } }
    const fake = boardClient({ ...BOARD, rows: [odd], you: null })
    await mountBoard(place, { client: fake.client }).refresh()
    expect(cells()[1]).toEqual(["1", "Ada", "1", ""])
  })

  test("says so when nobody has a score", async () => {
    const fake = boardClient({ ...BOARD, rows: [], you: null, total: 0 })
    await mountBoard(place, { client: fake.client }).refresh()
    expect(place.querySelector(".gb-board-empty")?.textContent).toBe(
      "Nobody has a score here yet.",
    )
  })

  test("draws only the newest read, and nothing once it is gone", async () => {
    // A read sent when the page loaded that answers after the read sent when
    // a run settled must not put back the board without that run.
    const answers: Array<(board: Board) => void> = []
    const fails: Array<(error: unknown) => void> = []
    const client = {
      board: () =>
        new Promise<Board>((resolve, reject) => {
          answers.push(resolve)
          fails.push(reject)
        }),
    }
    const board = mountBoard(place, { client })
    const older = board.refresh()
    const newer = board.refresh()
    answers[1]?.({ ...BOARD, rows: [row(1, "Newer", 9)], you: null })
    await newer
    answers[0]?.({ ...BOARD, rows: [row(1, "Older", 1)], you: null })
    await older
    expect(cells().at(-1)?.[1]).toBe("Newer")

    // An older read that fails says nothing over the newer table either.
    const stale = board.refresh()
    const fresh = board.refresh()
    answers[3]?.({ ...BOARD, rows: [row(1, "Fresh", 5)], you: null })
    await fresh
    fails[2]?.(new Error("late"))
    await expect(stale).rejects.toThrow("late")
    expect(cells().at(-1)?.[1]).toBe("Fresh")

    const last = board.refresh()
    board.destroy()
    answers[4]?.(BOARD)
    await last
    expect(place.children).toHaveLength(0)
  })

  test("shows the platform's own reason when the board cannot be read", async () => {
    const refusal = new PlatformRefusal(404, {
      error: "E_NO_GAME",
      message: "there is no game for this page key",
    })
    const fake = boardClient(refusal)
    const board = mountBoard(place, { client: fake.client })
    await expect(board.refresh()).rejects.toBe(refusal)
    expect(place.querySelector('[role="status"]')?.textContent).toBe(
      "there is no game for this page key",
    )
    board.destroy()
    expect(place.children).toHaveLength(0)
  })
})
