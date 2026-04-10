import { useState, useRef, useEffect } from "react";
import useTypewriter from "../hooks/useTypewriter.js";
import useSpeechToText from "../hooks/useSpeechToText.js";
import {
  PLACEHOLDER_PHRASES,
  STATIC_INPUT_PLACEHOLDER,
} from "../hooks/placeholderPhrases.js";
import "./ChatInput.css";

const MAX_IMAGE_EDGE = 1536;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;

const ACCEPT_ATTR = [
  "image/*",
  ".heic,.HEIC,.heif,.HEIF",
  ".pdf,.PDF",
  ".docx,.DOCX,.doc,.DOC",
  ".xlsx,.XLSX,.xls,.XLS",
  ".csv,.CSV",
  ".txt,.TXT,.md,.MD",
].join(",");

function guessMimeFromName(name) {
  const n = (name || "").toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (n.endsWith(".doc")) return "application/msword";
  if (n.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (n.endsWith(".xls")) return "application/vnd.ms-excel";
  if (n.endsWith(".csv")) return "text/csv";
  if (n.endsWith(".txt")) return "text/plain";
  if (n.endsWith(".md")) return "text/markdown";
  if (n.endsWith(".heic") || n.endsWith(".heif")) return "image/heic";
  return "application/octet-stream";
}

function isAllowedAttachment(file) {
  const name = file.name || "";
  const t = (file.type || "").toLowerCase();
  const extOk = /\.(heic|heif|png|jpe?g|gif|webp|avif|bmp|pdf|docx?|xlsx?|csv|txt|md)$/i.test(
    name
  );
  const mimeOk =
    t.startsWith("image/") ||
    t === "application/pdf" ||
    t === "application/msword" ||
    t.includes("wordprocessingml") ||
    t.includes("spreadsheet") ||
    t.includes("excel") ||
    t === "text/csv" ||
    t === "text/plain" ||
    t === "application/vnd.ms-excel" ||
    t === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return extOk || mimeOk;
}

function isHeicLike(file) {
  const t = (file.type || "").toLowerCase();
  if (t === "image/heic" || t === "image/heif") return true;
  const n = (file.name || "").toLowerCase();
  return n.endsWith(".heic") || n.endsWith(".heif");
}

function isRasterImageFile(file) {
  if (isHeicLike(file)) return false;
  const t = (file.type || "").toLowerCase();
  if (t.startsWith("image/")) return true;
  const n = file.name || "";
  return /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(n);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

async function fileToResizedDataUrl(file) {
  const raw = await readFileAsDataUrl(file);

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      let { width, height } = bitmap;
      const max = Math.max(width, height);
      if (max <= MAX_IMAGE_EDGE) {
        bitmap.close();
        return raw;
      }
      const scale = MAX_IMAGE_EDGE / max;
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      const blob = await canvas.convertToBlob({
        type: file.type === "image/png" ? "image/png" : "image/jpeg",
        quality: 0.9,
      });
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error("Failed to encode resized image"));
        r.readAsDataURL(blob);
      });
    } catch {
      // Fall through to Image() path
    }
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const max = Math.max(width, height);
      if (max <= MAX_IMAGE_EDGE) {
        resolve(raw);
        return;
      }
      const scale = MAX_IMAGE_EDGE / max;
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(raw);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
      const q = mime === "image/jpeg" ? 0.9 : undefined;
      resolve(canvas.toDataURL(mime, q));
    };
    img.onerror = () => resolve(raw);
    img.src = raw;
  });
}

async function processFile(file) {
  if (isRasterImageFile(file)) {
    const dataUrl = await fileToResizedDataUrl(file);
    return {
      kind: "image",
      dataUrl,
      fileName: file.name,
      mime: file.type || guessMimeFromName(file.name),
      previewable: true,
    };
  }
  if (isHeicLike(file)) {
    const dataUrl = await readFileAsDataUrl(file);
    return {
      kind: "image",
      dataUrl,
      fileName: file.name,
      mime: file.type || guessMimeFromName(file.name),
      previewable: false,
    };
  }
  const dataUrl = await readFileAsDataUrl(file);
  return {
    kind: "document",
    dataUrl,
    fileName: file.name,
    mime: file.type || guessMimeFromName(file.name),
    previewable: false,
  };
}

