/**
 * Putting a game on a studio's page: loading its page module, a platform run
 * through it, a settled run replayed, and the two widgets a game's page needs.
 *
 * Plain modules with no DOM at load time, like `/platform`, so a page may
 * import this while rendering on a server. It holds no engine: a game's page
 * module carries its own, and this reaches it through the module's `mount`.
 */

export {
  alteredBuiltins,
  type GameAddress,
  type LoadedGame,
  type LoadOptions,
  loadGame,
  SIMULATION_BUILTINS,
} from "./load.js"
export {
  type PlayedRun,
  type PlayOptions,
  playRun,
  type RunLocks,
  runLockName,
} from "./play.js"
export { type WatchedGame, type WatchOptions, watchRun } from "./watch.js"
export {
  type BoardWidgetOptions,
  type MountedBoard,
  type MountedSignIn,
  type MountedWidget,
  mountBoard,
  mountSignIn,
  type SignInOptions,
} from "./widgets.js"
