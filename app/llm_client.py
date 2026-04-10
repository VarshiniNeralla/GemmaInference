import base64
import io
import json
import logging
from collections.abc import AsyncIterator

import httpx
from PIL import Image

try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass

from app.attachments import normalize_messages_for_llm
from app.config import Settings

logger = logging.getLogger(__name__)


def _vllm_error_detail(response: httpx.Response) -> str:
    """Extract a short, human-readable message from vLLM/OpenAI-style error bodies."""
    raw = (response.text or "")[:4000]
    try:
        data = response.json()
    except json.JSONDecodeError:
        return f"HTTP {response.status_code}: {raw.strip() or response.reason_phrase}"

    err = data.get("error")
    if isinstance(err, dict):
        msg = err.get("message") or err.get("type") or str(err)
    elif isinstance(err, str):
        msg = err
    elif err is None and isinstance(data.get("detail"), (str, list)):
        # FastAPI/Starlette style: {"detail":"Not Found"}
        msg = data["detail"]
        if isinstance(msg, list):
            msg = "; ".join(str(x) for x in msg)
    else:
        msg = raw.strip() or str(data)
    return f"HTTP {response.status_code}: {msg}"


def _has_images(messages: list[dict]) -> bool:
    for m in messages:
        if isinstance(m.get("content"), list):
            for part in m["content"]:
                if part.get("type") == "image_url":
                    return True
    return False


def _to_ollama_native(messages: list[dict]) -> list[dict]:
    """Convert OpenAI vision format to Ollama's native /api/chat format.

    Ollama expects: {"role": "user", "content": "text", "images": ["<base64>"]}
    """
    result = []
    for m in messages:
        if isinstance(m.get("content"), list):
            text_parts = []
            images = []
            for part in m["content"]:
                if part.get("type") == "text":
                    text_parts.append(part["text"])
                elif part.get("type") == "image_url":
                    url = part["image_url"]["url"]
                    # Strip "data:image/...;base64," prefix
                    if url.startswith("data:"):
                        url = url.split(",", 1)[1]
                    raw = base64.b64decode(url)
                    logger.info("Image input: %d bytes, header: %r", len(raw), raw[:16])
                    # Convert any format (HEIC, AVIF, BMP, etc.) to PNG
                    img = Image.open(io.BytesIO(raw))
                    img = img.convert("RGB")
                    buf = io.BytesIO()
                    img.save(buf, format="PNG")
                    clean_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
                    logger.info("Image converted to PNG: %d bytes", len(buf.getvalue()))
                    images.append(clean_b64)
            entry = {"role": m["role"], "content": " ".join(text_parts)}
            if images:
                entry["images"] = images
            result.append(entry)
        else:
            result.append({"role": m["role"], "content": m.get("content", "")})
    return result


def _normalize_llm_base_url(url: str) -> str:
    """Avoid .../v1/v1/chat/completions when LLM_BASE_URL already ends with /v1."""
    base = url.rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3].rstrip("/")
    return base


def _apply_max_tokens(payload: dict, max_tokens: int) -> None:
    """Set max_tokens; omit when 0 so vLLM uses its/model defaults (no artificial gateway cap)."""
    if max_tokens <= 0:
        return
    payload["max_tokens"] = max_tokens


class LLMClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        base = _normalize_llm_base_url(settings.LLM_BASE_URL)
        self._chat_url = f"{base}/v1/chat/completions"
        self._ollama_chat_url = f"{base}/api/chat"
        if settings.VLLM_USE_COMPLETIONS:
            self._url = f"{base}/v1/completions"
        else:
            self._url = self._chat_url

    async def generate(
        self,
        prompt: str | None = None,
        messages: list[dict] | None = None,
    ) -> str:
        if self._settings.VLLM_USE_COMPLETIONS:
            if not prompt:
                raise RuntimeError("Completion mode requires a prompt string.")
            payload = {
                "model": self._settings.MODEL_NAME,
                "prompt": prompt,
                "temperature": self._settings.TEMPERATURE,
            }
            _apply_max_tokens(payload, self._settings.MAX_TOKENS)
            if self._settings.OLLAMA_NATIVE_VISION:
                payload["keep_alive"] = "30m"
        else:
            if not messages:
                messages = [{"role": "user", "content": prompt or ""}]
            else:
                messages = normalize_messages_for_llm(messages)

            # Ollama: native /api/chat for images. vLLM: OpenAI multimodal /v1/chat/completions (pass messages through).
            use_native = _has_images(messages) and self._settings.OLLAMA_NATIVE_VISION
            if use_native:
                messages = _to_ollama_native(messages)
                self._url = self._ollama_chat_url
                payload = {
                    "model": self._settings.MODEL_NAME,
                    "messages": messages,
                    "options": {
                        "num_predict": self._settings.MAX_TOKENS,
                        "temperature": self._settings.TEMPERATURE,
                    },
                    "keep_alive": "30m",
                    "think": False,
                    "stream": False,
                }
            else:
                self._url = self._chat_url
                payload = {
                    "model": self._settings.MODEL_NAME,
                    "messages": messages,
                    "temperature": self._settings.TEMPERATURE,
                }
                _apply_max_tokens(payload, self._settings.MAX_TOKENS)
                # Ollama's OpenAI-compatible layer accepts these; vLLM does not.
                if self._settings.OLLAMA_NATIVE_VISION:
                    payload["keep_alive"] = "30m"
                    payload["think"] = False
        logger.info(
            "LLM POST %s (ollama_native_vision=%s, has_images=%s, max_tokens_cap=%s)",
            self._url,
            self._settings.OLLAMA_NATIVE_VISION,
            _has_images(messages or []),
            self._settings.MAX_TOKENS if self._settings.MAX_TOKENS > 0 else "omit",
        )
        timeout = httpx.Timeout(self._settings.REQUEST_TIMEOUT)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(self._url, json=payload)
                resp.raise_for_status()
                text = resp.text
        except httpx.ConnectError as e:
            logger.error("vLLM connection failed: %s", e)
            raise RuntimeError("Could not connect to the language model server.") from e
        except httpx.TimeoutException as e:
            logger.error("vLLM request timed out: %s", e)
            raise RuntimeError("Language model request timed out.") from e
        except httpx.HTTPStatusError as e:
            detail = _vllm_error_detail(e.response)
            logger.error("vLLM %s", detail)
            raise RuntimeError(detail) from e
        except httpx.HTTPError as e:
            logger.error("vLLM HTTP error: %s", e)
            raise RuntimeError("Language model request failed.") from e

        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            logger.error("Invalid JSON from vLLM: %s", e)
            raise RuntimeError("Invalid response from language model server.") from e

        try:
            # Ollama native /api/chat returns {"message": {"content": "..."}}
            # OpenAI format returns {"choices": [{"message": {"content": "..."}}]}
            if "choices" in data:
                choice = data["choices"][0]
                if self._settings.VLLM_USE_COMPLETIONS:
                    content = choice["text"]
                else:
                    msg = choice["message"]
                    content = (msg.get("content") or "").strip()
                    reasoning = (msg.get("reasoning") or "").strip()
                    if not content and reasoning:
                        logger.info("content was empty, using reasoning field")
                        content = reasoning
            elif "message" in data:
                msg = data["message"]
                content = (msg.get("content") or "").strip()
                reasoning = (msg.get("reasoning") or "").strip()
                if not content and reasoning:
                    logger.info("content was empty, using reasoning field")
                    content = reasoning
            else:
                content = ""
        except (KeyError, IndexError, TypeError) as e:
            logger.error("Unexpected vLLM response shape: %s", data)
            raise RuntimeError("Unexpected response from language model server.") from e

        if not isinstance(content, str):
            content = str(content)

        out = content.strip()
        if not out:
            logger.error("Empty content from vLLM after strip, full response: %s", data)
            raise RuntimeError("Language model returned an empty response.")

        return out

    async def generate_stream(
        self,
        prompt: str | None = None,
        messages: list[dict] | None = None,
    ) -> AsyncIterator[str]:
        """Stream decoded text chunks from vLLM OpenAI-style ``/v1/chat/completions`` (SSE)."""
        if self._settings.VLLM_USE_COMPLETIONS:
            raise RuntimeError(
                "Streaming is not supported in completion mode (VLLM_USE_COMPLETIONS)."
            )
        if not messages:
            messages = [{"role": "user", "content": prompt or ""}]
        else:
            messages = normalize_messages_for_llm(messages)

        use_native = _has_images(messages) and self._settings.OLLAMA_NATIVE_VISION
        if use_native:
            raise RuntimeError(
                "Streaming is not supported with OLLAMA_NATIVE_VISION; use the non-streaming "
                "endpoint or set OLLAMA_NATIVE_VISION=false."
            )

        self._url = self._chat_url
        payload: dict = {
            "model": self._settings.MODEL_NAME,
            "messages": messages,
            "temperature": self._settings.TEMPERATURE,
            "stream": True,
        }
        _apply_max_tokens(payload, self._settings.MAX_TOKENS)
        if self._settings.OLLAMA_NATIVE_VISION:
            payload["keep_alive"] = "30m"
            payload["think"] = False

        payload_json = json.dumps(payload, ensure_ascii=False)
        payload_size_mb = len(payload_json) / (1024 * 1024)
        logger.info(
            "LLM stream POST %s (has_images=%s, payload=%.2f MB, msg_count=%d)",
            self._chat_url,
            _has_images(messages),
            payload_size_mb,
            len(messages),
        )
        timeout = httpx.Timeout(self._settings.REQUEST_TIMEOUT)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", self._chat_url, json=payload) as resp:
                    # Read error body INSIDE the context manager (before connection closes)
                    if resp.status_code >= 400:
                        await resp.aread()
                        detail = _vllm_error_detail(resp)
                        logger.error("vLLM stream error: %s", detail)
                        raise RuntimeError(detail)
                    async for line in resp.aiter_lines():
                        line = line.strip()
                        if not line:
                            continue
                        if line == "data: [DONE]":
                            break
                        if not line.startswith("data:"):
                            continue
                        raw = line[5:].strip()
                        try:
                            obj = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        err = obj.get("error")
                        if err:
                            msg = err if isinstance(err, str) else (err.get("message") or str(err))
                            raise RuntimeError(msg)
                        choices = obj.get("choices") or []
                        if not choices:
                            continue
                        delta = choices[0].get("delta") or {}
                        piece = delta.get("content") or ""
                        if not piece:
                            piece = (delta.get("reasoning") or "").strip()
                        if piece:
                            yield piece
        except httpx.ConnectError as e:
            logger.error("vLLM stream connection failed: %s", e)
            raise RuntimeError("Could not connect to the language model server.") from e
        except httpx.TimeoutException as e:
            logger.error("vLLM stream timed out: %s", e)
            raise RuntimeError("Language model request timed out.") from e
        except httpx.HTTPStatusError as e:
            detail = f"HTTP {e.response.status_code}"
            logger.error("vLLM stream status error: %s", detail)
            raise RuntimeError(detail) from e
        except httpx.HTTPError as e:
            logger.error("vLLM stream HTTP error (%s): %r", type(e).__name__, e)
            raise RuntimeError(f"Language model request failed: {type(e).__name__}: {e}") from e
