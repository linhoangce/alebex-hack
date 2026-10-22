# Step 5: Sound in the browser

**Goal:** build the page that captures the microphone, sends it to your server, plays the AI's
voice, and shows a live transcript. At the end of this step you have your first real
conversation.

**Files you create:** `public/index.html`, `public/styles.css`,
`public/capture-worklet.js`, `public/app.js` (first version)

## The idea

### Sound is a list of numbers

A microphone measures air pressure many times a second. Each measurement is one **sample**.

```
 air pressure
   +1 ┤      ●●                 ●●
      │    ●    ●             ●    ●
    0 ┤──●────────●─────────●────────●──── time
      │             ●     ●
   -1 ┤               ●●●
        │◄────── 1 sample every 1/16000 of a second (at 16 kHz)
```

The browser gives you samples as decimal numbers between -1 and +1, usually 48,000 per
second. The engine wants something else:

| | The browser gives | The engine wants (microphone) | The engine sends (voice) |
|---|---|---|---|
| Samples per second | 48,000 (or 44,100) | 16,000 | 24,000 |
| Number type | decimals from -1 to +1 | whole numbers, -32768 to 32767 (**PCM16**) | PCM16 |
| Channels | 1 or 2 | 1 (mono) | 1 |
| Packaging | blocks of 128 samples | **20 ms frames**: 320 samples = 640 bytes, as binary | `audio` JSON frames, base64 text |

So the page has two jobs: **convert on the way out** and **convert back on the way in**.

### The way out: microphone to engine

```
 microphone
     │  48,000 decimals per second
     ▼
 AudioContext ──► AudioWorklet "pcm16-capture"   (runs on the audio thread)
                   1. resample 48,000/s → 16,000/s
                   2. decimal -1..+1  → whole number -32768..32767
                   3. collect 320 samples = one 20 ms frame (640 bytes)
     │  posts each frame to the page
     ▼
 app.js ──► is the call live? is the agent talking (half-duplex)? ──► WebSocket (binary)
```

**Resampling** means changing the number of samples per second. With 48,000 in and 16,000
out, you could keep every third sample. But some microphones run at 44,100, and
44,100 / 16,000 = 2.75625, which is not a whole number. So the worklet uses **linear
interpolation**: when an output sample falls between two input samples, it takes the value
part of the way between them.

```
 input samples:   s2 = 0.20          s3 = 0.60
                    ●─────────────────────●
 output wanted at position 2.75:  0.20 + (0.60 - 0.20) × 0.75 = 0.50
```

### The way in: engine voice to speaker

```
 {"type":"audio","data":"<base64>","sample_rate":24000}
     │ base64 text → bytes → whole numbers → decimals (÷ 32768)
     ▼
 AudioBuffer (24,000/s; the AudioContext converts it to its own rate)
     │ scheduled to start exactly when the previous chunk ends
     ▼
 speaker
```

Audio arrives in small chunks. If each chunk simply started when it arrived, you would hear
gaps and overlaps. So the page keeps a **playhead**: the time when the last scheduled chunk
will end. Each new chunk starts there. The first chunk starts 180 ms in the future, which
gives a small cushion if a later chunk is a little late.

```
 time ─────────────────────────────────────────────────────────►
 now  +0.18 s
  │     [ chunk 1 ][ chunk 2 ][ chunk 3 ]
  │                                     ▲ playhead
```

### The mark rule

After the last chunk of each sentence, the engine sends a `mark`. The page must **hold** the
mark and send it back only when every chunk before it has **finished playing**.

```
 engine sends:   audio  audio  audio  mark
 page plays:     [ chunk ][ chunk ][ chunk ]
                                           ▲ the last chunk ends: NOW echo the mark
```

The echo is how the engine knows the listener has heard the whole sentence. If you echo too
early, the engine thinks the AI has stopped talking while the speaker is still playing, and
nobody can interrupt it. Also, until the greeting's mark comes back, the engine ignores the
microphone.

### Interrupting: `clear_audio`

If someone starts talking while the AI is speaking, the engine sends `clear_audio`. The
page must stop **everything already scheduled**, not just the queue, and echo any held
marks.

### Speakers and half-duplex

With speakers instead of headphones, the microphone hears the AI's own voice. The engine
then thinks someone is interrupting, and the AI stops itself. The fix is a checkbox, "Mute
mic while the interpreter speaks". While the AI is talking, the page sends **silence**
instead of the microphone. It still sends a frame every 20 ms, because the engine expects
a steady stream for the whole call. (Half-duplex means only one side talks at a time, like
a walkie-talkie.)

