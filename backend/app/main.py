"""ShopPilot API.

Run locally:   backend/.venv/Scripts/python -m uvicorn app.main:app --app-dir backend --port 7860
The React app proxies /api to this server in development, and this server also serves
the built React app (frontend/dist) so one container is enough on Hugging Face.
"""

from __future__ import annotations

import json
import logging
import secrets
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .agents import Agents
from .config import load_settings
from .db import MemoryStore, PostgresStore, Store, load_catalog
from .engine import CatalogIndex
from .missions import Context, run_mission
from .paypal import PayPalError, PayPalService

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("shoppilot")

settings = load_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    catalog = load_catalog(settings.catalog_path)
    store: Store = MemoryStore(catalog)
    if settings.supabase_db_url:
        pg = PostgresStore(settings.supabase_db_url, catalog)
        try:
            await pg.init()
            store = pg
        except Exception as e:
            log.error("Could not connect to Supabase (%s). Using the in-memory store for now.", type(e).__name__)
            log.debug("Supabase connection error", exc_info=True)
    else:
        log.warning("SUPABASE_DB_URL is not set. Using the in-memory store (data resets on restart).")

    index = CatalogIndex(store.categories, await store.all_products())
    app.state.ctx = Context(settings=settings, store=store, agents=Agents(settings, index), paypal=PayPalService(settings))
    log.info("ShopPilot ready · database=%s · ai=%s · payments=%s", store.kind, app.state.ctx.agents.label, app.state.ctx.paypal.mode)
    yield
    await store.close()


app = FastAPI(title="ShopPilot API", version="0.1.0", lifespan=lifespan)


def ctx() -> Context:
    return app.state.ctx


class MissionBody(BaseModel):
    query: str = Field(min_length=1, max_length=300)


class OrderBody(BaseModel):
    productId: str = Field(min_length=1, max_length=40)
    missionId: str | None = Field(default=None, max_length=40)


@app.get("/api/health")
async def health() -> dict[str, Any]:
    c = ctx()
    return {"ok": True, "database": c.store.kind, "ai": c.agents.label, "payments": c.paypal.mode}


@app.get("/api/config")
async def config() -> dict[str, Any]:
    c = ctx()
    return {
        "paypalClientId": c.paypal.client_id if c.paypal.mode == "sandbox" else None,
        "paypalMode": c.paypal.mode,
        "currency": "USD",
        "catalogSize": await c.store.product_count(),
        "database": c.store.kind,
        "ai": c.agents.label,
    }


@app.post("/api/missions")
async def missions(body: MissionBody) -> StreamingResponse:
    query = " ".join(body.query.split())
    if not query:
        raise HTTPException(422, "Tell ShopPilot what you're looking for.")

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
    order = await c.store.get_order(paypal_order_id)
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
    updated = await c.store.update_order(
        paypal_order_id, status=status, capture_id=capture["captureId"], paypal_response=capture["raw"]
    )
    if status != "COMPLETED":
        raise HTTPException(402, f"PayPal reported the payment as {capture['status'] or 'not completed'}. Nothing was charged.")
    return updated or order


@app.get("/api/orders")
async def list_orders() -> list[dict[str, Any]]:
    return await ctx().store.list_orders()


# Serve the built React app (after the API routes so /api/* wins).
if settings.frontend_dist.exists():
    app.mount("/", StaticFiles(directory=settings.frontend_dist, html=True), name="frontend")
