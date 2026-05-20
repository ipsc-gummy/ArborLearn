from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class LongTaskCreateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    node_id: str | None = Field(None, alias="nodeId")
    notebook_id: str | None = Field(None, alias="notebookId")
    question: str = Field(min_length=1)
    title: str | None = None
    auto_run: bool = Field(False, alias="autoRun")


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

