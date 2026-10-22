# Step 8: Ending a visit

**Goal:** make the End button save the intake form before the call closes, using a
**live call event** to tell the AI that the visit is over.

**Files you change:** `src/proxy.js` (it now matches the repo), `public/app.js` (it now
matches the repo)

## The idea

### The problem

The intake form is filled at the end of the visit from what the patient said. If End
simply hung up, the AI would never get the chance to call `record_intake`. So End must
mean: "AI, the visit is over. Fill the form. Then we hang up."

### Live call events: your app talks to the AI

Tools let the AI call your app. **Live call events** go the other way: your app tells a
live call that something happened. On a browser call, you send the event on the call's
socket as a `call_event` frame:

```json
{
  "type": "call_event",
  "name": "visit.ending",
  "hint": "The clinician has ended the visit. Call record_intake now with what the patient said during the visit, then say nothing more.",
  "speak": true,
  "priority": "interrupt",
  "idempotencyKey": "20261007-103012-a1f3-visit-ending"
}
```

| Field | Meaning |
|---|---|
| `name` | What happened. The prompt explains it: "visit.ending: the clinician has pressed the button to end the visit. Do step four at once." |
| `hint` | What the AI should do about it. |
| `speak: true` | The AI should act on it now, not just remember it. |
| `priority: "interrupt"` | It may cut the AI off mid-sentence (never a person who is talking). |
| `idempotencyKey` | If the same event is sent twice, the second is ignored. |

The engine answers with `event_status` frames: `queued`, then `spoken` (done), or
`dropped` or `rejected` with a reason. A `rejected` event with the reason
`not_enabled_for_call` means the agent has `callEvents` turned off. That is why Step 3 set
`callEvents: true`.

Events are off for an agent unless you turn them on. The full rules are in
"Live call events" in [`AGENTS.md`](../AGENTS.md).

### The flow, with safety nets

Every wait has a time limit, so a visit can never get stuck "ending".

```
 Clinician presses End (first time)
   │ page: sends end_session, shows "Saving intake notes…",
   │       the button becomes "End now", a 25 s safety timer starts
   ▼
 Server: is there anything to wait for?
   ├─ no  (call not live / form not wanted / form already saved / tools off)
   │        └──► end_call at once
   └─ yes ──► send call_event "visit.ending", start a 20 s timer
               │
               ├─ record_intake arrives ──► intake card appears on the page
               │        └──► wait 4 s so the AI's spoken thanks can finish ──► end_call
               ├─ event_status "rejected" or "dropped" ──► end_call at once
               └─ 20 s pass with no form ──► end_call anyway

 Clinician presses "End now" (second time) ──► end_call at once (the hard stop)
```

How does the proxy learn that `record_intake` has arrived? The tool request goes to
`toolRoutes.js`, which pushes `intake_recorded` through the registry. In Step 7 you built
`onSessionFrame` in the registry, so the proxy can **watch** that session's pushes. The tool
route does not need to know the proxy exists.

## Build it

### Change `src/proxy.js`

**1.** Add `getSession` to the `sessions.js` import, and `onSessionFrame` to the
`registry.js` import:

```js
import { createSession, getSession, updateSession, appendFrame, normalizeMessage } from "./sessions.js";
```

```js
import { registerSession, unregisterSession, onSessionFrame } from "./registry.js";
```

**2.** Update the comment on `RELAY_UP`, because the browser now sends `end_session` too:

```js
const RELAY_UP = new Set(["mark", "ping"]); // browser text frames passed upstream verbatim; end_session and end_call are handled below
```

**3.** Under `const unknownSeen = new Set();`, add the event and its two timers:

```js

const VISIT_ENDING = "visit.ending";
const VISIT_ENDING_HINT = "The clinician has ended the visit. Call record_intake now with what the patient said during the visit, then say nothing more.";
const INTAKE_WAIT_MS = 20000;  // record_intake must land within this after the event, else end_call anyway
const THANKS_GRACE_MS = 4000;  // after intake_recorded, lets the spoken thanks finish before end_call
```

**4.** Under `let customTools = null;`, add three state variables:

```js
  let intakeRecorded = false; // the intake_recorded push for this session was seen (tool route -> registry)
  let ending = null;          // { startedAt, timer, resolved } while end_session waits on record_intake
  let unsubscribe = null;
```

**5.** Above `function shutdown`, add a helper that cancels a pending end:

```js
  function clearEnding() {
    if (!ending) return;
    clearTimeout(ending.timer);
    ending = null;
  }

```

**6.** In `shutdown`, right after `closed = true;`, cancel any timer and stop watching:

```js
    clearEnding();
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
```

**7.** In `endCall`, make `clearEnding();` the first line:

