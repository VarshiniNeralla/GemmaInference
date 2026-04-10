import { useState } from "react";
import logoImg from "../../MyHomeLogo.png";
import "./ApiKeyGate.css";

export default function ApiKeyGate({ onAuthenticated }) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [showKey, setShowKey] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedKey = key.trim();

    if (!trimmedName) {
      setError("Please enter your name.");
      return;
    }
    if (!trimmedKey) {
      setError("Please enter the API key.");
      return;
    }

    setVerifying(true);
    setError("");

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, api_key: trimmedKey }),
      });

      if (res.ok) {
        onAuthenticated(trimmedKey, trimmedName);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(
          typeof data.detail === "string"
            ? data.detail
            : "Invalid API key. Please check and try again."
        );
      }
    } catch {
      setError("Could not reach the server. Is it running?");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-logo">
          <img src={logoImg} alt="" width={56} height={56} />
        </div>

        <h1 className="gate-title">Welcome to Gemma</h1>
        <p className="gate-subtitle">
          Enter your name and the API key to start chatting.
        </p>

        <form className="gate-form" onSubmit={handleSubmit}>
          <div className={`gate-input-wrap ${error && !name.trim() ? "has-error" : ""}`}>
            <span className="material-symbols-rounded gate-input-icon">person</span>
            <input
              className="gate-input"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError("");
              }}
              placeholder="Your name"
              autoComplete="name"
              spellCheck={false}
              disabled={verifying}
              autoFocus
            />
          </div>

          <div className={`gate-input-wrap ${error && name.trim() && !key.trim() ? "has-error" : ""}`}>
            <span className="material-symbols-rounded gate-input-icon">key</span>
            <input
              className="gate-input"
              type={showKey ? "text" : "password"}
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                if (error) setError("");
              }}
              placeholder="API key"
              autoComplete="off"
              spellCheck={false}
              disabled={verifying}
            />
            <button
              type="button"
              className="gate-eye-btn"
              onClick={() => setShowKey((v) => !v)}
              title={showKey ? "Hide" : "Show"}
              tabIndex={-1}
            >
              <span className="material-symbols-rounded">
                {showKey ? "visibility_off" : "visibility"}
              </span>
            </button>
          </div>

          {error && (
            <p className="gate-error" role="alert">
              <span className="material-symbols-rounded">error</span>
              {error}
            </p>
          )}

          <button
            type="submit"
            className="gate-submit"
            disabled={verifying || !key.trim() || !name.trim()}
          >
            {verifying ? (
              <>
                <span className="material-symbols-rounded gate-spin">progress_activity</span>
                Verifying...
              </>
            ) : (
              <>
                Continue
                <span className="material-symbols-rounded">arrow_forward</span>
              </>
            )}
          </button>
        </form>

        <p className="gate-hint">
          Don't have a key? Ask the person who shared this link.
        </p>
      </div>
    </div>
  );
}
