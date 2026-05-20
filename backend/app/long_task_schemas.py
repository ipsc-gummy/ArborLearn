from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class LongTaskCreateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    node_id: str | None = Field(None, alias="nodeId")
    notebook_id: str | None = Field(None, alias="notebookId")
    question: str = Field(min_length=1)
    title: str | None = None
    auto_run: bool = Field(False, alias="autoRun")
    model: Literal["deepseek-v4-flash", "deepseek-v4-pro"] | None = None
    modelName: Literal["deepseek-v4-flash", "deepseek-v4-pro"] | None = None
    thinkingMode: Literal["fast", "deep", "challenge"] | None = None

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
