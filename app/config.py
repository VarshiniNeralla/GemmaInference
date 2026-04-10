from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    MODEL_NAME: str
    LLM_BASE_URL: str = Field(
        validation_alias=AliasChoices("LLM_BASE_URL", "VLLM_URL"),
    )
    # Base / completion models (e.g. OPT) have no chat template; use /v1/completions instead of chat.
    VLLM_USE_COMPLETIONS: bool = False
    # True: image requests use Ollama /api/chat (native). False: OpenAI /v1/chat/completions (vLLM).
    # Default False: vLLM has no /api/chat; True would cause HTTP 404 on image requests.
    OLLAMA_NATIVE_VISION: bool = False
    # Max new tokens per completion. Use 0 to omit (vLLM/model defaults). Else set high (e.g. 32768) for long answers.
    MAX_TOKENS: int = Field(default=32768, ge=0)
    TEMPERATURE: float
    REQUEST_TIMEOUT: float
    API_KEY: str
    HOST: str
    PORT: int
