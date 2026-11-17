# The harness

`vbz dev ./my-game` is your game's page on a laptop. It builds the two real
artifacts, serves them on one port at the paths and with the headers the
platform's edge uses, and serves a page on another that loads the page module
from there with `loadGame` and plays it with `playLocal`, through the
module's own `mount`.

```
http://127.0.0.1:4310   the page that loads the game
http://127.0.0.1:4311   the game's two modules, under /g/<game id>/
```

Two ports are two origins, which is the point: a studio's page imports the
page module from the platform's bundle origin, and meeting that import on a
laptop is cheaper than meeting it on a studio's page. The page is served
under the Content-Security-Policy a studio's page should send, with scripts
from the page's own origin and the game's own path and nowhere else, and no
`unsafe-eval`, so a page module that needs more is refused here first.

## What the page gives you

- **The checks a studio's page makes**, through the same `loadGame`: a module
  of another contract, another manifest, a mapping its manifest does not
  allow, or a page that replaced a built-in is refused, and the refusal is in
  the status line.
- **Start and End.** Start asks for tilt first when the game reads it, as a
  studio's Play button does, and without tilt starts no run, with the code
  and the player's sentence in the status line. On a laptop, give the page a
  sensor with the browser's emulation: in Chrome, DevTools' Sensors panel
  (the Command Menu's Show Sensors). End stops the run where it stands,
  which is how to get a recording out of a game you do not intend to lose
  at.
- **A report on every run**, three lines under the game once it ends:
  - `replayed:` whether the recording, replayed against the built rules code
    to the tick it ended, matches what the page reported. A run that differs
    names the first tick it differs from, and fails on the platform too.
  - `inputs:` how many the recording holds, against the budget a ranked or
    practice run that long is held to, or the code the platform would refuse
    them with.
  - `recording:` its size in bytes, which is what a submit sends.
  The report turns red when the replay does not match or the inputs would be
  refused. The budget binds only ranked and practice runs, so a run over it
  turns the report red only under `vbz dev --ranked`.
- **The recording**, with a link to save it. It is the same envelope the
  platform would replay.
- **A status line** carrying what the game is saying: `ready`, the tick
  count, how the run ended and what it scored.

The seed is a constant, `local:harness`, so the run you are debugging is the
run you had a moment ago. The platform's daily seed is a keyed HMAC of the game and the day,
which does the same job for everybody at once. The config is what the
platform serves a run: every setting the manifest declares, at its default. A
run has no step limit, and the game's files folder is served beside its two
modules, under `/g/<game id>/t/<listing sha256>/`, where the page module
fetches its data packs.

## A phone

A phone is another machine, and a browser loads a game's code from another
machine only over https, and grants tilt only to a secure page. So both
origins listen on the laptop's own address on the network, over https:

```bash
vbz dev . --address 192.168.1.20 --https --cert cert.pem --key key.pem
```

The certificate and key are PEM files, and the phone has to trust the
certificate for that address; the harness makes none. An address other than
this machine's own (`127.0.0.1`, `localhost`, `::1`) is refused without
`--https`, and so is `0.0.0.0`, which no page can name. `--host` and
`--bundles-port` move the two ports.

## Your game's page

`vbz dev . --site` serves the game's own `site/` instead of the harness page:
`site/index.html`, `site/main.ts` bundled for the browser as `main.js`, and
every other file in `site/` as it is, under the same policy with the API's
origin added. The game is built and served from a bundles origin as above.

The page talks to a stand-in for the platform, on origins of its own: the
page routes and the sign-in window, as one local player. The harness answers
the page's `config.json` with the stand-in's API, sign-in window and page
key, so the file in `site/` is not read. The stand-in:

- signs the player in through a window of its own, with the same code trade;
- starts a run on the harness seed and the served config, and resumes it on
  a refresh until it has committed a chunk;
- holds chunks and the submit to the manifest the way the platform does:
  a chunk sent again unchanged, one that conflicts or reaches back, a
  checkpoint at a tick an earlier chunk reached, inputs the manifest does
  not allow, and the byte limits;
- settles a run at its submit with the counters the page sent, without a
  replay, and says so in the terminal;
- reads a settled run back for watching, a run from a day still open to the
  local player alone, and answers a run the reader may not have, or one that
  does not exist, with the platform's `E_NOT_FOUND`;
- keeps the local player's last ranked run of the day as the board;
- answers every refusal with the platform's code and the platform's status
  for it.

It neither replays nor ranks. A score it shows has not been checked.

## What it does not reproduce

- **The second registrable domain.** Production serves a game's code from a
  different site from the studio's page. Two ports on localhost are one site.
  A module import does not carry cookies either way, so this gap is named
  rather than closed.
- **Settlement and ranking.** The harness replays a run and says whether it
  matches; deciding what it scores on a board is the platform's.
- **The cross-engine sweep.** `vbz check` runs the engine's conformance
  checks under bun, in a process of its own with an empty environment. The
  platform also runs the game in three engines at ingest, which needs three
  browsers installed.

Use a device emulation at phone width, or a phone through `--https`. Your
game draws its own controls, so check that a thumb on one does not cover
anything the player needs to read.
