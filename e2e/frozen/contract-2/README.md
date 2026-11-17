# A page module from the first release of contract 2

`present.js` and `sim.js` are the template's two modules, Lane Runner 1.0.0,
as the tree that introduced contract 2 built them, against engine 0.10.0,
under the game id `00000000-0000-4000-8000-000000000001`. `manifest.json` is
the manifest that build wrote, format 3. `present.js` is stored after the
upload's rewrite, so its one import already names `sim.js` by its SHA-256.
The template has no files folder, so the module's folder is the empty
listing's.

They are never rebuilt once contract 2 is released. A page on every later
release of this package has to load this module and play it, as it does the
module in `contract-1/`, and the browser suite's
`another-release-of-the-sdk.spec.ts` holds it to that. Rebuilding them from a
newer tree would test the newer release against itself.

Until the release that carries contract 2, a change to what a contract-2
module is or does replaces these files with a build from the tree that made
the change, so what is frozen is what that release built.
