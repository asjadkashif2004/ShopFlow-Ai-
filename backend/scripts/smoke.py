"""Smoke test against a running backend: python backend/scripts/smoke.py [base_url] [query ...]"""

from __future__ import annotations

import json
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].startswith("http") else "http://localhost:7860"
QUERIES = [a for a in sys.argv[1:] if not a.startswith("http")] or [
    "Wireless headphones under $100 with noise cancelling and good battery life",
    "Gaming mouse under $50",
    "Smartwatch with GPS for running under $200",
    "Lightweight laptop for students under $800",
]


def mission(query: str) -> dict:
    req = urllib.request.Request(
        f"{BASE}/api/missions",
        data=json.dumps({"query": query}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    out: dict = {"steps": []}
    with urllib.request.urlopen(req, timeout=60) as resp:
        for raw in resp:
            line = raw.decode("utf-8").strip()
            if not line.startswith("data:"):
                continue
            e = json.loads(line[5:])
            if e["type"] == "agent_completed":
                out["steps"].append(f"{e['agent']} {e['durationMs']}ms {e.get('engine', '')}".strip())
            elif e["type"] == "result":
                out["result"] = e["result"]
            elif e["type"] == "mission_completed":
                out["total"] = e["durationMs"]
            elif e["type"] == "error":
                out["error"] = e["message"]
    return out


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    for q in QUERIES:
        m = mission(q)
        r = m.get("result") or {}
        print(f"\n{q}\n  {m.get('total')}ms · " + " · ".join(m["steps"]))
        print("  picks:", [(x["product"]["name"], x["score"]) for x in r.get("recommendations", [])])
        print("  summary:", r.get("summary") or r.get("notice") or m.get("error"))
