/**
 * Signing a player in through the box `signIn()` puts over a studio's page,
 * which holds the stand-in's sign-in in a frame, framed exactly as the
 * platform's is: for the page's exact origin, with the headers that let it
 * render under COOP and COEP, saying it is ready as it loads, and posting
 * the code to the page's origin alone.
 *
 * Each engine decides for itself whether it frames the sign-in, whether the
 * page stays isolated with it, where focus goes and what a refused frame
 * looks like, so this spec runs in every engine the suite has. A run here
 * says what this engine did; the list of what Safari and iOS Safari still
 * have to be checked against by hand is in signin-frame's findings, section
 * 8, and in `docs/sdk.md`.
 */

import { expect, type Page, test } from "@playwright/test"
import { PORTAL_ORIGIN, SIGN_IN_HOST } from "../src/env"
import { openRuns, signIn, signInFrame } from "../src/studio"

/**
 * Every call a page or a frame makes to `requestStorageAccess`, which
 * nothing in a sign-in should make: a remembered sign-in is kept per site,
 * and the cookie storage access would unlock is one that should not exist.
 */
async function countStorageAccess(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const scope = globalThis as unknown as { vbzStorageAccess?: number }
    scope.vbzStorageAccess = 0
    const proto = Document.prototype as unknown as {
      requestStorageAccess?: () => Promise<void>
    }
    const original = proto.requestStorageAccess
    if (original === undefined) return
    proto.requestStorageAccess = function (this: Document) {
      scope.vbzStorageAccess = (scope.vbzStorageAccess ?? 0) + 1
      return original.call(this)
    }
  })
}

test("a player signs in through the box, and nothing opens a window", async ({
  page,
}) => {
  await countStorageAccess(page)
  const windows: string[] = []
  page.on("popup", (opened) => windows.push(opened.url()))
  await openRuns(page, "template")

  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Sign in" })
  await expect(dialog).toBeVisible()
  // Focus moved into the frame from the click, which is when a phone opens
  // its keyboard; the sign-in then focuses its own first control.
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(
    "IFRAME",
  )
  const frame = signInFrame(page)
  const continuing = frame.getByRole("button", { name: /Sign in as/ })
  await expect(continuing).toBeVisible()
  await expect(continuing).toBeFocused()
  await continuing.click()

  await expect(page.locator("body")).toHaveAttribute(
    "data-player",
    "Local player",
  )
  await expect(dialog).toHaveCount(0)
  expect(windows).toEqual([])
  expect(
    await page.evaluate(
      () =>
        (globalThis as unknown as { vbzStorageAccess?: number })
          .vbzStorageAccess,
    ),
  ).toBe(0)
})

test("the player closes the box with Cancel, or with Escape inside the sign-in, and is told nothing", async ({
  page,
}) => {
  await openRuns(page, "template")
  const dialog = page.getByRole("dialog", { name: "Sign in" })
  const body = page.locator("body")

  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(
    signInFrame(page).getByRole("button", { name: /Sign in as/ }),
  ).toBeVisible()
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await expect(dialog).toHaveCount(0)
  await expect(body).toHaveAttribute("data-signin", "E_SIGNIN_CANCELLED")

  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  const inside = signInFrame(page).getByRole("button", { name: /Sign in as/ })
  await expect(inside).toBeFocused()
  // Pressed with focus inside the frame, where the page cannot hear it: the
  // sign-in says so.
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await expect(body).toHaveAttribute("data-signin", "E_SIGNIN_CANCELLED")
  await expect(body).toHaveAttribute("data-player", "")
})

/**
 * The box is a modal dialog: the page behind it is inert, so Tab moves
 * among the box's own controls and the sign-in's and never reaches the
 * page's Play button, and Escape with focus in the page is the dialog's
 * cancel, which closes the box with E_SIGNIN_CANCELLED.
 */
