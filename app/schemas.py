from pydantic import BaseModel


class Message(BaseModel):
    role: str
    content: str | list  # str for text-only, list for multimodal content parts


class GenerateRequest(BaseModel):
    # Chat mode: pass structured history (preferred for instruct models).
    messages: list[Message] | None = None
    # Completion mode fallback: raw prompt string.
    prompt: str | None = None


class GenerateResponse(BaseModel):
    response: str
