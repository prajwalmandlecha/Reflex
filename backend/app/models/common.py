"""Common Pydantic helpers."""

from pydantic import BaseModel


class SuccessResponse(BaseModel):
    status: str = "ok"
    message: str = ""


class PaginatedResponse(BaseModel):
    items: list
    total: int
    page: int = 1
    page_size: int = 50
