from contextlib import asynccontextmanager
import logging

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings, get_settings
from .providers import ProviderError, create_provider
from .schemas import NextActionRequest, NextActionResponse
from .service import ReasoningService

logger = logging.getLogger("nudge.reasoning")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.reasoning_service = ReasoningService(create_provider(settings))
    yield


app = FastAPI(title="Nudge Reasoning API", version="0.3.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin for origin in get_settings().cors_origins if not origin.startswith("chrome-extension://")],
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=False,
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.get("/healthz")
async def health(settings: Settings = Depends(get_settings)) -> dict[str, str]:
    return {"status": "ok", "provider": settings.provider, "model": settings.model}


@app.post("/v1/next-action", response_model=NextActionResponse, response_model_exclude_none=True)
async def next_action(request: Request, payload: NextActionRequest) -> NextActionResponse:
    try:
        return await request.app.state.reasoning_service.next_action(payload)
    except ProviderError as error:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)) from error
    except ValueError as error:
        # Never log request bodies, sanitized context, prompts, or provider responses.
        logger.warning("Rejected a reasoning request: %s", error)
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error
