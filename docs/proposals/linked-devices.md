# Proposal: a linked device, a paused run, and messages from a game to its page

This is a proposal, and nothing in it is built. The SDK keeps no `.dev/`
folder, so a design it has not taken on yet lives here, in
`docs/proposals/`, and `docs/sdk.md` links it.

Three things a game author has asked for:

1. **A linked device**: a phone driving a game shown on another screen, a
   laptop or a television, as a controller.
2. **A paused run**: the run's clock stopping when that link drops, and
   carrying on when it comes back.
3. **Messages from a game to its page**: the game telling the page it sits
   on that something happened, so the page can show it.

Each section says what the feature is for, how it fits the model in
`docs/sdk.md`, what the engine, the SDK and the platform would each have to
change, what is still open, and what it must not break. The model in one
paragraph: a game is one build. Played locally it is whatever its author
intends and talks to nobody. A ranked run is a kind of run vbz.gg serves:
the platform issues the seed and serves the config, the same build plays it
and records the player's inputs, and the platform replays them and ranks
what its replay computed; a practice run is the same, and never on a board.
No run has a step limit. Determinism binds every run, and four rules bind
only ranked and practice runs: the seed changes the state, at most 16 inputs
a tick on average, inputs only from the engine's device helpers, and the
checks play the served config.

## 1. A linked device

### What it is for

A game on a big screen with a phone in the player's hand: the phone draws
the controls, and the screen draws the game. A party game with several
phones, several players in one run, is out of scope here.

### How it fits the model

The phone is an input source and nothing more. Whatever it sends has to end
up where every other input does: in the game page's live queue, stamped with
the tick the game page was about to run, recorded, and replayed. The phone
never runs the rules code and never decides anything; it says what the
player's thumb did, and the game decides in `tick` as it does for a finger
on the screen. Recorded that way, a run driven from a phone replays exactly
like any other, because the replay reads the log and not the device, and the
time a press took to cross the link is already in the tick it was stamped
with.

The rule this strains is the third ranked rule: inputs come only from the
engine's device helpers. On one page the helpers read events the browser
marks as the player's (`isTrusted`), and a ranked run ignores the ones a
script made. A press that arrives over a link carries no such mark: anything
that can send on the link can press. That is the same trust a gamepad gets
today, which the browser reads by polling and which carries no mark either,
so the link is no wider a hole than a controller, if, and only if, nothing
but the paired phone can send on it. So the link has to be paired, and the
pairing has to be something a script on the game page cannot do by itself.

### What it would need

**The engine** (`@clockwork2/engine`):

- A linked source in `CaptureMapping`, beside `keys`, `pointers` and
  `gamepads`: named controls on the far device mapped to declared inputs,
  each recorded as a press or a level, only when it changes, merged to one
  value a tick and clamped to its range, through the same per-input check
  the live queue already runs, so a linked input is never checked a second
  way.
- A helper for the far device's page that reads its own keys and fingers
  with the existing helpers and sends what they record, not raw events, so
  the phone records as coarsely as the game's mapping says.
- Every press it records it also releases: on the link dropping, which is
  the new way for a press to end, and on everything that releases a press
  today.

**The SDK** (`@vbz-gg/sdk`):

- A pairing step in `/host`, shown on the game's screen: a short code or a
  QR code the phone reads, from which both ends derive a key, so a message
  the game page takes is one the paired phone sent.
- A controller page for the phone, a new subpath or a template, which loads
  nothing of the game but its manifest's declared inputs and draws the
  controls.
- `playLocal` and `playRun` taking the link, and the page module's `mount`
  attaching it to the run's live queue. That is a new member a page passes,
  which a module of contract 2 cannot use, so it is contract 3.

**The platform**: nothing, if the link is direct between the two devices.
WebRTC needs a way for two pages to find each other; if the platform offers
it, it is a route behind the game's page key that passes the two pages'
offers and nothing else, and it never sees an input.

### Open questions

- Which transport. WebRTC data channels are direct and need signalling; a
  relay over WebSocket is simpler and puts every press through a server.
  Nothing here has measured the latency of either from a phone to a
  laptop.
- Whether a linked device is allowed in ranked and practice runs at all, or
  only locally to begin with. The trust argument above is no worse than a
  gamepad's, and it rests entirely on the pairing.
- How the phone's inputs count against the budget of 16 a tick: they are
  the game page's inputs once recorded, so they count like any other, and a
  phone streaming a stick finely would spend it fastest.

### What it must not break

- A recorded input carries no device. The link's inputs are recorded as the
  game's declared names and values, like a key's.
- Nothing on a page builds a `GameHost` or decides what was pressed: the
  phone sends what its helpers recorded, and the game page's module
  attaches it.
- A game draws its own controls. On the phone, the controls are the
  game's, drawn from what the game declares, never a pad a page invented
  and handed the game an answer from.

## 2. Pausing a run when the link drops

### What it is for

A phone that loses its connection mid-run leaves a game the player cannot
steer. Without a pause the run plays on with nobody at the controls, and a
ranked run is spent.

### How it fits the model

The engine's host can already pause: `GameHost.pause()` stops the clock,
releases everything held into the log and takes no input until `resume()`,
which restarts the clock rather than carrying the pause forward. Nothing
about a pause reaches the recording: a paused run records no ticks, so it
replays exactly like the same run played straight through. Determinism is
untouched.