test("while the box is up Tab never reaches the page, and Escape in the page closes it", async ({
  page,
}) => {
  await openRuns(page, "template")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Sign in" })
  await expect(
    signInFrame(page).getByRole("button", { name: /Sign in as/ }),
  ).toBeVisible()
  const cancel = dialog.getByRole("button", { name: "Cancel" })
  await cancel.focus()
  const reached: string[] = []
  for (let press = 0; press < 8; press += 1) {
    await page.keyboard.press("Tab")
    reached.push(
      await page.evaluate(() => {
        const at = document.activeElement
        return at === null ? "nothing" : at.id || at.tagName
      }),
    )
  }
  test.info().annotations.push({
    type: "Tab reached, in the page",
    description: JSON.stringify(reached),
  })
  for (const control of ["signin", "play", "end", "watch", "retry", "stage"]) {
    expect(reached).not.toContain(control)
  }
  await cancel.focus()
  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await expect(page.locator("body")).toHaveAttribute(
    "data-signin",
    "E_SIGNIN_CANCELLED",
  )
})

/**
 * A page whose game needs threads is sent with COOP same-origin and COEP.
 * The sign-in sends COEP and CORP on every page it lets be framed, so the
 * box renders and the page stays cross-origin isolated. The sign-in is on
 * another site from the page, `localhost` against `127.0.0.1`, as the
 * platform's is from a studio's page.
 *
 * Whether it rendered is read from the page's side: the sign-in's own
 * ready message reaching the page, from the sign-in's origin. That much
 * every engine is measured on. Playwright 1.56.1 cannot drive the frame in
 * Firefox 142 here: it lists the frame as `about:blank` and its clicks do
 * not reach it, measured on this suite while the same frame posted its
 * ready and the page stayed isolated, as signin-frame's findings measured
 * on other origins. So signing the player in through it is measured in the
 * other engines.
 */
async function hearMessages(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const heard: string[] = []
    ;(globalThis as unknown as { vbzHeard: string[] }).vbzHeard = heard
    window.addEventListener("message", (event) => {
      const data = event.data as { type?: unknown } | null
      heard.push(`${event.origin} ${String(data?.type)}`)
    })
  })
}

async function heard(page: Page): Promise<string[]> {
  return await page.evaluate(
    () => (globalThis as unknown as { vbzHeard: string[] }).vbzHeard,
  )
}

test("under COOP and COEP, the sign-in from another site renders in the box, and the page stays isolated", async ({
  page,
}) => {
  await hearMessages(page)
  await openRuns(page, "template", { isolate: "1" })
  expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page.getByRole("dialog", { name: "Sign in" })).toBeVisible()
  // Two sites: the page on 127.0.0.1, the sign-in on localhost.
  expect(new URL(page.url()).hostname).toBe("127.0.0.1")
  const fromTheSignIn = (line: string) =>
    line.endsWith(" vbz.signin.ready") &&
    new URL(line.split(" ")[0] ?? "").hostname === SIGN_IN_HOST
  await expect
    .poll(async () => (await heard(page)).some(fromTheSignIn))
    .toBe(true)
  expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true)
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click()
  await expect(page.locator("body")).toHaveAttribute(
    "data-signin",
    "E_SIGNIN_CANCELLED",
  )
})

test("under COOP and COEP, a player signs in through the sign-in from another site", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === "firefox",
    "Playwright 1.56.1 cannot reach a cross-origin frame in Firefox 142 under COOP and COEP: it lists it as about:blank and its clicks do not reach it, measured while that frame rendered and posted its ready",
  )
  await openRuns(page, "template", { isolate: "1" })
  await signIn(page)
  expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true)
})

/**
 * Under `default-src 'none'` with no `frame-src` the frame is never asked
 * for. The browser shows an empty box and tells the page nothing, so the
 * sign-in's ready message never comes, and the box gives up with
 * `E_SIGNIN_UNREACHABLE` in the client's sentence for a studio.
 */