## Build it

### `public/index.html`

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>An - Your Trusted Interpreter</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main>
    <header>
      <h1>An - Your Trusted Interpreter</h1>
      <nav><a href="sessions.html">Past sessions</a></nav>
    </header>

    <!-- 1. Controls and status -->
    <section class="panel">
      <form id="session-form" autocomplete="off">
        <div class="grid">
          <label>Patient's language
            <select name="language" id="language"><option value="">Loading…</option></select>
          </label>
          <label class="toggle"><input type="checkbox" id="fill-intake" checked /> Fill the intake form at the end of the visit</label>
        </div>
        <div class="controls">
          <button type="submit" id="start">Start session</button>
          <button type="button" id="end" disabled>End session</button>
          <label class="toggle"><input type="checkbox" id="half-duplex" checked /> Mute mic while the interpreter speaks (speakers)</label>
        </div>
      </form>
      <div class="controls">
        <span id="status" class="status" data-state="idle">Idle</span>
        <span id="phase" class="phase" hidden></span>
        <span class="meta" id="call-id"></span>
      </div>
      <div id="notice" class="notice"></div>
    </section>

    <!-- 2. Urgent banner (filled in Step 7) -->
    <div id="urgent-banner" class="banner urgent" hidden role="alert">
      <div class="banner-body"><strong>Urgent symptom reported</strong><span id="urgent-text"></span></div>
      <button type="button" id="urgent-dismiss">Dismiss</button>
    </div>

    <!-- 3. Who is in the room (filled in Step 7) -->
    <section class="panel card" id="session-card" hidden>
      <h2>In the room</h2>
      <dl>
        <dt>Clinician</dt><dd id="card-clinician">—</dd>
        <dt>Patient</dt><dd id="card-patient">—</dd>
        <dt>Form of address</dt><dd id="card-address">—</dd>
      </dl>
    </section>

    <!-- 4. Intake form (filled in Step 7) -->
    <section class="panel card" id="intake-card" hidden>
      <h2>Intake <span id="intake-urgent" class="tag urgent" hidden>Urgent</span></h2>
      <dl id="intake-fields"></dl>
    </section>

    <!-- 5. Live transcript -->
    <section class="panel">
      <div id="transcript" class="transcript">
        <div class="empty">The transcript appears here once the session starts.</div>
      </div>
    </section>
  </main>
  <script src="app.js"></script>
