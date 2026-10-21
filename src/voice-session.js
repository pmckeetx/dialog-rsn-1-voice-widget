// One conversation with Dialog-RSN-1: microphone in, the agent's voice out, and a transcript.
// No framework in here. The React component subscribes to it; a Vue or Svelte one could too.
import { Player, encodeBase64 } from "./audio/player.js";
import workletSource from "./audio/mic-worklet.js?raw";

// The worklet ships inside the widget's single file and loads from a Blob URL.
const workletUrl = URL.createObjectURL(new Blob([workletSource], { type: "text/javascript" }));

export class VoiceSession {
  #server;
  #ws = null;
  #ctx = null;
  #stream = null;
  #player = null;
  #listeners = new Set();
  #state = { status: "idle", lines: [], error: null };

  constructor(server) {
    this.#server = server;
  }

  // For React's useSyncExternalStore.
  subscribe = (listener) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  getSnapshot = () => this.#state;

  async start() {
    if (this.#ctx) return;
    this.#update({ status: "connecting", lines: [], error: null });

    // Create and resume the AudioContext first, while the click still counts as a user gesture.
    const ctx = (this.#ctx = new AudioContext());
    await ctx.resume();
    let stream;
    try {
      // Echo cancellation stops the agent hearing itself. Noise suppression stays off:
      // Dialog-RSN-1 is trained on real, noisy calls and uses cues that suppression removes.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true },
      });
    } catch {
      this.#fail("Microphone access was blocked. Allow it in the address bar and try again.");
      return;
    }
    await ctx.audioWorklet.addModule(workletUrl);
    if (this.#ctx !== ctx) {
      // stop() ran while we waited for the microphone.
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.#stream = stream;

    this.#player = new Player(ctx);
    this.#player.onIdle = () => this.#state.status === "speaking" && this.#update({ status: "listening" });

    const url = new URL(this.#server);
    url.searchParams.set("rate", ctx.sampleRate);
    const ws = (this.#ws = new WebSocket(url));
    ws.onmessage = (e) => this.#handle(JSON.parse(e.data));
    ws.onclose = () => {
      if (this.#ws === ws) this.#fail(this.#state.error ?? "The connection closed. Start again to reconnect.");
    };

    // Stream the microphone from now until stop(). Dialog-RSN-1 decides when you've finished.
    const mic = new AudioWorkletNode(ctx, "mic-capture", { numberOfOutputs: 0 });
    mic.port.onmessage = (e) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: encodeBase64(new Uint8Array(e.data)) }));
    };
    ctx.createMediaStreamSource(stream).connect(mic);
  }

  stop() {
    const ws = this.#ws;
    this.#ws = null;
    ws?.close();
    this.#player?.flush();
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#ctx?.close();
    this.#ctx = this.#stream = this.#player = null;
    if (this.#state.status !== "error") this.#update({ status: "idle" });
  }

  #handle(event) {
    switch (event.type) {
      case "session.updated":
        if (this.#state.status === "connecting") this.#update({ status: "listening" });
        break;

      // Dialog-RSN-1 has confirmed the visitor is talking. If the agent was speaking, that's a
      // barge-in: the server has already cancelled the reply, so stop what's still queued here.
      case "input_audio_buffer.speech_started":
        if (this.#player.playing) {
          this.#player.flush();
          this.#markInterrupted();
        }
        this.#upsertLine(event.item_id, "user", "");
        this.#update({ status: "hearing" });
        break;

      case "input_audio_buffer.speech_stopped":
        this.#update({ status: "thinking" });
        break;

      // The visitor's words arrive with the reply, from the same model pass.
      case "conversation.item.input_audio_transcription.delta":
        this.#upsertLine(event.item_id, "user", (text) => text + event.delta);
        break;
      case "conversation.item.input_audio_transcription.completed":
        this.#upsertLine(event.item_id, "user", event.transcript);
        break;

      // What the agent is saying, as text, a little ahead of the audio.
      case "response.output_audio_transcript.delta":
        this.#upsertLine(event.item_id, "agent", (text) => text + event.delta);
        break;

      case "response.output_audio.delta":
        this.#player.play(event.delta);
        if (this.#state.status !== "speaking") this.#update({ status: "speaking" });
        break;

      case "error":
        console.warn(`[voice-assistant] ${event.error.code}: ${event.error.message}`);
        if (event.error.code?.startsWith("upstream_")) this.#update({ error: event.error.message });
        break;
    }
  }

  #upsertLine(id, role, text) {
    const lines = [...this.#state.lines];
    let i = lines.findIndex((line) => line.id === id);
    if (i === -1) i = lines.push({ id, role, text: "", interrupted: false }) - 1;
    lines[i] = { ...lines[i], text: typeof text === "function" ? text(lines[i].text) : text };
    this.#update({ lines });
  }

  #markInterrupted() {
    const lines = [...this.#state.lines];
    const i = lines.findLastIndex((line) => line.role === "agent");
    if (i !== -1) lines[i] = { ...lines[i], interrupted: true };
    this.#update({ lines });
  }

  #fail(message) {
    this.#update({ status: "error", error: message });
    this.stop();
  }

  #update(patch) {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }
}
