# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [0.7.3](https://github.com/vbz-gg/sdk/compare/v0.7.2...v0.7.3) (2026-11-18)


### Bug Fixes

* a game shipped anywhere, vbz build --addressed, refusals for checks that run out of time ([#26](https://github.com/vbz-gg/sdk/issues/26)) ([0d26682](https://github.com/vbz-gg/sdk/commit/0d2668217c506b36e385b99aa44b7d2ff176807e))

## [0.7.2](https://github.com/vbz-gg/sdk/compare/v0.7.1...v0.7.2) (2026-11-17)


### Bug Fixes

* the replay service's load refusal, upload checks that play nothing, patch replays of at most 3 runs ([#25](https://github.com/vbz-gg/sdk/issues/25)) ([1110fe5](https://github.com/vbz-gg/sdk/commit/1110fe507eefb64301aa4774ea90fb315451b789))

## [0.7.1](https://github.com/vbz-gg/sdk/compare/v0.7.0...v0.7.1) (2026-11-17)


### Bug Fixes

* the ranking refusal's public code, the replay-service check's codes, the replay budget as constants, a longer publish wait ([#24](https://github.com/vbz-gg/sdk/issues/24)) ([f42b444](https://github.com/vbz-gg/sdk/commit/f42b444b322c5cc927855aa5986b9d9a69333b3d))

## [0.7.0](https://github.com/vbz-gg/sdk/compare/v0.6.0...v0.7.0) (2026-11-17)


### ⚠ BREAKING CHANGES

* one game build, local play, files folder and data packs, the sign-in box, new limits (#23)

### Features

* one game build, local play, files folder and data packs, the sign-in box, new limits ([#23](https://github.com/vbz-gg/sdk/issues/23)) ([417ed20](https://github.com/vbz-gg/sdk/commit/417ed20f30b1e83b4eedbe04db6a8c65643799f5))

## [0.6.0](https://github.com/vbz-gg/sdk/compare/v0.5.1...v0.6.0) (2026-11-17)


### ⚠ BREAKING CHANGES

* the controls subpath and the frame document are removed; a page loads a game with
loadGame and plays it with playRun; a manifest declares inputs (engine 0.9.0); versions are
semantic and a patch may not change its line's rules.

Docs-Updated: sdk.md, the package README and the skill describe the page module and the commands

### Features

* games run on the studio's own page, draw their own controls, and ship in release lines ([#21](https://github.com/vbz-gg/sdk/issues/21)) ([5d998b1](https://github.com/vbz-gg/sdk/commit/5d998b1dd0efce68b350fe3fcefee71f5a10a747))
* **guide:** the agent guides ship in the package, and vbz new and vbz guides install them ([#22](https://github.com/vbz-gg/sdk/issues/22)) ([8175d15](https://github.com/vbz-gg/sdk/commit/8175d15891511889ba7b13dc084df4c8daa1dba8))

## [0.5.1](https://github.com/vbz-gg/sdk/compare/v0.5.0...v0.5.1) (2026-11-12)


### Bug Fixes

* **serve:** drop the webrtc directive no browser knows ([#20](https://github.com/vbz-gg/sdk/issues/20)) ([4b160f0](https://github.com/vbz-gg/sdk/commit/4b160f00e18951e6f1c1961dc1ebe404524e84de))

## [0.5.0](https://github.com/vbz-gg/sdk/compare/v0.4.0...v0.5.0) (2026-11-12)


### Features

* **host:** put a game on a studio's page with @vbz-gg/sdk/host ([#19](https://github.com/vbz-gg/sdk/issues/19)) ([031ecb4](https://github.com/vbz-gg/sdk/commit/031ecb41177e96d8ed366e03e9300b18c0758056))

## [0.4.0](https://github.com/vbz-gg/sdk/compare/v0.3.0...v0.4.0) (2026-11-11)


### Features

* **cli:** vbz publish uploads a build and waits for the verdict ([#18](https://github.com/vbz-gg/sdk/issues/18)) ([ff5ea0b](https://github.com/vbz-gg/sdk/commit/ff5ea0bca87f09efdd76ee5b471c996e12706aa8))
* **platform:** a game page's client, as @vbz-gg/sdk/platform ([#17](https://github.com/vbz-gg/sdk/issues/17)) ([f79ef4c](https://github.com/vbz-gg/sdk/commit/f79ef4c735477fa3bba8851376b5478dcbb68ba3))


### Bug Fixes

* **package:** write the vbz command's path the way npm publishes it ([#16](https://github.com/vbz-gg/sdk/issues/16)) ([14cb522](https://github.com/vbz-gg/sdk/commit/14cb522434a3d9cc7539a54f5e6369b09ae8cb67))

## [0.3.0](https://github.com/vbz-gg/sdk/compare/v0.2.0...v0.3.0) (2026-11-11)


### ⚠ BREAKING CHANGES

* publish as @vbz-gg/sdk, with the command vbz (#13)

### Features

* **api:** the platform's route shapes, as @vbz-gg/sdk/api ([#15](https://github.com/vbz-gg/sdk/issues/15)) ([29189d2](https://github.com/vbz-gg/sdk/commit/29189d2e40ec66384f09e44e2ec92ae003ee3ece))
* publish as @vbz-gg/sdk, with the command vbz ([#13](https://github.com/vbz-gg/sdk/issues/13)) ([bbc49c1](https://github.com/vbz-gg/sdk/commit/bbc49c184a187e6d52b67fbe7a8c7570cac062f0))


### Bug Fixes

* **scripts:** a Docs-Updated line in wrapped prose is not the record ([#12](https://github.com/vbz-gg/sdk/issues/12)) ([396ae33](https://github.com/vbz-gg/sdk/commit/396ae3308a70800165c98be93e6452a1561d5ce6))
* **template:** write a checkpoint each second at any tick rate ([#9](https://github.com/vbz-gg/sdk/issues/9)) ([e1a2460](https://github.com/vbz-gg/sdk/commit/e1a2460686147f6b96cb6905ea4a6076bbd630a3))


### Documentation

* the platform and a studio's page, where the docs said the arcade ([#14](https://github.com/vbz-gg/sdk/issues/14)) ([ecafc60](https://github.com/vbz-gg/sdk/commit/ecafc606cbfae6cb097527e6dbac6140948548a6))


### Build System

* **deps:** engine 0.8.0 ([#10](https://github.com/vbz-gg/sdk/issues/10)) ([b13610d](https://github.com/vbz-gg/sdk/commit/b13610de8e3f0c6d40143ac751a3a46e2a3d79a7))


### CI

* **release:** tell the arcade when a version is out ([#8](https://github.com/vbz-gg/sdk/issues/8)) ([9f66087](https://github.com/vbz-gg/sdk/commit/9f660871797f27df902eeb1cbb1eae73abc22a97))
* **release:** tell the platform when a version is out ([#11](https://github.com/vbz-gg/sdk/issues/11)) ([25fb715](https://github.com/vbz-gg/sdk/commit/25fb7158288dd85b7913ea43d45d11c9b3f78b49))

## [0.2.1](https://github.com/vbz-gg/sdk/compare/v0.2.0...v0.2.1) (2026-11-10)


### ⚠ BREAKING CHANGES

* publish as @vbz-gg/sdk, with the command vbz (#13)

### Features

* **api:** the platform's route shapes, as @vbz-gg/sdk/api ([#15](https://github.com/vbz-gg/sdk/issues/15)) ([29189d2](https://github.com/vbz-gg/sdk/commit/29189d2e40ec66384f09e44e2ec92ae003ee3ece))
* publish as @vbz-gg/sdk, with the command vbz ([#13](https://github.com/vbz-gg/sdk/issues/13)) ([bbc49c1](https://github.com/vbz-gg/sdk/commit/bbc49c184a187e6d52b67fbe7a8c7570cac062f0))


### Bug Fixes

* **scripts:** a Docs-Updated line in wrapped prose is not the record ([#12](https://github.com/vbz-gg/sdk/issues/12)) ([396ae33](https://github.com/vbz-gg/sdk/commit/396ae3308a70800165c98be93e6452a1561d5ce6))
* **template:** write a checkpoint each second at any tick rate ([#9](https://github.com/vbz-gg/sdk/issues/9)) ([e1a2460](https://github.com/vbz-gg/sdk/commit/e1a2460686147f6b96cb6905ea4a6076bbd630a3))


### Documentation

* the platform and a studio's page, where the docs said the arcade ([#14](https://github.com/vbz-gg/sdk/issues/14)) ([ecafc60](https://github.com/vbz-gg/sdk/commit/ecafc606cbfae6cb097527e6dbac6140948548a6))


### Build System

* **deps:** engine 0.8.0 ([#10](https://github.com/vbz-gg/sdk/issues/10)) ([b13610d](https://github.com/vbz-gg/sdk/commit/b13610de8e3f0c6d40143ac751a3a46e2a3d79a7))


### CI

* **release:** tell the arcade when a version is out ([#8](https://github.com/vbz-gg/sdk/issues/8)) ([9f66087](https://github.com/vbz-gg/sdk/commit/9f660871797f27df902eeb1cbb1eae73abc22a97))
* **release:** tell the platform when a version is out ([#11](https://github.com/vbz-gg/sdk/issues/11)) ([25fb715](https://github.com/vbz-gg/sdk/commit/25fb7158288dd85b7913ea43d45d11c9b3f78b49))

## 0.2.0 (2026-09-23)


### Features

* the repository, and the control schemes it owns ([efb27a1](https://github.com/vbz-gg/game-base/commit/efb27a14a31b3d44cf4787f34ba116cd7a2914a0))


### Bug Fixes

* **cli:** copy the template when it is installed, not only when it is not ([#3](https://github.com/vbz-gg/game-base/issues/3)) ([22b34cc](https://github.com/vbz-gg/game-base/commit/22b34cc7b1d32a2b38fd9dba74b5a5bcba131e5d))


### Build System

* **deps:** engine 0.7.2 ([#6](https://github.com/vbz-gg/game-base/issues/6)) ([5db2a54](https://github.com/vbz-gg/game-base/commit/5db2a5472974819ab766cf52b5a82117617b2203))
* **deps:** engine 0.7.3 ([#7](https://github.com/vbz-gg/game-base/issues/7)) ([5257694](https://github.com/vbz-gg/game-base/commit/525769462b3d204622ff518c49dcdfdefdd748e3))


### CI

* **engine-update:** recover from a branch left without its pull request ([#5](https://github.com/vbz-gg/game-base/issues/5)) ([a7d1ae8](https://github.com/vbz-gg/game-base/commit/a7d1ae833357ee4d48481e093cda7b1e4377f0f0))
* release from a dispatch, and follow the engine from clockwork2 ([#4](https://github.com/vbz-gg/game-base/issues/4)) ([ab951b6](https://github.com/vbz-gg/game-base/commit/ab951b6517dee7e76e967bda676b18d3c05abb65))
