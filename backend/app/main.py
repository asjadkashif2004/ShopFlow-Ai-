"""ShopPilot API.

Run locally:   backend/.venv/Scripts/python -m uvicorn app.main:app --app-dir backend --port 7860
The React app proxies /api to this server in development, and this server also serves
the built React app (frontend/dist) so one container is enough on Hugging Face.
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .agents import Agents
from .config import load_settings
from .db import MemoryStore, PostgresStore, Store, SupabaseRestStore, SupabaseSetupNeeded, load_catalog
from .engine import CatalogIndex
from .missions import Context, run_mission
from .paypal import PayPalError, PayPalService

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("shoppilot")

settings = load_settings()

SETUP_NOTE = (
    "Supabase is connected but the ShopPilot tables are missing. "
    "Run supabase/shoppilot_setup.sql in the Supabase SQL Editor, then refresh the page."
)
PAUSED_NOTE = (
    "Supabase can't be reached: the project's address doesn't exist right now, which usually means "
    "the free project is paused. Click Restore project in the Supabase dashboard; ShopPilot reconnects by itself."
)
RETRY_SECONDS = 10


@asynccontextmanager
async def lifespan(app: FastAPI):
    catalog = load_catalog(settings.catalog_path)
    store: Store = MemoryStore(catalog)
    note: str | None = None
    if settings.supabase_db_url:
        pg = PostgresStore(settings.supabase_db_url, catalog)
        try:
            await pg.init()
            store = pg
        except Exception as e:
            note = f"Could not connect to the Supabase database ({type(e).__name__}). Check SUPABASE_DB_URL."
            log.error(note)
    if store.kind == "memory" and settings.supabase_url and settings.supabase_key:
        # REST API: used when there is no DB URL, or when the DB URL didn't connect.
        rest = SupabaseRestStore(settings.supabase_url, settings.supabase_key, catalog)
        try:
            await rest.init()
            store = rest
            if note:
                log.info("Using the Supabase REST API instead of the database URL.")
                note = None
        except SupabaseSetupNeeded:
            note = SETUP_NOTE
            log.error(note)
            await rest.close()
        except Exception as e:
            note = supabase_error_note(e)
            log.error(note)
            await rest.close()
    elif store.kind == "memory" and not note:
        note = "No Supabase settings found, so data is kept in memory and resets on restart."
        log.warning(note)
    if store.kind == "memory":
        log.warning("Using the in-memory store for now.")

    index = CatalogIndex(store.categories, await store.all_products())
    app.state.ctx = Context(settings=settings, store=store, agents=Agents(settings, index), paypal=PayPalService(settings))
    app.state.db_note = note
    app.state.catalog = catalog
    # While on the in-memory store, keep trying Supabase (tables not created yet, or the
    # free project is paused) so fixing it on the Supabase side needs no restart.
    app.state.retry_supabase = store.kind == "memory" and bool(settings.supabase_url and settings.supabase_key)
    app.state.last_retry = time.monotonic()
    app.state.retry_lock = asyncio.Lock()
    app.state.previous_store = None
    log.info("ShopPilot ready · database=%s · ai=%s · payments=%s", store.kind, app.state.ctx.agents.label, app.state.ctx.paypal.mode)
    yield
    await store.close()


app = FastAPI(title="ShopPilot API", version="0.1.0", lifespan=lifespan)


def ctx() -> Context:
    return app.state.ctx


def supabase_error_note(e: Exception) -> str:
    if "getaddrinfo" in str(e) or "Name or service not known" in str(e):
        return PAUSED_NOTE
    status = getattr(e, "status", None)
    if isinstance(status, int) and status >= 500:
        return (
            f"Supabase is starting up or temporarily down (HTTP {status}). A restored project takes a few "
            "minutes to boot; ShopPilot reconnects by itself."
        )
    if isinstance(status, int) and status in (401, 403):
        return f"Supabase rejected the API key (HTTP {status}). Check the publishable or anon key in the key folder."
    return f"Could not reach Supabase ({type(e).__name__}). Check SUPABASE_URL and the API key."


async def _connect_supabase() -> None:
    async with app.state.retry_lock:
        rest = SupabaseRestStore(settings.supabase_url, settings.supabase_key, app.state.catalog)
        try:
            await rest.init()
        except SupabaseSetupNeeded:
            app.state.db_note = SETUP_NOTE
            await rest.close()
            return
        except Exception as e:
            app.state.db_note = supabase_error_note(e)
            await rest.close()
            return
        app.state.previous_store = ctx().store
        ctx().store = rest
        app.state.db_note = None
        app.state.retry_supabase = False
        log.info("Connected to Supabase. Switched from the in-memory store to Supabase.")


async def maybe_connect_supabase() -> None:
    """While on the in-memory store, retry Supabase every few seconds without holding up requests."""
    if (
        not app.state.retry_supabase
        or app.state.retry_lock.locked()
        or time.monotonic() - app.state.last_retry < RETRY_SECONDS
    ):
        return
    app.state.last_retry = time.monotonic()
    app.state.retry_task = asyncio.create_task(_connect_supabase())
    # Wait briefly so a page refresh right after a fix already shows Supabase.
    await asyncio.wait({app.state.retry_task}, timeout=1.5)


async def store_for_order(paypal_order_id: str) -> tuple[Store, dict[str, Any] | None]:
    """Orders started just before the switch to Supabase still live in the old in-memory store."""
    store = ctx().store
    order = await store.get_order(paypal_order_id)
    prev: Store | None = app.state.previous_store
    if order is None and prev is not None:
        prev_order = await prev.get_order(paypal_order_id)
        if prev_order:
            return prev, prev_order
    return store, order


class MissionBody(BaseModel):
    query: str = Field(min_length=1, max_length=300)


class OrderBody(BaseModel):
    productId: str = Field(min_length=1, max_length=40)
    missionId: str | None = Field(default=None, max_length=40)


@app.get("/api/health")
async def health() -> dict[str, Any]:
    c = ctx()
    return {"ok": True, "database": c.store.kind, "databaseNote": app.state.db_note, "ai": c.agents.label, "payments": c.paypal.mode}


@app.get("/api/config")
async def config() -> dict[str, Any]:
    await maybe_connect_supabase()
    c = ctx()
    return {
        "paypalClientId": c.paypal.client_id if c.paypal.mode == "sandbox" else None,
        "paypalMode": c.paypal.mode,
        "currency": "USD",
        "catalogSize": await c.store.product_count(),
        "database": c.store.kind,
        "databaseNote": app.state.db_note,
        "ai": c.agents.label,
    }


@app.post("/api/missions")
async def missions(body: MissionBody) -> StreamingResponse:
    query = " ".join(body.query.split())
    if not query:
        raise HTTPException(422, "Tell ShopPilot what you're looking for.")
    await maybe_connect_supabase()

    async def stream():
        async for event in run_mission(query, ctx()):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/orders")
async def create_order(body: OrderBody) -> dict[str, str]:
    c = ctx()
    product = await c.store.get_product(body.productId)
    if not product:
        raise HTTPException(404, "That product no longer exists.")
    if product["stock"] <= 0:
        raise HTTPException(409, "Sorry, that product just sold out.")
    local_id = f"ord_{secrets.token_hex(8)}"
    try:
        paypal_order_id = await c.paypal.create_order(product, local_id)
    except PayPalError as e:
        raise HTTPException(e.status, str(e)) from e
    # The amount is the database price. The browser never sends a price.
    await c.store.create_order(
        {
            "id": local_id,
            "paypal_order_id": paypal_order_id,
            "product_id": product["id"],
            "mission_id": body.missionId,
            "amount": product["price"],
            "currency": "USD",
            "payment_mode": c.paypal.mode,
        }
    )
    return {"paypalOrderId": paypal_order_id}


@app.post("/api/orders/{paypal_order_id}/capture")
async def capture_order(paypal_order_id: str) -> dict[str, Any]:
    c = ctx()
    store, order = await store_for_order(paypal_order_id)
    if not order:
        raise HTTPException(404, "Order not found. Please start checkout again.")
    if order["status"] == "COMPLETED":
        return order  # already captured: safe to call twice
    try:
        capture = await c.paypal.capture_order(paypal_order_id)
    except PayPalError as e:
        raise HTTPException(e.status, str(e)) from e

    amount_ok = capture["amount"] is None or abs(capture["amount"] - order["amount"]) < 0.005
    status = "COMPLETED" if capture["status"] == "COMPLETED" and amount_ok else "FAILED"
    if not amount_ok:
        log.error("Captured amount %s does not match order amount %s for %s", capture["amount"], order["amount"], paypal_order_id)
    updated = await store.update_order(
        paypal_order_id, status=status, capture_id=capture["captureId"], paypal_response=capture["raw"]
    )
    if status != "COMPLETED":
        raise HTTPException(402, f"PayPal reported the payment as {capture['status'] or 'not completed'}. Nothing was charged.")
    return updated or order


@app.get("/api/orders")
async def list_orders() -> list[dict[str, Any]]:
    orders = await ctx().store.list_orders()
    prev: Store | None = app.state.previous_store
    if prev is not None:  # include orders paid just before the switch to Supabase
        seen = {o["paypalOrderId"] for o in orders}
        orders += [o for o in await prev.list_orders() if o["paypalOrderId"] not in seen]
        orders.sort(key=lambda o: o["createdAt"], reverse=True)
    return orders


# Serve the built React app (after the API routes so /api/* wins).
if settings.frontend_dist.exists():
    app.mount("/", StaticFiles(directory=settings.frontend_dist, html=True), name="frontend")
