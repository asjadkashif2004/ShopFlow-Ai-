"""Data access.

PostgresStore talks to Supabase Postgres (the real database). MemoryStore is only a
stand-in so the app still runs before SUPABASE_DB_URL is configured; it loses data
on restart and /api/config reports it as "memory".
"""

from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import asyncpg

from .engine import Category, Product, Req, meets

log = logging.getLogger("shoppilot.db")

SCHEMA_SQL = (Path(__file__).parent / "schema.sql").read_text(encoding="utf-8")


def load_catalog(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store(ABC):
    kind: str = "memory"
    categories: list[Category] = []

    async def init(self) -> None: ...

    async def close(self) -> None: ...

    @abstractmethod
    async def all_products(self) -> list[Product]: ...

    @abstractmethod
    async def product_count(self) -> int: ...

    @abstractmethod
    async def count_in_category(self, slug: str) -> int: ...

    @abstractmethod
    async def search(self, slug: str, musts: list[Req]) -> list[Product]:
        """Products in a category that meet every must-have, cheapest first."""

    @abstractmethod
    async def get_product(self, product_id: str) -> Product | None: ...

    @abstractmethod
    async def mission_started(self, mission_id: str, query: str) -> None: ...

    @abstractmethod
    async def mission_finished(self, mission_id: str, **data: Any) -> None: ...

    @abstractmethod
    async def create_order(self, order: dict[str, Any]) -> None: ...

    @abstractmethod
    async def get_order(self, paypal_order_id: str) -> dict[str, Any] | None: ...

    @abstractmethod
    async def update_order(
        self, paypal_order_id: str, *, status: str, capture_id: str | None, paypal_response: Any
    ) -> dict[str, Any] | None: ...

    @abstractmethod
    async def list_orders(self, limit: int = 50) -> list[dict[str, Any]]: ...


# --------------------------------------------------------------------------- #
# Supabase Postgres
# --------------------------------------------------------------------------- #


def _connect_args(dsn: str) -> dict[str, Any]:
    """Split a postgres:// URL by hand so passwords containing '@', ':' or '#' still work."""
    rest = dsn.split("://", 1)[1]
    creds, _, hostpart = rest.rpartition("@")
    user, _, password = creds.partition(":")
    hostport, _, dbq = hostpart.partition("/")
    database = dbq.split("?", 1)[0] or "postgres"
    host, _, port = hostport.rpartition(":") if ":" in hostport else (hostport, "", "")
    return {
        "user": unquote(user),
        "password": unquote(password),
        "host": host,
        "port": int(port or 5432),
        "database": database,
        "ssl": "require" if host.endswith("supabase.com") else "prefer",
    }


async def _init_connection(conn: asyncpg.Connection) -> None:
    for t in ("json", "jsonb"):
        await conn.set_type_codec(t, encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


def _product_row(row: asyncpg.Record) -> Product:
    return {
        "id": row["id"],
        "category": row["category"],
        "name": row["name"],
        "brand": row["brand"],
        "price": float(row["price"]),
        "rating": float(row["rating"]),
        "reviewCount": row["review_count"],
        "stock": row["stock"],
        "description": row["description"],
        "specs": row["specs"] or {},
        "tags": list(row["tags"] or []),
    }


def _order_row(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": row["id"],
        "paypalOrderId": row["paypal_order_id"],
        "captureId": row["capture_id"],
        "productId": row["product_id"],
        "productName": row["product_name"],
        "brand": row["brand"],
        "category": row["category"],
        "amount": float(row["amount"]),
        "currency": row["currency"],
        "status": row["status"],
        "missionId": row["mission_id"],
        "paymentMode": row["payment_mode"],
        "createdAt": row["created_at"].isoformat(),
    }


PRODUCT_COLS = "id, category, name, brand, price, rating, review_count, stock, description, specs, tags"
ORDER_SELECT = """
  select o.id, o.paypal_order_id, o.capture_id, o.product_id, o.mission_id, o.amount, o.currency,
         o.status, o.payment_mode, o.created_at, p.name as product_name, p.brand, p.category
  from orders o join products p on p.id = o.product_id
"""


class PostgresStore(Store):
    kind = "postgres"

    def __init__(self, dsn: str, catalog: dict[str, Any]):
        self.dsn = dsn
        self.seed = catalog
        self.pool: asyncpg.Pool | None = None

    async def init(self) -> None:
        # statement_cache_size=0 keeps this working with Supabase's transaction pooler too.
        self.pool = await asyncpg.create_pool(
            **_connect_args(self.dsn), min_size=1, max_size=5, statement_cache_size=0, init=_init_connection, command_timeout=20
        )
        async with self.pool.acquire() as conn:
            await conn.execute(SCHEMA_SQL)
            await self._seed(conn)
            rows = await conn.fetch("select slug, name, singular, key_specs, specs from categories order by sort_order")
        self.categories = [
            {"slug": r["slug"], "name": r["name"], "singular": r["singular"], "keySpecs": list(r["key_specs"]), "specs": r["specs"]}
            for r in rows
        ]
        log.info("Connected to Supabase Postgres: %d categories, %d products", len(self.categories), await self.product_count())

    async def _seed(self, conn: asyncpg.Connection) -> None:
        cats = self.seed["categories"]
        prods = self.seed["products"]
        async with conn.transaction():
            await conn.executemany(
                """insert into categories (slug, name, singular, key_specs, specs, sort_order)
                   values ($1, $2, $3, $4, $5::jsonb, $6)
                   on conflict (slug) do update set name = excluded.name, singular = excluded.singular,
                     key_specs = excluded.key_specs, specs = excluded.specs, sort_order = excluded.sort_order""",
                [(c["slug"], c["name"], c["singular"], c["keySpecs"], c["specs"], i) for i, c in enumerate(cats)],
            )
            # Stock is only set on first insert, so purchases are not undone by a restart.
            await conn.executemany(
                f"""insert into products ({PRODUCT_COLS})
                    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
                    on conflict (id) do update set category = excluded.category, name = excluded.name,
                      brand = excluded.brand, price = excluded.price, rating = excluded.rating,
                      review_count = excluded.review_count, description = excluded.description,
                      specs = excluded.specs, tags = excluded.tags, updated_at = now()""",
                [
                    (
                        p["id"], p["category"], p["name"], p["brand"], Decimal(str(p["price"])), Decimal(str(p["rating"])),
                        p["reviewCount"], p["stock"], p["description"], p["specs"], p["tags"],
                    )
                    for p in prods
                ],
            )

    async def close(self) -> None:
        if self.pool:
            await self.pool.close()

    async def all_products(self) -> list[Product]:
        assert self.pool
        rows = await self.pool.fetch(f"select {PRODUCT_COLS} from products order by category, price")
        return [_product_row(r) for r in rows]

    async def product_count(self) -> int:
        assert self.pool
        return await self.pool.fetchval("select count(*) from products")

    async def count_in_category(self, slug: str) -> int:
        assert self.pool
        return await self.pool.fetchval("select count(*) from products where category = $1", slug)

    async def search(self, slug: str, musts: list[Req]) -> list[Product]:
        """Must-haves become SQL filters on the JSONB specs and the tags array."""
        assert self.pool
        clauses = ["category = $1"]
        params: list[Any] = [slug]
        for r in musts:
            if r.get("tag"):
                params.append(r["tag"])
                clauses.append(f"${len(params)} = any(tags)")
            elif "equals" in r:
                params.append({r["spec"]: r["equals"]})
                clauses.append(f"specs @> ${len(params)}::jsonb")
            elif "min" in r:
                params.append(r["spec"])
                key_param = len(params)
                params.append(float(r["min"]))
                clauses.append(f"(specs ->> ${key_param}::text)::float8 >= ${len(params)}::float8")
        sql = f"select {PRODUCT_COLS} from products where {' and '.join(clauses)} order by price"
        rows = await self.pool.fetch(sql, *params)
        return [_product_row(r) for r in rows]

    async def get_product(self, product_id: str) -> Product | None:
        assert self.pool
        row = await self.pool.fetchrow(f"select {PRODUCT_COLS} from products where id = $1", product_id)
        return _product_row(row) if row else None

    async def mission_started(self, mission_id: str, query: str) -> None:
        assert self.pool
        try:
            await self.pool.execute("insert into missions (id, query) values ($1, $2)", mission_id, query)
        except Exception:  # never break the live stream over logging
            log.exception("Could not save mission start")

    async def mission_finished(self, mission_id: str, **d: Any) -> None:
        assert self.pool
        try:
            async with self.pool.acquire() as conn, conn.transaction():
                await conn.execute(
                    """update missions set status = $2, intent = $3::jsonb, result = $4::jsonb, intent_engine = $5,
                         explain_engine = $6, duration_ms = $7 where id = $1""",
                    mission_id, d.get("status", "done"), d.get("intent"), d.get("result"),
                    d.get("intent_engine"), d.get("explain_engine"), d.get("duration_ms"),
                )
                steps = d.get("steps") or []
                if steps:
                    await conn.executemany(
                        "insert into mission_steps (mission_id, agent, message, duration_ms) values ($1, $2, $3, $4)",
                        [(mission_id, s["agent"], s["message"], s["durationMs"]) for s in steps],
                    )
                recs = (d.get("result") or {}).get("recommendations") or []
                near = (d.get("result") or {}).get("nearMisses") or []
                if recs or near:
                    await conn.executemany(
                        """insert into recommendations (mission_id, product_id, rank, score, breakdown, reasons, tradeoffs, over_budget)
                           values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)""",
                        [
                            (mission_id, r["product"]["id"], r["rank"], r["score"], r["breakdown"], r["reasons"], r["tradeoffs"], r["overBudget"])
                            for r in [*recs, *near]
                        ],
                    )
        except Exception:
            log.exception("Could not save mission result")

    async def create_order(self, o: dict[str, Any]) -> None:
        assert self.pool
        await self.pool.execute(
            """insert into orders (id, paypal_order_id, product_id, mission_id, amount, currency, status, payment_mode)
               values ($1, $2, $3, (select id from missions where id = $4), $5, $6, 'CREATED', $7)""",
            o["id"], o["paypal_order_id"], o["product_id"], o.get("mission_id"), Decimal(str(o["amount"])), o["currency"], o["payment_mode"],
        )

    async def get_order(self, paypal_order_id: str) -> dict[str, Any] | None:
        assert self.pool
        row = await self.pool.fetchrow(ORDER_SELECT + " where o.paypal_order_id = $1", paypal_order_id)
        return _order_row(row) if row else None

    async def update_order(self, paypal_order_id: str, *, status: str, capture_id: str | None, paypal_response: Any):
        assert self.pool
        async with self.pool.acquire() as conn, conn.transaction():
            product_id = await conn.fetchval(
                """update orders set status = $2, capture_id = $3, paypal_response = $4::jsonb, updated_at = now()
                   where paypal_order_id = $1 returning product_id""",
                paypal_order_id, status, capture_id, paypal_response,
            )
            if product_id and status == "COMPLETED":
                await conn.execute("update products set stock = greatest(stock - 1, 0) where id = $1", product_id)
        return await self.get_order(paypal_order_id)

    async def list_orders(self, limit: int = 50) -> list[dict[str, Any]]:
        assert self.pool
        rows = await self.pool.fetch(ORDER_SELECT + " order by o.created_at desc limit $1", limit)
        return [_order_row(r) for r in rows]


# --------------------------------------------------------------------------- #
# In-memory stand-in (until the database URL is set)
# --------------------------------------------------------------------------- #


class MemoryStore(Store):
    kind = "memory"

    def __init__(self, catalog: dict[str, Any]):
        self.categories = catalog["categories"]
        self.products: dict[str, Product] = {p["id"]: dict(p) for p in catalog["products"]}
        self.orders: dict[str, dict[str, Any]] = {}

    async def all_products(self) -> list[Product]:
        return list(self.products.values())

    async def product_count(self) -> int:
        return len(self.products)

    async def count_in_category(self, slug: str) -> int:
        return sum(1 for p in self.products.values() if p["category"] == slug)

    async def search(self, slug: str, musts: list[Req]) -> list[Product]:
        found = [p for p in self.products.values() if p["category"] == slug and all(meets(p, r) for r in musts)]
        return sorted(found, key=lambda p: p["price"])

    async def get_product(self, product_id: str) -> Product | None:
        return self.products.get(product_id)

    async def mission_started(self, mission_id: str, query: str) -> None:
        return None

    async def mission_finished(self, mission_id: str, **data: Any) -> None:
        return None

    def _public(self, o: dict[str, Any]) -> dict[str, Any]:
        p = self.products[o["product_id"]]
        return {
            "id": o["id"],
            "paypalOrderId": o["paypal_order_id"],
            "captureId": o.get("capture_id"),
            "productId": p["id"],
            "productName": p["name"],
            "brand": p["brand"],
            "category": p["category"],
            "amount": o["amount"],
            "currency": o["currency"],
            "status": o["status"],
            "missionId": o.get("mission_id"),
            "paymentMode": o["payment_mode"],
            "createdAt": o["created_at"],
        }

    async def create_order(self, o: dict[str, Any]) -> None:
        self.orders[o["paypal_order_id"]] = {**o, "status": "CREATED", "created_at": _now_iso()}

    async def get_order(self, paypal_order_id: str) -> dict[str, Any] | None:
        o = self.orders.get(paypal_order_id)
        return self._public(o) if o else None

    async def update_order(self, paypal_order_id: str, *, status: str, capture_id: str | None, paypal_response: Any):
        o = self.orders.get(paypal_order_id)
        if not o:
            return None
        o.update(status=status, capture_id=capture_id)
        if status == "COMPLETED":
            p = self.products[o["product_id"]]
            p["stock"] = max(0, p["stock"] - 1)
        return self._public(o)

    async def list_orders(self, limit: int = 50) -> list[dict[str, Any]]:
        items = sorted(self.orders.values(), key=lambda o: o["created_at"], reverse=True)[:limit]
        return [self._public(o) for o in items]
