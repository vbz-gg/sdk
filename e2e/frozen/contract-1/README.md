# A page module from the first release of contract 1

`present.js` and `sim.js` are the template's two modules, Lane Runner 1.0.0,
as the first release of `@vbz-gg/sdk` whose page modules speak contract 1
built them, against engine 0.8.0, under the game id
`00000000-0000-4000-8000-000000000001`. `manifest.json` is the manifest that
build wrote. `present.js` is stored after the upload's rewrite, so its one
import already names `sim.js` by its SHA-256.

They are never rebuilt. A page on every later release of this package has to
load this module and play it, which is what "a release drives every contract
version an earlier release drove" means in practice, and the browser suite's
`another-release-of-the-sdk.spec.ts` holds it to that. Rebuilding them from a
newer tree would test the newer release against itself.

A release that adds a contract adds a folder beside this one, built by that
release, and this one stays.
