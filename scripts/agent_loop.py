"""
Minimal AI agent loop with tool calling over vLLM (OpenAI-compatible API).
Model: gemma4-31b-it served via vLLM Docker container.

Usage:
    python scripts/agent_loop.py "What is the weather in Chennai?"
"""

import json
import re
import sys

import httpx

VLLM_URL = "http://localhost:8000/v1/chat/completions"
MODEL = "gemma4-31b"

# ── Tools registry ──────────────────────────────────────────────────────────

TOOLS_SCHEMA = [
    {
        "name": "get_weather",
        "description": "Get current weather for a city.",
        "parameters": {"city": "string (required)"},
    },
    {
        "name": "calculate",
        "description": "Evaluate a math expression.",
        "parameters": {"expression": "string (required)"},
    },
]


def get_weather(city: str) -> str:
    """Mock weather tool."""
    return json.dumps({"city": city, "temp_c": 34, "condition": "Partly cloudy"})


def calculate(expression: str) -> str:
    """Safe math evaluator."""
    allowed = set("0123456789+-*/.() ")
    if not all(c in allowed for c in expression):
        return json.dumps({"error": "Invalid expression"})
    try:
        return json.dumps({"result": eval(expression)})  # noqa: S307
    except Exception as e:
        return json.dumps({"error": str(e)})


TOOL_FNS = {
    "get_weather": get_weather,
    "calculate": calculate,
}

# ── System prompt that teaches the model to emit tool calls ─────────────────

SYSTEM_PROMPT = f"""\
You are a helpful assistant with access to tools.

Available tools:
{json.dumps(TOOLS_SCHEMA, indent=2)}

When you need to call a tool, reply with EXACTLY this JSON block and nothing else:

```json
{{"tool_call": {{"name": "<tool_name>", "arguments": {{...}}}}}}
```

Rules:
- Only use one tool call per reply.
- If you don't need a tool, reply normally in plain text.
- After receiving a tool result, use it to answer the user's question.
"""

# ── Helper: extract a tool call JSON from model output ──────────────────────


def extract_tool_call(text: str) -> dict | None:
    """Try to pull a tool_call JSON from the model's response."""
    # Try fenced code block first
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if m:
        try:
            obj = json.loads(m.group(1))
            if "tool_call" in obj:
                return obj["tool_call"]
        except json.JSONDecodeError:
            pass

    # Fallback: bare JSON anywhere in the response
    m = re.search(r'\{\s*"tool_call"\s*:\s*\{.*?\}\s*\}', text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))["tool_call"]
        except json.JSONDecodeError:
            pass

    return None


# ── Chat with vLLM ──────────────────────────────────────────────────────────


def chat(messages: list[dict]) -> str:
    """Send messages to vLLM and return the assistant's text."""
    payload = {
        "model": MODEL,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": 1024,
    }
    resp = httpx.post(VLLM_URL, json=payload, timeout=120)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


# ── Agent loop ──────────────────────────────────────────────────────────────

MAX_TOOL_ROUNDS = 5


def run_agent(user_query: str) -> str:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_query},
    ]

    for i in range(MAX_TOOL_ROUNDS):
        print(f"\n── Round {i + 1} ──")
        reply = chat(messages)
        print(f"Model: {reply}")

        tool_call = extract_tool_call(reply)
        if tool_call is None:
            # No tool call → final answer
            return reply

        name = tool_call["name"]
        args = tool_call.get("arguments", {})
        print(f"  → Tool: {name}({args})")

        fn = TOOL_FNS.get(name)
        if fn is None:
            result = json.dumps({"error": f"Unknown tool: {name}"})
        else:
            result = fn(**args)

        print(f"  ← Result: {result}")

        # Append assistant reply + tool result, then loop
        messages.append({"role": "assistant", "content": reply})
        messages.append({"role": "user", "content": f"Tool result:\n{result}"})

    return reply


# ── Main ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    query = " ".join(sys.argv[1:]) or "What is the weather in Chennai and what is 123 * 456?"
    print(f"User: {query}")
    answer = run_agent(query)
    print(f"\n{'='*60}\nFinal answer:\n{answer}")
