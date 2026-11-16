# paddle

A game steered by tilting the device, and the SDK's subject for tilt.

Drops fall and the paddle slides the way the screen leans. `src/capture.ts`
maps tilt through the engine's device helpers, as one input from -10 to 10
with full deflection at 30 degrees, so the page module reports `needsMotion`
and a page asks for motion in the Play button's click, the one place iOS lets
it. The arrow keys move the paddle too, and Space puts it back in the middle.
Space is there for the browser suite: it is the key that also presses a
focused button, so a game mapping it is where a Play button that kept focus
would show.

A game that reads tilt starts no run without it, keys or not, so on a laptop
the paddle starts nothing until the browser has a sensor to read. Chrome's
DevTools give it one: the Sensors panel (the Command Menu's Show Sensors)
sets the device's orientation, and the keys then play beside it.

What it exists to prove: that a game reading tilt is asked for it before
anything is awaited, that a refusal or a missing sensor starts no run, that a
recorded tilt replays to where the paddle went, and that a reading held still
records nothing, because the helpers record a level only when it changes.

```bash
bun run packages/sdk/src/cli/index.ts dev fixtures/paddle
```

A phone is another machine, and a browser grants tilt only to a secure page,
so on a phone it is served over https on the laptop's own address, with a
certificate the phone trusts for that address:

```bash
bun run packages/sdk/src/cli/index.ts dev fixtures/paddle \
  --address 192.168.1.20 --https --cert cert.pem --key key.pem
```
