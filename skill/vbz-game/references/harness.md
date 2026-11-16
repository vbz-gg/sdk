# The harness

`vbz dev ./my-game` is your game's page on a laptop. It builds the two real
artifacts, serves them at the paths and with the headers the platform's edge
uses on one port, and serves a page on another that loads the page module
from there with `loadGame` and plays it through the module's own `mount`.

```
http://127.0.0.1:4310   the page that loads the game
http://127.0.0.1:4311   the game's two modules, under /g/<game id>/
```

Two ports are two origins, which is the point: a studio's page imports the
page module from the platform's bundle origin, and meeting that import on a
laptop is cheaper than meeting it on a studio's page.

## What the page gives you

- **The checks a studio's page makes**, through the same `loadGame`: a module
  of another contract, another manifest, a mapping its manifest does not
  allow, or a page that replaced a built-in is refused, and the refusal is in
  the status line.
- **Start and End.** End stops the run where it stands, which is how to get a
  recording out of a game you do not intend to lose at.
- **The recording**, published when the run ends, with a link to save it. It
  is the same envelope the platform would replay.
- **A status line** carrying what the game is saying: `ready`, the tick
  count, how the run ended and what it scored.

The seed is a constant, so the run you are debugging is the run you had a
moment ago. The platform's daily seed is a keyed HMAC of the game and the day,
which does the same job for everybody at once.

## What it does not reproduce

- **The second registrable domain.** Production serves a game's code from a
  different site from the studio's page. Two ports on localhost are one site.
  A module import does not carry cookies either way, so this gap is named
  rather than closed.
- **Replay, settlement and ranking.** That half is the platform's, and a harness
  that pretended to do it would be teaching you about a server that does not
  exist.
- **The conformance suite and the cross-engine sweep.** Use the platform-game
  skill's `validate` for the first; the second needs three browsers installed
  and runs at ingest.

## A phone

Use a device emulation at phone width, or a phone on the same network. Your
game draws its own controls, so check that a thumb on one does not cover
anything the player needs to read.
