import { useState, useEffect, useRef, useCallback } from "react";
import Sidebar from "./components/Sidebar.jsx";
import Header from "./components/Header.jsx";
import Welcome from "./components/Welcome.jsx";
import ChatMessage from "./components/ChatMessage.jsx";
import ChatInput from "./components/ChatInput.jsx";
import ApiKeyGate from "./components/ApiKeyGate.jsx";
import { consumeGenerateStream } from "./utils/consumeGenerateStream.js";
import "./App.css";

const DEFAULT_API_KEY = "";

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function chatTitle(messages) {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "New chat";
  const c = first.content;
  if (typeof c === "string") {
    return c.length > 40 ? c.slice(0, 40) + "..." : c;
  }
  if (Array.isArray(c)) {
    const filePart = c.find((p) => p.type === "file");
    const fn = filePart?.file?.filename || filePart?.file?.name;
    if (fn) return fn.length > 40 ? fn.slice(0, 40) + "..." : fn;
    const img = c.some((p) => p.type === "image_url");
    if (img) {
      const t = c.find((p) => p.type === "text")?.text;
      if (t) return t.length > 40 ? t.slice(0, 40) + "..." : t;
      return "Image chat";
    }
    const t = c.find((p) => p.type === "text")?.text || "New chat";
    return t.length > 40 ? t.slice(0, 40) + "..." : t;
  }
  return "New chat";
}