test("a page whose policy has no frame-src gets E_SIGNIN_UNREACHABLE, and asks the sign-in nothing", async ({
  page,
}) => {
  const asked: string[] = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/authorize")
      asked.push(request.url())
  })
  await openRuns(page, "template", { frames: "none" })
  // Whether the refused frame fires `load` or `error` is the engine's to
  // decide, and decides nothing: the box waits for the sign-in's own word
  // either way. Heard from the moment the box's frame is on the page.
  await page.evaluate(() => {
    const heard: string[] = []
    ;(globalThis as unknown as { vbzFrameEvents: string[] }).vbzFrameEvents =
      heard
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          const frame = (node as Element).querySelector?.("iframe")
          frame?.addEventListener("load", () => heard.push("load"))
          frame?.addEventListener("error", () => heard.push("error"))
        }
      }
    }).observe(document.body, { childList: true })
  })
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Sign in" })
  await expect(dialog).toBeVisible()
  await expect(page.locator("body")).toHaveAttribute(
    "data-signin",
    "E_SIGNIN_UNREACHABLE",
  )
  test.info().annotations.push({
    type: "a frame the policy refused fired",
    description: JSON.stringify(
      await page.evaluate(
        () =>
          (globalThis as unknown as { vbzFrameEvents: string[] })
            .vbzFrameEvents,
      ),
    ),
  })
  await expect(dialog).toHaveCount(0)
  await expect(page.locator("#state")).toContainText(
    "frame-src naming the sign-in origin",
  )
  expect(asked).toEqual([])
  const violations = JSON.parse(
    (await page.locator("#violations").textContent()) ?? "[]",
  ) as Array<{ directive: string }>
  expect(violations.map((violation) => violation.directive)).toContain(
    "frame-src",
  )
})

/**
 * Every page the frame shows owes a ready, not only the first. Here the
 * first renders and says so, and its Continue posts a request the sign-in
 * cannot check, which it answers with a page framed for nobody: the
 * browser refuses to show it and fires `load` all the same, and the box
 * gives up rather than leaving the player in front of an empty frame.
 */
test("a later page of the sign-in the browser will not show gets E_SIGNIN_UNREACHABLE", async ({
  page,
}) => {
  await openRuns(page, "template")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  const frame = signInFrame(page)
  const continuing = frame.getByRole("button", { name: /Sign in as/ })
  await expect(continuing).toBeVisible()
  // A form whose state was lost: the sign-in refuses it, framed for nobody.
  await frame
    .locator('input[name="state"]')
    .evaluate((input) => input.setAttribute("value", ""))
  await continuing.click()
  await expect(page.locator("body")).toHaveAttribute(
    "data-signin",
    "E_SIGNIN_UNREACHABLE",
  )
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.locator("body")).toHaveAttribute("data-player", "")
})

/**
 * The sign-in frames for the exact origin that asked, and a browser holds
 * every ancestor to `frame-ancestors`, not only the parent, and each by its
 * exact origin. A studio's page shown inside a portal's page asks for the
 * sign-in, gets it, and the browser refuses to show it, so the box gives up
 * as it does for a page that names no `frame-src`. The portal here is
 * another origin on the same site as the studio's page, 127.0.0.1 on
 * another port, so being the same site saves nothing. That is a cost of the
 * exact-origin rule, and this is it measured.
 */
test("a studio's page shown inside a page of another origin cannot show the sign-in, and says so", async ({
  page,
}) => {
  const asked: string[] = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/authorize")
      asked.push(request.url())
  })
  await page.goto(`${PORTAL_ORIGIN}/?game=template`)
  const studio = page.frameLocator('iframe[title="The game"]')
  await expect(studio.locator("body")).toHaveAttribute("data-loaded", "ready")
  await studio.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(studio.locator("body")).toHaveAttribute(
    "data-signin",
    "E_SIGNIN_UNREACHABLE",
  )
  // Asked for, and refused by the browser: the portal is not the origin the
  // sign-in frames for.
  expect(asked).toHaveLength(1)
  await expect(studio.locator("body")).toHaveAttribute("data-player", "")
})
