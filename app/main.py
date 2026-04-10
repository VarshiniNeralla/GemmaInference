import json
import logging
import sys
from pathlib import Path

import uvicorn
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.config import Settings
from app.llm_client import LLMClient
from app.schemas import GenerateRequest, GenerateResponse
from app import user_tracker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

settings = Settings()
llm_client = LLMClient(settings)

app = FastAPI(title="vLLM Gateway")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def verify_api_key(x_api_key: str | None = Header(default=None)) -> None:
    if x_api_key != settings.API_KEY:
        logger.info("Rejected request: invalid or missing API key")
        raise HTTPException(
            status_code=401,
            detail="Invalid API key. Enter the correct API key from your gateway .env (API_KEY).",
        )


def _get_client_ip(request: Request) -> str:
    """Get the real client IP, checking proxy headers first."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else ""


# Your machine's WSL bridge IP — requests from Windows browser to WSL uvicorn come from this.
# Run `ipconfig` and look for the WSL vEthernet adapter IP.
_ADMIN_ALLOWED_IPS = {"127.0.0.1", "::1", "172.28.0.1"}


def _is_localhost(request: Request) -> bool:
    """Check if the request comes from this machine (localhost or WSL bridge)."""
    return _get_client_ip(request) in _ADMIN_ALLOWED_IPS


def require_localhost(request: Request) -> None:
    if not _is_localhost(request):
        raise HTTPException(status_code=403, detail="Admin access is only available from localhost.")


# ── Public endpoints ─────────────────────────────────────────────────────────

@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}



@app.get("/info")
async def info() -> dict[str, str | bool]:
    return {
        "model_name": settings.MODEL_NAME,
        "completions_mode": settings.VLLM_USE_COMPLETIONS,
    }


@app.post("/verify-api-key")
async def verify_api_key_endpoint(_: None = Depends(verify_api_key)) -> dict[str, bool]:
    return {"valid": True}


# ── Login (name + API key) ───────────────────────────────────────────────────

class LoginRequest(BaseModel):
    name: str
    api_key: str


@app.post("/api/login")
async def login(body: LoginRequest, request: Request):
    if body.api_key != settings.API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key.")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")
    ip = _get_client_ip(request) or "unknown"
    user_tracker.record_login(name, ip)
    logger.info("User logged in: %s from %s", name, ip)
    return {"valid": True, "name": name}


# ── Generate (with usage tracking) ──────────────────────────────────────────

@app.post("/generate", response_model=GenerateResponse)
async def generate(
    body: GenerateRequest,
    _: None = Depends(verify_api_key),
    x_user_name: str | None = Header(default=None),
) -> GenerateResponse:
    prompt_len = len(body.prompt or "")
    msg_count = len(body.messages or [])
    logger.info("Generate request (user=%s, prompt_len=%d, messages=%d)", x_user_name, prompt_len, msg_count)
    if x_user_name:
        user_tracker.record_message(x_user_name)
    msgs = [{"role": m.role, "content": m.content} for m in body.messages] if body.messages else None
    try:
        text = await llm_client.generate(prompt=body.prompt, messages=msgs)
    except RuntimeError as e:
        logger.error("Generate failed: %s", e)
        raise HTTPException(status_code=502, detail=str(e)) from e
    return GenerateResponse(response=text)


@app.post("/generate/stream")
async def generate_stream(
    body: GenerateRequest,
    _: None = Depends(verify_api_key),
    x_user_name: str | None = Header(default=None),
) -> StreamingResponse:
    prompt_len = len(body.prompt or "")
    msg_count = len(body.messages or [])
    logger.info("Generate stream (user=%s, prompt_len=%d, messages=%d)", x_user_name, prompt_len, msg_count)
    if x_user_name:
        user_tracker.record_message(x_user_name)
    msgs = (
        [{"role": m.role, "content": m.content} for m in body.messages]
        if body.messages
        else None
    )

    async def sse():
        try:
            async for chunk in llm_client.generate_stream(
                prompt=body.prompt,
                messages=msgs,
            ):
                yield f"data: {json.dumps({'text': chunk}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        except RuntimeError as e:
            logger.error("Generate stream failed: %s", e)
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        sse(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── Admin API (localhost only) ───────────────────────────────────────────────

@app.get("/api/admin/users", dependencies=[Depends(require_localhost)])
async def admin_users():
    return user_tracker.get_all_users()


@app.get("/api/admin/stats", dependencies=[Depends(require_localhost)])
async def admin_stats():
    return user_tracker.get_stats()


# ── Admin Dashboard (localhost only) ─────────────────────────────────────────

@app.get("/admin", response_class=HTMLResponse)
async def admin_dashboard(request: Request):
    if not _is_localhost(request):
        raise HTTPException(status_code=403, detail="Admin access is only available from localhost.")

    return """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Gemma Admin</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600&family=Inter:wght@400;500&display=swap" rel="stylesheet" />
  <link href="https://fonts.googleapis.com/icon?family=Material+Symbols+Rounded" rel="stylesheet" />
  <style>
    :root {
      --blue: #1a73e8;
      --blue-light: #e8f0fe;
      --surface: #ffffff;
      --bg: #f0f4f9;
      --text: #1f1f1f;
      --text-secondary: #5f6368;
      --border: #dadce0;
      --success: #0d652d;
      --success-bg: #e6f4ea;
      --warning: #b06000;
      --warning-bg: #fef7e0;
      --radius: 16px;
      --shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Google Sans", "Inter", system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }

    .topbar {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 16px 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .topbar-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .topbar-left .material-symbols-rounded {
      font-size: 28px;
      color: var(--blue);
    }
    .topbar h1 {
      font-size: 20px;
      font-weight: 500;
    }
    .topbar-badge {
      font-size: 11px;
      font-weight: 500;
      background: var(--blue-light);
      color: var(--blue);
      padding: 4px 12px;
      border-radius: 20px;
    }
    .refresh-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: 20px;
      border: 1px solid var(--border);
      background: var(--surface);
      font-family: inherit;
      font-size: 13px;
      font-weight: 500;
      color: var(--text);
      cursor: pointer;
      transition: all 0.12s;
    }
    .refresh-btn:hover {
      background: var(--blue-light);
      border-color: var(--blue);
      color: var(--blue);
    }
    .refresh-btn .material-symbols-rounded { font-size: 18px; }

    .container { max-width: 1000px; margin: 0 auto; padding: 28px 32px; }

    /* Stat cards */
    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 28px;
    }
    .stat-card {
      background: var(--surface);
      border-radius: var(--radius);
      padding: 24px;
      border: 1px solid var(--border);
      box-shadow: var(--shadow);
    }
    .stat-card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .stat-card-header .material-symbols-rounded {
      font-size: 20px;
    }
    .stat-card-value {
      font-size: 36px;
      font-weight: 400;
      color: var(--text);
      letter-spacing: -1px;
    }

    /* User table */
    .table-card {
      background: var(--surface);
      border-radius: var(--radius);
      border: 1px solid var(--border);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .table-header {
      padding: 20px 24px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border);
    }
    .table-header h2 {
      font-size: 16px;
      font-weight: 500;
    }
    .table-header-count {
      font-size: 12px;
      color: var(--text-secondary);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    thead th {
      text-align: left;
      padding: 12px 24px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.3px;
      background: #f8f9fa;
      border-bottom: 1px solid var(--border);
    }
    tbody td {
      padding: 14px 24px;
      border-bottom: 1px solid #f1f3f4;
      vertical-align: middle;
    }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:hover { background: #f8f9fa; }

    .user-name {
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .user-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--blue);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 600;
      flex-shrink: 0;
    }
    .user-ip {
      font-size: 12px;
      color: var(--text-secondary);
      font-family: "Roboto Mono", monospace;
    }
    .msg-count {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 500;
    }
    .msg-count.high { background: var(--success-bg); color: var(--success); }
    .msg-count.med { background: var(--blue-light); color: var(--blue); }
    .msg-count.low { background: #f1f3f4; color: var(--text-secondary); }

    .empty-state {
      padding: 60px 24px;
      text-align: center;
      color: var(--text-secondary);
    }
    .empty-state .material-symbols-rounded {
      font-size: 48px;
      opacity: 0.3;
      margin-bottom: 12px;
    }
    .auto-refresh { font-size: 11px; color: var(--text-secondary); margin-top: 16px; text-align: center; }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="topbar-left">
      <span class="material-symbols-rounded">admin_panel_settings</span>
      <h1>Gemma Admin</h1>
      <span class="topbar-badge">Localhost only</span>
    </div>
    <button class="refresh-btn" onclick="loadData()">
      <span class="material-symbols-rounded">refresh</span>
      Refresh
    </button>
  </div>

  <div class="container">
    <div class="stats" id="stats">
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="material-symbols-rounded">group</span> Total users
        </div>
        <div class="stat-card-value" id="totalUsers">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="material-symbols-rounded">chat</span> Total messages
        </div>
        <div class="stat-card-value" id="totalMessages">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="material-symbols-rounded">trending_up</span> Active today
        </div>
        <div class="stat-card-value" id="activeToday">-</div>
      </div>
    </div>

    <div class="table-card">
      <div class="table-header">
        <h2>Users</h2>
        <span class="table-header-count" id="userCount"></span>
      </div>
      <div id="tableBody"></div>
    </div>

    <p class="auto-refresh">Auto-refreshes every 10 seconds</p>
  </div>

<script>
function getInitials(name) {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

function fmtDate(utcStr) {
  if (!utcStr || utcStr === "-") return "-";
  // Parse "2026-04-09 06:56:47 UTC" into a Date
  const d = new Date(utcStr.replace(" UTC", "Z").replace(" ", "T"));
  if (isNaN(d)) return utcStr;
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);

  // "Just now", "5 min ago", "2 hr ago"
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return diffMin + " min ago";
  if (diffHr < 24) return diffHr + " hr ago";

  // "Apr 9, 12:26 PM"
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    + ", " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function msgClass(count) {
  if (count >= 20) return "high";
  if (count >= 5) return "med";
  return "low";
}

async function loadData() {
  try {
    const [statsRes, usersRes] = await Promise.all([
      fetch("/api/admin/stats"),
      fetch("/api/admin/users"),
    ]);
    const stats = await statsRes.json();
    const users = await usersRes.json();

    document.getElementById("totalUsers").textContent = stats.total_users;
    document.getElementById("totalMessages").textContent = stats.total_messages;
    document.getElementById("activeToday").textContent = stats.active_today;
    document.getElementById("userCount").textContent = users.length + " total";

    if (users.length === 0) {
      document.getElementById("tableBody").innerHTML =
        '<div class="empty-state"><span class="material-symbols-rounded">person_off</span><p>No users have logged in yet.</p></div>';
      return;
    }

    let html = "<table><thead><tr>";
    html += "<th>User</th><th>IP Address</th><th>First Login</th><th>Last Active</th><th>Logins</th><th>Messages</th>";
    html += "</tr></thead><tbody>";

    for (const u of users) {
      const cls = msgClass(u.messages_sent || 0);
      html += "<tr>";
      html += '<td><div class="user-name"><div class="user-avatar">' + getInitials(u.name) + '</div>' + u.name + '</div></td>';
      html += '<td><span class="user-ip">' + (u.ip || "-") + '</span></td>';
      html += "<td>" + fmtDate(u.first_login) + "</td>";
      html += "<td>" + fmtDate(u.last_active) + "</td>";
      html += "<td>" + (u.login_count || 0) + "</td>";
      html += '<td><span class="msg-count ' + cls + '">' + (u.messages_sent || 0) + "</span></td>";
      html += "</tr>";
    }

    html += "</tbody></table>";
    document.getElementById("tableBody").innerHTML = html;
  } catch (err) {
    console.error("Failed to load admin data:", err);
  }
}

loadData();
setInterval(loadData, 10000);
</script>
</body>
</html>"""


# Serve the built frontend (npm run build -> frontend/dist)
_frontend_dir = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _frontend_dir.is_dir():
    app.mount(
        "/",
        StaticFiles(directory=str(_frontend_dir), html=True),
        name="frontend",
    )


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        log_level="info",
    )
