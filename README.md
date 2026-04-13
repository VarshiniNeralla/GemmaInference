# Gemma 4 31B — vLLM gateway and chat UI

This repository runs **Google Gemma 4** (31B instruct, NVFP4 checkpoint from Hugging Face) behind **vLLM**, adds a small **FastAPI gateway** for auth and file/image handling, and ships a **React + Vite** web chat that talks to that gateway.

After setup you get:

- **Inference:** OpenAI-compatible **`/v1/chat/completions`** from vLLM (multimodal: text + images).
- **Gateway:** **`/generate`** and **`/generate/stream`** with a shared **API key**, optional usage tracking, and normalization of uploads for the model.
- **UI:** Browser chat with Markdown rendering, attachments, and streaming replies.

---

## Table of contents

1. [Architecture](#architecture)
2. [Requirements](#requirements)
3. [Configuration (`.env`)](#configuration-env)
4. [Run with Docker Compose (recommended)](#run-with-docker-compose-recommended)
5. [Run locally (development)](#run-locally-development)
6. [Ports and services](#ports-and-services)
7. [HTTP API reference](#http-api-reference)
8. [Calling vLLM from another application](#calling-vllm-from-another-application)
9. [Model and vLLM settings](#model-and-vllm-settings)
10. [Persistence and admin](#persistence-and-admin)
11. [Troubleshooting](#troubleshooting)
12. [Further reading](#further-reading)

---

## Architecture

```text
Browser  ──►  Vite (port 3000)  ──proxy──►  FastAPI gateway (port 9000)
                                                  │
                                                  ▼
                                           vLLM (port 8000)
                                           OpenAI-compatible API
```

- **Frontend** (`frontend/`): React app; dev server proxies `/generate`, `/health`, `/info`, etc. to the gateway (see `frontend/vite.config.js`, env `VITE_API_PROXY`).
- **Backend** (`app/`): FastAPI app (`app.main:app`). Validates **`X-API-Key`**, forwards chat to **`LLM_BASE_URL`** (vLLM’s base URL, no path).
- **vLLM** (`docker/vllm-gemma4.Dockerfile`): Serves **`RedHatAI/gemma-4-31B-it-NVFP4`** with **`--served-model-name gemma4-31b`**.

The gateway’s `MODEL_NAME` in `.env` must match the served model name vLLM exposes (e.g. `gemma4-31b`).

---

## Requirements

| Component | Notes |
|-----------|--------|
| **GPU** | NVIDIA GPU suitable for **31B** inference (VRAM depends on quantization and context; compose uses `--gpu-memory-utilization 0.9`). |
| **Docker** | Docker Engine + **NVIDIA Container Toolkit** for GPU inside containers. |
| **OS** | vLLM is **Linux-oriented**; many teams use **WSL2** on Windows with Docker Desktop and run backend/frontend from WSL for consistent paths. |
| **Python** | **3.12+** (see `pyproject.toml` / `docker/backend.Dockerfile`). |
| **Node.js** | **20+** for the Vite frontend (local or container). |
| **Hugging Face** | A **Hugging Face token** with access to the model repo (accept any license/terms on the model card). Used as **`HF_TOKEN`** for Compose to pull weights. |

Optional: **[uv](https://github.com/astral-sh/uv)** for Python (`uv sync`, `uv run`).

---

## Configuration (`.env`)

Create a **`.env`** file in the **repository root** (same folder as `docker-compose.yml`). It is **gitignored**; do not commit secrets.

### Required variables (gateway)

These are loaded by **`app/config.py`** via `pydantic-settings`:

| Variable | Description |
|----------|-------------|
| **`MODEL_NAME`** | Model id sent to vLLM in JSON (must match **`--served-model-name`**, e.g. `gemma4-31b`). |
| **`LLM_BASE_URL`** | Base URL of the inference server **without** a path. Examples: `http://localhost:8000` (vLLM on host), `http://vllm:8000` (Compose service name from backend container). Legacy alias: **`VLLM_URL`**. |
| **`TEMPERATURE`** | Sampling temperature forwarded to vLLM (e.g. `0.3`). |
| **`MAX_TOKENS`** | Max **new** tokens per completion sent as `max_tokens`. Use **`0`** to omit the cap and let vLLM use its defaults. |
| **`REQUEST_TIMEOUT`** | HTTP client timeout in **seconds** for each vLLM call (e.g. `600` for long generations). |
| **`API_KEY`** | Shared secret; clients must send header **`X-API-Key`** (same value) to protected routes. |
| **`HOST`** | Uvicorn bind address (e.g. `0.0.0.0` for LAN). |
| **`PORT`** | Uvicorn port (e.g. `9000`). |

### Optional / advanced

| Variable | Default | Description |
|----------|---------|-------------|
| **`VLLM_USE_COMPLETIONS`** | `false` | If `true`, uses **`/v1/completions`** instead of chat (for non-chat models). |
| **`OLLAMA_NATIVE_VISION`** | `false` | If `true`, image requests use Ollama **`/api/chat`**. Leave **`false`** for vLLM (OpenAI multimodal **`/v1/chat/completions`**). |

### Docker Compose: Hugging Face token

`docker-compose.yml` passes **`HUGGING_FACE_HUB_TOKEN=${HF_TOKEN}`** into the vLLM service. Set **`HF_TOKEN`** in your shell or in the same **`.env`** file in the project root (Compose reads it for **variable substitution** in the YAML). This is separate from the Python `Settings` class but commonly stored alongside other secrets in `.env`.

### Example `.env` (template — replace values)

```env
MODEL_NAME=gemma4-31b
LLM_BASE_URL=http://localhost:8000

VLLM_USE_COMPLETIONS=false
OLLAMA_NATIVE_VISION=false

MAX_TOKENS=10000
TEMPERATURE=0.3
REQUEST_TIMEOUT=600

API_KEY=your-long-random-secret
HOST=0.0.0.0
PORT=9000

HF_TOKEN=hf_your_huggingface_token_here
```

---

## Run with Docker Compose (recommended)

1. Install **Docker** + **NVIDIA GPU** support for containers.
2. Create **`.env`** as above (at minimum **`API_KEY`**, **`MODEL_NAME`**, **`LLM_BASE_URL`**, **`TEMPERATURE`**, **`MAX_TOKENS`**, **`REQUEST_TIMEOUT`**, **`HOST`**, **`PORT`**, and **`HF_TOKEN`** for the model pull).
3. For **Compose**, the **backend** service overrides **`LLM_BASE_URL=http://vllm:8000`** so the gateway reaches vLLM on the internal network. Your `.env` may still say `localhost` for local-only runs; the override wins for the backend container.
4. From the repo root:

   ```bash
   docker compose up --build
   ```

5. Wait for the **vLLM healthcheck** (first start downloads the model; can take a long time).
6. Open the UI at **`http://localhost:3000`** (or your host IP on port **3000**).

Services:

- **vLLM:** `8000`
- **Gateway:** `9000`
- **Frontend:** `3000`

---

## Run locally (development)

Use this when vLLM runs in Docker (or elsewhere) and you want to edit Python/React with reload.

### 1. Start vLLM

Either:

- `docker compose up vllm` (only the GPU service), **or**
- Any other vLLM deployment listening on **`LLM_BASE_URL`**.

### 2. Backend (FastAPI)

From the **repository root**, with Python 3.12 and dependencies installed:

```bash
# Using uv (recommended if you use pyproject.toml / uv.lock)
uv sync
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 9000

# Or pip
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 9000
```

Ensure **`.env`** has **`LLM_BASE_URL`** pointing at vLLM (e.g. `http://127.0.0.1:8000` when vLLM publishes port 8000 on the host).

### 3. Frontend (Vite)

```bash
cd frontend
npm ci
npm run dev
```

Default API target is **`http://127.0.0.1:9000`**. To point elsewhere:

```bash
export VITE_API_PROXY=http://127.0.0.1:9000
npm run dev
```

The dev server listens on **`0.0.0.0:3000`** (see `vite.config.js`).

### Serving the built UI from the gateway (optional)

If you run **`npm run build`** inside **`frontend/`**, output goes to **`frontend/dist/`**. When that directory exists, **`app.main`** mounts it at **`/`** on the same process as the API (so one origin can serve both UI and **`/generate`**). API routes remain available at their usual paths. In day-to-day development, most people use **Vite on 3000** and **Uvicorn on 9000** separately.

---

## Ports and services

| Port | Service | Purpose |
|------|---------|---------|
| **8000** | vLLM | Model server; **`GET /health`**, **`POST /v1/chat/completions`**, etc. |
| **9000** | FastAPI (`app.main`) | Gateway, static UI in production build if mounted |
| **3000** | Vite (dev) | React UI; proxies API calls to gateway |

---

## HTTP API reference

Base URL in development: **`http://127.0.0.1:9000`** (gateway).

### Public (no API key)

| Method | Path | Description |
|--------|------|-------------|
| **GET** | `/health` | Liveness: `{"status":"ok"}`. Does **not** verify vLLM. |
| **GET** | `/info` | Public metadata: `model_name`, `completions_mode`. |

### Auth check

| Method | Path | Headers | Description |
|--------|------|---------|-------------|
| **POST** | `/verify-api-key` | `X-Api-Key: <API_KEY>` | Returns `{"valid": true}` if the key matches. |

### Login (optional display name + tracking)

| Method | Path | Body (JSON) | Description |
|--------|------|-------------|-------------|
| **POST** | `/api/login` | `{"name": "<string>", "api_key": "<API_KEY>"}` | Validates key; records login for usage tracking. |

### Generation (requires API key)

Headers:

- **`X-Api-Key`**: must equal **`API_KEY`** from `.env`.
- **`X-User-Name`** (optional): if set, counted for per-user message stats.

| Method | Path | Body | Response |
|--------|------|------|------------|
| **POST** | `/generate` | `GenerateRequest` | `{"response": "<string>"}` |
| **POST** | `/generate/stream` | Same body | **SSE** stream: `data: {"text":"..."}\n\n` chunks, then `data: [DONE]\n\n` |

**`GenerateRequest`** (JSON):

- **`messages`** (preferred): array of `{ "role": "user"|"assistant"|"system", "content": ... }`.
  - **`content`** may be a **string** or a **multimodal array** (OpenAI-style parts: `text`, `image_url`, `file` — the gateway normalizes files/images before calling vLLM).
- **`prompt`** (legacy): single string; used if **`messages`** is omitted.

Errors:

- **401**: missing/wrong API key.
- **502**: gateway could not get a valid completion from vLLM (detail string in body).

CORS is enabled for all origins on the gateway (suitable for dev; tighten for production).

---

## Calling vLLM from another application

You can integrate in two ways:

1. **Through the gateway** (same contract as the UI): **`POST /generate`** or **`POST /generate/stream`** with **`X-Api-Key`** and the same JSON body as above. Generation caps and **`TEMPERATURE`** come from **`.env`**.
2. **Directly to vLLM**: **`POST <LLM_BASE_URL>/v1/chat/completions`** with OpenAI-style JSON. Set **`model`** to the served name (e.g. **`gemma4-31b`**). You must pass **`max_tokens`**, **`temperature`**, etc. yourself if you want parity with this stack.

The web UI renders assistant Markdown with **`marked`**; other clients should either render Markdown or show plain text.

---

## Model and vLLM settings

Default image / Compose command aligns with:

- **Model id (HF):** `RedHatAI/gemma-4-31B-it-NVFP4`
- **`--served-model-name`:** `gemma4-31b` (this is what clients send as **`model`**).
- **`--max-model-len`:** `32768` (context window upper bound).
- **`--gpu-memory-utilization`:** `0.9`
- **`--max-num-seqs`:** `16`
- **`--trust-remote-code`:** enabled in Compose

The custom **`docker/vllm-gemma4.Dockerfile`** extends **`vllm/vllm-openai:nightly`** and upgrades **Transformers** from Git so **Gemma 4** architecture support is available even if the base image lags.

---

## Persistence and admin

- **`data/users.json`**: Created at runtime for simple **usage / login tracking** (gitignored via `.gitignore`). Mounted in Compose as **`./data:/app/data`**.
- **Admin** (localhost / configured bridge IP only): **`GET /api/admin/users`**, **`GET /api/admin/stats`**, **`GET /admin`**. See **`_ADMIN_ALLOWED_IPS`** in `app/main.py` if you access from WSL vs Windows browser.

---

## Troubleshooting

| Symptom | Things to check |
|---------|------------------|
| **401** from gateway | **`X-Api-Key`** header matches **`API_KEY`** in `.env`. |
| **502** from gateway | vLLM URL (**`LLM_BASE_URL`**), GPU OOM, model name mismatch (**`MODEL_NAME`** vs **`--served-model-name`**), timeout (**`REQUEST_TIMEOUT`**). |
| **Frontend cannot reach API** | **`VITE_API_PROXY`** / default **`127.0.0.1:9000`**; if UI runs in Docker, proxy target must be reachable (Compose uses **`http://backend:9000`**). |
| **Images fail with Ollama errors** | Set **`OLLAMA_NATIVE_VISION=false`** when using vLLM. |
| **Download / auth errors for weights** | **`HF_TOKEN`** valid and model access granted on Hugging Face. |
| **Out of memory** | Lower **`--max-model-len`**, **`--max-num-seqs`**, or **`--gpu-memory-utilization`** in Compose or your vLLM command. |

---

## Further reading

- **`docs/ARCHITECTURE_AND_INFERENCE_OPTIMIZATION.md`** — deeper notes on the gateway, `LLMClient`, Ollama vs vLLM paths, and tuning.
- **`docker-compose.yml`** — full stack wiring, healthchecks, volumes.
- **`app/llm_client.py`** — how requests are built and responses parsed.

---

## Repository layout (short)

| Path | Role |
|------|------|
| `app/main.py` | FastAPI routes, static mount, admin |
| `app/config.py` | Environment settings |
| `app/llm_client.py` | HTTP client to vLLM (chat / stream / completions) |
| `app/attachments.py` | Multimodal normalization (images, file text extraction) |
| `app/schemas.py` | `GenerateRequest` / `GenerateResponse` |
| `frontend/` | React + Vite UI |
| `docker/` | Dockerfiles for vLLM, backend, frontend |
| `scripts/` | Helper scripts (e.g. `agent_loop.py` for direct vLLM demos) |

The top-level **`main.py`** is a minimal placeholder; the real ASGI app is **`app.main:app`**.

---

## License and model terms

Use of **Gemma** and the **RedHatAI** checkpoint is subject to their respective **license and acceptable use** policies on Hugging Face. This repository does not grant any additional rights to the weights.
