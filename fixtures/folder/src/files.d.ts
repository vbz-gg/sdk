/**
 * The folder's entry, as the page module imports it. `vbz build` leaves
 * `cw2:files/` for the platform to rewrite to the folder's address, and a
 * page playing locally maps it with an import map; for the type checker,
 * this is what `files/entry.js` exports.
 */
declare module "cw2:files/entry.js" {
  /** What the rules code's `view()` returns, which the drawing draws. */
  type View = import("./sim").View

  export interface Started {
    /** What the WebAssembly core answered. */
    readonly tint: number
    /** The module the entry imported by a computed name. */
    readonly drawnBy: string
    draw(
      context: CanvasRenderingContext2D,
      view: View,
      width: number,
      height: number,
    ): void
    /** Stops the worker. */
    stop(): void
  }

  export function start(): Promise<Started>
}
