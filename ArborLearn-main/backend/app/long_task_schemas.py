from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class LongTaskCreateRequest(BaseModel):
    node_id: str | None = None
    notebook_id: str | None = None
    question: str = Field(min_length=1)
    title: str | None = None
    auto_run: bool = False
    model: Literal["deepseek-v4-flash", "deepseek-v4-pro"] | None = None
    modelName: Literal["deepseek-v4-flash", "deepseek-v4-pro"] | None = None
    thinkingMode: Literal["fast", "deep", "challenge"] | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize_request_keys(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        normalized = dict(data)
        aliases = {
            "nodeId": "node_id",
            "notebookId": "notebook_id",
            "autoRun": "auto_run",
        }
        for camel_key, snake_key in aliases.items():
            if snake_key not in normalized and camel_key in normalized:
                normalized[snake_key] = normalized[camel_key]
        return normalized

    @property
    def resolved_model_name(self) -> str | None:
        return self.modelName or self.model

    @property
    def resolved_thinking_mode(self) -> str | None:
        return self.thinkingMode


class LongTaskRunResponse(BaseModel):
    task_id: str
    status: str
    message: str


class LongTaskCreateResponse(BaseModel):
    id: str
    status: str
    title: str | None
    original_question: str
    node_id: str | None
