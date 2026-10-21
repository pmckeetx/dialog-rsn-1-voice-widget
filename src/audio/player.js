// Plays the agent's voice: 24 kHz, 16-bit mono PCM chunks from response.output_audio.delta.
// Each chunk becomes an AudioBuffer scheduled right after the last one, and the browser
// resamples 24 kHz to whatever rate the AudioContext runs at.
export class Player {
  #ctx;
  #rate;
  #next = 0;
  #sources = new Set();

  constructor(ctx, rate = 24000) {
    this.#ctx = ctx;
    this.#rate = rate;
    this.onIdle = null; // called when the last scheduled chunk finishes
  }

  get playing() {
    return this.#sources.size > 0;
  }

  play(base64) {
    const pcm = new Int16Array(decodeBase64(base64).buffer);
    const buffer = this.#ctx.createBuffer(1, pcm.length, this.#rate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 0x8000;

    const source = this.#ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.#ctx.destination);

    // A small lead covers network jitter between chunks without adding noticeable delay.
    const at = Math.max(this.#next, this.#ctx.currentTime + 0.08);
    source.start(at);
    this.#next = at + buffer.duration;

    this.#sources.add(source);
    source.onended = () => {
      this.#sources.delete(source);
      if (!this.#sources.size) this.onIdle?.();
    };
  }

  // Barge-in: stop now, and drop everything queued.
  flush() {
    for (const source of this.#sources) {
      source.onended = null;
      source.stop();
    }
    this.#sources.clear();
    this.#next = 0;
  }
}

export function decodeBase64(base64) {
  if (Uint8Array.fromBase64) return Uint8Array.fromBase64(base64);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeBase64(bytes) {
  if (bytes.toBase64) return bytes.toBase64();
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
