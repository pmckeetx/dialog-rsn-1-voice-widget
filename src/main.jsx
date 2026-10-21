// Packages the React widget as <voice-assistant>, a custom element any page can use:
//
//   <script type="module" src="https://your-server/voice-assistant.js"></script>
//   <voice-assistant name="Juno"></voice-assistant>
//
// The widget renders into a shadow root, so the host page's CSS can't break it and its CSS
// can't leak into the page.
import { createRoot } from "react-dom/client";
import { VoiceAssistant } from "./VoiceAssistant.jsx";
import css from "./styles.css?inline";

// By default, the relay lives on the server this script was loaded from.
const defaultServer = new URL(/* @vite-ignore */ "/realtime", import.meta.url);
defaultServer.protocol = defaultServer.protocol === "https:" ? "wss:" : "ws:";

class VoiceAssistantElement extends HTMLElement {
  #root = null;

  connectedCallback() {
    if (!this.shadowRoot) {
      const shadow = this.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = css;
      shadow.append(style, document.createElement("div"));
    }
    this.#root = createRoot(this.shadowRoot.lastChild);
    this.#root.render(
      <VoiceAssistant
        server={this.getAttribute("server") ?? defaultServer.href}
        name={this.getAttribute("name") ?? "Assistant"}
      />,
    );
  }

  disconnectedCallback() {
    const root = this.#root;
    this.#root = null;
    queueMicrotask(() => root?.unmount());
  }
}

if (!customElements.get("voice-assistant")) {
  customElements.define("voice-assistant", VoiceAssistantElement);
}