```js
  function endCall(why) {
    clearEnding();
    log.info(`${tag()} end_call (${why})`);
    if (!sendUp({ type: "end_call" })) shutdown(`end_call with no upstream (${why})`);
  }
```

**8.** Under `endCall`, add the three functions that run the flow:

```js

  // The End button. When the session asked for the intake form and it has not landed yet, the agent
  // is told through the visit.ending event and the call ends once record_intake has been saved.
  function endSession() {
    if (ending) return; // already in progress; a second End press arrives as a raw end_call
    const stored = getSession(session.id);
    const recorded = intakeRecorded || Boolean(stored?.intakeRecord);
    const skip = !live ? "call not live" : !session.intake ? "no intake form for this visit" : recorded ? "intake already recorded" : !customTools ? "tools off" : null;
    if (skip) { endCall(`end_session: ${skip}`); return; }
    const sent = sendUp({
      type: "call_event",
      name: VISIT_ENDING,
      hint: VISIT_ENDING_HINT,
      speak: true,
      priority: "interrupt",
      idempotencyKey: `${session.id}-visit-ending`,
    });
    if (!sent) { endCall("end_session: upstream not open"); return; }
    ending = { startedAt: Date.now(), resolved: false, timer: null };
    ending.timer = setTimeout(() => endCall(`${VISIT_ENDING}: no record_intake within ${INTAKE_WAIT_MS / 1000} s`), INTAKE_WAIT_MS);
    log.info(`${tag()} end_session: sent ${VISIT_ENDING}, waiting up to ${INTAKE_WAIT_MS / 1000} s for record_intake`);
  }

  // intake_recorded was pushed to the browser (src/toolRoutes.js through src/registry.js).
  function onIntakeRecorded() {
    intakeRecorded = true;
    if (!ending || ending.resolved) return;
    const waited = Date.now() - ending.startedAt;
    ending.resolved = true;
    clearTimeout(ending.timer);
    ending.timer = setTimeout(() => endCall(`${VISIT_ENDING}: record_intake landed after ${waited} ms, thanks grace over`), THANKS_GRACE_MS);
    log.info(`${tag()} record_intake landed ${waited} ms after ${VISIT_ENDING}; end_call in ${THANKS_GRACE_MS / 1000} s`);
  }

  function onEventStatus(frame) {
    const detail = [frame.status, frame.reason, frame.line ? JSON.stringify(frame.line) : ""].filter(Boolean).join(" ");
    log.info(`${tag()} event_status ${frame.name ?? "?"}: ${detail}`);
    if (!ending || ending.resolved || (frame.name && frame.name !== VISIT_ENDING)) return;
    if (frame.status === "rejected" || frame.status === "dropped") {
      endCall(`${VISIT_ENDING} ${frame.status}${frame.reason ? ` (${frame.reason})` : ""}`);
    }
  }
```

**9.** In `browser.on("message", ...)`, add a line for `end_session` right above the
`end_call` line:

```js
    if (frame.type === "end_session") { endSession(); return; }
```

**10.** In `startSession`, right after `registerSession(session.id, toBrowser);`, start
watching this session's pushes:

```js
    unsubscribe = onSessionFrame(session.id, (pushed) => { if (pushed?.type === "intake_recorded") onIntakeRecorded(); });
```

**11.** In `upstream.on("message", ...)`, add an `event_status` branch right above the
`call_ended` branch:

```js
      } else if (frame.type === "event_status") {
        onEventStatus(frame);
```

Your `src/proxy.js` now matches the repo's. Compare them with
`diff src/proxy.js <the repo's copy>` if you have the repo next to yours.

What the new parts do:

- **`endSession`** decides whether waiting is worth it. The chained `? :` checks four
  reasons to skip the wait, and the first one that applies becomes the log message: the
  call is not live, no form was wanted, the form is already saved (checked in memory and in
  the session file), or tools are off. If none applies, it sends the event and starts the
  20-second timer.
- **`ending`** is a small object that exists only while the server waits.
  `if (ending) return;` at the top ignores a second `end_session`.
- **`onIntakeRecorded`** is called by the registry watcher. It marks the form as saved,
  swaps the 20-second timer for the 4-second "let the thanks finish" timer, and logs how
  long the AI took. `resolved` makes sure this happens only once.
- **`onEventStatus`** logs every status. If the `visit.ending` event was `rejected` or
  `dropped` while the server waits, waiting is pointless, so it hangs up at once.
- **`clearEnding`** in `endCall` and `shutdown` cancels any timer, so a timer can never fire
  after the call has already ended.

### Change `public/app.js`

**1.** Under `let closeAudioWhenDrained = false;`, add:

```js
let intakeFormOn = true;   // the checkbox at Start, echoed by session_created
let toolsOn = true;        // tools_enabled from session_created: the intake form can only land when tools are on
let endRequested = false;  // End pressed once: end_session sent; a second press sends end_call
```

