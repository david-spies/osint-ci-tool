"""
OSINT-CI-TOOL  |  Backend Proxy Server  |  v3.1.0
==================================================
Framework  : FastAPI (async Python)
Purpose    : Stateless pass-through proxy that injects the Master Prompt
             Matrix server-side and forwards requests to the Anthropic
             Messages API. Profile data is NEVER persisted to disk or DB.

All tunables (model allowlist, CORS origins, prompt matrix, API keys)
live in config.py — edit there, not here.

Run locally:
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000

Docker:
    docker build -t osint-ci-backend .
    docker run -e ANTHROPIC_API_KEY=sk-ant-... -p 8000:8000 osint-ci-backend

Deploy (Railway / Render / Fly.io):
    Set ANTHROPIC_API_KEY + ALLOWED_ORIGINS env vars, then:
    uvicorn main:app --host 0.0.0.0 --port $PORT
"""

import re
import json
import logging

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, field_validator
from typing import Optional

import config

# ── Logging ────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
log = logging.getLogger("osint-ci")

# ── App ────────────────────────────────────────────────────────
app = FastAPI(
    title=config.APP_TITLE,
    description=config.APP_DESCRIPTION,
    version=config.APP_VERSION,
    docs_url="/docs",
    redoc_url=None,
)

# ── CORS ───────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# ── Schemas ────────────────────────────────────────────────────
class AnalyzeRequest(BaseModel):
    profile_text: str
    model: Optional[str] = None

    @field_validator("profile_text")
    @classmethod
    def text_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("profile_text cannot be empty.")
        return v


class HealthResponse(BaseModel):
    status: str
    version: str
    default_model: str
    allowed_models: list[str]


# ── Routes ─────────────────────────────────────────────────────
@app.get("/health", response_model=HealthResponse, tags=["System"])
async def health_check():
    """Liveness probe — returns version and active model allowlist."""
    return {
        "status":         "operational",
        "version":        config.APP_VERSION,
        "default_model":  config.DEFAULT_MODEL,
        "allowed_models": sorted(config.ALLOWED_MODELS),
    }


@app.post("/api/analyze", tags=["Analysis"])
async def analyze_profile(payload: AnalyzeRequest):
    """
    Accepts raw LinkedIn profile text, injects the Master Prompt Matrix,
    calls the Anthropic Messages API, and returns a structured JSON
    psychometric payload. Profile data is never written to disk.
    """
    # ── Guard: API key configured ──────────────────────────────
    if not config.ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Server misconfiguration: ANTHROPIC_API_KEY env var not set.",
        )

    # ── Model resolution & validation ─────────────────────────
    model = (payload.model or config.DEFAULT_MODEL).strip()
    if model not in config.ALLOWED_MODELS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported model '{model}'. "
                f"Allowed: {sorted(config.ALLOWED_MODELS)}"
            ),
        )

    # ── Truncate oversized inputs ──────────────────────────────
    profile_text = payload.profile_text[: config.MAX_PROFILE_CHARS]

    log.info(
        "Analysis request | model=%s | input_chars=%d",
        model,
        len(profile_text),
    )

    # ── Build Anthropic request body ───────────────────────────
    request_body = {
        "model":      model,
        "max_tokens": config.LLM_MAX_TOKENS,
        "system":     config.MASTER_PROMPT_MATRIX,
        "messages": [
            {
                "role":    "user",
                "content": (
                    "Analyze this LinkedIn profile and return ONLY "
                    f"the JSON object:\n\n{profile_text}"
                ),
            }
        ],
    }

    # ── Call Anthropic ─────────────────────────────────────────
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(
                config.ANTHROPIC_API_URL,
                headers={
                    "x-api-key":         config.ANTHROPIC_API_KEY,
                    "anthropic-version": config.ANTHROPIC_VERSION,
                    "Content-Type":      "application/json",
                },
                json=request_body,
            )

        if response.status_code != 200:
            log.error("Anthropic API error %d: %s", response.status_code, response.text)
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Upstream LLM error: {response.text}",
            )

        data     = response.json()
        raw_text = data.get("content", [{}])[0].get("text", "")

        # ── Extract JSON from model output ─────────────────────
        match = re.search(r"\{[\s\S]*\}", raw_text)
        if not match:
            log.error("No JSON object found in model output: %s", raw_text[:200])
            raise HTTPException(
                status_code=502,
                detail="Model returned output with no parseable JSON payload.",
            )

        metrics = json.loads(match.group(0))
        log.info(
            "Analysis complete | overallProbability=%s",
            metrics.get("overallProbability"),
        )

        # Return the raw JSON string with correct content-type
        # (avoids double-serialization by Pydantic/FastAPI)
        return Response(
            content=json.dumps(metrics),
            media_type="application/json",
        )

    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="LLM request timed out. Try again.")
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"JSON parse error: {e}")
    except HTTPException:
        raise
    except Exception as e:
        log.exception("Unexpected server error")
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")


# ── Dev entrypoint ─────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=config.HOST,
        port=config.PORT,
        reload=True,
    )
