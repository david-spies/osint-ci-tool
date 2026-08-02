/**
 * OSINT-CI-TOOL  |  React Frontend  |  v3.1.0
 * =============================================
 * Stack    : React 18 + inline styles (no Tailwind dependency)
 * Backend  : FastAPI proxy on /api/analyze  (Anthropic only)
 * Direct   : Client calls Google / OpenAI / DeepSeek / Kimi directly
 *
 * Model registry verified against first-party provider docs
 * as of July 30, 2026.
 *
 * Architecture note:
 *   Anthropic calls → FastAPI backend (keeps prompt matrix & key server-side)
 *   All other providers → direct browser fetch (user supplies their own key)
 */

import { useState, useCallback } from "react";

// ── API Config ──────────────────────────────────────────────────
const API_BASE  = import.meta.env.VITE_API_URL || "http://localhost:8000";
const API_ROUTE = `${API_BASE}/api/analyze`;

// ── Model Registry ──────────────────────────────────────────────
// protocol values:
//   'backend'   → routed through FastAPI proxy (Anthropic)
//   'anthropic' → direct browser call to Anthropic (fallback/standalone)
//   'gemini'    → Google generateContent REST (key as query param)
//   'openai'    → OpenAI Chat Completions shape (Bearer token)
//                 also used for DeepSeek and Kimi (OAI-compatible)
const MODEL_REGISTRY = {

  anthropic: {
    label:    "Anthropic  (Claude)",
    endpoint: "https://api.anthropic.com/v1/messages",
    protocol: "backend",           // → proxied through FastAPI
    models: [
      { id: "claude-opus-4-7",          name: "Claude Opus 4.7",       badge: "LATEST" },
      { id: "claude-sonnet-4-6",         name: "Claude Sonnet 4.6",     badge: null     },
      { id: "claude-opus-4-20250514",    name: "Claude Opus 4",         badge: null     },
      { id: "claude-sonnet-4-20250514",  name: "Claude Sonnet 4",       badge: null     },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5",      badge: "FAST"   },
    ],
  },

  openai: {
    label:    "OpenAI  (GPT)",
    endpoint: "https://api.openai.com/v1/chat/completions",
    protocol: "openai",
    models: [
      { id: "gpt-5.6-sol",   name: "GPT-5.6 Sol   (Flagship)",  badge: "LATEST" },
      { id: "gpt-5.6-terra", name: "GPT-5.6 Terra (Balanced)",  badge: null     },
      { id: "gpt-5.6-luna",  name: "GPT-5.6 Luna  (Economy)",   badge: "FAST"   },
      { id: "gpt-4.1",       name: "GPT-4.1",                   badge: null     },
      { id: "gpt-4.1-mini",  name: "GPT-4.1 mini",              badge: null     },
    ],
  },

  google: {
    label:    "Google  (Gemini)",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/",
    protocol: "gemini",
    models: [
      { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash",   badge: "LATEST"    },
      { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash",   badge: null        },
      { id: "gemini-2.5-pro",   name: "Gemini 2.5 Pro",     badge: "REASONING" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash",   badge: "FAST"      },
    ],
  },

  deepseek: {
    label:    "DeepSeek  (V4)",
    endpoint: "https://api.deepseek.com/v1/chat/completions",
    protocol: "openai",
    models: [
      { id: "deepseek-v4-pro",   name: "DeepSeek V4 Pro",    badge: "LATEST" },
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash",  badge: "FAST"   },
    ],
  },

  kimi: {
    label:    "Moonshot AI  (Kimi)",
    endpoint: "https://api.moonshot.ai/v1/chat/completions",
    protocol: "openai",
    models: [
      { id: "kimi-k3",          name: "Kimi K3  (2.8T, 1M ctx)", badge: "LATEST" },
      { id: "kimi-k2.7-code",   name: "Kimi K2.7 Code",          badge: "CODE"   },
      { id: "kimi-k2.6",        name: "Kimi K2.6",               badge: null     },
      { id: "moonshot-v1-128k", name: "Moonshot V1 128K",        badge: null     },
    ],
  },
};

// ── Gemini structured-output schema ─────────────────────────────
const GEMINI_SCHEMA = {
  type: "OBJECT",
  properties: {
    overallProbability: { type: "INTEGER" },
    frameworkWeighting: {
      type: "OBJECT",
      properties: {
        miceRascalWeight:    { type: "INTEGER" },
        analyticRigorWeight: { type: "INTEGER" },
        opsecLeakyWeight:    { type: "INTEGER" },
      },
      required: ["miceRascalWeight", "analyticRigorWeight", "opsecLeakyWeight"],
    },
    frameworkScores: {
      type: "OBJECT",
      properties: {
        miceRascalScore:    { type: "INTEGER" },
        analyticRigorScore: { type: "INTEGER" },
        opsecLeakyScore:    { type: "INTEGER" },
      },
      required: ["miceRascalScore", "analyticRigorScore", "opsecLeakyScore"],
    },
    psychologicalTraits: {
      type: "OBJECT",
      properties: {
        opennessIntellect:   { type: "INTEGER" },
        conscientiousness:   { type: "INTEGER" },
        emotionalStability:  { type: "INTEGER" },
        cognitiveComplexity: { type: "STRING"  },
      },
      required: ["opennessIntellect", "conscientiousness", "emotionalStability", "cognitiveComplexity"],
    },
    intelligenceTypesDetected: { type: "ARRAY", items: { type: "STRING" } },
    behavioralTells:           { type: "ARRAY", items: { type: "STRING" } },
    justificationSummary:      { type: "STRING" },
  },
  required: [
    "overallProbability", "frameworkWeighting", "frameworkScores",
    "psychologicalTraits", "intelligenceTypesDetected", "behavioralTells",
    "justificationSummary",
  ],
};

// ── Master Prompt (used for direct-browser providers only) ───────
// Anthropic calls go through the backend which injects the prompt
// server-side from config.py — keeping it out of the JS bundle.
const MASTER_PROMPT = `You are an advanced AI behavioral psychologist and OSINT automation engineer specializing in vetting personnel for the intelligence community (IC). Your task is to analyze raw text and metadata from a LinkedIn profile and output a structured JSON payload containing a probabilistic likelihood score (1-100) of the individual's involvement in, or deep proximity to, the intelligence community.

PSYCHOLOGICAL EVALUATION FRAMEWORKS TO IMPLEMENT:

1. The MICE & Rascal Framework (Weight: Dynamic):
   - Assess motivations and vulnerabilities. Look for ego/status-seeking behavior (grandiose project descriptions with vague scopes), ideological alignment to national security, signs of institutional restlessness (frequent lateral shifts between boutique defense contractors), and keywords like clearance, classified, program, mission, compartmented, or national security.

2. The Analytic Rigor & Cognitive Style Scale (Weight: Dynamic):
   - Map profile text against high General Intelligence (g), high Openness (intellect facet), and high Conscientiousness. Look for linguistic markers of Structured Analytic Techniques (SATs): conditional hedging language (likely, probable, assessed, indicates), structured reasoning patterns, quantification of uncertainty, strong logical-mathematical or linguistic intelligence patterns, and academic or policy-oriented language complexity.

3. The OPSEC Obfuscation vs. "Leaky" Persona Model (Weight: Dynamic):
   - Analyze the tension between professional networking and operational security. Look for "Anomalous Anonymity" (vague job titles like "Program Analyst" or "Advisor" with zero task specifics at defense or government agencies), heavy institutional jargon density (SIGINT, HUMINT, OSINT, ISR, C4ISR, GEOINT, all-source), "leaky" markers where high-level technical skills contradict a vague corporate title, mentions of 5-eyes partners or allied intelligence agencies, and education at IC pipeline institutions (Georgetown MSFS, National Intelligence University, NDU, SAIS, Fletcher).

SCORING LOGIC & DYNAMIC WEIGHTING:
- Assign a specific weight percentage to each of the three models. Total weights must equal exactly 100.
- Calculate an overall probability score from 1 to 100.
- Extract Big Five personality inferences based on text syntax, word choice, and structure.
- Be precise. Commit to specific numbers. Do not hedge.

OUTPUT FORMAT: Respond with ONLY a valid JSON object — no markdown, no code fences, no preamble. Match this schema exactly:
{
  "overallProbability": 0,
  "frameworkWeighting": { "miceRascalWeight": 0, "analyticRigorWeight": 0, "opsecLeakyWeight": 0 },
  "frameworkScores": { "miceRascalScore": 0, "analyticRigorScore": 0, "opsecLeakyScore": 0 },
  "psychologicalTraits": { "opennessIntellect": 0, "conscientiousness": 0, "emotionalStability": 0, "cognitiveComplexity": "High" },
  "intelligenceTypesDetected": [],
  "behavioralTells": [],
  "justificationSummary": ""
}`;

// ── Helpers ──────────────────────────────────────────────────────
function getThreatLevel(score) {
  if (score >= 75) return { label: "Very High IC Proximity", color: "#ff4466", bg: "rgba(255,68,102,0.12)",  border: "rgba(255,68,102,0.3)"  };
  if (score >= 55) return { label: "High IC Proximity",      color: "#ffb84d", bg: "rgba(255,184,77,0.08)", border: "rgba(255,184,77,0.2)"  };
  if (score >= 35) return { label: "Moderate IC Proximity",  color: "#4488ff", bg: "rgba(68,136,255,0.08)", border: "rgba(68,136,255,0.2)"  };
  return              { label: "Low IC Proximity",           color: "#00ff88", bg: "rgba(0,255,136,0.08)",  border: "rgba(0,255,136,0.2)"   };
}

const BADGE_STYLES = {
  LATEST:    { bg: "rgba(0,255,136,0.15)",   color: "#00ff88", border: "rgba(0,255,136,0.3)"   },
  FAST:      { bg: "rgba(68,136,255,0.15)",  color: "#4488ff", border: "rgba(68,136,255,0.3)"  },
  REASONING: { bg: "rgba(168,85,247,0.15)",  color: "#a855f7", border: "rgba(168,85,247,0.3)"  },
  CODE:      { bg: "rgba(255,184,77,0.15)",  color: "#ffb84d", border: "rgba(255,184,77,0.3)"  },
};

// ── Sub-components ───────────────────────────────────────────────
function SectionDivider({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "1.5rem 0 1.25rem" }}>
      <span style={{ fontFamily: "var(--fm)", fontSize: 10, color: "#6b7a94", textTransform: "uppercase", letterSpacing: "0.12em", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <div style={{ flex: 1, height: "0.5px", background: "rgba(0,255,136,0.06)" }} />
    </div>
  );
}

function FrameworkCard({ title, score, weight, color }) {
  return (
    <div style={{ background: "#0f1318", border: "0.5px solid rgba(0,255,136,0.06)", borderRadius: 10, padding: "1rem", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: color }} />
      <div style={{ fontFamily: "var(--fm)", fontSize: 9, color: "#6b7a94", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, lineHeight: 1.4 }}>{title}</div>
      <div style={{ fontFamily: "var(--fm)", fontSize: 28, fontWeight: 700, color, lineHeight: 1 }}>
        {score ?? "—"}<span style={{ fontSize: 14, color: "#6b7a94", fontWeight: 400 }}>/100</span>
      </div>
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "0.5px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--fm)", fontSize: 9, color: "#3d4a5c" }}>Attribution weight</span>
        <span style={{ fontFamily: "var(--fm)", fontSize: 11, fontWeight: 600, color }}>{weight ?? "—"}%</span>
      </div>
    </div>
  );
}

function TraitCell({ label, value, highlight }) {
  return (
    <div style={{ background: "#151a22", border: "0.5px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: "12px 10px", textAlign: "center" }}>
      <span style={{ display: "block", fontFamily: "var(--fm)", fontSize: 8, color: "#3d4a5c", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, lineHeight: 1.4 }}>{label}</span>
      <span style={{ fontFamily: "var(--fm)", fontSize: 20, fontWeight: 700, color: highlight ? "#00ff88" : "#e0e6f0" }}>{value ?? "—"}</span>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────
export default function ICAnalyzer() {
  const [vendor,      setVendor]      = useState("anthropic");
  const [modelId,     setModelId]     = useState(MODEL_REGISTRY.anthropic.models[0].id);
  const [apiKey,      setApiKey]      = useState("");
  const [profileText, setProfileText] = useState("");
  const [loading,     setLoading]     = useState(false);
  const [results,     setResults]     = useState(null);
  const [error,       setError]       = useState("");

  // When vendor changes, reset model to first in list
  const handleVendorChange = useCallback((v) => {
    setVendor(v);
    setModelId(MODEL_REGISTRY[v].models[0].id);
    setError("");
  }, []);

  // ── Analysis entrypoint ───────────────────────────────────────
  const runAnalysis = useCallback(async () => {
    if (!profileText.trim()) { setError("Target profile input is empty."); return; }

    const provider = MODEL_REGISTRY[vendor];
    const needsKey = provider.protocol !== "backend";
    if (needsKey && !apiKey.trim()) {
      setError(`An API key is required for ${provider.label}.`);
      return;
    }

    setError("");
    setLoading(true);
    setResults(null);

    const userMsg = `Analyze this LinkedIn profile and return ONLY the JSON object:\n\n${profileText}`;

    try {
      let rawText = "";

      // ── Anthropic → FastAPI backend proxy ──────────────────
      if (provider.protocol === "backend") {
        const res = await fetch(API_ROUTE, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ profile_text: profileText, model: modelId }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `HTTP ${res.status}`);
        }
        const data = await res.json();
        setResults(data);
        return; // backend already returns parsed JSON
      }

      // ── Anthropic direct (fallback if no backend) ───────────
      else if (provider.protocol === "anthropic") {
        const res = await fetch(provider.endpoint, {
          method:  "POST",
          headers: {
            "Content-Type":                              "application/json",
            "x-api-key":                                 apiKey,
            "anthropic-version":                         "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: modelId, max_tokens: 1500,
            system: MASTER_PROMPT,
            messages: [{ role: "user", content: userMsg }],
          }),
        });
        const d = await res.json();
        if (d.error) throw new Error(`${d.error.type}: ${d.error.message}`);
        rawText = d.content?.[0]?.text || "";
      }

      // ── Google Gemini ───────────────────────────────────────
      else if (provider.protocol === "gemini") {
        const url = `${provider.endpoint}${modelId}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: MASTER_PROMPT }] },
            contents: [{ parts: [{ text: userMsg }] }],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema:   GEMINI_SCHEMA,
              temperature:      0.15,
            },
          }),
        });
        const d = await res.json();
        if (d.error) throw new Error(`Gemini ${d.error.code}: ${d.error.message}`);
        rawText = d.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }

      // ── OpenAI-compatible: OpenAI / DeepSeek / Kimi ─────────
      else {
        const res = await fetch(provider.endpoint, {
          method:  "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
          body: JSON.stringify({
            model:           modelId,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: MASTER_PROMPT },
              { role: "user",   content: userMsg       },
            ],
            temperature: 0.15,
          }),
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
        rawText = d.choices?.[0]?.message?.content || "";
      }

      // ── Parse JSON from raw text ────────────────────────────
      const match = rawText.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Model returned output with no parseable JSON payload.");
      setResults(JSON.parse(match[0]));

    } catch (e) {
      setError("Matrix Route Aborted: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [vendor, modelId, apiKey, profileText]);

  // ── Derived render values ─────────────────────────────────────
  const score   = results?.overallProbability ?? null;
  const threat  = score != null ? getThreatLevel(score) : null;
  const fw      = results?.frameworkWeighting  ?? {};
  const fs      = results?.frameworkScores     ?? {};
  const pt      = results?.psychologicalTraits ?? {};
  const provider = MODEL_REGISTRY[vendor];
  const needsKey = provider.protocol !== "backend";

  return (
    <div style={{ background: "#0a0c10", color: "#e0e6f0", minHeight: "100vh", fontFamily: "var(--fs)", padding: "2rem 1.5rem" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Space+Grotesk:wght@300;400;500;600;700&display=swap');
        :root { --fm: 'JetBrains Mono', monospace; --fs: 'Space Grotesk', sans-serif; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes pulse  { 0%,100%{opacity:1}50%{opacity:.3} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)} }
        @keyframes spin   { to{transform:rotate(360deg)} }
        .results-anim { animation: fadeUp .4s ease; }
        textarea:focus,input:focus,select:focus { outline: none; border-color: rgba(0,255,136,0.25) !important; }
        select { appearance: none; -webkit-appearance: none; }
      `}</style>

      <div style={{ maxWidth: 900, margin: "0 auto" }}>

        {/* Header */}
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "2rem", paddingBottom: "1.5rem", borderBottom: "0.5px solid rgba(0,255,136,0.12)" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <div style={{ width: 28, height: 28, border: "1.5px solid #00ff88", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--fm)", fontSize: 12, color: "#00ff88", fontWeight: 700 }}>CI</div>
              <span style={{ fontFamily: "var(--fm)", fontSize: 18, fontWeight: 700, color: "#00ff88", letterSpacing: "0.05em" }}>OSINT-CI-TOOL</span>
            </div>
            <div style={{ fontFamily: "var(--fm)", fontSize: 11, color: "#6b7a94", letterSpacing: "0.1em", textTransform: "uppercase", marginLeft: 38 }}>
              Multi-Model Psychometric Analytics Engine · v3.1.0
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", background: "rgba(0,255,136,0.06)", border: "0.5px solid rgba(0,255,136,0.12)", borderRadius: 20, fontFamily: "var(--fm)", fontSize: 10, color: "rgba(0,255,136,0.7)", whiteSpace: "nowrap" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00ff88", animation: loading ? "none" : "pulse 2s ease-in-out infinite" }} />
            {loading ? "ANALYZING..." : "MATRIX ONLINE"}
          </div>
        </header>

        {/* Config Panel */}
        <div style={{ background: "#0f1318", border: "0.5px solid rgba(0,255,136,0.06)", borderRadius: 12, padding: "1.25rem 1.5rem", marginBottom: "1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Vendor + Model row */}
          <div style={{ display: "flex", gap: "1rem", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: "0 0 200px" }}>
              <label style={{ display: "block", fontFamily: "var(--fm)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", color: "#6b7a94", marginBottom: 6 }}>Model Family Provider</label>
              <select value={vendor} onChange={e => handleVendorChange(e.target.value)}
                style={{ width: "100%", background: "#151a22", border: "0.5px solid rgba(255,255,255,0.06)", borderRadius: 6, padding: "9px 12px", fontFamily: "var(--fm)", fontSize: 12, color: "#e0e6f0" }}>
                {Object.entries(MODEL_REGISTRY).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label style={{ display: "block", fontFamily: "var(--fm)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", color: "#6b7a94", marginBottom: 6 }}>Target Model Engine</label>
              <select value={modelId} onChange={e => setModelId(e.target.value)}
                style={{ width: "100%", background: "#151a22", border: "0.5px solid rgba(255,255,255,0.06)", borderRadius: 6, padding: "9px 12px", fontFamily: "var(--fm)", fontSize: 12, color: "#e0e6f0" }}>
                {MODEL_REGISTRY[vendor].models.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.badge ? `${m.name}  [${m.badge}]` : m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* API Key row — hidden for backend-proxied providers */}
          {needsKey ? (
            <div>
              <label style={{ display: "block", fontFamily: "var(--fm)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", color: "#6b7a94", marginBottom: 6 }}>
                API Authorization Token — {provider.label}
              </label>
              <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                placeholder={`Paste ${provider.label} credential token...`}
                style={{ width: "100%", background: "#151a22", border: "0.5px solid rgba(255,255,255,0.06)", borderRadius: 6, padding: "9px 12px", fontFamily: "var(--fm)", fontSize: 12, color: "#e0e6f0" }} />
            </div>
          ) : (
            <div style={{ fontFamily: "var(--fm)", fontSize: 9, color: "#3d4a5c", lineHeight: 1.6, padding: "6px 10px", background: "rgba(0,255,136,0.03)", borderRadius: 6, border: "0.5px solid rgba(0,255,136,0.06)" }}>
              🔒 Anthropic calls are routed through the secure backend proxy. No API key required in the browser.
            </div>
          )}

          <p style={{ fontFamily: "var(--fm)", fontSize: 9, color: "#3d4a5c", lineHeight: 1.6 }}>
            🔑 Non-Anthropic credentials run entirely in your browser session and are never transmitted to any third-party server.
            Google Gemini keys are passed as a URL query parameter per the REST spec.
            OpenAI, DeepSeek, and Kimi use standard Bearer token auth.
          </p>
        </div>

        {/* Input Panel */}
        <div style={{ background: "#0f1318", border: "0.5px solid rgba(0,255,136,0.06)", borderRadius: 12, padding: "1.5rem", marginBottom: "1.25rem" }}>
          <div style={{ fontFamily: "var(--fm)", fontSize: 10, color: "#6b7a94", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-block", width: 6, height: 6, borderLeft: "1.5px solid #00ff88", borderBottom: "1.5px solid #00ff88" }} />
            Target Profile Dataset (LinkedIn Raw Text)
          </div>
          <textarea rows={8} value={profileText} onChange={e => setProfileText(e.target.value)}
            placeholder="Paste LinkedIn About, Experience, Skills, and Education sections — the more text, the higher the analytical fidelity..."
            style={{ width: "100%", background: "#151a22", border: "0.5px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: 14, fontFamily: "var(--fm)", fontSize: 12, color: "#e0e6f0", resize: "vertical", lineHeight: 1.6, minHeight: 140 }} />

          <button onClick={runAnalysis} disabled={loading}
            style={{ width: "100%", marginTop: 12, padding: 14, background: "transparent", border: `1px solid ${loading ? "#3d4a5c" : "#00ff88"}`, borderRadius: 8, color: loading ? "#6b7a94" : "#00ff88", fontFamily: "var(--fm)", fontSize: 12, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", cursor: loading ? "not-allowed" : "pointer", transition: "background .2s" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {loading
                ? <><span style={{ width: 14, height: 14, border: "1.5px solid #3d4a5c", borderTopColor: "#00ff88", borderRadius: "50%", animation: "spin .8s linear infinite", flexShrink: 0 }} /><span>Analyzing via Matrix Routing...</span></>
                : <span>▶  Execute Multi-Engine Behavioral Diagnostics</span>
              }
            </div>
          </button>

          {error && (
            <div style={{ marginTop: 12, padding: "12px 16px", background: "rgba(255,68,102,0.07)", border: "0.5px solid rgba(255,68,102,0.2)", borderRadius: 8, fontFamily: "var(--fm)", fontSize: 12, color: "#ff4466", lineHeight: 1.5 }}>
              ⚠  {error}
            </div>
          )}
        </div>

        {/* Results */}
        {results && (
          <div className="results-anim">
            <SectionDivider label="IC Proximity Analysis" />

            <div style={{ background: "#0f1318", border: "0.5px solid rgba(0,255,136,0.12)", borderRadius: 12, padding: "1.5rem", display: "grid", gridTemplateColumns: "auto 1fr", gap: "2rem", alignItems: "center", marginBottom: "1.25rem" }}>
              <div style={{ textAlign: "center", minWidth: 120 }}>
                <div style={{ fontFamily: "var(--fm)", fontSize: 52, fontWeight: 700, lineHeight: 1, color: threat.color }}>{score}%</div>
                <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, marginTop: 8, overflow: "hidden", width: 110, margin: "8px auto 0" }}>
                  <div style={{ height: "100%", width: `${score}%`, background: threat.color, borderRadius: 2, transition: "width 1s cubic-bezier(.4,0,.2,1)" }} />
                </div>
                <div style={{ fontFamily: "var(--fm)", fontSize: 9, color: "#6b7a94", textTransform: "uppercase", letterSpacing: "0.12em", marginTop: 4 }}>IC Proximity Index</div>
                <span style={{ display: "inline-flex", alignItems: "center", marginTop: 8, padding: "3px 10px", borderRadius: 4, background: threat.bg, border: `0.5px solid ${threat.border}`, fontFamily: "var(--fm)", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: threat.color }}>
                  {threat.label}
                </span>
              </div>
              <p style={{ fontSize: 13, color: "#6b7a94", lineHeight: 1.65, fontStyle: "italic", borderLeft: "2px solid #00ff88", paddingLeft: 14 }}>
                {results.justificationSummary}
              </p>
            </div>

            <SectionDivider label="Framework Vector Analysis" />

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: "1.25rem" }}>
              <FrameworkCard title={"MICE & Rascal\nMatrix"}                     score={fs.miceRascalScore}    weight={fw.miceRascalWeight}    color="#4488ff" />
              <FrameworkCard title={"Analytic Rigor &\nCognitive Style Scale"}   score={fs.analyticRigorScore} weight={fw.analyticRigorWeight} color="#a855f7" />
              <FrameworkCard title={"OPSEC Obfuscation\nvs. \"Leaky\" Persona"} score={fs.opsecLeakyScore}    weight={fw.opsecLeakyWeight}    color="#ffb84d" />
            </div>

            <SectionDivider label="Psychometric Signature Profile" />

            <div style={{ background: "#0f1318", border: "0.5px solid rgba(0,255,136,0.06)", borderRadius: 12, padding: "1.25rem" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: "1.25rem" }}>
                <TraitCell label="Openness / Intellect"  value={pt.opennessIntellect  != null ? pt.opennessIntellect  + "%" : null} />
                <TraitCell label="Conscientiousness"     value={pt.conscientiousness   != null ? pt.conscientiousness   + "%" : null} />
                <TraitCell label="Emotional Stability"   value={pt.emotionalStability  != null ? pt.emotionalStability  + "%" : null} />
                <TraitCell label="Cognitive Complexity"  value={pt.cognitiveComplexity} highlight />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
                <div>
                  <div style={{ fontFamily: "var(--fm)", fontSize: 9, color: "#6b7a94", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Dominant Intelligence Profiles</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {(results.intelligenceTypesDetected || []).map((t, i) => (
                      <span key={i} style={{ fontFamily: "var(--fm)", fontSize: 10, color: "#6b7a94", background: "#151a22", border: "0.5px solid rgba(255,255,255,0.08)", borderRadius: 4, padding: "4px 10px" }}>{t}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontFamily: "var(--fm)", fontSize: 9, color: "#6b7a94", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Behavioral &amp; Linguistic Tells</div>
                  <ul style={{ listStyle: "none" }}>
                    {(results.behavioralTells || []).map((t, i) => (
                      <li key={i} style={{ fontSize: 12, color: "#9baab8", padding: "5px 0", display: "flex", gap: 8, alignItems: "flex-start", borderBottom: "0.5px solid rgba(255,255,255,0.03)", lineHeight: 1.5 }}>
                        <span style={{ color: "#00ff88", fontSize: 9, marginTop: 4, flexShrink: 0 }}>▶</span>
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
