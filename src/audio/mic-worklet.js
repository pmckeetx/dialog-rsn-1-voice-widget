// Runs on the audio thread. Turns the microphone's float samples into 16-bit PCM
// and posts a chunk about every 20 ms, rather than one message per 128-sample render quantum.
class MicCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate / 50); // 20 ms at the context's rate
    this.chunk = new Int16Array(this.size);
    this.filled = 0;
  }

  process(inputs) {
    const samples = inputs[0][0];
    if (!samples) return true;

    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      this.chunk[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.filled === this.size) {
        // Transferring the buffer detaches this.chunk, so start a fresh one.
        this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
        this.chunk = new Int16Array(this.size);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("mic-capture", MicCapture);
