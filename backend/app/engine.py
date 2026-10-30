"""ShopPilot decision engine.

- Turns the Intent Agent's output into validated requirements (only real specs, values and tags).
- Rule-based intent parser used when Groq is unavailable.
- Transparent scoring, reasons, trade-offs, refinements and a template write-up.

Mirrors frontend/src/demo/engine.ts so demo mode and live mode behave the same.
"""

from __future__ import annotations

import json
import math
import re
from typing import Any

Product = dict[str, Any]
Category = dict[str, Any]
Req = dict[str, Any]
Intent = dict[str, Any]

# --------------------------------------------------------------------------- #
# Formatting
# --------------------------------------------------------------------------- #


def fmt_price(n: float) -> str:
    return f"${n:,.2f}"


def fmt_budget(n: float) -> str:
    return f"${int(n):,}" if float(n).is_integer() else fmt_price(n)


def fmt_count(n: int) -> str:
    return f"{n:,}"


def fmt_num(v: float | int) -> str:
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    if abs(v) >= 10000:
        return f"{v:,}"
    return f"{v:g}" if isinstance(v, float) else str(v)


def fmt_spec(d: dict[str, Any], v: Any) -> str:
    if v is None:
        return "—"
    if d["type"] == "bool":
        return "Yes" if v else "No"
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if d["key"] == "storageGb":
            return f"{fmt_num(v / 1000)} TB" if v >= 1000 else f"{fmt_num(v)} GB"
        num = fmt_num(v)
        unit = d.get("unit")
        if not unit:
            return num
        if unit == '"':
            return f'{num}"'
        return f"{num} {unit}"
    return str(v)