export default function ChatInput({
  onSend,
  disabled,
  suppressPlaceholderAnimation = false,
  onInputEngagement,
  editDraft = null,
  editRevision = 0,
  onConsumeEditDraft,
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [attachBusy, setAttachBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const textBeforeSpeechRef = useRef("");

  const speech = useSpeechToText({ lang: "en-US", continuous: true });

  // Sync speech transcript into the text field while listening
  useEffect(() => {
    if (!speech.listening) return;
    const combined = textBeforeSpeechRef.current
      ? textBeforeSpeechRef.current + " " + speech.transcript
      : speech.transcript;
    setText(combined);
    // Auto-resize textarea
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 160) + "px";
    }
  }, [speech.transcript, speech.listening]);

  function handleMicToggle() {
    if (speech.listening) {
      speech.stop();
    } else {
      textBeforeSpeechRef.current = text;
      onInputEngagement?.();
      speech.start();
    }
  }

  useEffect(() => {
    if (editDraft == null) return;
    setText(editDraft.text ?? "");
    setAttachments(
      Array.isArray(editDraft.attachments) ? editDraft.attachments : []
    );
    onConsumeEditDraft?.();
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
        el.style.height = "auto";
        el.style.height = Math.min(el.scrollHeight, 160) + "px";
      }
    });
  }, [editRevision, editDraft, onConsumeEditDraft]);

  const hasAttachments = attachments.length > 0;

  const showAnimatedOverlay =
    !suppressPlaceholderAnimation && !focused && !text && !hasAttachments;

  const { text: typewriterText } = useTypewriter(PLACEHOLDER_PHRASES, {
    enabled: showAnimatedOverlay,
    typeSpeed: 50,
    deleteSpeed: 30,
    pauseAfter: 1500,
    pauseBetween: 400,
  });

  function handleFocus() {
    setFocused(true);
    onInputEngagement?.();
  }

  function handleBlur() {
    setFocused(false);
  }

  function handleInput(e) {
    const v = e.target.value;
    if (v.length > 0) {
      onInputEngagement?.();
    }
    setText(v);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function removeAttachment(index) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function clearAllAttachments() {
    setAttachments([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function onPickFiles(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const remaining = MAX_ATTACHMENTS - attachments.length;
    if (files.length > remaining) {
      alert(`You can attach up to ${MAX_ATTACHMENTS} files at a time. ${remaining} slots remaining.`);
    }
    const batch = files.slice(0, remaining);

    // Validate all files first
    const rejected = [];
    const tooBig = [];
    const valid = [];
    for (const file of batch) {
      if (!isAllowedAttachment(file)) {
        rejected.push(file.name);
      } else if (file.size > MAX_FILE_BYTES) {
        tooBig.push(file.name);
      } else {
        valid.push(file);
      }
    }
    if (rejected.length > 0) {
      alert(`Unsupported file type: ${rejected.join(", ")}`);
    }
    if (tooBig.length > 0) {
      alert(`File too large (max ${MAX_FILE_BYTES / (1024 * 1024)} MB): ${tooBig.join(", ")}`);
    }
    if (valid.length === 0) return;

    setAttachBusy(true);
    onInputEngagement?.();

    try {
      const processed = await Promise.all(valid.map(processFile));
      setAttachments((prev) => [...prev, ...processed]);
    } catch {
      alert("Could not read one or more files.");
    } finally {
      setAttachBusy(false);
      // Reset so the same files can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function submit() {
    if (disabled) return;
    if (!text.trim() && !hasAttachments) return;
    if (speech.listening) speech.stop();
    onSend(text, { attachments: hasAttachments ? attachments : undefined });
    setText("");
    textBeforeSpeechRef.current = "";
    clearAllAttachments();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  const canSend =
    (text.trim().length > 0 || hasAttachments) && !disabled && !attachBusy;
  const canType = !attachBusy;

  const nativePlaceholder = showAnimatedOverlay ? "" : STATIC_INPUT_PLACEHOLDER;

  return (
    <div className="input-area">
      {hasAttachments && (
        <div className="attachments-strip">
          {attachments.map((att, i) => (
            <div
              key={i}
              className={`attachment-card ${att.previewable ? "" : "attachment-card--file"}`}
            >
              {att.previewable ? (
                <img src={att.dataUrl} alt="" />
              ) : (
                <div className="attachment-doc-icon" aria-hidden>
                  <span className="material-symbols-rounded">description</span>
                </div>
              )}
              <button
                type="button"
                className="attachment-remove"
                onClick={() => removeAttachment(i)}
                title="Remove"
              >
                <span className="material-symbols-rounded">close</span>
              </button>
              <div className="attachment-name" title={att.fileName}>
                {att.fileName}
              </div>
            </div>
          ))}
          {attachments.length > 1 && (
            <button
              type="button"
              className="attachments-clear-all"
              onClick={clearAllAttachments}
              title="Remove all"
            >
              <span className="material-symbols-rounded">delete_sweep</span>
              Clear all
            </button>
          )}
        </div>
      )}
      <div className="input-box">
        <div className="textarea-wrap">
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            placeholder={nativePlaceholder}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
          {showAnimatedOverlay && (
            <div className="animated-placeholder" aria-hidden="true">
              <span>{typewriterText}</span>
              <span className="cursor-blink" />
            </div>
          )}
        </div>
        <div className="input-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_ATTR}
            multiple
            className="file-input-hidden"
            onChange={onPickFiles}
          />
          <button
            type="button"
            className="attach-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={attachBusy || attachments.length >= MAX_ATTACHMENTS}
            title={`Attach files (${attachments.length}/${MAX_ATTACHMENTS})`}
          >
            <span className="material-symbols-rounded">attach_file</span>
          </button>
          {speech.supported && (
            <button
              type="button"
              className={`mic-btn ${speech.listening ? "listening" : ""}`}
              onClick={handleMicToggle}
              disabled={false}
              title={speech.listening ? "Stop listening" : "Voice input"}
            >
              <span className="material-symbols-rounded">
                {speech.listening ? "mic" : "mic_none"}
              </span>
            </button>
          )}
          <button
            className={`send-btn ${canSend ? "active" : ""}`}
            type="button"
            onClick={submit}
            disabled={!canSend}
            title="Send"
          >
            <span className="material-symbols-rounded">arrow_upward</span>
          </button>
        </div>
      </div>
      <p className="footer-text">
        Gemma may display inaccurate info. Verify important information.
      </p>
    </div>
  );
}