What a pause does to a ranked run is about wall-clock time, which the
platform reads in two places:

- **The submit's time check.** The platform refuses a submit whose run
  simulated more time than passed on the wall clock between its start and
  its last chunk, `E_TIME_IMPOSSIBLE`, which no host can do and which is a
  strike. A pause only ever makes the wall clock run ahead of the
  simulation, so no pause can trip it.
- **The close of a run nobody comes back to.** `Run` sends a chunk every two
  seconds of play, counted in ticks, so a paused run sends nothing. The
  platform closes a run that stops making progress and settles it from its
  chunks: today after its version's `max_wall_seconds` and 15 minutes more,
  and, once the platform takes the work that removed the step limit, after
  30 minutes with no new progress. A pause longer than that ends the run
  where it stood, settled as an abandoned run from what it committed.

And one thing about fairness the platform cannot check: a paused game is a
frozen picture. In a game where reaction time is the skill, a pause is time
to think that a player who never paused did not have. A modified page could
already stop its clock today, so a supported pause opens no hole the checks
could close, but it does make one a normal thing to do.

### What it would need

**The engine**: nothing for the pause itself. A notice for the link
dropping and coming back, beside the ones the helpers send today, so the
page can say why the game stopped.

**The SDK**:

- `pause()` and `resume()` on a run's handle, driving the module's own
  host. That is a new member a page calls, so it is contract 3, and a page
  pausing a module of contract 2 finds it cannot and says so rather than
  calling nothing.
- `playRun` and `playLocal` pausing when the link drops and resuming when
  it is back, and saying so through `onNotice`.
- A rule for how long a ranked run may stay paused, kept below the
  platform's close, so a run ends the way the page says rather than the way
  a sweep finds it.

**The platform**: nothing is required. If ranked play allows pauses, a chunk
could carry how long the run was paused, stored for the operator to read and
deciding nothing, as the recording's frame figures are today.

### Open questions

- Whether a ranked run may pause at all, or only a practice or local one;
  and if it may, whether the game says so in its manifest, so a game whose
  skill is reaction time can refuse it.
- Whether the presentation covers the game while it is paused, so the
  picture is not there to study. A page cannot enforce it on a determined
  player; it can make it the default.
- Whether a pause should be a page's choice beyond a dropped link, such as a
  Pause button or a tab hidden mid-run. A hidden tab draws no frames, so the
  host runs no ticks there already, and the device helpers release what was
  held; whether that should be a pause the player sees is the same
  question.

### What it must not break

- No pause reaches the log: a paused run replays like the same run played
  straight through.
- The clock does not come back owing the paused time: `resume()` restarts
  it, as it does today.
- A run still ends cleanly before its recording fills, and still ends when
  the platform closes it, paused or not.

## 3. Messages from a game to its page

### What it is for

A page around a game shows more than the game: a level reached, an
achievement, a share button when the run ends well, a prompt to turn the
phone. Today a page hears a run's frames (the tick and the counters), its
checkpoints, its end, a failure and a device notice, and nothing the game
chose to say.

### How it fits the model

Two kinds of message, and they are not the same:

- **From the rules code.** The rules code already emits cues each tick,
  `effects()`, which the presentation plays as sound and sparks. A message
  derived from those is deterministic: the same run sends the same messages
  at the same ticks in a replay. That is the kind a page can trust to mean
  what the run did.
- **From the presentation.** The presentation may say anything, such as a
  button it drew being pressed, and none of it is in the recording. A page
  may show it and must never act on it in a way that changes the run or
  reaches the platform as a claim.

Either way a message decides nothing a run counts. A page never submits
anything because a message said so; the platform's replay is still what
ranks a run.

### What it would need

**The engine**: nothing for messages from the rules code, which are effects.
A way for a presentation to say something is not the engine's business,
because the presentation is the game's own code.

**The SDK**:

- An `onMessage` handler a page passes `playLocal`, `playRun` and
  `watchRun`, called with plain data, `{ from, type, tick, data }`, where
  `from` says whether the rules code or the presentation sent it, so a page
  can tell a fact about the run from a remark about the screen.
- `definePageModule` taking which effects to forward, so a game opts in per
  cue rather than sending every spark to the page.
- A page passing a handler a module of contract 2 has never heard of calls
  nothing; whether that needs contract 3, or is a member an older module
  simply never calls, is decided by whether a page needs to know that
  messages will come.

**The platform**: nothing.

### Open questions

- Whether watching a run should send the rules code's messages too, so a
  page shows the same achievements over a replay. Being deterministic, it
  can.
- Whether a message from the presentation is needed at all, or is the
  opening for a game to hand its page a decision. A page that showed it and
  acted on nothing would be safe; one that started a run or submitted
  because of it would not.

### What it must not break

- What crosses between a page and its module is plain data, behind a
  contract version, never an object of the module's.
- A game never constructs an input, and no message becomes one: a page
  cannot answer a message by pressing something in the game.
- `/game` holds no DOM and no dynamic import, and reads nothing of the
  browser until `mount` is called.

## Order of work

The engine's linked source and its notice first, in a minor release; then
the SDK's contract 3 with pairing, pause and messages, in one minor, so a
page learns all three new members at once; then, only if the transport
chosen needs it, the platform's signalling route. Messages could ship alone
before the rest, since they need no engine change.
