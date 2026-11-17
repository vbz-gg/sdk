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
 * A page whose game needs threads is sent with COOP same-origin and COEP.
 * The sign-in sends COEP and CORP on every page it lets be framed, so the
 * box renders and the page stays cross-origin isolated.
 */
test("a page sent with COOP and COEP signs a player in, and stays isolated", async ({
  page,
}) => {
  await openRuns(page, "template", { isolate: "1" })
  expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true)
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
  test.setTimeout(60_000)
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
    { timeout: 20_000 },
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
