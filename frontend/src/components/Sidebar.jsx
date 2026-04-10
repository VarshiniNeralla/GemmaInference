import { useState, useEffect } from "react";
import logoImg from "../../MyHomeLogo.png";
import "./Sidebar.css";

function formatApiErrorDetail(detail) {
  if (detail == null) {
    return "Invalid API key. Enter the correct API key from your gateway .env (API_KEY).";
  }
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e) => (typeof e === "object" && e?.msg ? e.msg : String(e)))
      .join(" ");
  }
  return "Invalid API key. Enter the correct API key from your gateway .env (API_KEY).";
}

export default function Sidebar({
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  open,
  chatTitle,
  savedApiKey,
  onApiKeySaved,
}) {
  const [hoveredId, setHoveredId] = useState(null);
  const [draft, setDraft] = useState(savedApiKey);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(savedApiKey);
  }, [savedApiKey]);

  const today = [];
  const last7 = [];
  const older = [];
  const now = Date.now();
  const dayMs = 86400000;

  for (const chat of chats) {
    if (chat.messages.length === 0 && chat.id !== activeChatId) continue;
    const age = now - chat.createdAt;
    if (age < dayMs) today.push(chat);
    else if (age < 7 * dayMs) last7.push(chat);
    else older.push(chat);
  }

  async function handleSubmitApiKey() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("Enter your API key.");
      return;
    }
    setVerifying(true);
    setError("");
    try {
      const res = await fetch("/verify-api-key", {
        method: "POST",
        headers: { "X-Api-Key": trimmed },
      });
      if (res.ok) {
        onApiKeySaved(trimmed);
        setError("");
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(formatApiErrorDetail(data.detail));
      }
    } catch {
      setError("Could not reach the gateway. Is the API running?");
    } finally {
      setVerifying(false);
    }
  }

  function renderGroup(label, items) {
    if (items.length === 0) return null;
    return (
      <div className="sidebar-group">
        <div className="sidebar-group-label">{label}</div>
        {items.map((chat) => (
          <div
            key={chat.id}
            className={`sidebar-item ${chat.id === activeChatId ? "active" : ""}`}
            onClick={() => onSelectChat(chat.id)}
            onMouseEnter={() => setHoveredId(chat.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <span className="material-symbols-rounded sidebar-item-icon">
              chat_bubble_outline
            </span>
            <span className="sidebar-item-text">
              {chatTitle(chat.messages)}
            </span>
            {(hoveredId === chat.id || chat.id === activeChatId) && (
              <button
                className="sidebar-item-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteChat(chat.id);
                }}
                title="Delete chat"
              >
                <span className="material-symbols-rounded">delete</span>
              </button>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <aside className={`sidebar ${open ? "open" : "closed"}`}>
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <img src={logoImg} alt="" className="sidebar-logo-img" />
          <span className="sidebar-brand-name">Gemma</span>
        </div>
        <button className="sidebar-new-chat" onClick={onNewChat}>
          <span className="material-symbols-rounded">add</span>
          New chat
        </button>
      </div>

      <div className="sidebar-chats">
        {chats.length === 0 && (
          <div className="sidebar-empty">
            <span className="material-symbols-rounded">forum</span>
            <p>No conversations yet</p>
          </div>
        )}
        {renderGroup("Today", today)}
        {renderGroup("Previous 7 days", last7)}
        {renderGroup("Older", older)}
      </div>

      <div className="sidebar-footer">
        <label className="sidebar-api-label" htmlFor="sidebar-api-key">
          <span className="material-symbols-rounded sidebar-api-label-icon">key</span>
          Enter API key to start
        </label>
        <form
          className={`sidebar-api-form ${error ? "has-error" : ""} ${saved ? "has-success" : ""}`}
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmitApiKey();
          }}
        >
          <input
            id="sidebar-api-key"
            className="sidebar-api-input"
            type={showKey ? "text" : "password"}
            autoComplete="off"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError("");
              if (saved) setSaved(false);
            }}
            placeholder="Paste your API key and press Enter"
            spellCheck={false}
            disabled={verifying}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "sidebar-api-key-error" : undefined}
          />
          <div className="sidebar-api-actions">
            <button
              type="button"
              className="sidebar-api-icon-btn"
              onClick={() => setShowKey((v) => !v)}
              title={showKey ? "Hide" : "Show"}
              aria-label={showKey ? "Hide API key" : "Show API key"}
              tabIndex={-1}
            >
              <span className="material-symbols-rounded" aria-hidden>
                {showKey ? "visibility_off" : "visibility"}
              </span>
            </button>
            <button
              type="submit"
              className={`sidebar-api-submit-btn ${saved ? "saved" : ""}`}
              disabled={verifying || !draft.trim()}
              title="Submit API key"
            >
              <span className="material-symbols-rounded" aria-hidden>
                {verifying ? "hourglass_top" : saved ? "check" : "arrow_forward"}
              </span>
            </button>
          </div>
        </form>
        {error && (
          <p id="sidebar-api-key-error" className="sidebar-api-error" role="alert">
            <span className="material-symbols-rounded">error</span>
            {error}
          </p>
        )}
        {saved && (
          <p className="sidebar-api-success" role="status">
            <span className="material-symbols-rounded">check_circle</span>
            API key saved
          </p>
        )}
      </div>
    </aside>
  );
}
