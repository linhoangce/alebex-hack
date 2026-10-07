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
