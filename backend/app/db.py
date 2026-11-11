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


IMAGE_COLS = ("image_url", "image_credit", "image_credit_url")


def image_from_row(row: Any) -> dict[str, str] | None:
    """Product photo from a database row (asyncpg Record or REST dict), if it has one."""
    url = row.get("image_url") if row is not None else None
    if not url:
        return None
    return {"url": url, "credit": row.get("image_credit") or "", "creditUrl": row.get("image_credit_url") or ""}


def catalog_images(catalog: dict[str, Any] | None) -> dict[str, dict[str, str]]:
    """Photos from the seed catalog, used when the database has no image columns yet."""
    return {p["id"]: p["image"] for p in (catalog or {}).get("products", []) if p.get("image")}


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
        "image": image_from_row(row),
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
        "image": image_from_row(row),
    }


PRODUCT_COLS = "id, category, name, brand, price, rating, review_count, stock, description, specs, tags, image_url, image_credit, image_credit_url"
ORDER_SELECT = """
  select o.id, o.paypal_order_id, o.capture_id, o.product_id, o.mission_id, o.amount, o.currency,
         o.status, o.payment_mode, o.created_at, p.name as product_name, p.brand, p.category,
         p.image_url, p.image_credit, p.image_credit_url
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
                    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14)
                    on conflict (id) do update set category = excluded.category, name = excluded.name,
                      brand = excluded.brand, price = excluded.price, rating = excluded.rating,
                      review_count = excluded.review_count, description = excluded.description,
                      specs = excluded.specs, tags = excluded.tags, image_url = excluded.image_url,
                      image_credit = excluded.image_credit, image_credit_url = excluded.image_credit_url,
                      updated_at = now()""",
                [
                    (
                        p["id"], p["category"], p["name"], p["brand"], Decimal(str(p["price"])), Decimal(str(p["rating"])),
                        p["reviewCount"], p["stock"], p["description"], p["specs"], p["tags"],
                        (p.get("image") or {}).get("url"), (p.get("image") or {}).get("credit"),
                        (p.get("image") or {}).get("creditUrl"),
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
# Supabase through its REST API (publishable / anon / secret key)
# --------------------------------------------------------------------------- #


class SupabaseSetupNeeded(Exception):
    """The ShopPilot tables are missing: run supabase/shoppilot_setup.sql in the SQL Editor."""


class SupabaseError(Exception):
    def __init__(self, status: int, body: str):
        super().__init__(f"Supabase API error {status}: {body[:300]}")
        self.status = status
        self.body = body


REST_PRODUCT_COLS = "id,category,name,brand,price,rating,review_count,stock,description,specs,tags"
REST_IMAGE_COLS = ",".join(IMAGE_COLS)


def _rest_order(row: dict[str, Any]) -> dict[str, Any]:
    p = row.get("products") or {}
    return {
        "id": row["id"],
        "paypalOrderId": row["paypal_order_id"],
        "captureId": row.get("capture_id"),
        "productId": row["product_id"],
        "productName": p.get("name", row["product_id"]),
        "brand": p.get("brand", ""),
        "category": p.get("category", ""),
        "amount": float(row["amount"]),
        "currency": row["currency"],
        "status": row["status"],
        "missionId": row.get("mission_id"),
        "paymentMode": row.get("payment_mode"),
        "createdAt": row["created_at"],
    }


class SupabaseRestStore(Store):
    """Uses Supabase's auto-generated REST API (PostgREST). Filters run in Postgres."""

    kind = "supabase"

    def __init__(self, url: str, key: str, catalog: dict[str, Any] | None = None):
        import httpx

        headers = {"apikey": key, "Content-Type": "application/json"}
        if key.startswith("eyJ"):  # legacy anon/service keys are JWTs and also go in Authorization
            headers["Authorization"] = f"Bearer {key}"
        self.http = httpx.AsyncClient(base_url=f"{url.rstrip('/')}/rest/v1", headers=headers, timeout=15)
        self._count = 0
        self.fallback_images = catalog_images(catalog)
        self.has_image_cols = True

    @property
    def product_cols(self) -> str:
        return f"{REST_PRODUCT_COLS},{REST_IMAGE_COLS}" if self.has_image_cols else REST_PRODUCT_COLS

    @property
    def order_select(self) -> str:
        return f"*,products(name,brand,category{',' + REST_IMAGE_COLS if self.has_image_cols else ''})"

    async def _req(self, method: str, path: str, *, params: Any = None, json_body: Any = None, prefer: str | None = None) -> Any:
        headers = {"Prefer": prefer} if prefer else None
        r = await self.http.request(method, path, params=params, json=json_body, headers=headers)
        if r.status_code >= 400:
            raise SupabaseError(r.status_code, r.text)
        return r.json() if r.content else None

    async def init(self) -> None:
        try:
            rows = await self._req("GET", "/categories", params={"select": "slug,name,singular,key_specs,specs", "order": "sort_order"})
        except SupabaseError as e:
            if e.status == 404 or "PGRST205" in e.body or "42P01" in e.body:
                raise SupabaseSetupNeeded("ShopPilot tables not found") from e
            raise
        if not rows:
            raise SupabaseSetupNeeded("No categories found (the seed has not run, or read access is blocked)")
        self.categories = [
            {"slug": r["slug"], "name": r["name"], "singular": r["singular"], "keySpecs": r["key_specs"] or [], "specs": r["specs"]}
            for r in rows
        ]
        self._count = len(await self._req("GET", "/products", params={"select": "id"}))
        try:
            await self._req("GET", "/products", params={"select": REST_IMAGE_COLS, "limit": "1"})
        except SupabaseError as e:
            if e.status != 400 or "42703" not in e.body:
                raise
            self.has_image_cols = False
            log.warning("Product photo columns are missing. Run supabase/002_product_images.sql; using catalog photos meanwhile.")
        log.info("Connected to Supabase (REST API): %d categories, %d products", len(self.categories), self._count)

    async def close(self) -> None:
        await self.http.aclose()

    def _image(self, row: dict[str, Any] | None, product_id: str) -> dict[str, str] | None:
        return image_from_row(row or {}) or self.fallback_images.get(product_id)

    def _product(self, row: dict[str, Any]) -> Product:
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
            "tags": row["tags"] or [],
            "image": self._image(row, row["id"]),
        }

    def _order(self, row: dict[str, Any]) -> dict[str, Any]:
        return {**_rest_order(row), "image": self._image(row.get("products"), row["product_id"])}

    async def all_products(self) -> list[Product]:
        rows = await self._req("GET", "/products", params={"select": self.product_cols, "order": "category.asc,price.asc"})
        return [self._product(r) for r in rows]

    async def product_count(self) -> int:
        return self._count

    async def count_in_category(self, slug: str) -> int:
        return len(await self._req("GET", "/products", params={"select": "id", "category": f"eq.{slug}"}))

    def search_params(self, slug: str, musts: list[Req]) -> list[tuple[str, str]]:
        params = [("select", self.product_cols), ("category", f"eq.{slug}"), ("order", "price.asc")]
        equals = {r["spec"]: r["equals"] for r in musts if "equals" in r and not r.get("tag")}
        if equals:  # one JSONB containment check covers every equality must-have
            params.append(("specs", "cs." + json.dumps(equals, ensure_ascii=False, separators=(",", ":"))))
        tags = [r["tag"] for r in musts if r.get("tag")]
        if tags:
            params.append(("tags", "cs.{" + ",".join(tags) + "}"))
        for r in musts:
            if "min" in r and not r.get("tag"):
                params.append((f"specs->{r['spec']}", f"gte.{float(r['min']):g}"))
        return params

    def search_preview(self, slug: str, musts: list[Req]) -> str:
        from urllib.parse import urlencode

        return "GET /rest/v1/products?" + urlencode(self.search_params(slug, musts), safe="{}:,>.-\"*")

    async def search(self, slug: str, musts: list[Req]) -> list[Product]:
        rows = await self._req("GET", "/products", params=self.search_params(slug, musts))
        return [self._product(r) for r in rows]

    async def get_product(self, product_id: str) -> Product | None:
        rows = await self._req("GET", "/products", params={"select": self.product_cols, "id": f"eq.{product_id}"})
        return self._product(rows[0]) if rows else None

    async def mission_started(self, mission_id: str, query: str) -> None:
        try:
            await self._req("POST", "/missions", json_body={"id": mission_id, "query": query}, prefer="return=minimal")
        except Exception:
            log.exception("Could not save mission start")

    async def mission_finished(self, mission_id: str, **d: Any) -> None:
        try:
            await self._req(
                "PATCH",
                "/missions",
                params={"id": f"eq.{mission_id}"},
                json_body={
                    "status": d.get("status", "done"),
                    "intent": d.get("intent"),
                    "result": d.get("result"),
                    "intent_engine": d.get("intent_engine"),
                    "explain_engine": d.get("explain_engine"),
                    "duration_ms": d.get("duration_ms"),
                },
                prefer="return=minimal",
            )
            steps = d.get("steps") or []
            if steps:
                await self._req(
                    "POST",
                    "/mission_steps",
                    json_body=[{"mission_id": mission_id, "agent": s["agent"], "message": s["message"], "duration_ms": s["durationMs"]} for s in steps],
                    prefer="return=minimal",
                )
            result = d.get("result") or {}
            recs = [*(result.get("recommendations") or []), *(result.get("nearMisses") or [])]
            if recs:
                await self._req(
                    "POST",
                    "/recommendations",
                    json_body=[
                        {
                            "mission_id": mission_id,
                            "product_id": r["product"]["id"],
                            "rank": r["rank"],
                            "score": r["score"],
                            "breakdown": r["breakdown"],
                            "reasons": r["reasons"],
                            "tradeoffs": r["tradeoffs"],
                            "over_budget": r["overBudget"],
                        }
                        for r in recs
                    ],
                    prefer="return=minimal",
                )
        except Exception:
            log.exception("Could not save mission result")

    async def create_order(self, o: dict[str, Any]) -> None:
        mission_id = o.get("mission_id")
        if mission_id:
            found = await self._req("GET", "/missions", params={"select": "id", "id": f"eq.{mission_id}"})
            mission_id = mission_id if found else None
        await self._req(
            "POST",
            "/orders",
            json_body={
                "id": o["id"],
                "paypal_order_id": o["paypal_order_id"],
                "product_id": o["product_id"],
                "mission_id": mission_id,
                "amount": round(float(o["amount"]), 2),
                "currency": o["currency"],
                "status": "CREATED",
                "payment_mode": o["payment_mode"],
            },
            prefer="return=minimal",
        )

    async def get_order(self, paypal_order_id: str) -> dict[str, Any] | None:
        rows = await self._req("GET", "/orders", params={"select": self.order_select, "paypal_order_id": f"eq.{paypal_order_id}"})
        return self._order(rows[0]) if rows else None

    async def update_order(self, paypal_order_id: str, *, status: str, capture_id: str | None, paypal_response: Any):
        rows = await self._req(
            "PATCH",
            "/orders",
            params={"paypal_order_id": f"eq.{paypal_order_id}", "select": "product_id"},
            json_body={"status": status, "capture_id": capture_id, "paypal_response": paypal_response, "updated_at": _now_iso()},
            prefer="return=representation",
        )
        if rows and status == "COMPLETED":
            try:
                await self._req("POST", "/rpc/decrement_stock", json_body={"p_product_id": rows[0]["product_id"]})
            except Exception:
                log.warning("Could not update stock", exc_info=True)
        return await self.get_order(paypal_order_id)

    async def list_orders(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = await self._req("GET", "/orders", params={"select": self.order_select, "order": "created_at.desc", "limit": str(limit)})
        return [self._order(r) for r in rows]


# --------------------------------------------------------------------------- #
# In-memory stand-in (until Supabase is set up)
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
            "image": p.get("image"),
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
