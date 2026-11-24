# turns

A game of two players taking turns, and the SDK's subject for seats.

Each turn, the player whose turn it is steps the aim with the arrow keys and
shoots with Space. The ball rolls and stops, the shot scores by how near it
stops to a mark drawn from the seed, and the turn passes. A player who has
not shot within four seconds loses the shot. The run ends when both have
taken three.

Its manifest declares `session.seats: 2`, and its rules code answers
`seat()`, so a run has two seats. Each player's page plays its own seat:
it mounts the page module with `seats: { local, onLocalInputs }`, sends what
`onLocalInputs` hands it to the other page, and hands what arrives from the
other page to the run's `remote`. A page with `local: null` follows the
match and records nothing. Both pages play the same seed and config, and
each runs the whole simulation.

What it exists to prove, in `packages/sdk/tests/game/seats.test.ts`: that
two pages wired that way reach the same checkpoints and the same merged log,
that a page following the match reaches them too, that a press on the
other player's turn is dropped rather than recorded, that a page whose
opponent stalls waits for that seat and then catches up, and that the merged
log replays like any log, watched with no seats at all.

It has no page of its own to play a match on. The harness plays a run with
no seats, which the page module refuses with `E_SEATS_REQUIRED`, so
`vbz dev fixtures/turns` shows that code on its status line. `vbz check
fixtures/turns` runs the engine's checks, whose determinism check plays the
bot's log split by seat as well as whole.
