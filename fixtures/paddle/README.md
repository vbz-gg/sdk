# paddle

A game steered by tilting the device, and the SDK's subject for tilt.

Drops fall and the paddle slides the way the screen leans. `src/capture.ts`
maps tilt through the engine's device helpers, as one input from -10 to 10
with full deflection at 30 degrees, so the page module reports `needsMotion`
and a page asks for motion in the Play button's click, the one place iOS lets
it. The arrow keys move the paddle too, so it plays on a desktop with no
sensor.

What it exists to prove: that a game reading tilt is asked for it before
anything is awaited, that a recorded tilt replays to where the paddle went,
and that a reading held still records nothing, because the helpers record a
level only when it changes.

```bash
bun run packages/sdk/src/cli/index.ts dev fixtures/paddle
```
