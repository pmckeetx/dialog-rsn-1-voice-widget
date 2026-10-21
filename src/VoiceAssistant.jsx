import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { VoiceSession } from "./voice-session.js";

const STATUS = {
  idle: "Talk to us, out loud",
  connecting: "Connecting…",
  listening: "Listening",
  hearing: "Listening",
  thinking: "Thinking…",
  speaking: "Speaking",
  error: "Something went wrong",
};

export function VoiceAssistant({ server, name }) {
  const [open, setOpen] = useState(false);
  const [session] = useState(() => new VoiceSession(server));
  const { status, lines, error } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const active = !["idle", "error"].includes(status);

  // Hang up if the widget is removed from the page.
  useEffect(() => () => session.stop(), [session]);

  // Keep the newest line in view.
  const transcript = useRef(null);
  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight });
  }, [lines]);

  const close = () => {
    session.stop();
    setOpen(false);
  };

  if (!open) {
    return (
      <button className="launcher" onClick={() => setOpen(true)} aria-label={`Talk to ${name}`}>
        <MicIcon />
      </button>
    );
  }

  return (
    <section className="panel" aria-label={`${name}, voice assistant`}>
      <header>
        <div>
          <strong>{name}</strong>
          <span className="powered">Voice assistant</span>
        </div>
        <button className="close" onClick={close} aria-label="Close">×</button>
      </header>

      <div className={`orb ${status}`} aria-hidden="true" />
      <p className="status" aria-live="polite">{error ?? STATUS[status]}</p>

      <ol className="transcript" ref={transcript}>
        {lines.filter((line) => line.text).map((line) => (
          <li key={line.id} className={`${line.role}${line.interrupted ? " interrupted" : ""}`}>
            {line.text}
          </li>
        ))}
      </ol>

      {active ? (
        <button className="primary end" onClick={() => session.stop()}>End conversation</button>
      ) : (
        <button className="primary" onClick={() => session.start()}>
          <MicIcon /> {status === "error" ? "Try again" : "Start talking"}
        </button>
      )}
    </section>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" />
    </svg>
  );
}
