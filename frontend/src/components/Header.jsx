import { HamburgerIcon, SidebarPanelIcon } from "./icons/SidebarToggleIcons.jsx";
import "./Header.css";

export default function Header({
  status,
  modelName,
  sidebarOpen,
  onToggleSidebar,
  onNewChat,
}) {
  return (
    <header className="header">
      <div className="header-left">
        <button
          className="header-icon-btn header-sidebar-toggle"
          type="button"
          onClick={onToggleSidebar}
          title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          aria-expanded={sidebarOpen}
          aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        >
          {sidebarOpen ? <SidebarPanelIcon /> : <HamburgerIcon />}
        </button>
        <button className="header-icon-btn" onClick={onNewChat} title="New chat">
          <span className="material-symbols-rounded">edit_square</span>
        </button>
      </div>
      <div className="header-center">
        <span className="header-model-name">{modelName || "Gemma"}</span>
      </div>
      <div className="header-right">
        <span className="model-badge">
          <span className={`status-dot ${status}`} />
          {status === "online" ? "Online" : status === "error" ? "Offline" : "..."}
        </span>
      </div>
    </header>
  );
}