</body>
</html>
```

The repo's file has the same elements and ids, just spread over more lines (it was run
through a code formatter). The comments here are added to help you find your way.

- **Every element the script needs has an `id`.** `app.js` finds them with
  `document.getElementById`.
- **The cards and the banner are written now but stay `hidden`.** Step 7 fills them.
- **The Start button is a `submit` button inside a `<form>`**, so pressing Enter also
  starts a session.
- **`role="alert"`** on the banner makes screen readers announce it straight away.
- **The `<script>` is the last thing in `<body>`**, so every element exists by the time the
  script runs.

### `public/styles.css`

Styling is not the focus of this course. Copy the file from the repo, or expand it below.
Five ideas in it are worth knowing:

1. **Colours are variables** in `:root` (`--accent`, `--danger`, ...), so the whole palette
   can be changed in one place.
2. **The status pill changes colour from a data attribute.** The script sets
   `data-state="live"`, and the CSS rule `.status[data-state="live"]` turns it green. The
   script never touches colours.
3. **`[hidden]` needs help.** The browser's built-in rule for `hidden` is easy to beat. A
   rule like `.banner { display: flex }` wins, and the "hidden" banner shows up anyway. So
   the file adds `.banner[hidden] { display: none; }` (and the same for `.phase` and
   `.tag`).
4. **Chat bubbles.** The transcript is a flex column. `.msg.caller` sits on the left
   (`align-self: flex-start`), and `.msg.agent` on the right (`flex-end`). Lines still being
   spoken (`.partial`) are faded and in italics.
5. **Big touch targets.** Buttons are at least 48 px tall, for a tablet in an exam room.

<details>
<summary>The full <code>public/styles.css</code></summary>

```css
:root {
  --bg: #f4f6f8;
  --panel: #ffffff;
  --ink: #1b2430;
  --muted: #5f6b7a;
  --line: #d9dee5;
  --accent: #1f6feb;
  --live: #1a7f37;
  --warn: #b35c00;
  --danger: #c62828;
  --caller: #eef3ff;
  --agent: #f1f8f1;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 17px;
  line-height: 1.4;
  color: var(--ink);
  background: var(--bg);
}
main { max-width: 760px; margin: 0 auto; padding: 16px; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
header h1 { font-size: 1.25rem; margin: 0; }
header nav a { color: var(--accent); text-decoration: none; font-size: 0.95rem; }

.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px; margin-bottom: 12px; }
.grid { display: grid; grid-template-columns: 1fr; gap: 10px; }
@media (min-width: 560px) { .grid { grid-template-columns: 1fr 1fr; } }
label { display: flex; flex-direction: column; gap: 4px; font-size: 0.9rem; color: var(--muted); }
input, select { font: inherit; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: #fff; color: var(--ink); }
input:focus, select:focus { outline: 2px solid var(--accent); outline-offset: 1px; }

.controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
button { font: inherit; font-weight: 600; padding: 12px 18px; border-radius: 10px; border: 1px solid transparent; cursor: pointer; min-height: 48px; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
#start { background: var(--accent); color: #fff; }
#end { background: #fff; color: var(--danger); border-color: var(--danger); }
.toggle { display: flex; flex-direction: row; align-items: center; gap: 8px; font-size: 0.95rem; color: var(--muted); margin-left: auto; }
.grid .toggle { margin-left: 0; align-self: end; min-height: 44px; }
.toggle input { width: 22px; height: 22px; }

.status { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; font-size: 0.9rem; font-weight: 600; background: #e9ecf1; color: var(--muted); }
.status::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: currentColor; }
.status[data-state="connecting"] { background: #fff4e5; color: var(--warn); }
.status[data-state="live"] { background: #e6f4ea; color: var(--live); }
.status[data-state="ended"] { background: #fdecea; color: var(--danger); }
.phase { display: inline-flex; align-items: center; padding: 6px 12px; border-radius: 999px; font-size: 0.9rem; font-weight: 600; background: #eef3ff; color: #1b3a7a; }
.phase[hidden] { display: none; }
.meta { font-size: 0.85rem; color: var(--muted); margin-top: 8px; word-break: break-all; }

.notice { display: none; padding: 10px 12px; border-radius: 8px; font-size: 0.95rem; margin-top: 10px; }
.notice.info { display: block; background: #eef3ff; color: #1b3a7a; }
.notice.error { display: block; background: #fdecea; color: var(--danger); }

.banner { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-radius: 12px; margin-bottom: 12px; }
.banner[hidden] { display: none; }
.banner.urgent { background: #fdecea; border: 2px solid var(--danger); color: var(--danger); }
.banner-body { display: flex; flex-direction: column; gap: 2px; font-size: 1rem; }
.banner-body strong { text-transform: uppercase; letter-spacing: 0.04em; font-size: 0.85rem; }
.banner button { background: #fff; color: var(--danger); border-color: var(--danger); padding: 8px 14px; min-height: 40px; }

.card h2 { display: flex; align-items: center; gap: 8px; }
.card dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 0; }
.card dt { color: var(--muted); font-size: 0.9rem; }
.card dd { margin: 0; font-size: 1.05rem; }
.card dd.muted { grid-column: 1 / -1; color: var(--muted); }
@media (max-width: 420px) { .card dl { grid-template-columns: 1fr; gap: 2px; } .card dt { margin-top: 8px; } }
.tag { display: inline-block; padding: 1px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; vertical-align: middle; }
.tag.urgent { background: var(--danger); color: #fff; }
.tag[hidden] { display: none; }

.transcript { min-height: 240px; max-height: 60vh; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.transcript .empty { color: var(--muted); font-size: 0.95rem; text-align: center; padding: 40px 0; }
.msg { padding: 10px 12px; border-radius: 12px; max-width: 92%; border: 1px solid var(--line); }
.msg.caller { background: var(--caller); align-self: flex-start; }
.msg.agent { background: var(--agent); align-self: flex-end; }
.msg.partial { opacity: 0.6; font-style: italic; }
.msg .head { display: flex; gap: 8px; align-items: center; font-size: 0.75rem; color: var(--muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
.msg .lang { padding: 1px 6px; border-radius: 6px; background: #fff; border: 1px solid var(--line); font-weight: 700; }
.msg .lang.vi { color: #8a2d9a; }
.msg .lang.zh { color: #b3261e; }
.msg .lang.en { color: #1f6feb; }
.msg p { margin: 0; font-size: 1.05rem; }

.list { display: flex; flex-direction: column; gap: 8px; }
.list a { display: block; padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: #fff; color: var(--ink); text-decoration: none; }
.list a:hover { border-color: var(--accent); }
.list small { color: var(--muted); }
pre.block { white-space: pre-wrap; background: #f7f8fa; border: 1px solid var(--line); border-radius: 8px; padding: 10px; font-size: 0.9rem; }
h2 { font-size: 1.05rem; margin: 0 0 10px; }
.flag { background: #fdecea; border: 1px solid var(--danger); color: var(--danger); border-radius: 8px; padding: 8px 10px; margin-bottom: 6px; }
#detail .card { border: 1px solid var(--line); border-radius: 10px; padding: 12px; margin-bottom: 12px; }
audio { width: 100%; max-width: 480px; display: block; margin-bottom: 6px; }
```

</details>

### `public/capture-worklet.js`: microphone to 16 kHz frames

An **AudioWorklet** is a small piece of code that runs on the browser's audio thread, apart
from the page. The browser calls its `process()` method with each new block of 128 samples,
about 375 times a second at 48 kHz. Doing the conversion there keeps it smooth even when
the page is busy.

```js
// AudioWorklet: resamples the microphone from the context rate to 16 kHz (linear interpolation),
// packs 320 samples (20 ms) as PCM16 little-endian and posts one 640-byte buffer per frame.
class Pcm16Capture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.targetRate = o.targetRate || 16000;
    this.frameSamples = o.frameSamples || 320;
    this.step = sampleRate / this.targetRate; // input samples per output sample
    this.pos = 0;   // position of the next output sample, in input samples, relative to the current block
    this.prev = 0;  // last input sample of the previous block, for interpolation across the boundary
    this.frame = new Int16Array(this.frameSamples);
    this.n = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];
    const N = ch.length;
    let t = this.pos;
    while (t < N - 1) {
      const i = Math.floor(t);
      const frac = t - i;
      const s0 = i < 0 ? this.prev : ch[i];
      const s1 = ch[i + 1];
      const s = s0 + (s1 - s0) * frac;
      const v = s < -1 ? -1 : s > 1 ? 1 : s;
      this.frame[this.n++] = v < 0 ? v * 32768 : v * 32767;
      if (this.n === this.frameSamples) {
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
        this.frame = new Int16Array(this.frameSamples);
        this.n = 0;
      }
      t += this.step;
    }
    this.pos = t - N;
    this.prev = ch[N - 1];
    return true; // output stays silent; the node is connected to the destination only to keep processing
  }
}

registerProcessor("pcm16-capture", Pcm16Capture);
```

Line by line:

- **`sampleRate`** is a global inside a worklet: the input rate, for example 48000.
  `this.step` is how many input samples make one output sample (48000 / 16000 = 3).
- **`t`** is the position of the next output sample, counted in input samples. It moves
  forward by `step` each time: 0, 3, 6, 9, ... At 44.1 kHz it would move 0, 2.75625,
  5.5125, ...
- **Interpolation**: `i` is the whole part of `t` and `frac` the fraction. The output is
  `s0 + (s1 - s0) * frac`, a point on the straight line between two neighbouring samples.
- **Across blocks**: when a block ends, `this.pos = t - N` remembers how far into the *next*
  block the next output sample falls. `this.prev` keeps the last sample, because the next
  interpolation may need it (that is the `i < 0` case).
- **Clamping**: `v` is forced into -1..+1, in case the microphone overshoots.
- **Decimal to whole number**: negative values times 32768 and positive values times 32767,
  because a 16-bit number goes from -32768 to +32767. `Int16Array` stores them
  little-endian (low byte first) on every common computer, which is what the engine expects.
- **One frame = 320 samples.** When it is full, `postMessage(buffer, [buffer])` sends it to
  the page. The second argument **transfers** the memory instead of copying it, and then a
  fresh `Int16Array` is made for the next frame.
- **`return true`** keeps the worklet alive. Its output is silent. The page connects it to
  the speakers only because the browser stops calling `process()` on a node that goes
  nowhere.

### `public/app.js`: the page script (first version)

Steps 7 and 8 add cards and a smarter End button. This first version does the sound and
the transcript.

```js
// Browser client: mic -> PCM16 16 kHz mono 20 ms frames -> /ws/session -> server proxy -> Alebex.
// Playback follows AGENTS.md "Run a browser call": hold each mark until the audio before it has
// played out, stop everything on clear_audio. A half-duplex guard mutes the mic while the agent
// is speaking so the agent's own voice from the speakers is not heard as a barge-in.
// Nothing is typed: the agent collects the names by voice, the clinician leads the visit, and the
// intake form is filled at the end from what was said. The server pushes session_details,
// intake_recorded and urgent_flag frames here when the engine calls its tools. End sends
// end_session: the server raises the visit.ending event, waits for record_intake, then ends the call.

const $ = (id) => document.getElementById(id);
const ui = {
  form: $("session-form"), start: $("start"), end: $("end"), status: $("status"), phase: $("phase"),
  transcript: $("transcript"), halfDuplex: $("half-duplex"), callId: $("call-id"), notice: $("notice"),
  language: $("language"), fillIntake: $("fill-intake"),
};

const VI_RE = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const CJK_RE = /[㐀-鿿]/;
const ZERO_FRAME = new ArrayBuffer(640);
let WS_PATH = "/ws/session";          // from /api/config: a hosted deployment may route the socket elsewhere
let MAX_SESSION_SECONDS = null;       // from /api/config: hosted sessions end at the function duration limit
const LANG_MARK_RE = /^\[LANG:[a-z]+\]\s*/i; // the engine's language mark on some transcript lines; speech is unaffected

let ws = null;
let ctx = null;
let stream = null;
let workletNode = null;
let pingTimer = null;
let endTimer = null;
let live = false;
let closeAudioWhenDrained = false;

// Playback state, per the AGENTS.md snippet.
const playing = new Set();
const heldMarks = [];
let playhead = 0;

function wsSend(data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
}
const sendHeldMarks = () => { while (heldMarks.length) wsSend(JSON.stringify(heldMarks.shift())); };

function play(frame) {
  if (!ctx) return;
  const bytes = Uint8Array.from(atob(frame.data), (c) => c.charCodeAt(0));
  const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  if (!pcm.length) return;
  const buf = ctx.createBuffer(1, pcm.length, frame.sample_rate || 24000); // the context resamples to its own rate
  buf.getChannelData(0).set(Float32Array.from(pcm, (s) => s / 32768));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  if (playhead <= ctx.currentTime) playhead = ctx.currentTime + 0.18; // first chunk, or drained
  src.start(playhead);
  playhead += buf.duration;
  playing.add(src);
  src.onended = () => {
    playing.delete(src);
    if (playing.size === 0) {
      sendHeldMarks();
      if (closeAudioWhenDrained) closeAudio();
    }
  };
}

function stopPlayback() {
  for (const s of playing) { try { s.stop(); } catch {} }
  playing.clear();
  playhead = 0;
  sendHeldMarks();
}

function setStatus(state, text) {
  ui.status.dataset.state = state;
  ui.status.textContent = text;
}

function setPhase(text) {
  ui.phase.hidden = !text;
  ui.phase.textContent = text || "";
}

function notice(text, kind) {
  ui.notice.className = `notice ${kind || "info"}`;
  ui.notice.textContent = text;
}

const langOf = (text) => (VI_RE.test(text) ? "vi" : CJK_RE.test(text) ? "zh" : "en");

// --- Server config: the language list ---
async function loadConfig() {
  try {
    const cfg = await (await fetch("/api/config")).json();
    WS_PATH = cfg.wsPath || WS_PATH;
    MAX_SESSION_SECONDS = cfg.maxSessionSeconds ?? null;
    const langs = cfg.languages || [];
    ui.language.innerHTML = "";
    for (const l of langs) {
      const opt = document.createElement("option");
      opt.value = l.code;
      opt.textContent = l.name;
      ui.language.append(opt);
    }
    if (!langs.length) {
      ui.language.innerHTML = '<option value="">No language packs</option>';
      ui.start.disabled = true;
      notice("No language pack is set up on the server. Run npm run setup.", "error");
    }
  } catch {
    notice("Could not load /api/config from the server.", "error");
  }
}

// --- Transcript rendering. Observed shape on the first live call:
//   {"type":"conversation_message","role":"assistant","content":"...","timestamp":"..."}
// The `transcript` frame (what the engine heard) is read defensively. ---
const pending = {}; // role -> bubble element for an in-progress (partial) line

function describe(frame) {
  const text = String(frame.content ?? frame.text ?? frame.message ?? frame.transcript ?? "").replace(LANG_MARK_RE, "");
  let role = String(frame.role ?? frame.speaker ?? frame.source ?? (frame.type === "transcript" ? "caller" : "agent")).toLowerCase();
  if (["user", "caller", "customer", "human"].includes(role)) role = "caller";
  if (["assistant", "agent", "ai", "bot"].includes(role)) role = "agent";
  const final = frame.final ?? frame.is_final ?? frame.isFinal ?? (frame.partial === undefined ? true : !frame.partial);
  return { role, text: String(text), final: Boolean(final) };
}

function renderMessage(frame) {
  const { role, text, final } = describe(frame);
  if (!text.trim()) return;
  const empty = ui.transcript.querySelector(".empty");
  if (empty) empty.remove();

  let el = pending[role];
  if (!el) {
    el = document.createElement("div");
    el.innerHTML = '<div class="head"><span class="who"></span><span class="lang"></span></div><p></p>';
    ui.transcript.appendChild(el);
  }
  const lang = langOf(text);
  el.className = `msg ${role}${final ? "" : " partial"}`;
  el.querySelector(".who").textContent = role === "agent" ? "Interpreter" : "Room";
  el.querySelector(".lang").textContent = lang.toUpperCase();
  el.querySelector(".lang").className = `lang ${lang}`;
  el.querySelector("p").textContent = text;
  pending[role] = final ? null : el;
  ui.transcript.scrollTop = ui.transcript.scrollHeight;
}

// --- Session lifecycle ---
async function start(event) {
  event.preventDefault();
  const language = ui.language.value;
  const intake = ui.fillIntake.checked;
  if (!language) { notice("Pick the patient's language first.", "error"); return; }
  ui.start.disabled = true;
  ui.notice.className = "notice";
  ui.callId.textContent = "";
  ui.transcript.innerHTML = '<div class="empty">Connecting…</div>';
  setPhase("");
  setStatus("connecting", "Connecting");
  try {
    ctx = new AudioContext(); // one context, default rate, created inside the click
    await ctx.audioWorklet.addModule("capture-worklet.js");
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const source = ctx.createMediaStreamSource(stream);
    workletNode = new AudioWorkletNode(ctx, "pcm16-capture", {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      processorOptions: { targetRate: 16000, frameSamples: 320 },
    });
    source.connect(workletNode);
    workletNode.connect(ctx.destination); // the worklet outputs silence; this keeps it processing
    workletNode.port.onmessage = (e) => {
      if (!live) return;
      const agentTalking = playing.size > 0 || heldMarks.length > 0;
      wsSend(ui.halfDuplex.checked && agentTalking ? ZERO_FRAME : e.data);
    };
    openSocket({ language, intake });
  } catch (err) {
    setStatus("ended", "Could not start");
    notice(`Microphone or audio setup failed: ${err.message}`, "error");
    cleanup();
  }
}

function openSocket({ language, intake }) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}${WS_PATH}`);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "session_start", language, intake }));
  };
  ws.onmessage = (e) => {
    if (typeof e.data !== "string") return;
    let frame;
    try { frame = JSON.parse(e.data); } catch { return; }
    handleFrame(frame);
  };
  ws.onclose = () => {
    if (ui.status.dataset.state !== "ended") {
      setStatus("ended", "Disconnected");
      if (MAX_SESSION_SECONDS && live) notice(`Hosted sessions end after ${Math.round(MAX_SESSION_SECONDS / 60)} minutes. Start a new session to continue.`, "info");
    }
    cleanup();
  };
  ws.onerror = () => notice("Connection to the server failed.", "error");
}

function handleFrame(frame) {
  switch (frame.type) {
    case "session_created":
      ui.callId.textContent = `session ${frame.session_id}`;
      break;
    case "call_started": {
      // Arrives after the greeting's audio and mark, so the greeting bubble may already be on screen.
      live = true;
      setStatus("live", "Live");
      setPhase("Opening");
      ui.end.disabled = false;
      ui.callId.textContent += ` · call ${frame.call_id}`;
      const empty = ui.transcript.querySelector(".empty");
      if (empty) empty.textContent = "Listening. Speak a few sentences at a time.";
      pingTimer = setInterval(() => wsSend(JSON.stringify({ type: "ping" })), 15000);
      break;
    }
    case "audio":
      play(frame);
      break;
    case "mark":
      heldMarks.push(frame);
      if (playing.size === 0) sendHeldMarks();
      break;
    case "clear_audio":
      stopPlayback();
      break;
    case "transcript":
    case "conversation_message":
      renderMessage(frame);
      break;
    case "call_ended":
      setStatus("ended", `Ended${frame.reason ? `: ${frame.reason}` : ""}`);
      setPhase("Ended");
      cleanup();
      break;
    case "error":
      notice(`${frame.code}: ${frame.message}`, "error");
      break;
    case "pong":
      break;
    default:
      console.debug("frame", frame);
  }
}

// End: tell the server to hang up. If call_ended never comes back, close the socket after 4 s.
function endSession() {
  ui.end.disabled = true;
  clearTimeout(endTimer);
  wsSend(JSON.stringify({ type: "end_call" }));
  endTimer = setTimeout(() => { if (ws) ws.close(); }, 4000); // in case call_ended never comes
}

function closeAudio() {
  closeAudioWhenDrained = false;
  if (ctx) { ctx.close().catch(() => {}); ctx = null; }
}

function cleanup() {
  live = false;
  clearInterval(pingTimer);
  clearTimeout(endTimer);
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (workletNode) { workletNode.port.onmessage = null; workletNode.disconnect(); workletNode = null; }
  heldMarks.length = 0;
  if (playing.size > 0) closeAudioWhenDrained = true; // let the last words play out
  else closeAudio();
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  ws = null;
  ui.start.disabled = false;
  ui.end.disabled = true;
}

ui.form.addEventListener("submit", start);
ui.end.addEventListener("click", endSession);
loadConfig();
```

As with `proxy.js`, the comment at the top already describes the finished file.

#### The top: elements and state

- **`$` and `ui`**: a short name for `getElementById`, and one object holding every element
  the script uses.
- **`VI_RE` and `CJK_RE`** recognise Vietnamese letters with accents and Chinese
  characters. They are only used to put a small "VI", "ZH" or "EN" label on each bubble.
- **`ZERO_FRAME`**: 640 bytes of zeros, which is 20 ms of silence. The half-duplex guard
  sends it.
- **`LANG_MARK_RE`**: with two voices, the engine puts a mark such as `[LANG:vi]` in front
  of some lines in the transcript. It is never spoken, but it must be removed before the
  text is shown.
- **State variables**: `ws` (the socket), `ctx` (the AudioContext), `stream` (the
  microphone), `live` (true after `call_started`), and the playback state below.

#### Playback: `play`, `stopPlayback`, marks

- **`play(frame)`** turns one `audio` frame into sound:
  1. `atob` turns base64 into a "binary string" with one character per byte, and
     `Uint8Array.from(..., c => c.charCodeAt(0))` turns that into real bytes.
  2. `new Int16Array(bytes.buffer, 0, bytes.length >> 1)` reads every 2 bytes as one
     16-bit number. `>> 1` divides by 2.
  3. `s / 32768` turns each number back into a decimal from -1 to +1.
  4. `ctx.createBuffer(1, length, 24000)` makes a one-channel buffer at the engine's rate.
     The AudioContext converts it to the speaker's rate by itself.
  5. It schedules the chunk at `playhead`, then moves `playhead` forward by the chunk's
     length.
  6. It keeps every playing chunk in the `playing` set. When the last one ends,
     `onended` echoes any held marks. That is the mark rule.
- **`case "mark"`**: hold the mark. If nothing is playing, echo it at once.
- **`stopPlayback()`** (for `clear_audio`) stops every scheduled chunk, resets the
  playhead, and echoes held marks.

#### Small screen helpers

`setStatus` sets the pill's text and its `data-state` (the CSS colours it). `setPhase` shows
a second pill such as "Opening". `notice` shows a message box. All of them use
`textContent`, which shows text exactly as it is and never runs it as HTML.

#### `loadConfig`

When the page loads, it asks `/api/config` for the language list and fills the drop-down.
With no languages, it disables Start and explains why.

#### The transcript: `describe` and `renderMessage`

- **`describe(frame)` reads defensively.** On the first live call, the developers saw
  `conversation_message` frames shaped like `{role, content, timestamp}`. Other frame types
  might name the same things differently, so the code tries several field names
  (`content ?? text ?? message ?? transcript`) and turns many role names into two:
  `caller` and `agent`.
- **Partial lines.** Speech-to-text can send a line while it is still being spoken, then
  the final version. `pending[role]` remembers the bubble still in progress for each role,
  so the next update changes that bubble instead of adding a new one. A final line clears
  it.
- `ui.transcript.scrollTop = ui.transcript.scrollHeight` keeps the newest line in view.

#### Starting: `start()`

1. **`event.preventDefault()`** stops the form from reloading the page.
2. **`new AudioContext()` runs inside the click.** Browsers block sound until the user has
   clicked something, so the context must be made in the click handler.
3. **`addModule("capture-worklet.js")`** loads the worklet.
4. **`getUserMedia`** asks for the microphone (the browser shows a permission prompt). Echo
   cancellation, noise suppression and automatic gain are all on: on speakers, echo
   cancellation is your first defence against the AI hearing itself.
5. **The chain**: microphone → `source` → worklet → speakers (silent).
6. **`port.onmessage`** receives each 640-byte frame from the worklet. It sends nothing
   before `live`. While the AI is talking (`playing.size > 0` or marks are held) and the
   checkbox is on, it sends `ZERO_FRAME` instead.
7. **`openSocket`**. If anything fails (for example, the microphone is blocked), the
   `catch` shows the reason and cleans up.

#### The socket: `openSocket()` and `handleFrame()`

- `wss` on an `https` page, `ws` on `http`. Browsers block a plain `ws` socket from a secure
  page.
- `binaryType = "arraybuffer"`: binary frames arrive as raw bytes. (The page ignores them
  anyway: the engine sends audio as JSON text frames.)
- **`onopen`** sends `session_start` with the language and the intake checkbox.
- **`handleFrame`** is one `switch` over `frame.type`:
  - `session_created`: show the session id.
  - `call_started`: go live, enable End, and send a `ping` every 15 seconds. The engine
    answers with `pong`, and the regular traffic stops anything along the way from
    closing a quiet connection.
  - `audio`, `mark`, `clear_audio`: playback, as above.
  - `transcript`, `conversation_message`: add to the transcript.
  - `call_ended`: show the reason and clean up.
  - `error`: show it.

#### Ending and cleaning up

- **`endSession()`** sends `end_call`. If `call_ended` never comes back, it closes the
  socket after 4 seconds anyway. (Step 8 makes this smarter.)
- **`cleanup()`** stops the microphone (`track.stop()` turns off the browser's recording
  light), disconnects the worklet, closes the socket and resets the buttons. If the AI is
  still speaking, `closeAudioWhenDrained` lets the last words finish before the
  AudioContext closes.

## Try it: your first conversation

1. Put on headphones if you have them.
2. Start the server (`npm start`) and open `http://localhost:3000` in Chrome or Edge.
3. Pick Vietnamese and press **Start session**. Allow the microphone.
4. You should hear: "Hello. I'm an A I interpreter between English and Vietnamese...". The
   status turns green ("Live") and the greeting appears in the transcript.
5. Answer as the clinician: "I'm Doctor Chen, a physician." Then speak a sentence in
   English and listen for the Vietnamese.
6. Press **End session**. The status shows "Ended".

Watch the server terminal as you go: you will see `start`, `call_started`, `end_call` and
`closed`.

Some things will not work yet, and that is expected. When the agent tries to call
`record_session_details`, nothing happens, because no tools are sent with the call. The
cards stay hidden until Step 7.

**Microphone problems?** Pages on `http://localhost` may use the microphone. On any other
`http://` address the browser blocks it: the page must be `https` (ngrok or Vercel give you
that).

## Why it is written this way

- **The worklet, not the page, converts audio.** It runs on the audio thread at a steady
  pace, so a busy page cannot cause crackles or gaps.
- **Silence instead of nothing.** The half-duplex guard keeps the 20 ms rhythm the engine
  expects.
- **The mark is held, not echoed at once.** Otherwise the engine thinks the AI has
  finished speaking while the speaker is still playing.
- **`textContent` everywhere for engine text.** Transcript text comes from speech
  recognition. Putting it into the page as HTML could let odd input break the page.
  `textContent` is always safe.

## Recap

- The worklet turns 48 kHz decimals into 16 kHz PCM16 frames of 640 bytes.
- The page plays 24 kHz PCM16 chunks back to back, using a playhead with a 180 ms cushion.
- Marks are echoed only after the audio before them has played. `clear_audio` stops
  everything.
- Half-duplex sends silence while the AI talks, for rooms without headphones.

Next: [Step 6: saving sessions](06-saving-sessions.md).
