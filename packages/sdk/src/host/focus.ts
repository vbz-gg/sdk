/**
 * Handing the game element the focus, for `playRun` and `playLocal` alike.
 */

/**
 * Makes the game element the one that has focus, so a key the game maps
 * reaches it rather than the button a player just pressed, labelled with
 * `title` for a screen reader. A tabindex the page set is kept.
 */
export function focusGame(
  element: HTMLElement,
  title: string | undefined,
): void {
  if (!element.hasAttribute("tabindex")) element.tabIndex = 0
  if (title !== undefined) element.setAttribute("aria-label", title)
  element.focus()
}
