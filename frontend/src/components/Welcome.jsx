import logoImg from "../../MyHomeLogo.png";
import "./Welcome.css";

const SUGGESTIONS = [
  { icon: "lightbulb", text: "Explain quantum computing in simple terms" },
  { icon: "code", text: "Write a Python function to reverse a linked list" },
  { icon: "auto_awesome", text: "What makes Gemma different from other AI models?" },
  { icon: "edit_note", text: "Help me write a professional email to my team" },
];

export default function Welcome({ onSuggestion }) {
  return (
    <div className="welcome">
      <div className="welcome-icon">
        <img src={logoImg} alt="" width={64} height={64} />
      </div>
      <h1 className="welcome-title">
        <span className="gradient-text">Hello there</span>
      </h1>
      <p className="welcome-subtitle">
        How can I help you today?
      </p>
      <div className="suggestions">
        {SUGGESTIONS.map(({ icon, text }) => (
          <button key={text} className="suggestion" onClick={() => onSuggestion(text)}>
            <span className="material-symbols-rounded suggestion-icon">{icon}</span>
            <span className="suggestion-text">{text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