def join_list(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return f"{', '.join(items[:-1])} and {items[-1]}"


def lower_first(s: str) -> str:
    return s[0].lower() + s[1:] if re.match(r"^[A-Z][a-z]", s) else s


def capitalize(s: str) -> str:
    return s[:1].upper() + s[1:]


def spec_def(category: Category, key: str | None) -> dict[str, Any] | None:
    return next((s for s in category["specs"] if s["key"] == key), None)


# --------------------------------------------------------------------------- #
# Requirements: one place that knows how to label them
# --------------------------------------------------------------------------- #

ADJECTIVE_BOOLS = {"wireless", "mechanical"}
RESOLUTION_NAMES = {"3840×2160": "4K", "2560×1440": "1440p", "1920×1080": "1080p", "3440×1440": "Ultrawide 1440p"}
DIRECTION_TEXT = {
    "batteryHours": ("Long battery", "long battery"),
    "batteryDays": ("Long battery", "long battery"),
    "weightG": ("Lightweight", "lightweight"),
    "weightKg": ("Lightweight", "lightweight"),
    "refreshHz": ("High refresh rate", "high refresh rate"),
    "responseMs": ("Fast response", "fast response time"),
    "dpi": ("High DPI", "high DPI"),
    "pollingHz": ("High polling rate", "high polling rate"),
    "ramGb": ("More memory", "more memory"),
    "storageGb": ("More storage", "more storage"),
    "usbCWatts": ("More USB-C power", "more USB-C power"),
}
TAG_TEXT = {
    "gaming": ("For gaming", "for gaming"),
    "running": ("For running", "for running"),
    "coding": ("For coding", "for coding"),
    "student": ("For students", "for students"),
    "office": ("For work", "for work"),
    "travel": ("For travel", "for travel"),
    "fitness": ("For workouts", "for workouts"),
    "hiking": ("For the outdoors", "for hiking"),
    "creative": ("For creative work", "for creative work"),
    "quiet": ("Quiet", "quiet"),
    "ergonomic": ("Ergonomic", "ergonomic"),
    "kids": ("For kids", "for kids"),
    "esports": ("For esports", "for esports"),
    "mmo": ("For MMO games", "for MMO games"),
    "commute": ("For commuting", "for commuting"),
    "lightweight": ("Lightweight build", "lightweight"),
    "premium": ("Premium", "premium"),
    "slim": ("Slim profile", "slim"),
}
TAG_PRAISE = {
    "gaming": "Built for gaming",
    "running": "Built for running",
    "coding": "Great for coding",
    "student": "Popular with students",
    "office": "Made for work",
    "travel": "Travel-friendly",
    "fitness": "Made for workouts",
    "hiking": "Trail-ready",
    "creative": "Made for creative work",
    "quiet": "Quiet in use",
    "ergonomic": "Ergonomic design",
    "kids": "Designed for kids",
    "esports": "Esports-ready",
    "mmo": "Built for MMO games",
    "commute": "Great for commuting",
    "lightweight": "Lightweight build",
    "premium": "Premium build",
    "slim": "Slim profile",
}


def spec_req(d: dict[str, Any], kind: str, *, equals: Any = None, minimum: float | None = None, direction: str | None = None) -> Req:
    key = d["key"]
    if direction:
        label, phrase = DIRECTION_TEXT.get(key, (f"Better {lower_first(d['label'])}", f"better {d['label'].lower()}"))
        return {"id": f"{key}:{direction}", "label": label, "phrase": phrase, "kind": "prefer", "spec": key, "direction": direction}
    if minimum is not None:
        if key == "usbCWatts" and minimum <= 1:
            label, phrase = "USB-C power", "USB-C"
        else:
            label = f"{fmt_spec(d, minimum)}+ {lower_first(d['label'])}"
            phrase = f"at least {fmt_spec(d, minimum)} {d['label'].lower()}"
        return {"id": f"{key}>={minimum:g}", "label": label, "phrase": phrase, "kind": kind, "spec": key, "min": minimum, "verb": "has"}
    verb = "has"
    if d["type"] == "bool":
        if equals:
            label, phrase = d["label"], d["label"].lower()
            if key in ADJECTIVE_BOOLS:
                verb = "is"
        elif key == "wireless":
            label, phrase, verb = "Wired", "wired", "is"
        else:
            label, phrase = f"No {lower_first(d['label'])}", f"without {d['label'].lower()}"
    else:
        val = str(equals)
        if key == "resolution":
            name = RESOLUTION_NAMES.get(val, val)
            label, phrase = f"{name} resolution", name
        elif key == "form":
            label, phrase, verb = val, val.lower(), "is"
        elif key == "panel":
            label, phrase = f"{val} panel", val
        elif key == "switchType":
            label, phrase = f"{val} switches", f"{val.lower()} switches"
        elif key == "layout":
            label = phrase = f"{val} layout"
        else:
            label = f"{val} {lower_first(d['label'])}"
            phrase = label
    return {"id": f"{key}={equals}", "label": label, "phrase": phrase, "kind": kind, "spec": key, "equals": equals, "verb": verb}


def tag_req(tag: str) -> Req:
    label, phrase = TAG_TEXT.get(tag, (f"For {tag}", f"for {tag}"))
    return {"id": f"tag:{tag}", "label": label, "phrase": phrase, "kind": "prefer", "tag": tag}


class CatalogIndex:
    """Per-category tags and observed text values, used to validate AI output."""

    def __init__(self, categories: list[Category], products: list[Product] | None = None, values: dict | None = None):
        self.categories = categories
        self.by_slug = {c["slug"]: c for c in categories}
        self.tags: dict[str, set[str]] = {}
        self.values: dict[str, dict[str, set[str]]] = {}
        self.ranges: dict[str, dict[str, tuple[float, float]]] = {}
        for p in products or []:
            self.tags.setdefault(p["category"], set()).update(p["tags"])
            cat = self.by_slug.get(p["category"])
            if not cat:
                continue
            for d in cat["specs"]:
                v = p["specs"].get(d["key"])
                if d["type"] == "text" and isinstance(v, str):
                    self.values.setdefault(p["category"], {}).setdefault(d["key"], set()).add(v)
                elif d["type"] == "number" and isinstance(v, (int, float)) and not isinstance(v, bool):
                    lo, hi = self.ranges.setdefault(p["category"], {}).get(d["key"], (v, v))
                    self.ranges[p["category"]][d["key"]] = (min(lo, v), max(hi, v))

    def schema_for_prompt(self) -> list[dict[str, Any]]:
        out = []
        for c in self.categories:
            specs = []
            for d in c["specs"]:
                item: dict[str, Any] = {"key": d["key"], "label": d["label"], "type": d["type"]}
                if d.get("unit"):
                    item["unit"] = d["unit"]
                if d["type"] == "text":
                    item["values"] = sorted(self.values.get(c["slug"], {}).get(d["key"], set()))
                if d["type"] == "number" and d["key"] in self.ranges.get(c["slug"], {}):
                    item["range"] = list(self.ranges[c["slug"]][d["key"]])
                specs.append(item)
            # "budget" is a price wish, handled by emphasis.value, so it is not offered as a tag.
            tags = sorted(self.tags.get(c["slug"], set()) - {"budget"})
            out.append({"slug": c["slug"], "name": c["name"], "specs": specs, "tags": tags})
        return out


def _norm(s: str) -> str:
    return s.lower().replace(" ", "").replace("x", "×")


RESOLUTION_ALIASES = {"4k": "3840×2160", "uhd": "3840×2160", "2160p": "3840×2160", "1440p": "2560×1440", "qhd": "2560×1440", "2k": "2560×1440", "1080p": "1920×1080", "fhd": "1920×1080"}


def _req_from_ai(item: Any, kind: str, cat: Category, index: CatalogIndex) -> Req | None:
    if not isinstance(item, dict):
        return None
    tag = item.get("tag")
    if isinstance(tag, str):
        tag = tag.strip().lower()
        return tag_req(tag) if tag in index.tags.get(cat["slug"], set()) else None
    d = spec_def(cat, item.get("spec"))
    if not d:
        return None
    direction = item.get("direction")
    if direction in ("higher", "lower") and d["type"] == "number":
        return spec_req(d, "prefer", direction=direction)
    m = item.get("min")
    if isinstance(m, (int, float)) and not isinstance(m, bool) and d["type"] == "number":
        return spec_req(d, kind, minimum=float(m))
    if "equals" in item:
        v = item["equals"]
        if d["type"] == "bool":
            if isinstance(v, str):
                v = v.strip().lower() in ("true", "yes", "1")
            return spec_req(d, kind, equals=v) if isinstance(v, bool) else None
        if d["type"] == "text" and isinstance(v, (str, int, float)):
            allowed = index.values.get(cat["slug"], {}).get(d["key"], set())
            match = next((a for a in allowed if _norm(a) == _norm(str(v))), None)
            if not match and d["key"] == "resolution":
                match = RESOLUTION_ALIASES.get(str(v).strip().lower())
            return spec_req(d, kind, equals=match) if match else None
        if d["type"] == "number" and isinstance(v, (int, float)) and not isinstance(v, bool):
            return spec_req(d, kind, minimum=float(v))
    return None


def _finish_intent(category: Category | None, max_price: float | None, reqs: list[Req], emphasis: dict[str, bool]) -> Intent:
    # "wired" and "wireless" together: trust "wireless".
    if any(r["id"] == "wireless=True" for r in reqs):
        reqs = [r for r in reqs if r["id"] != "wireless=False"]
    intent: Intent = {
        "category": category["slug"] if category else None,
        "maxPrice": max_price,
        "requirements": reqs,
        "emphasis": {"value": bool(emphasis.get("value")), "rating": bool(emphasis.get("rating"))},
        "summary": "",
    }
    intent["summary"] = summarize_intent(intent, category)
    return intent


def intent_from_ai(raw: dict[str, Any], index: CatalogIndex) -> Intent:
    """Validate the Intent Agent's JSON. Anything not in the catalog schema is dropped."""
    slug = raw.get("category")
    cat = index.by_slug.get(slug) if isinstance(slug, str) else None
    mp = raw.get("maxPrice")
    max_price = float(mp) if isinstance(mp, (int, float)) and not isinstance(mp, bool) and mp > 0 else None
    reqs: list[Req] = []
    emphasis = dict(raw.get("emphasis")) if isinstance(raw.get("emphasis"), dict) else {}
    if cat:
        for kind in ("must", "prefer"):
            for item in raw.get(kind) or []:
                if isinstance(item, dict) and str(item.get("tag", "")).lower() == "budget":
                    emphasis["value"] = True
                    continue
                r = _req_from_ai(item, kind, cat, index)
                if r and not any(x["id"] == r["id"] for x in reqs):
                    reqs.append(r)
    return _finish_intent(cat, max_price, reqs, emphasis)


# --------------------------------------------------------------------------- #
# Rule-based fallback parser (used when Groq is not configured or fails)
# --------------------------------------------------------------------------- #

CATEGORY_PATTERNS = [
    ("headphones", r"\b(head ?phones?|ear ?buds?|headsets?|earphones?|buds)\b"),
    ("mice", r"\b(mouse|mice)\b"),
    ("keyboards", r"\b(keyboards?)\b"),
    ("monitors", r"\b(monitors?|displays?|screens?)\b"),
    ("smartwatches", r"\b(smart ?watch(es)?|watch(es)?|fitness trackers?|trackers?|fitness bands?)\b"),
    ("laptops", r"\b(laptops?|notebooks?|ultrabooks?|chromebooks?)\b"),
]

TAG_PATTERNS = [
    (r"\b(gaming|gamers?|games?|fps|esports?)\b", "gaming"),
    (r"\b(run|runs|running|runners?|jogging|marathons?)\b", "running"),
    (r"\b(coding|programming|programmers?|developers?|code)\b", "coding"),
    (r"\b(students?|school|college|university)\b", "student"),
    (r"\b(office|work|working|productivity|business)\b", "office"),
    (r"\b(travel|traveling|travelling|flights?|commute|commuting|trips?)\b", "travel"),
    (r"\b(fitness|workouts?|gym|training)\b", "fitness"),
    (r"\b(hiking|hikes?|outdoors?|trails?)\b", "hiking"),
    (r"\b(creative|design|designers?|photos?|video|editing)\b", "creative"),
    (r"\b(quiet|silent)\b", "quiet"),
    (r"\b(ergonomic|wrist|vertical)\b", "ergonomic"),
    (r"\b(kids?|children|child)\b", "kids"),
]

VALUE_RE = r"\b(cheap|cheapest|cheaper|affordable|inexpensive|bargain|budget[- ]friendly|best value|value for money)\b"
RATING_RE = r"\b(top[- ]rated|best[- ]rated|highest[- ]rated|well[- ]reviewed|best reviewed|great reviews)\b"


def parse_budget(q: str) -> float | None:
    rng = re.search(r"between\s*\$?\s*(\d[\d,]*)\s*(?:and|-|to)\s*\$?\s*(\d[\d,]*)", q)
    if rng:
        return float(rng.group(2).replace(",", ""))
    patterns = [
        r"(?:under|below|less than|max(?:imum)?|up to|within|no more than|cheaper than|budget(?: of| is)?:?|<)\s*(?:\$|usd\s*)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\b",
        r"\$\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\b",
        r"(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*(?:dollars|usd|bucks)\b",
    ]
    for p in patterns:
        m = re.search(p, q)
        if m:
            n = float(m.group(1).replace(",", ""))
            if m.group(2):
                n *= 1000
            if n > 0:
                return n
    return None


def parse_intent_rules(query: str, index: CatalogIndex) -> Intent:
    q = query.lower()
    best: tuple[int, str] | None = None
    for slug, pat in CATEGORY_PATTERNS:
        m = re.search(pat, q)
        if m and (best is None or m.start() < best[0]):
            best = (m.start(), slug)
    cat = index.by_slug.get(best[1]) if best else None
    reqs: list[Req] = []

    def add(r: Req | None) -> None:
        if r and not any(x["id"] == r["id"] for x in reqs):
            reqs.append(r)

    if cat:
        def d(key: str) -> dict[str, Any] | None:
            return spec_def(cat, key)

        def boolean(key: str, val: bool = True, kind: str = "must") -> Req | None:
            dd = d(key)
            return spec_req(dd, kind, equals=val) if dd else None

        def text(key: str, val: str) -> Req | None:
            dd = d(key)
            return spec_req(dd, "must", equals=val) if dd else None

        def minimum(key: str, n: float) -> Req | None:
            dd = d(key)
            return spec_req(dd, "must", minimum=n) if dd else None

        def direction(keys: list[str], way: str) -> Req | None:
            for k in keys:
                dd = d(k)
                if dd:
                    return spec_req(dd, "prefer", direction=way)
            return None

        rules: list[tuple[str, Any]] = [
            (r"\bwired\b", lambda m: boolean("wireless", False)),
            (r"\b(wireless|bluetooth|cordless)\b", lambda m: boolean("wireless")),
            (r"\b(ear ?buds?|in[- ]ear|buds)\b", lambda m: text("form", "In-ear")),
            (r"\bover[- ]ear\b", lambda m: text("form", "Over-ear")),
            (r"\bon[- ]ear\b", lambda m: text("form", "On-ear")),
            (r"noise[- ]?cancel|\banc\b", lambda m: boolean("anc")),
            (r"\bmechanical\b", lambda m: boolean("mechanical")),
            (r"hot[- ]?swap", lambda m: boolean("hotSwap")),
            (r"\b(4k|uhd|2160p?)\b", lambda m: text("resolution", "3840×2160")),
            (r"\b(1440p|qhd)\b", lambda m: text("resolution", "2560×1440")),
            (r"\boled\b", lambda m: text("panel", "OLED")),
            (r"\b(\d{2,3})\s?hz\b", lambda m: minimum("refreshHz", float(m.group(1)))),
            (r"usb[- ]?c", lambda m: minimum("usbCWatts", 1)),
            (r"\bgps\b", lambda m: boolean("gps")),
            (r"tap[- ]to[- ]pay|\bnfc\b|contactless", lambda m: boolean("nfcPay")),
            (r"\b(\d{1,2})\s?gb\b", lambda m: minimum("ramGb", float(m.group(1)))),
            (r"\b(mic|microphone|calls?)\b", lambda m: boolean("mic", True, "prefer")),
            (r"\brgb\b", lambda m: boolean("rgb", True, "prefer")),
            (r"battery|all[- ]day|long[- ]lasting", lambda m: direction(["batteryDays", "batteryHours"], "higher")),
            (r"\b(light|lightweight|lighter|portable|ultralight|featherweight)\b", lambda m: direction(["weightKg", "weightG"], "lower")),
            (r"high[- ]refresh|smooth|fast refresh", lambda m: direction(["refreshHz"], "higher")),
        ]
        for pat, build in rules:
            m = re.search(pat, q)
            if m:
                add(build(m))
        tags = index.tags.get(cat["slug"], set())
        for pat, tag in TAG_PATTERNS:
            if tag in tags and re.search(pat, q):
                add(tag_req(tag))

    emphasis = {"value": bool(re.search(VALUE_RE, q)), "rating": bool(re.search(RATING_RE, q))}
    return _finish_intent(cat, parse_budget(q), reqs, emphasis)


def must_clause(reqs: list[Req], base: bool = False) -> str:
    """'is wireless and has noise cancelling' (or 'be … and have …' with base verbs)."""
    is_ = [lower_first(r["label"]) for r in reqs if r.get("verb") == "is"]
    has = [lower_first(r["label"]) for r in reqs if r.get("verb") != "is"]
    parts = []
    if is_:
        parts.append(f"{'be' if base else 'is'} {join_list(is_)}")
    if has:
        parts.append(f"{'have' if base else 'has'} {join_list(has)}")
    return " and ".join(parts)


def summarize_intent(intent: Intent, category: Category | None) -> str:
    if not category:
        return "Product type not recognised"
    parts = [category["name"]]
    if intent["maxPrice"] is not None:
        parts.append(f"under {fmt_budget(intent['maxPrice'])}")
    musts = [r for r in intent["requirements"] if r["kind"] == "must"]
    prefs = [lower_first(r["label"]) for r in intent["requirements"] if r["kind"] == "prefer"]
    if musts:
        parts.append(f"must {must_clause(musts, base=True)}")
    if prefs:
        parts.append(f"prefers {join_list(prefs)}")
    return " · ".join(parts)


# --------------------------------------------------------------------------- #
# Search + budget
# --------------------------------------------------------------------------- #


def meets(p: Product, r: Req) -> bool:
    if r.get("tag"):
        return r["tag"] in p["tags"]
    spec = r.get("spec")
    if not spec:
        return True
    v = p["specs"].get(spec)
    if "equals" in r:
        return v == r["equals"]
    if "min" in r:
        return isinstance(v, (int, float)) and not isinstance(v, bool) and v >= r["min"]
    return True


def split_budget(matched: list[Product], intent: Intent) -> tuple[list[Product], list[Product]]:
    mp = intent["maxPrice"]
    if mp is None:
        return matched, []
    return [p for p in matched if p["price"] <= mp], sorted([p for p in matched if p["price"] > mp], key=lambda p: p["price"])


# --------------------------------------------------------------------------- #
# Comparison: transparent scoring
# --------------------------------------------------------------------------- #

DEFAULT_WEIGHTS = {"value": 0.25, "rating": 0.3, "fit": 0.25, "specs": 0.2}


def weights_for(intent: Intent) -> dict[str, float]:
    if intent["emphasis"]["value"]:
        return {"value": 0.4, "rating": 0.25, "fit": 0.2, "specs": 0.15}
    if intent["emphasis"]["rating"]:
        return {"value": 0.2, "rating": 0.45, "fit": 0.2, "specs": 0.15}
    return dict(DEFAULT_WEIGHTS)


def directional_keys(intent: Intent, category: Category) -> list[tuple[str, str]]:
    from_prefs = [(r["spec"], r["direction"]) for r in intent["requirements"] if r.get("direction") and r.get("spec")]
    if from_prefs:
        return from_prefs
    out = []
    for key in category.get("keySpecs", []):
        d = spec_def(category, key)
        if d and d.get("better"):
            out.append((key, d["better"]))
    return out


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _clamp(n: float, lo: float = 0, hi: float = 100) -> float:
    return max(lo, min(hi, n))


def _round_smart(n: float) -> float:
    return round(n, 1) if abs(n) < 10 else round(n)


def _js_round(n: float) -> int:
    """Round half up like JavaScript's Math.round, so scores match the demo engine."""
    return math.floor(n + 0.5)


def _spec_scores(products: list[Product], keys: list[tuple[str, str]]) -> dict[str, float]:
    out = {p["id"]: (0.0 if keys else 70.0) for p in products}
    for key, way in keys:
        vals = [v for v in (_num(p["specs"].get(key)) for p in products) if v is not None]
        lo, hi = (min(vals), max(vals)) if vals else (0.0, 0.0)
        for p in products:
            v = _num(p["specs"].get(key))
            norm = 0.0
            if v is not None:
                norm = 1.0 if hi == lo else ((v - lo) / (hi - lo) if way == "higher" else (hi - v) / (hi - lo))
            out[p["id"]] += (40 + 60 * norm) / len(keys)
    return out


def score_all(products: list[Product], intent: Intent, category: Category, weights: dict[str, float]) -> list[dict[str, Any]]:
    if not products:
        return []
    keys = directional_keys(intent, category)
    spec_map = _spec_scores(products, keys)
    prices = sorted(p["price"] for p in products)
    ref = intent["maxPrice"] if intent["maxPrice"] is not None else prices[len(prices) // 2] * 1.25
    prefs = [r for r in intent["requirements"] if r["kind"] == "prefer" and not r.get("direction")]
    scored = []
    for p in products:
        value = _clamp(100 - (p["price"] / ref) * 50)
        rating = _clamp(((p["rating"] - 3) / 2) * 100) * (0.85 + 0.15 * min(1, p["reviewCount"] / 2000))
        fit = (sum(1 for r in prefs if meets(p, r)) / len(prefs)) * 100 if prefs else 100
        specs = spec_map.get(p["id"], 70)
        total = value * weights["value"] + rating * weights["rating"] + fit * weights["fit"] + specs * weights["specs"]
        scored.append(
            {
                "product": p,
                "score": _js_round(total),
                "breakdown": {"value": _js_round(value), "rating": _js_round(rating), "fit": _js_round(fit), "specs": _js_round(specs)},
            }
        )
    return sorted(scored, key=lambda s: (-s["score"], s["product"]["price"]))


# --------------------------------------------------------------------------- #
# Explainer helpers
# --------------------------------------------------------------------------- #


def _best_phrase(d: dict[str, Any]) -> str:
    k = d["key"]
    if k.startswith("battery"):
        return "Longest battery"
    if k.startswith("weight"):
        return "Lightest"
    if k == "refreshHz":
        return "Highest refresh rate"
    if k == "responseMs":
        return "Fastest response"
    if k == "ramGb":
        return "Most memory"
    return f"Best {lower_first(d['label'])}"


def _spec_clause(d: dict[str, Any], v: Any) -> str:
    val = fmt_spec(d, v)
    k = d["key"]
    if k.startswith("battery"):
        return f"lasts {val} on a charge"
    if k.startswith("weight"):
        return f"weighs just {val}"
    if k == "refreshHz":
        return f"runs at {val}"
    if k == "responseMs":
        return f"responds in {val}"
    if k == "ramGb":
        return f"has {val} of memory"
    return f"has {lower_first(d['label'])} of {val}"


def _better_clause(d: dict[str, Any], v: Any) -> str:
    val = fmt_spec(d, v)
    k = d["key"]
    if k.startswith("battery"):
        return f"lasts longer ({val})"
    if k.startswith("weight"):
        return f"is lighter ({val})"
    if k == "refreshHz":
        return f"is faster ({val})"
    return f"has a better {lower_first(d['label'])} ({val})"


def reasons_for(p: Product, pool: list[Product], intent: Intent, category: Category, keys: list[tuple[str, str]]) -> list[str]:
    out: list[str] = []
    musts = [r for r in intent["requirements"] if r["kind"] == "must"]
    if musts:
        out.append(capitalize(must_clause(musts)))
    for key, way in keys:
        d = spec_def(category, key)
        v = _num(p["specs"].get(key))
        if not d or v is None:
            continue
        vals = [x for x in (_num(o["specs"].get(key)) for o in pool) if x is not None]
        best = max(vals) if way == "higher" else min(vals)
        if len(vals) > 1 and all(x == vals[0] for x in vals):
            out.append(f"{d['label']}: {fmt_spec(d, v)}, same as every match")
        elif len(vals) > 1 and v == best:
            out.append(f"{_best_phrase(d)} of your matches: {fmt_spec(d, v)}")
        elif len(vals) > 1:
            avg = sum(vals) / len(vals)
            out.append(f"{d['label']}: {fmt_spec(d, v)} (group average {fmt_spec(d, _round_smart(avg))})")
        else:
            out.append(f"{d['label']}: {fmt_spec(d, v)}")
    best_rating = max(o["rating"] for o in pool)
    if len(pool) > 1 and p["rating"] == best_rating:
        out.append(f"Top-rated match: {p['rating']:.1f}★ from {fmt_count(p['reviewCount'])} reviews")
    else:
        out.append(f"Rated {p['rating']:.1f}★ by {fmt_count(p['reviewCount'])} buyers")
    mp = intent["maxPrice"]
    if mp is not None and p["price"] <= mp:
        under = mp - p["price"]
        out.append(f"Right at your {fmt_budget(mp)} budget" if under < 1 else f"{fmt_price(under)} under your {fmt_budget(mp)} budget")
    elif len(pool) > 1 and p["price"] == min(o["price"] for o in pool):
        out.append("Lowest price of your matches")
    for r in intent["requirements"]:
        if r.get("tag") and r["tag"] in p["tags"] and r["tag"] in TAG_PRAISE:
            out.append(TAG_PRAISE[r["tag"]])
    return out[:5]


def compare_to(p: Product, top: Product, category: Category, keys: list[tuple[str, str]], intent: Intent) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    dp = p["price"] - top["price"]
    if dp <= -1:
        out.append({"tone": "pro", "text": f"{fmt_price(-dp)} cheaper"})
    elif dp >= 1:
        out.append({"tone": "con", "text": f"{fmt_price(dp)} more"})
    for key, way in keys:
        d = spec_def(category, key)
        a, b = _num(p["specs"].get(key)), _num(top["specs"].get(key))
        if not d or a is None or b is None or a == b:
            continue
        better = a > b if way == "higher" else a < b
        out.append({"tone": "pro" if better else "con", "text": f"{d['label']}: {fmt_spec(d, a)} vs {fmt_spec(d, b)}"})
    dr = round(p["rating"] - top["rating"], 1)
    if dr >= 0.1:
        out.append({"tone": "pro", "text": f"Higher rated: {p['rating']:.1f}★ vs {top['rating']:.1f}★"})
    elif dr <= -0.1:
        out.append({"tone": "con", "text": f"Lower rated: {p['rating']:.1f}★ vs {top['rating']:.1f}★"})
    must_specs = {r.get("spec") for r in intent["requirements"] if r["kind"] == "must"}
    diffs = 0
    for d in category["specs"]:
        if d["type"] != "bool" or d["key"] in must_specs or diffs >= 2:
            continue
        a, b = p["specs"].get(d["key"]), top["specs"].get(d["key"])
        if not isinstance(a, bool) or not isinstance(b, bool) or a == b:
            continue
        out.append({"tone": "pro", "text": f"Adds {lower_first(d['label'])}"} if a else {"tone": "con", "text": f"No {lower_first(d['label'])}"})
        diffs += 1
    return out[:4]


def top_caveats(top: Product, alts: list[Product], category: Category, keys: list[tuple[str, str]]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    cheaper = sorted([a for a in alts if top["price"] - a["price"] >= 5], key=lambda a: a["price"])
    if cheaper:
        out.append({"tone": "con", "text": f"{cheaper[0]['name']} is {fmt_price(top['price'] - cheaper[0]['price'])} cheaper"})
    for key, way in keys:
        d = spec_def(category, key)
        t = _num(top["specs"].get(key))
        if not d or t is None:
            continue
        beat = next((a for a in alts if (v := _num(a["specs"].get(key))) is not None and (v > t if way == "higher" else v < t)), None)
        if beat:
            out.append({"tone": "con", "text": f"{d['label']} trails {beat['name']} ({fmt_spec(d, t)} vs {fmt_spec(d, beat['specs'].get(key))})"})
    return out[:2]


def template_summary(top: dict[str, Any], alts: list[dict[str, Any]], intent: Intent, category: Category, keys: list[tuple[str, str]]) -> str:
    p = top["product"]
    clauses = []
    musts = [r for r in intent["requirements"] if r["kind"] == "must"]
    if musts:
        clauses.append(must_clause(musts))
    d = spec_def(category, keys[0][0]) if keys else None
    if d and _num(p["specs"].get(d["key"])) is not None:
        clauses.append(_spec_clause(d, p["specs"][d["key"]]))
    clauses.append(f"is rated {p['rating']:.1f}★ by {fmt_count(p['reviewCount'])} buyers")
    s = f"{p['name']} is my pick: it {join_list(clauses)}."
    mp = intent["maxPrice"]
    if mp is not None and p["price"] <= mp and mp - p["price"] >= 1:
        s += f" At {fmt_price(p['price'])}, it comes in {fmt_price(mp - p['price'])} under your budget."
    cheaper = sorted([a for a in alts if a["product"]["price"] < p["price"] - 1], key=lambda a: a["product"]["price"])
    cheap = cheaper[0] if cheaper else None
    if cheap:
        s += f" If you'd rather save, {cheap['product']['name']} costs {fmt_price(cheap['product']['price'])}."
    if d and keys:
        t = _num(p["specs"].get(d["key"]))
        way = keys[0][1]
        better = next(
            (a for a in alts if (v := _num(a["product"]["specs"].get(d["key"]))) is not None and t is not None and (v > t if way == "higher" else v < t)),
            None,
        )
        if better and better is not cheap:
            s += f" {better['product']['name']} {_better_clause(d, better['product']['specs'][d['key']])} but scores lower overall."
    return s


# --------------------------------------------------------------------------- #
# Refinements
# --------------------------------------------------------------------------- #

EXAMPLE_BUDGETS = {"headphones": 100, "mice": 50, "keyboards": 80, "monitors": 300, "smartwatches": 200, "laptops": 800}


def build_query(intent: Intent, category: Category, *, max_price: Any = "keep", add_phrase: str | None = None, drop: str | None = None, rating: bool | None = None) -> str:
    reqs = [r for r in intent["requirements"] if r["id"] != drop]
    musts = [r["phrase"] for r in reqs if r["kind"] == "must"]
    prefs = [r["phrase"] for r in reqs if r["kind"] == "prefer"]
    if add_phrase:
        prefs.append(add_phrase)
    use_rating = intent["emphasis"]["rating"] if rating is None else rating
    lead = " ".join(x for x in ["top rated" if use_rating else "", "affordable" if intent["emphasis"]["value"] else "", *musts, category["singular"]] if x)
    budget = intent["maxPrice"] if max_price == "keep" else max_price
    q = lead
    if budget:
        q += f" under {fmt_budget(budget)}"
    if prefs:
        q += ", " + ", ".join(prefs)
    return q


def refinements_for(intent: Intent, category: Category, recs: list[dict[str, Any]], near: list[dict[str, Any]]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    top = recs[0]["product"] if recs else None
    if top:
        target = math.floor((top["price"] - 1) / 5) * 5
        if target >= 5:
            out.append({"kind": "cheaper", "label": f"Cheaper, under {fmt_budget(target)}", "query": build_query(intent, category, max_price=target)})
    if intent["maxPrice"] is not None and near:
        nb = math.ceil(near[0]["product"]["price"] / 10) * 10
        out.append({"kind": "budget", "label": f"Raise budget to {fmt_budget(nb)}", "query": build_query(intent, category, max_price=nb)})
    keys_present = {r.get("spec") for r in intent["requirements"] if r.get("direction")}
    ideas = [
        (["batteryHours", "batteryDays"], "Longer battery", "long battery"),
        (["weightG", "weightKg"], "Lighter", "lightweight"),
        (["refreshHz"], "Higher refresh rate", "high refresh rate"),
    ]
    added = 0
    for keys, label, phrase in ideas:
        has_key = any(spec_def(category, k) for k in keys)
        if recs and has_key and not keys_present.intersection(keys) and added < 2:
            out.append({"kind": "spec", "label": label, "query": build_query(intent, category, add_phrase=phrase)})
            added += 1
    if not recs:
        for r in [x for x in intent["requirements"] if x["kind"] == "must"][:2]:
            out.append({"kind": "spec", "label": f"Without “{lower_first(r['label'])}”", "query": build_query(intent, category, drop=r["id"])})
    if not intent["emphasis"]["rating"] and recs:
        out.append({"kind": "rating", "label": "Favor top rated", "query": build_query(intent, category, rating=True)})
    return out[:5]


def category_examples(categories: list[Category]) -> list[dict[str, str]]:
    return [
        {
            "kind": "category",
            "label": f"{c['name']} under {fmt_budget(EXAMPLE_BUDGETS.get(c['slug'], 100))}",
            "query": f"{c['singular']} under {fmt_budget(EXAMPLE_BUDGETS.get(c['slug'], 100))}",
        }
        for c in categories
    ]


# --------------------------------------------------------------------------- #
# Result assembly
# --------------------------------------------------------------------------- #


def build_result(
    mission_id: str,
    query: str,
    intent: Intent,
    category: Category | None,
    categories: list[Category],
    in_category: int,
    matched: list[Product],
) -> dict[str, Any]:
    weights = weights_for(intent)
    base = {"missionId": mission_id, "query": query, "intent": intent, "category": category, "weights": weights}
    if not category:
        return {
            **base,
            "recommendations": [],
            "nearMisses": [],
            "summary": "",
            "notice": "I couldn't tell which kind of product you're after. Mention one, like headphones, a mouse, a keyboard, a monitor, a smartwatch or a laptop.",
            "refinements": category_examples(categories),
        }

    within, over = split_budget(matched, intent)
    keys = directional_keys(intent, category)
    top3 = score_all(within, intent, category, weights)[:3]
    recs = []
    for i, s in enumerate(top3):
        recs.append(
            {
                "rank": i + 1,
                "product": s["product"],
                "score": s["score"],
                "breakdown": s["breakdown"],
                "reasons": reasons_for(s["product"], within, intent, category, keys),
                "tradeoffs": top_caveats(s["product"], [x["product"] for x in top3[1:]], category, keys)
                if i == 0
                else compare_to(s["product"], top3[0]["product"], category, keys, intent),
                "overBudget": False,
            }
        )

    near: list[dict[str, Any]] = []
    mp = intent["maxPrice"]
    if mp is not None and over:
        candidates = [p for p in over if p["price"] <= mp * 1.6] if within else over[:3]
        for i, s in enumerate(score_all(candidates, intent, category, weights)[: 1 if recs else 3]):
            near.append(
                {
                    "rank": i + 1,
                    "product": s["product"],
                    "score": s["score"],
                    "breakdown": s["breakdown"],
                    "reasons": reasons_for(s["product"], within + candidates, intent, category, keys),
                    "tradeoffs": compare_to(s["product"], recs[0]["product"], category, keys, intent) if recs else [],
                    "overBudget": True,
                }
            )

    notice = None
    musts = [lower_first(r["label"]) for r in intent["requirements"] if r["kind"] == "must"]
    if not matched:
        notice = f"None of the {in_category} {category['name'].lower()} in the catalog has all of these: {', '.join(musts)}. Try dropping one."
    elif not within and mp is not None:
        notice = f"Nothing that fits costs {fmt_budget(mp)} or less. The closest is {over[0]['name']} at {fmt_price(over[0]['price'])}."

    return {
        **base,
        "recommendations": recs,
        "nearMisses": near,
        "summary": template_summary(recs[0], recs[1:], intent, category, keys) if recs else "",
        "notice": notice,
        "refinements": refinements_for(intent, category, recs, near),
    }


# --------------------------------------------------------------------------- #
# Agent "show your work" details for the UI
# --------------------------------------------------------------------------- #


def _clean_num(v: Any) -> Any:
    return int(v) if isinstance(v, float) and v.is_integer() else v


def _plan_item(r: Req) -> dict[str, Any]:
    if r.get("tag"):
        return {"tag": r["tag"]}
    if r.get("direction"):
        return {"spec": r["spec"], "direction": r["direction"]}
    if "min" in r:
        return {"spec": r["spec"], "min": _clean_num(r["min"])}
    return {"spec": r["spec"], "equals": r["equals"]}


def intent_plan_text(intent: Intent) -> str:
    """The validated intent as compact JSON: one requirement per line."""
    dump = lambda v: json.dumps(v, ensure_ascii=False)  # noqa: E731

    def arr(kind: str) -> str:
        items = [dump(_plan_item(r)) for r in intent["requirements"] if r["kind"] == kind]
        return "[]" if not items else "[\n    " + ",\n    ".join(items) + "\n  ]"

    return "\n".join(
        [
            "{",
            f'  "category": {dump(intent["category"])},',
            f'  "maxPrice": {dump(_clean_num(intent["maxPrice"]))},',
            f'  "must": {arr("must")},',
            f'  "prefer": {arr("prefer")},',
            f'  "emphasis": {dump(intent["emphasis"])}',
            "}",
        ]
    )


def sql_preview(slug: str, musts: list[Req]) -> str:
    """Readable version of the parameterised search query (for display only)."""
    q = lambda s: str(s).replace("'", "''")  # noqa: E731
    lines = ["select id, name, price, rating", "from products", f"where category = '{q(slug)}'"]
    for r in musts:
        if r.get("tag"):
            lines.append(f"  and '{q(r['tag'])}' = any(tags)")
        elif "equals" in r:
            lines.append(f"  and specs @> '{q(json.dumps({r['spec']: r['equals']}, ensure_ascii=False))}'")
        elif "min" in r:
            lines.append(f"  and (specs ->> '{q(r['spec'])}')::float8 >= {fmt_num(r['min'])}")
    lines.append("order by price;")
    return "\n".join(lines)


def _line(name: str, right: str, width: int = 26) -> str:
    name = name if len(name) <= width else name[: width - 1] + "…"
    return f"{name:<{width}} {right:>9}"


def budget_detail(within: list[Product], over: list[Product], max_price: float | None) -> str:
    if max_price is None:
        return "No budget given, so every match stays in.\n\n" + "\n".join(f"✓ {_line(p['name'], fmt_price(p['price']))}" for p in within)
    rows = [f"Budget: {fmt_budget(max_price)}", ""]
    rows += [f"✓ {_line(p['name'], fmt_price(p['price']))}" for p in within]
    rows += [f"✕ {_line(p['name'], fmt_price(p['price']))}  +{fmt_price(p['price'] - max_price)}" for p in over]
    return "\n".join(rows)


def compare_detail(result: dict[str, Any]) -> str:
    w = result["weights"]
    rows = ["Weights  " + " · ".join(f"{k} {round(v * 100)}%" for k, v in w.items()), ""]
    for r in result["recommendations"]:
        b = r["breakdown"]
        rows.append(f"#{r['rank']} {_line(r['product']['name'], str(r['score']), 24)}")
        rows.append(f"   value {b['value']} · rating {b['rating']} · fit {b['fit']} · specs {b['specs']}")
    if not result["recommendations"]:
        rows.append("Nothing within budget to rank.")
    return "\n".join(rows)


def explain_facts(result: dict[str, Any]) -> dict[str, Any]:
    """The only facts the Explainer Agent may use."""
    intent = result["intent"]
    recs = result["recommendations"]

    mp = intent["maxPrice"]

    def budget_note(price: float) -> str | None:
        """Pre-computed so the model never does price arithmetic."""
        if mp is None:
            return None
        diff = mp - price
        if abs(diff) < 0.005:
            return f"exactly your {fmt_budget(mp)} budget"
        if diff > 0:
            return f"{fmt_price(diff)} under your {fmt_budget(mp)} budget"
        return f"{fmt_price(-diff)} over your {fmt_budget(mp)} budget"

    def brief(r: dict[str, Any]) -> dict[str, Any]:
        p = r["product"]
        item = {
            "name": p["name"],
            "price": fmt_price(p["price"]),
            "budgetNote": budget_note(p["price"]),
            "rating": f"{p['rating']:.1f}★ from {fmt_count(p['reviewCount'])} reviews",
            "reasons": r["reasons"],
            "versusTopPick" if r["rank"] > 1 else "caveats": [t["text"] for t in r["tradeoffs"]],
        }
        return {k: v for k, v in item.items() if v is not None}

    facts: dict[str, Any] = {
        "shopperRequest": result["query"],
        "understood": intent["summary"],
        "budget": fmt_budget(intent["maxPrice"]) if intent["maxPrice"] is not None else None,
        "topPick": brief(recs[0]),
        "alternatives": [brief(r) for r in recs[1:]],
    }
    if result["nearMisses"]:
        n = result["nearMisses"][0]["product"]
        facts["justOverBudget"] = {
            "name": n["name"],
            "price": fmt_price(n["price"]),
            "budgetNote": budget_note(n["price"]),
            "rating": f"{n['rating']:.1f}★",
        }
    return facts
