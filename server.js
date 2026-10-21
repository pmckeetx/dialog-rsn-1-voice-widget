/**
 * Serves the widget, relays its audio to Dialog-RSN-1, and serves the test website.
 *
 *   http://localhost:8787/voice-assistant.js   the widget, one file
 *   ws://localhost:8787/realtime               the relay: browser audio in, Dialog-RSN-1 events out
 *   http://localhost:3000                      the test website, on its own origin like a real customer site
 *
 * The browser can't put a key in a WebSocket header, and a key in page code is readable by anyone.
 * So the relay holds the key and owns the session: the browser only ever sends microphone audio.
 */
import { createServer } from "node:http";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { agent } from "./agent.js";

const PORT = Number(process.env.PORT ?? 8787);
const SITE_PORT = Number(process.env.SITE_PORT ?? 3000);
const UPSTREAM = process.env.DIALOG_REALTIME_URL ?? "wss://api.studio.poly.ai/v1/realtime";
const API_KEY = process.env.POLY_API_KEY;
// Pages allowed to open the relay. Anyone else would be talking on your key.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ??
  `http://localhost:${SITE_PORT},http://127.0.0.1:${SITE_PORT}`).split(",").map((o) => o.trim());

if (!API_KEY) {
  console.error("POLY_API_KEY is not set. Copy .env.example to .env and add your key from studio.poly.ai.");
  process.exit(1);
}

// The widget. A module script loaded from another origin is fetched with CORS, so allow it.
const app = express();
app.use(express.static("dist", {
  setHeaders: (res) => res.set("Access-Control-Allow-Origin", "*"),
}));
const server = createServer(app);

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, "http://x");
  if (pathname !== "/realtime" || !ALLOWED_ORIGINS.includes(req.headers.origin)) {
    console.warn(`[relay] refused ${pathname} from origin ${req.headers.origin}`);
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

wss.on("connection", (browser, req) => {
  // The page tells us its microphone sample rate; Dialog-RSN-1 resamples on the way in.
  const rate = Number(new URL(req.url, "http://x").searchParams.get("rate"));
  const inputRate = Number.isInteger(rate) && rate >= 8000 && rate <= 48000 ? rate : 24000;
  console.log(`[relay] browser connected from ${req.headers.origin}, mic at ${inputRate} Hz`);

  const upstream = new WebSocket(UPSTREAM, {
    headers: {
      "X-API-KEY": API_KEY,
      // The API answers 403 to a handshake with no User-Agent, and `ws` sends none by default.
      "User-Agent": "dialog-rsn-1-voice-widget/1.0",
    },
  });

  // Audio the page sends before the upstream socket opens would be lost, so hold it.
  const backlog = [];
  const toUpstream = (event) =>
    upstream.readyState === WebSocket.OPEN ? upstream.send(event) : backlog.push(event);

  upstream.on("open", () => {
    upstream.send(JSON.stringify({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: agent.instructions,
        audio: {
          input: { format: { type: "audio/pcm", rate: inputRate } },
          output: { voice: agent.voice },
        },
      },
    }));
    if (agent.greet) upstream.send(JSON.stringify({ type: "response.create" }));
    for (const event of backlog.splice(0)) upstream.send(event);
  });

  // Everything Dialog-RSN-1 says goes to the page: audio, transcripts, turn events, errors.
  upstream.on("message", (data) => {
    if (browser.readyState === WebSocket.OPEN) browser.send(data.toString());
  });

  // A bad key or host fails the handshake. Tell the page why instead of just closing.
  upstream.on("unexpected-response", (_req, res) => {
    console.error(`[relay] Dialog-RSN-1 refused the connection: HTTP ${res.statusCode}`);
    if (browser.readyState === WebSocket.OPEN) {
      browser.send(JSON.stringify({
        type: "error",
        error: { code: `upstream_http_${res.statusCode}`, message: `Dialog-RSN-1 refused the connection (HTTP ${res.statusCode})` },
      }));
    }
    browser.close();
  });
  upstream.on("error", (err) => {
    console.error("[relay] upstream error:", err.message);
    browser.close();
  });
  upstream.on("close", (code) => {
    console.log(`[relay] upstream closed ${code}`);
    browser.close();
  });

  // The page may only send audio. Instructions, voice and tools stay on this server.
  browser.on("message", (data) => {
    const text = data.toString();
    let type;
    try { ({ type } = JSON.parse(text)); } catch { return; }
    if (type === "input_audio_buffer.append") toUpstream(text);
    else console.warn(`[relay] dropped ${type} from the browser`);
  });
  browser.on("close", () => {
    console.log("[relay] browser disconnected");
    upstream.close();
  });
});

server.listen(PORT, () => {
  console.log(`[relay] widget and relay on http://localhost:${PORT}  ->  ${UPSTREAM}`);
});

// The test website. In real life this is your site, on its own server.
express().use(express.static("site")).listen(SITE_PORT, () => {
  console.log(`[site]  test website on http://localhost:${SITE_PORT}`);
});
