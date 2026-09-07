from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Provider keys must stay on the server."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    provider: str = Field(default="mock", validation_alias="NUDGE_PROVIDER")
    model: str = Field(default="gpt-5-mini", validation_alias="NUDGE_MODEL")
    openai_api_key: str | None = Field(default=None, validation_alias="OPENAI_API_KEY")
    openai_base_url: str = Field(default="https://api.openai.com/v1", validation_alias="OPENAI_BASE_URL")
    fastrouter_base_url: str = Field(
        default="https://api.fastrouter.ai/api/v1", validation_alias="FASTROUTER_BASE_URL"
    )
    fastrouter_api_key: str | None = Field(default=None, validation_alias="FASTROUTER_API_KEY")
    qwen_base_url: str | None = Field(default=None, validation_alias="QWEN_BASE_URL")
    qwen_api_key: str | None = Field(default=None, validation_alias="QWEN_API_KEY")
    allowed_origins: str = Field(default="chrome-extension://*", validation_alias="NUDGE_ALLOWED_ORIGINS")

    @model_validator(mode="after")
    def validate_provider(self) -> "Settings":
        if self.provider not in {"mock", "fastrouter", "openai", "qwen"}:
            raise ValueError("NUDGE_PROVIDER must be 'mock', 'fastrouter', 'openai', or 'qwen'.")
        if self.provider == "fastrouter" and not self.fastrouter_api_key:
            raise ValueError("FASTROUTER_API_KEY is required when NUDGE_PROVIDER=fastrouter.")
        if self.provider == "openai" and not self.openai_api_key:
            raise ValueError("OPENAI_API_KEY is required when NUDGE_PROVIDER=openai.")
        if self.provider == "qwen" and (not self.qwen_api_key or not self.qwen_base_url):
            raise ValueError("QWEN_API_KEY and QWEN_BASE_URL are required when NUDGE_PROVIDER=qwen.")
        return self

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
