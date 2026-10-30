"""Settings loader.

Order of precedence for every value:
  1. Real environment variables (what Hugging Face Space "Secrets" become)
  2. key/.env            (NAME=value lines)
  3. key/*.txt           (free-form "label : value" lines, e.g. key/All keys.txt)

Values are never logged; only which source each one came from.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger("shoppilot.config")

ROOT = Path(__file__).resolve().parents[2]
KEY_DIR = ROOT / "key"

KNOWN = [
    "GROQ_API_KEY",
    "GROQ_MODEL",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_DB_URL",
    "PAYPAL_CLIENT_ID",
    "PAYPAL_CLIENT_SECRET",
    "PAYPAL_ENV",
    "STEP_MIN_MS",
]

ENV_LINE = re.compile(r"^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$")


def _strip_quotes(v: str) -> str:
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
        return v[1:-1]
    return v


def _read_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        if line.strip().startswith("#"):
            continue
        m = ENV_LINE.match(line)
        if m and m.group(2):
            out[m.group(1)] = _strip_quotes(m.group(2))
    return out


def _guess_name(label: str, value: str) -> str | None:
    """Map a free-form label/value pair from a notes file to a setting name."""
    l = label.lower()
    v = value.strip()
    if v.startswith(("postgres://", "postgresql://")):
        return "SUPABASE_DB_URL"
    if v.startswith("gsk_") or "groq" in l:
        return "GROQ_API_KEY"
    if v.startswith("sb_publishable_"):
        return "SUPABASE_PUBLISHABLE_KEY"
    if v.startswith("sb_secret_") or "service" in l:
        return "SUPABASE_SECRET_KEY"
    if v.startswith("https://") and "supabase" in v:
        return "SUPABASE_URL"
    if "anon" in l and "supabase" in l or v.startswith("eyJ"):
        return "SUPABASE_ANON_KEY"
    if "paypal" in l or "pay pal" in l:
        if "secret" in l:
            return "PAYPAL_CLIENT_SECRET"
        return "PAYPAL_CLIENT_ID"
    if any(w in l for w in ("db url", "database", "connection", "pooler")):
        return "SUPABASE_DB_URL"
    if "client id" in l or l.strip() == "client":
        return "PAYPAL_CLIENT_ID"
    if "secret" in l:
        return "PAYPAL_CLIENT_SECRET"
    return None


def _read_notes_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    section = ""  # a heading line like "Paypal keys:" applies to the lines below it
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = ENV_LINE.match(line)
        if m and m.group(1) in KNOWN and m.group(2):
            out.setdefault(m.group(1), _strip_quotes(m.group(2)))
            continue
        # "label : value" (values like URLs contain ':' too, so split on the first one only)
        if ":" in line and not line.lower().startswith(("http", "postgres")):
            label, value = line.split(":", 1)
        else:
            label, value = "", line
        value = _strip_quotes(value)
        if not value:
            section = label.strip().lower()
            continue
        if " " in value:
            continue
        name = _guess_name(f"{section} {label}", value)
        if name:
            out.setdefault(name, value)
    return out


@dataclass(frozen=True)
class Settings:
    groq_api_key: str | None
    groq_model: str
    supabase_db_url: str | None
    supabase_url: str | None
    supabase_key: str | None  # best available API key: secret > publishable > anon
    supabase_key_kind: str | None
    paypal_client_id: str | None
    paypal_client_secret: str | None
    paypal_env: str
    step_min_ms: int
    catalog_path: Path
    frontend_dist: Path
    sources: dict[str, str] = field(default_factory=dict)

    @property
    def paypal_ready(self) -> bool:
        return bool(self.paypal_client_id and self.paypal_client_secret)


def load_settings() -> Settings:
    values: dict[str, str] = {}
    sources: dict[str, str] = {}

    files: list[tuple[str, dict[str, str]]] = []
    env_file = KEY_DIR / ".env"
    if env_file.exists():
        files.append(("key/.env", _read_env_file(env_file)))
    if KEY_DIR.exists():
        for txt in sorted(KEY_DIR.glob("*.txt")):
            files.append((f"key/{txt.name}", _read_notes_file(txt)))

    for name in KNOWN:
        if os.environ.get(name):
            values[name] = os.environ[name]
            sources[name] = "environment"
            continue
        for src, data in files:
            if data.get(name):
                values[name] = data[name]
                sources[name] = src
                break

    db_url = values.get("SUPABASE_DB_URL")
    if db_url and "[YOUR-PASSWORD]" in db_url:
        log.warning("SUPABASE_DB_URL still contains [YOUR-PASSWORD]; replace it with your database password.")
        db_url = None

    key_kind = next((k for k in ("SECRET", "PUBLISHABLE", "ANON") if values.get(f"SUPABASE_{k}_KEY")), None)
    settings = Settings(
        groq_api_key=values.get("GROQ_API_KEY"),
        groq_model=values.get("GROQ_MODEL", "openai/gpt-oss-120b"),
        supabase_db_url=db_url,
        supabase_url=values.get("SUPABASE_URL"),
        supabase_key=values.get(f"SUPABASE_{key_kind}_KEY") if key_kind else None,
        supabase_key_kind=key_kind.lower() if key_kind else None,
        paypal_client_id=values.get("PAYPAL_CLIENT_ID"),
        paypal_client_secret=values.get("PAYPAL_CLIENT_SECRET"),
        paypal_env=values.get("PAYPAL_ENV", "sandbox").lower(),
        step_min_ms=int(values.get("STEP_MIN_MS", "350")),
        catalog_path=ROOT / "data" / "catalog.seed.json",
        frontend_dist=ROOT / "frontend" / "dist",
        sources=sources,
    )
    found = ", ".join(f"{k} ({v})" for k, v in sorted(sources.items())) or "none"
    log.info("Settings loaded: %s", found)
    return settings
