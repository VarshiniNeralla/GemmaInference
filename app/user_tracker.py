"""Simple in-memory + JSON-file user activity tracker."""

import json
import threading
from datetime import datetime, timezone
from pathlib import Path

_DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "users.json"
_lock = threading.Lock()

# In-memory store: { "username": { ... } }
_users: dict[str, dict] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def _load():
    """Load persisted user data from disk (once at startup)."""
    global _users
    if _DATA_FILE.exists():
        try:
            _users = json.loads(_DATA_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            _users = {}


def _save():
    """Persist user data to disk."""
    try:
        _DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        _DATA_FILE.write_text(
            json.dumps(_users, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
    except OSError:
        pass


# Load on import
_load()


def record_login(name: str, ip: str) -> None:
    with _lock:
        now = _now_iso()
        if name in _users:
            _users[name]["last_login"] = now
            _users[name]["login_count"] = _users[name].get("login_count", 0) + 1
            _users[name]["ip"] = ip
        else:
            _users[name] = {
                "first_login": now,
                "last_login": now,
                "login_count": 1,
                "messages_sent": 0,
                "last_active": now,
                "ip": ip,
            }
        _save()


def record_message(name: str) -> None:
    with _lock:
        now = _now_iso()
        if name in _users:
            _users[name]["messages_sent"] = _users[name].get("messages_sent", 0) + 1
            _users[name]["last_active"] = now
        else:
            _users[name] = {
                "first_login": now,
                "last_login": now,
                "login_count": 1,
                "messages_sent": 1,
                "last_active": now,
                "ip": "unknown",
            }
        _save()


def get_all_users() -> list[dict]:
    with _lock:
        result = []
        for name, data in _users.items():
            result.append({"name": name, **data})
        # Sort by last_active descending
        result.sort(key=lambda u: u.get("last_active", ""), reverse=True)
        return result


def get_stats() -> dict:
    with _lock:
        total_users = len(_users)
        total_messages = sum(u.get("messages_sent", 0) for u in _users.values())
        active_today = 0
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        for u in _users.values():
            if u.get("last_active", "").startswith(today):
                active_today += 1
        return {
            "total_users": total_users,
            "total_messages": total_messages,
            "active_today": active_today,
        }
