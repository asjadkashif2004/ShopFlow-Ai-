"""Runs one shopping mission and streams every agent step as an event.

Event shapes match frontend/src/api/types.ts (MissionEvent).
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
from dataclasses import dataclass
from typing import Any, AsyncIterator

from .agents import Agents
from .config import Settings
from .db import Store
from .engine import (
    budget_detail,
    build_result,
    compare_detail,
    explain_facts,
    fmt_budget,
    intent_plan_text,
    split_budget,
    sql_preview,
)

log = logging.getLogger("shoppilot.missions")


@dataclass
class Context:
    settings: Settings
    store: Store
    agents: Agents
    paypal: Any


def _engine_name(engine: str) -> str:
    """'openai/gpt-oss-120b' -> 'gpt-oss-120b'"""
    return engine.split("/")[-1]


async def run_mission(query: str, ctx: Context) -> AsyncIterator[dict[str, Any]]:
    store, agents = ctx.store, ctx.agents  # read once, so a mid-mission switch to Supabase can't split a mission
    min_step = ctx.settings.step_min_ms / 1000
    started = time.perf_counter()
    mission_id = f"msn_{secrets.token_hex(6)}"
    steps: list[dict[str, Any]] = []
    timers: dict[str, float] = {}
    intent: dict[str, Any] | None = None
    intent_engine = explain_engine = None

    def begin(agent: str, message: str) -> dict[str, Any]:
        timers[agent] = time.perf_counter()
        return {"type": "agent_started", "agent": agent, "message": message}

    async def finish(
        agent: str, message: str, engine: str | None = None, detail: dict[str, str] | None = None
    ) -> dict[str, Any]:
        # Keep each step on screen long enough to follow, without hiding real latency.
        elapsed = time.perf_counter() - timers[agent]
        if elapsed < min_step:
            await asyncio.sleep(min_step - elapsed)
        duration = round((time.perf_counter() - timers[agent]) * 1000)
        steps.append({"agent": agent, "message": message, "durationMs": duration})
        event = {"type": "agent_completed", "agent": agent, "message": message, "durationMs": duration}
        if engine:
            event["engine"] = engine
        if detail:
            event["detail"] = detail
        return event

    try:
        total = await store.product_count()
        yield {"type": "mission_started", "missionId": mission_id, "query": query, "catalogSize": total}
        await store.mission_started(mission_id, query)

        # 1. Intent Agent
        yield begin("intent", "Reading your request…")
        intent, intent_engine = await agents.understand(query)
        yield {"type": "intent", "intent": intent}
        yield await finish(
            "intent",
            intent["summary"] if intent["category"] else "Couldn't tell which product type you want",
            _engine_name(intent_engine),
            {
                "label": "Validated intent from Groq" if intent_engine != "rules" else "Parsed with rules (Groq unavailable)",
                "language": "json",
                "content": intent_plan_text(intent),
            },
        )

        category = next((c for c in store.categories if c["slug"] == intent["category"]), None)
        if not category:
            result = build_result(mission_id, query, intent, None, store.categories, 0, [])
            yield {"type": "result", "result": result}
            yield {"type": "mission_completed", "durationMs": round((time.perf_counter() - started) * 1000)}
            await store.mission_finished(mission_id, status="done", intent=intent, result=result, steps=steps,
                                         intent_engine=intent_engine, explain_engine=None,
                                         duration_ms=round((time.perf_counter() - started) * 1000))
            return

        # 2. Search Agent: real SQL against Supabase
        source = "Supabase" if store.kind in ("postgres", "supabase") else "the catalog"
        yield begin("search", f"Querying {total} products in {source}…")
        yield {"type": "stats", "stats": {"analyzed": total}}
        in_category = await store.count_in_category(category["slug"])
        yield {"type": "stats", "stats": {"inCategory": in_category}}
        musts = [r for r in intent["requirements"] if r["kind"] == "must"]
        matched = await store.search(category["slug"], musts)
        yield {"type": "stats", "stats": {"matched": len(matched)}}
        name = category["name"].lower()
        yield await finish(
            "search",
            f"{in_category} {name} found · {len(matched)} have every must-have" if musts else f"{in_category} {name} found",
            {"postgres": "SQL", "supabase": "Supabase"}.get(store.kind, "memory"),
            {
                "label": {
                    "postgres": "Query run on Supabase Postgres",
                    "supabase": "Query run in Supabase (sent through its REST API)",
                }.get(store.kind, "Equivalent SQL (in-memory store until Supabase is set up)"),
                "language": "sql",
                "content": sql_preview(category["slug"], musts)
                + (f"\n\n-- sent as\n-- {store.search_preview(category['slug'], musts)}" if hasattr(store, "search_preview") else ""),
            },
        )

        # 3. Budget Agent
        mp = intent["maxPrice"]
        yield begin("budget", f"Checking prices against {fmt_budget(mp)}…" if mp is not None else "No budget given, keeping every match")
        within, over = split_budget(matched, intent)
        yield {"type": "stats", "stats": {"withinBudget": len(within)}}
        yield await finish(
            "budget",
            f"{len(within)} within budget · {len(over)} over" if mp is not None else f"{len(within)} options in range",
            detail={"label": "Price check", "language": "text", "content": budget_detail(within, over, mp)},
        )

        # 4. Comparison Agent: transparent scoring
        yield begin("compare", "Scoring value, rating, fit and specs…")
        result = build_result(mission_id, query, intent, category, store.categories, in_category, matched)
        top = result["recommendations"][0] if result["recommendations"] else None
        yield await finish(
            "compare",
            f"Ranked {len(within)} · top score {top['score']}/100" if top else "Nothing left to rank",
            detail={"label": "Scores (0–100)", "language": "text", "content": compare_detail(result)},
        )

        # 5. Explainer Agent
        yield begin("explain", "Writing the recommendation…")
        summary, explain_engine = await agents.explain(result)
        result["summary"] = summary
        yield {"type": "result", "result": result}
        yield await finish(
            "explain",
            f"Picked {top['product']['name']}" if top else "Suggested next steps",
            _engine_name(explain_engine) if top else None,
            {
                "label": "Facts the Explainer was allowed to use" if explain_engine != "template" else "Template write-up from these facts",
                "language": "json",
                "content": json.dumps(explain_facts(result), ensure_ascii=False, indent=2),
            }
            if top
            else None,
        )

        duration = round((time.perf_counter() - started) * 1000)
        yield {"type": "mission_completed", "durationMs": duration}
        await store.mission_finished(mission_id, status="done", intent=intent, result=result, steps=steps,
                                     intent_engine=intent_engine, explain_engine=explain_engine, duration_ms=duration)
    except asyncio.CancelledError:
        raise
    except Exception:
        log.exception("Mission %s failed", mission_id)
        yield {"type": "error", "message": "Something went wrong while researching. Please try again."}
        await store.mission_finished(mission_id, status="error", intent=intent, result=None, steps=steps,
                                     intent_engine=intent_engine, explain_engine=explain_engine,
                                     duration_ms=round((time.perf_counter() - started) * 1000))