export default function App() {
  const [chats, setChats] = useState(() => {
    try {
      const saved = localStorage.getItem("gemma-chats");
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });
  const [activeChatId, setActiveChatId] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState("checking");
  const [modelName, setModelName] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  /** Per chat (or "_prechat_" when no tab): user focused, typed, or we lock after first message via messages.length */
  const [inputEngagementByChat, setInputEngagementByChat] = useState({});
  const [apiKey, setApiKey] = useState(() => {
    try {
      const s = localStorage.getItem("gemma-api-key");
      if (s != null) return s;
    } catch {}
    return DEFAULT_API_KEY;
  });
  const [userName, setUserName] = useState(() => {
    try {
      return localStorage.getItem("gemma-user-name") || "";
    } catch {}
    return "";
  });
  const chatRef = useRef(null);

  const activeChat = chats.find((c) => c.id === activeChatId);
  const messages = activeChat?.messages || [];
  const engagementKey = activeChatId ?? "_prechat_";
  const hasStartedChat = messages.length > 0;
  const hasEngagedInput = Boolean(inputEngagementByChat[engagementKey]);
  const suppressPlaceholderAnimation = hasStartedChat || hasEngagedInput;
  const isAuthenticated = apiKey.trim().length > 0 && userName.trim().length > 0;

  const markInputEngaged = useCallback(() => {
    setInputEngagementByChat((prev) => {
      if (prev[engagementKey]) return prev;
      return { ...prev, [engagementKey]: true };
    });
  }, [engagementKey]);

  const persistApiKey = useCallback((key) => {
    try {
      localStorage.setItem("gemma-api-key", key);
    } catch {}
  }, []);

  const saveValidatedApiKey = useCallback(
    (key, name) => {
      setApiKey(key);
      persistApiKey(key);
      if (name) {
        setUserName(name);
        try { localStorage.setItem("gemma-user-name", name); } catch {}
      }
    },
    [persistApiKey]
  );

  // Persist chats
  useEffect(() => {
    try {
      localStorage.setItem("gemma-chats", JSON.stringify(chats));
    } catch {}
  }, [chats]);

  // Health check
  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  async function checkStatus() {
    try {
      const [health, info] = await Promise.all([
        fetch("/health").then((r) => r.json()),
        fetch("/info").then((r) => r.json()),
      ]);
      setStatus(health.status === "ok" ? "online" : "error");
      setModelName(info.model_name || "");
    } catch {
      setStatus("error");
    }
  }

  const createNewChat = useCallback(() => {
    const id = generateId();
    setChats((prev) => [{ id, messages: [], createdAt: Date.now() }, ...prev]);
    setActiveChatId(id);
  }, []);

  const deleteChat = useCallback(
    (id) => {
      setChats((prev) => prev.filter((c) => c.id !== id));
      if (activeChatId === id) setActiveChatId(null);
    },
    [activeChatId]
  );

  function updateChatMessages(chatId, newMessages) {
    setChats((prev) =>
      prev.map((c) => (c.id === chatId ? { ...c, messages: newMessages } : c))
    );
  }

  function handleEditUserMessage(index, newText) {
    if (!activeChatId || generating) return;
    const chat = chats.find((c) => c.id === activeChatId);
    if (!chat) return;
    const msg = chat.messages[index];
    if (!msg || msg.role !== "user") return;

    // Truncate everything from this message onward, replace with edited text
    const truncated = chat.messages.slice(0, index);
    updateChatMessages(activeChatId, truncated);

    // Re-send with the new text (this will append user msg + assistant response)
    handleSend(newText);
  }

  function buildUserContent(text, attachments) {
    const t = text.trim();
    if (!attachments || attachments.length === 0) return t;

    const parts = [];
    for (const att of attachments) {
      if (att.kind === "image") {
        parts.push({ type: "image_url", image_url: { url: att.dataUrl } });
      } else {
        parts.push({
          type: "file",
          file: {
            filename: att.fileName,
            dataUrl: att.dataUrl,
            mime: att.mime || "",
          },
        });
      }
    }

    const fileNames = attachments
      .filter((a) => a.kind !== "image")
      .map((a) => `"${a.fileName}"`);
    const imageCount = attachments.filter((a) => a.kind === "image").length;

    let defaultHint = "";
    if (imageCount > 0 && fileNames.length > 0) {
      defaultHint = `Describe the image(s) and analyze ${fileNames.join(", ")}. Summarize key points.`;
    } else if (imageCount > 0) {
      defaultHint = "Describe this image and answer any questions.";
    } else {
      defaultHint = `Analyze the attached file(s) ${fileNames.join(", ")}. Summarize key points and answer any questions.`;
    }

    parts.push({ type: "text", text: t || defaultHint });
    return parts;
  }

  async function handleSend(text, options = {}) {
    const { attachments } = options;
    if (generating) return;
    if (!text.trim() && (!attachments || attachments.length === 0)) return;

    markInputEngaged();

    let chatId = activeChatId;
    if (!chatId) {
      chatId = generateId();
      setChats((prev) => [{ id: chatId, messages: [], createdAt: Date.now() }, ...prev]);
      setActiveChatId(chatId);
    }

    const userMsg = { role: "user", content: buildUserContent(text, attachments) };
    const currentChat = chats.find((c) => c.id === chatId);
    const currentMessages = currentChat?.messages || [];
    const newMessages = [...currentMessages, userMsg];

    updateChatMessages(chatId, [...newMessages, { role: "assistant", content: null }]);
    setGenerating(true);

    const key = apiKey.trim() || DEFAULT_API_KEY;
    let assistantText = "";

    const appendAssistant = (delta) => {
      assistantText += delta;
      updateChatMessages(chatId, [
        ...newMessages,
        { role: "assistant", content: assistantText },
      ]);
    };

    try {
      const res = await fetch("/generate/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": key,
          "X-User-Name": userName,
        },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const streamResult = await consumeGenerateStream(res, appendAssistant);

      if (!streamResult.ok) {
        updateChatMessages(chatId, [
          ...newMessages,
          {
            role: "assistant",
            content: `__ERROR__${streamResult.error}`,
          },
        ]);
      } else if (!assistantText.trim()) {
        updateChatMessages(chatId, [
          ...newMessages,
          { role: "assistant", content: "(empty response)" },
        ]);
      }
    } catch (err) {
      updateChatMessages(chatId, [
        ...newMessages,
        { role: "assistant", content: `__ERROR__${err.message}` },
      ]);
    }

    setGenerating(false);
  }

  if (!isAuthenticated) {
    return <ApiKeyGate onAuthenticated={saveValidatedApiKey} />;
  }

  return (
    <div className="layout">
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={setActiveChatId}
        onNewChat={createNewChat}
        onDeleteChat={deleteChat}
        open={sidebarOpen}
        chatTitle={chatTitle}
        savedApiKey={apiKey}
        onApiKeySaved={saveValidatedApiKey}
      />

      <div className="main">
        <Header
          status={status}
          modelName={modelName}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onNewChat={createNewChat}
        />

        <div className="chat-area" ref={chatRef}>
          {messages.length === 0 && (
            <Welcome onSuggestion={(t) => handleSend(t)} />
          )}
          {messages.map((msg, i) => (
            <ChatMessage
              key={`${activeChatId ?? "none"}-${i}`}
              role={msg.role}
              content={msg.content}
              userInitial={userName ? userName.charAt(0) : "U"}
              assistantReplyInProgress={
                generating &&
                msg.role === "assistant" &&
                i === messages.length - 1
              }
              onEditUser={
                msg.role === "user" && !generating
                  ? (newText) => handleEditUserMessage(i, newText)
                  : undefined
              }
            />
          ))}
        </div>

        <ChatInput
          onSend={handleSend}
          disabled={generating}
          suppressPlaceholderAnimation={suppressPlaceholderAnimation}
          onInputEngagement={markInputEngaged}
        />
      </div>
    </div>
  );
}
