/**
 * Reads SSE from POST /generate/stream (data: {"text":"..."} | {"error":"..."} | [DONE]).
 * Calls onDelta for each text piece. Returns { ok: true } or { ok: false, error: string }.
 */
export async function consumeGenerateStream(response, onDelta) {
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: response.statusText }));
    const msg =
      typeof err.detail === "string"
        ? err.detail
        : Array.isArray(err.detail)
          ? err.detail.map((d) => d.msg || String(d)).join(" ")
          : response.statusText;
    return { ok: false, error: msg || `HTTP ${response.status}` };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return { ok: false, error: "No response body" };
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, sep).trim();
        buffer = buffer.slice(sep + 2);
        if (!block) continue;

        for (const rawLine of block.split("\n")) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") {
            return { ok: true };
          }
          try {
            const j = JSON.parse(data);
            if (j.error) {
              return { ok: false, error: String(j.error) };
            }
            if (j.text) {
              onDelta(j.text);
            }
          } catch {
            // ignore malformed JSON lines
          }
        }
      }
    }
  } finally {
    reader.releaseLock?.();
  }

  return { ok: true };
}
