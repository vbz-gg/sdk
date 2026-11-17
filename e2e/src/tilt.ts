/**
 * Tilt in Chromium, which has no sensor on the machine the suite runs on.
 *
 * A game that reads tilt starts no run without it, and a desktop Chromium
 * sends no reading: with the sensors not granted it sends one with every
 * angle null and nothing after, which the engine reports as
 * `E_MOTION_NO_SENSOR`. So a spec that plays the paddle, by tilt or by its
 * keys, gives the page a sensor first. Firefox and WebKit have no sensor
 * override in Playwright.
 */

import type { BrowserContext, Page } from "@playwright/test"

/** Leans the device `gamma` degrees, the right edge down. */
export type Lean = (gamma: number) => Promise<void>

/**
 * A sensor for `page`, from Chromium's orientation override, held level
 * until the spec leans it.
 */
export async function tiltSensor(
  context: BrowserContext,
  page: Page,
): Promise<Lean> {
  await context.grantPermissions(["accelerometer", "gyroscope"])
  const cdp = await context.newCDPSession(page)
  // Flat on the table, the right edge `gamma` degrees down.
  const lean: Lean = async (gamma) => {
    await cdp.send("DeviceOrientation.setDeviceOrientationOverride", {
      alpha: 0,
      beta: 0,
      gamma,
    })
  }
  await lean(0)
  return lean
}

/** One call to the stand-in for iOS's prompt. */
export interface TiltAsked {
  /** Whether the tap's activation was still live, which iOS requires. */
  readonly active: boolean
}

/**
 * iOS's `DeviceOrientationEvent.requestPermission` on every page `page`
 * opens, answering `answer` the way iOS answers once a player has tapped
 * "Cancel" on its motion prompt (the button's name, measured on iPadOS 26.7):
 * at once, and without asking again. Chromium has none of its own and cannot
 * produce that refusal, and the engine calls the method wherever the browser
 * has it. Each call is kept for `tiltAsked`.
 */
export async function answerTilt(page: Page, answer: string): Promise<void> {
  await page.addInitScript((said) => {
    const scope = window as unknown as { __tiltAsked: TiltAsked[] }
    scope.__tiltAsked = []
    const orientation = DeviceOrientationEvent as unknown as {
      requestPermission: () => Promise<string>
    }
    orientation.requestPermission = () => {
      scope.__tiltAsked.push({ active: navigator.userActivation.isActive })
      return Promise.resolve(said)
    }
  }, answer)
}

/** Every call `answerTilt`'s stand-in heard, in order. */
export async function tiltAsked(page: Page): Promise<TiltAsked[]> {
  return await page.evaluate(
    () => (window as unknown as { __tiltAsked: TiltAsked[] }).__tiltAsked,
  )
}
