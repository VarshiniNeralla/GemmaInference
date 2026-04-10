import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { marked } from "marked";
import { userContentToPlainText } from "../utils/messageText.js";
import Avatar from "./Avatar.jsx";
import "./ChatMessage.css";

marked.setOptions({
  breaks: true,
  gfm: true,
});

function UserMultimodalContent({ parts }) {
  return (
    <div className="user-mm">
      {parts.map((part, i) => {
        if (part.type === "text" && part.text) {
          return (
            <p key={i} className="user-mm-text">
              {part.text}
            </p>
          );
        }
        if (part.type === "image_url" && part.image_url?.url) {
          return (
            <div key={i} className="user-mm-image-wrap">
              <img
                src={part.image_url.url}
                alt="Uploaded"
                className="user-mm-image"
              />
            </div>
          );
        }
        if (part.type === "file" && part.file) {
          const fn = part.file.filename || part.file.name || "Attachment";
          return (
            <div key={i} className="user-mm-file">
              <span className="material-symbols-rounded" aria-hidden>
                description
              </span>
              <span className="user-mm-file-name">{fn}</span>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch {
      /* ignore */
    }
  }
}

function InlineEditor({ initialText, onSave, onCancel }) {
  const [text, setText] = useState(initialText);
  const textareaRef = useRef(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
      // Place cursor at end
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, []);

  function handleInput(e) {
    setText(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (text.trim()) onSave(text.trim());
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div className="inline-editor">
      <textarea
        ref={textareaRef}
        className="inline-editor__textarea"
        value={text}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        rows={1}
      />
      <div className="inline-editor__actions">
        <button
          type="button"
          className="inline-editor__btn inline-editor__btn--cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="inline-editor__btn inline-editor__btn--save"
          onClick={() => text.trim() && onSave(text.trim())}
          disabled={!text.trim()}
        >
          <span className="material-symbols-rounded">send</span>
          Save & Submit
        </button>
      </div>
      <p className="inline-editor__hint">
        Enter to save, Esc to cancel, Shift+Enter for new line
      </p>
    </div>
  );
}

export default function ChatMessage({
  role,
  content,
  onEditUser,
  assistantReplyInProgress = false,
  userInitial = "U",
}) {
  const isUser = role === "user";
  const isError = typeof content === "string" && content?.startsWith("__ERROR__");
  const isLoading = content === null;
  const isMultimodalUser =
    isUser && Array.isArray(content) && content.length > 0;

  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [copyFlash, setCopyFlash] = useState(false);

  const html = useMemo(() => {
    if (isLoading || isError || !content) return "";
    if (typeof content !== "string") return "";
    return marked.parse(content);
  }, [content, isLoading, isError]);

  const plainText = useMemo(() => {
    return userContentToPlainText(content);
  }, [content]);

  const showUserToolbar = isUser && !isLoading && !isError && !editing;
  const showAssistantToolbar =
    !isUser &&
    !isLoading &&
    !isError &&
    typeof content === "string" &&
    !assistantReplyInProgress;

  const canEdit = isUser && typeof onEditUser === "function" && !isLoading && !isError;

  const handleCopyUser = useCallback(() => {
    copyText(userContentToPlainText(content));
    setCopyFlash(true);
    window.setTimeout(() => setCopyFlash(false), 1500);
  }, [content]);

  const handleCopyAssistant = useCallback(() => {
    if (typeof content !== "string") return;
    copyText(content);
    setCopyFlash(true);
    window.setTimeout(() => setCopyFlash(false), 1500);
  }, [content]);

  const toggleFeedback = useCallback((kind) => {
    setFeedback((prev) => (prev === kind ? null : kind));
  }, []);

  function handleStartEdit() {
    setEditing(true);
  }

  function handleSaveEdit(newText) {
    setEditing(false);
    if (onEditUser && newText !== plainText) {
      onEditUser(newText);
    }
  }

  function handleCancelEdit() {
    setEditing(false);
  }

  return (
    <div className={`message ${isUser ? "message-user" : "message-bot"}`}>
      <Avatar
        role={role}
        isThinking={!isUser && (isLoading || assistantReplyInProgress)}
        userInitial={userInitial}
      />
      <div className="message-body">
        <div className="message-role">{isUser ? "You" : "Gemma"}</div>
        <div
          className={`message-column ${isUser ? "message-column--user" : "message-column--bot"}`}
        >
          {editing ? (
            <InlineEditor
              initialText={plainText}
              onSave={handleSaveEdit}
              onCancel={handleCancelEdit}
            />
          ) : (
            <>
              <div className="message-content">
                {isLoading && (
                  <div
                    className="thinking-indicator"
                    aria-live="polite"
                    aria-busy="true"
                    aria-label="Gemma is thinking"
                  >
                    <span className="thinking-indicator-text">thinking</span>
                    <span className="thinking-indicator-dots" aria-hidden="true">
                      <span className="thinking-dot">.</span>
                      <span className="thinking-dot">.</span>
                      <span className="thinking-dot">.</span>
                    </span>
                  </div>
                )}
                {isError && (
                  <div className="error-text">
                    <span className="material-symbols-rounded">error</span>
                    {content.replace("__ERROR__", "")}
                  </div>
                )}
                {!isLoading && !isError && isMultimodalUser && (
                  <UserMultimodalContent parts={content} />
                )}
                {!isLoading && !isError && !isMultimodalUser && (
                  <div dangerouslySetInnerHTML={{ __html: html }} />
                )}
              </div>

              {showUserToolbar && (
                <div className="message-toolbar message-toolbar--user">
                  <button
                    type="button"
                    className={`message-tool-btn${copyFlash ? " message-tool-btn--copied" : ""}`}
                    onClick={handleCopyUser}
                    title={copyFlash ? "Copied" : "Copy"}
                    aria-label={copyFlash ? "Copied to clipboard" : "Copy message"}
                  >
                    <span className="material-symbols-rounded" aria-hidden>
                      {copyFlash ? "check" : "content_copy"}
                    </span>
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      className="message-tool-btn"
                      onClick={handleStartEdit}
                      title="Edit"
                      aria-label="Edit message"
                    >
                      <span className="material-symbols-rounded" aria-hidden>
                        edit
                      </span>
                    </button>
                  )}
                </div>
              )}

              {showAssistantToolbar && (
                <div className="message-toolbar message-toolbar--bot">
                  <button
                    type="button"
                    className={`message-tool-btn${copyFlash ? " message-tool-btn--copied" : ""}`}
                    onClick={handleCopyAssistant}
                    title={copyFlash ? "Copied" : "Copy"}
                    aria-label={copyFlash ? "Copied to clipboard" : "Copy response"}
                  >
                    <span className="material-symbols-rounded" aria-hidden>
                      {copyFlash ? "check" : "content_copy"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`message-tool-btn ${feedback === "up" ? "message-tool-btn--active" : ""}`}
                    onClick={() => toggleFeedback("up")}
                    title="Good response"
                    aria-label="Good response"
                    aria-pressed={feedback === "up"}
                  >
                    <span className="material-symbols-rounded" aria-hidden>
                      thumb_up
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`message-tool-btn ${feedback === "down" ? "message-tool-btn--active" : ""}`}
                    onClick={() => toggleFeedback("down")}
                    title="Bad response"
                    aria-label="Bad response"
                    aria-pressed={feedback === "down"}
                  >
                    <span className="material-symbols-rounded" aria-hidden>
                      thumb_down
                    </span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
