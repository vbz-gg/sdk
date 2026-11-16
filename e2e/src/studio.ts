/**
 * What a spec does with the suite's studio page: open it, sign the local
 * player in through the stand-in's window, and read what the page sent.
 */

import { expect, type Page, type Request } from "@playwright/test"
import { CONTROL_ORIGIN, STUDIO_ORIGIN, type SubjectName } from "./env"

export interface StudioModule {
  readonly presentUrl: string
  readonly manifestHash: string
  readonly tickHz: number
  readonly maxTicks: number
}

export interface StudioInfo {
  readonly origin: string
  readonly bundlesOrigin: string
  readonly modules: Readonly<Record<string, StudioModule>>
  /** The packed package, unpacked beside the engine, as a studio installs it. */
  readonly nodeModules: string
  /** A registry holding the two tarballs, and npm's packages beside them. */
  readonly registry: string
  /** The packed kit and the engine packed from the copy installed here. */
  readonly tarballs: { readonly sdk: string; readonly engine: string }
}

let known: StudioInfo | null = null

export async function studio(): Promise<StudioInfo> {
  if (known === null) {
    known = (await (
      await fetch(`${CONTROL_ORIGIN}/studio`)
    ).json()) as StudioInfo
  }
  return known
}

/**
 * Opens the page for one game's runs, and waits until it has loaded the
 * module the stand-in's next ranked start plays.
 */
export async function openRuns(
  page: Page,
  game: SubjectName,
  extra: Readonly<Record<string, string>> = {},
): Promise<void> {
  const query = new URLSearchParams({ game, ...extra })
  await page.goto(`${STUDIO_ORIGIN}/?${query}`)
  await expect(page.locator("body")).toHaveAttribute("data-loaded", "ready")
}

/**
 * Opens the page on one module the studio's bundles origin holds, under the
 * policy for `game`'s path, and answers what `loadGame` made of it: `ready`,
 * or the code it refused with.
 */
export async function openModule(
  page: Page,
  module: string,
  game: SubjectName = "template",
): Promise<string> {
  const query = new URLSearchParams({ game, load: module })
  await page.goto(`${STUDIO_ORIGIN}/?${query}`)
  await expect(page.locator("body")).toHaveAttribute("data-loaded", /.+/)
  return (await page.locator("body").getAttribute("data-loaded")) ?? ""
}

/** Signs the stand-in's one player in, through its window, as a player would. */
export async function signIn(page: Page): Promise<void> {
  const [window] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "Sign in" }).click(),
  ])
  const closed = window.waitForEvent("close")
  // The window posts the code and closes itself inside the click, as the
  // platform's does, and Chromium can close it before it has answered the
  // click's mouseup. A click that failed with the window still open is a
  // failure; one that failed because it closed is the click working.
  await window
    .getByRole("button", { name: /Sign in as/ })
    .click()
    .catch((error: unknown) => {
      if (!window.isClosed()) throw error
    })
  await closed
  await expect(page.locator("body")).toHaveAttribute(
    "data-player",
    "Local player",
  )
}

/** Waits for the run to reach `phase`, and fails at once if it fails instead. */
export async function reach(page: Page, phase: string): Promise<void> {
  await expect(page.locator("body")).toHaveAttribute(
    "data-phase",
    new RegExp(`^(${phase}|failed)$`),
  )
  const reached = await page.locator("body").getAttribute("data-phase")
  if (reached !== phase) {
    throw new Error(
      `the run failed: ${await page.locator("#state").textContent()}`,
    )
  }
}

/** Every request a page sent to the stand-in's API, in order. */
export function sentBy(page: Page, apiOrigin?: string): Request[] {
  const sent: Request[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith("/v1/")) {
      if (apiOrigin === undefined || url.origin === apiOrigin)
        sent.push(request)
    }
  })
  return sent
}

/** `POST /v1/runs/<id>/chunks` and the like, as `METHOD path`. */
export function routesOf(sent: readonly Request[]): string[] {
  return sent.map(
    (request) => `${request.method()} ${new URL(request.url()).pathname}`,
  )
}

/** The next request for a module's page module fails once, as a network would. */
export async function failOnce(module: string): Promise<void> {
  await fetch(`${CONTROL_ORIGIN}/studio/fail-once/${module}`, {
    method: "POST",
  })
}

/** What the page published into one of its JSON blocks. */
export async function published<T>(page: Page, id: string): Promise<T> {
  return JSON.parse((await page.locator(`#${id}`).textContent()) ?? "") as T
}

/** A run's end as the page module reported it, recording and all. */
export interface ModuleEnd {
  readonly tick: number
  readonly reason: string
  readonly counters: Record<string, number>
  readonly recording: {
    readonly endTick: number
    readonly inputs: readonly {
      readonly tick: number
      readonly code: string
      readonly value: number
    }[]
  }
}

/** On a module opened with `openModule`: Play, and wait until it ticks. */
export async function startModule(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Play" }).click()
  await expect(page.locator("body")).toHaveAttribute("data-tick", /^[1-9]/)
}

/** Waits until the module has run at least `tick` ticks. */
export async function moduleAt(page: Page, tick: number): Promise<void> {
  await page.waitForFunction(
    (at) => Number(document.body.dataset.tick ?? "0") >= at,
    tick,
  )
}

/** End, and what the module said about the run it ended. */
export async function endModule(page: Page): Promise<ModuleEnd> {
  await page.getByRole("button", { name: "End" }).click()
  await expect(page.locator("body")).toHaveAttribute("data-phase", "ended")
  return await published<ModuleEnd>(page, "run")
}