**2.** In `start`, right after `clearCards();`, reset the End button:

```js
  endRequested = false;
  ui.end.textContent = "End session";
```

**3.** In `handleFrame`, at the top of the `session_created` case (right under
`case "session_created":`), remember what the server confirmed:

```js
      intakeFormOn = frame.intake === true;
      toolsOn = frame.tools_enabled !== false;
```

**4.** In the `intake_recorded` case, under `showIntake(frame.intake);`, add:

```js
      if (endRequested) notice("Intake form saved. The session closes in a moment.", "info");
```

**5.** Replace the whole `endSession` function from Step 5 (and the comment above it) with
these two functions:

```js
// First press: end_session. The server raises the visit.ending event and ends the call once the
// intake form has been saved (or at once when there is nothing to save). A second press, or 25 s,
// sends the hard end_call.
function endSession() {
  if (endRequested) { hardEnd(); return; }
  endRequested = true;
  setStatus("connecting", "Ending");
  setPhase("Wrapping up");
  wsSend(JSON.stringify({ type: "end_session" }));
  if (intakeFormOn && toolsOn && ui.intakeCard.hidden) {
    notice("Saving intake notes… The session closes by itself; press End again to close it now.", "info");
    ui.end.textContent = "End now";
    endTimer = setTimeout(hardEnd, 25000);
  } else {
    ui.end.disabled = true;
    endTimer = setTimeout(() => { if (ws) ws.close(); }, 4000); // in case call_ended never comes
  }
}

function hardEnd() {
  ui.end.disabled = true;
  clearTimeout(endTimer);
  wsSend(JSON.stringify({ type: "end_call" }));
  endTimer = setTimeout(() => { if (ws) ws.close(); }, 4000); // in case call_ended never comes
}
```

`hardEnd` is your old `endSession` under a new name.

**6.** At the end of `cleanup`, under `ui.end.disabled = true;`, reset the button for the
next session:

```js
  ui.end.textContent = "End session";
  endRequested = false;
```

Your `public/app.js` now matches the repo's.

- **First press**: `end_session`. If a form is expected and the intake card is not showing
  yet, the page says "Saving intake notes…", relabels the button "End now", and sets its
  own 25-second limit.
- **Second press** (or 25 seconds): `hardEnd` sends `end_call`. The proxy passes that
  straight on, whatever it was waiting for.
- **25 seconds on the page against 20 + 4 on the server**: the server's timers finish first
  in the normal case. The page's timer only matters if something goes wrong.

## Try it

1. Restart the server. Start a session with **"Fill the intake form"** ticked.
2. Do the opening, then speak as the patient for a little while: why you came, since when,
   how bad the pain is, any allergies.
3. Press **End session** once. Watch the page and the server log:

   ```
   [session ...] end_session: sent visit.ending, waiting up to 20 s for record_intake
   [session ...] event_status visit.ending: queued
   [session ...] record_intake landed 3120 ms after visit.ending; end_call in 4 s
   [tools] [session ...] record_intake: stomach pain since yesterday
   [session ...] end_call (visit.ending: record_intake landed after 3120 ms, thanks grace over)
   [session ...] closed (customer-ended-call); 14 transcript lines saved
   ```

   (Your lines and times will differ. The "landed" line comes before the `[tools]` line
   because the tool route pushes the frame, and the proxy's watcher runs, before the route
   writes its own log line.) The intake card appears, the AI thanks the patient,
   and the call closes by itself.
4. Start again with the box **unticked** and press End: the call closes at once
   (`end_session: no intake form for this visit`).
5. Start again, press End, then **End now** straight away: the call closes at once.

If the log shows `event_status visit.ending: rejected not_enabled_for_call`, the agent has
`callEvents` off. Run `npm run setup` again.

## Why it is written this way

- **The server makes the decision, not the page.** The server knows whether tools are on
  and whether the form is already saved. The page only says "the clinician pressed End".
- **Every wait has a limit.** A stuck AI, a dropped event or a lost network message all end
  in a timer that hangs up anyway. In a clinic, "the app will not close" is not acceptable.
- **Watchers instead of wiring.** The proxy subscribes to the registry
  (`onSessionFrame`) instead of the tool route calling into the proxy. Each file only knows
  about the registry.
- **A grace period for politeness.** The form arrives while the AI is still saying its
  short thanks. Hanging up at once would cut it off mid-word.

## Recap

- `call_event` frames tell the live AI something happened. `event_status` frames say what
  became of the event.
- End now runs a short, time-limited flow: event → form → thanks → hang up.
- A second press always hangs up at once.
- `src/proxy.js` and `public/app.js` are now complete.

Next: [Step 9: the end-of-call report](09-end-of-call-webhook.md).
