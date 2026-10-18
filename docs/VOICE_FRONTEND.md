# Voice frontend: streaming answer, speech, mouth from loudness

Flow: browser records question -> speech-to-text -> `POST /ask/stream` -> for every `sentence` event, send
`speak` to text-to-speech and queue the audio -> play the queue; the avatar mouth follows the loudness of whatever plays.
Nothing here needs a GPU. (Not tested against Fish Audio yet: check its streaming/chunk API and measure it.)

## 1. Read the stream (fetch, because EventSource cannot POST)
```js
async function ask(question, lawyer, onEvent) {
  const res = await fetch(`${BACKEND}/ask/stream`, {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({lawyer, question, voice: true}),
  });
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    buf += dec.decode(value, {stream: true});
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {          // one event per blank line
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
      if (line.startsWith("data:")) onEvent(JSON.parse(line.slice(5)));
    }
  }
}
```
`BACKEND` is the tunnel address. If the first backend errors or takes over ~15 s to send its first event, retry on the second.

## 2. Speak sentence by sentence, in order
Keep a promise chain so audio plays in the order the sentences arrived even if one TTS call finishes late:
```js
let chain = Promise.resolve();
function enqueueSpeech(text) {
  const audioPromise = ttsFetch(text);                // start now; resolves to an ArrayBuffer (mp3/wav)
  chain = chain.then(async () => playBuffer(await audioPromise));
}
ask(q, "criminal", ev => {
  if (ev.type === "sentence") { showText(ev.text); addCitations(ev.new_citations); enqueueSpeech(ev.speak); }
  if (ev.type === "refused")  { showText(ev.answer); enqueueSpeech(ev.answer); }
  if (ev.type === "error")    { showText("Sorry, something went wrong. Please ask again."); }
});
```
Call TTS from the backend (or a small proxy), never from the browser, so the Fish Audio key stays secret.

## 3. Mouth from loudness (Web Audio, no GPU)
```js
const ctx = new AudioContext();
const analyser = ctx.createAnalyser(); analyser.fftSize = 256;
analyser.connect(ctx.destination);
const data = new Uint8Array(analyser.fftSize);

function playBuffer(arrayBuffer) {
  return ctx.decodeAudioData(arrayBuffer).then(buf => new Promise(done => {
    const src = ctx.createBufferSource(); src.buffer = buf;
    src.connect(analyser); src.onended = done; src.start();
  }));
}

let open = 0;                                          // smoothed mouth opening, 0..1
function frame() {
  analyser.getByteTimeDomainData(data);
  let sum = 0; for (const v of data) { const x = (v - 128) / 128; sum += x * x; }
  const level = Math.min(1, Math.sqrt(sum / data.length) * 4);   // RMS loudness, gain 4 (tune)
  open += (level - open) * 0.4;                        // smoothing so the mouth does not flicker
  avatarMouth.style.transform = `scaleY(${0.1 + 0.9 * open})`;   // or swap between 3-4 mouth images
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```
Call `ctx.resume()` after the first tap (browsers block audio until the user interacts). With 3 or 4 mouth images
(closed / half / open) pick one by thresholds on `open` (for example <0.12, <0.4, else) instead of scaling.
