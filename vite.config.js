import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds the widget as one ES module, React included: dist/voice-assistant.js.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Library builds leave process.env alone, and React reads NODE_ENV. Browsers have no `process`.
  define: { "process.env.NODE_ENV": JSON.stringify(mode) },
  build: {
    lib: {
      entry: "src/main.jsx",
      formats: ["es"],
      fileName: () => "voice-assistant.js",
    },
  },
}));
