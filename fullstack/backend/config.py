"""
OSINT-CI-TOOL  |  Backend Configuration  |  v3.1.0
===================================================
Centralizes all environment variables, model allowlists,
CORS settings, and the Master Prompt Matrix so main.py
stays clean and this file serves as the single source
of truth for all tunable parameters.

Model registry verified against first-party provider docs
as of July 30, 2026.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# ── Server ─────────────────────────────────────────────────────
APP_TITLE       = "OSINT-CI-TOOL Proxy Server"
APP_DESCRIPTION = "Stateless Anthropic API proxy for IC Profile Psychometric Scoring"
APP_VERSION     = "3.1.0"
HOST            = os.environ.get("HOST", "0.0.0.0")
PORT            = int(os.environ.get("PORT", 8000))

# ── CORS ───────────────────────────────────────────────────────
# Production: set ALLOWED_ORIGINS to your exact frontend domain(s)
# e.g. "https://app.yourdomain.com,https://yourdomain.com"
ALLOWED_ORIGINS: list[str] = os.environ.get(
    "ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000"
).split(",")

# ── Anthropic API ──────────────────────────────────────────────
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"

# ── Defaults & Limits ──────────────────────────────────────────
DEFAULT_MODEL     = os.environ.get("DEFAULT_MODEL", "claude-opus-4-7")
MAX_PROFILE_CHARS = int(os.environ.get("MAX_PROFILE_CHARS", 12000))
LLM_MAX_TOKENS    = 1500
LLM_TEMPERATURE   = 0.15

# ── Model Allowlist ────────────────────────────────────────────
# Verified model IDs as of July 30, 2026.
# Backend only proxies Anthropic — other providers are called
# directly from the client. Update this set when new Claude
# model IDs are released.
#
# Naming conventions:
#   claude-opus-4-7          → dateless snapshot (new format, Claude 4.6+)
#   claude-sonnet-4-6        → dateless snapshot
#   claude-opus-4-20250514   → dated snapshot (legacy format)
#   claude-sonnet-4-20250514 → dated snapshot
#   claude-haiku-4-5-20251001→ dated snapshot

ALLOWED_MODELS: set[str] = {
    "claude-opus-4-7",            # Opus 4.7  — latest flagship      [LATEST]
    "claude-sonnet-4-6",          # Sonnet 4.6 — balanced             [NEW]
    "claude-opus-4-20250514",     # Opus 4    — previous flagship
    "claude-sonnet-4-20250514",   # Sonnet 4  — previous balanced
    "claude-haiku-4-5-20251001",  # Haiku 4.5 — fast / low-cost      [FAST]
}

# ── Master Prompt Matrix ───────────────────────────────────────
# Kept server-side to protect proprietary scoring logic from
# exposure via browser DevTools / client-side JS inspection.
MASTER_PROMPT_MATRIX = """You are an advanced AI behavioral psychologist and OSINT automation engineer specializing in vetting personnel for the intelligence community (IC). Your task is to analyze raw text and metadata from a LinkedIn profile and output a structured JSON payload containing a probabilistic likelihood score (1-100) of the individual's involvement in, or deep proximity to, the intelligence community.

PSYCHOLOGICAL EVALUATION FRAMEWORKS TO IMPLEMENT:

1. The MICE & Rascal Framework (Weight: Dynamic):
   - Assess motivations and vulnerabilities. Look for ego/status-seeking behavior (grandiose project descriptions with vague scopes), ideological alignment to national security, signs of institutional restlessness (frequent lateral shifts between boutique defense contractors), and keywords like clearance, classified, program, mission, compartmented, or national security.

2. The Analytic Rigor & Cognitive Style Scale (Weight: Dynamic):
   - Map profile text against high General Intelligence (g), high Openness (intellect facet), and high Conscientiousness. Look for linguistic markers of Structured Analytic Techniques (SATs): conditional hedging language (likely, probable, assessed, indicates), structured reasoning patterns, quantification of uncertainty, strong logical-mathematical or linguistic intelligence patterns, and academic or policy-oriented language complexity.

3. The OPSEC Obfuscation vs. "Leaky" Persona Model (Weight: Dynamic):
   - Analyze the tension between professional networking and operational security. Look for "Anomalous Anonymity" (vague job titles like "Program Analyst" or "Advisor" with zero task specifics at defense or government agencies), heavy institutional jargon density (SIGINT, HUMINT, OSINT, ISR, C4ISR, GEOINT, all-source), "leaky" markers where high-level technical skills contradict a vague corporate title, mentions of 5-eyes partners or allied intelligence agencies, and education at IC pipeline institutions (Georgetown MSFS, National Intelligence University, NDU, SAIS, Fletcher).

SCORING LOGIC & DYNAMIC WEIGHTING:
- Assign a specific weight percentage to each of the three models based on what signals are most evident in the profile. Total weights must equal exactly 100.
- Calculate an overall probability score from 1 to 100.
- Extract Big Five personality inferences based on text syntax, word choice, and structure.
- Be precise and analytical. Commit to specific numbers. Do not hedge.

OUTPUT FORMAT: Respond with ONLY a valid JSON object — no markdown, no code fences, no preamble. Match this schema exactly:
{
  "overallProbability": 0,
  "frameworkWeighting": {
    "miceRascalWeight": 0,
    "analyticRigorWeight": 0,
    "opsecLeakyWeight": 0
  },
  "frameworkScores": {
    "miceRascalScore": 0,
    "analyticRigorScore": 0,
    "opsecLeakyScore": 0
  },
  "psychologicalTraits": {
    "opennessIntellect": 0,
    "conscientiousness": 0,
    "emotionalStability": 0,
    "cognitiveComplexity": "High"
  },
  "intelligenceTypesDetected": [],
  "behavioralTells": [],
  "justificationSummary": ""
}"""
