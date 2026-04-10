import "./Avatar.css";

export default function Avatar({ role, isThinking = false, userInitial = "U" }) {
  if (role === "user") {
    return (
      <div className="avatar avatar--user" aria-hidden="true">
        <span className="avatar__initial">
          {(userInitial || "U").charAt(0).toUpperCase()}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`avatar avatar--assistant ${isThinking ? "avatar--thinking" : ""}`}
      aria-hidden="true"
    >
      <span className="avatar__letter">G</span>
    </div>
  );
}
