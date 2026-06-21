#!/usr/bin/env python3
"""
SRE Agent Eval Framework
Runs scenarios against the deployed agent and measures RCA accuracy and MTTR.

Usage:
    python evals/run_eval.py --env staging --scenarios evals/scenarios/
    python evals/run_eval.py --scenario evals/scenarios/sample-incident-001.json
"""

import argparse
import json
import os
import time
from pathlib import Path
from typing import Any
import urllib.request
import urllib.parse


def load_scenarios(path: str) -> list[dict[str, Any]]:
    p = Path(path)
    if p.is_file():
        with open(p) as f:
            return [json.load(f)]
    return [json.loads(f.read_text()) for f in sorted(p.glob("*.json"))]


def send_incident(base_url: str, scenario: dict[str, Any], api_key: str) -> dict[str, Any]:
    """Send a mock incident via the webhook endpoint and return the result."""
    payload = json.dumps(scenario["input"]).encode()
    req = urllib.request.Request(
        f"{base_url}/webhook/eval",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-Eval-API-Key": api_key,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def score_rca(predicted: dict[str, Any], ground_truth: dict[str, Any]) -> float:
    """Simple keyword-overlap F1 score for RCA evaluation."""
    pred_text = (
        predicted.get("title", "") + " " + predicted.get("description", "")
    ).lower()
    keywords = ground_truth.get("rca_keywords", [])
    if not keywords:
        return 0.0
    hits = sum(1 for kw in keywords if kw.lower() in pred_text)
    precision = hits / max(len(pred_text.split()), 1)
    recall = hits / len(keywords)
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


def run_eval(base_url: str, scenarios: list[dict[str, Any]], api_key: str) -> None:
    results = []
    for scenario in scenarios:
        print(f"Running: {scenario['id']} — {scenario['scenario']}")
        start = time.time()
        try:
            response = send_incident(base_url, scenario, api_key)
            elapsed = time.time() - start
            rca = response.get("rca", {})
            f1 = score_rca(rca, scenario["ground_truth"])
            mttr = response.get("mttr_seconds", elapsed)
            results.append(
                {
                    "id": scenario["id"],
                    "f1": round(f1, 3),
                    "mttr_seconds": round(mttr),
                    "approval_required": response.get("approval_required", False),
                    "status": "pass" if f1 >= 0.6 else "fail",
                }
            )
            print(f"  F1={f1:.3f}  MTTR={mttr:.0f}s  status={results[-1]['status']}")
        except Exception as e:
            print(f"  ERROR: {e}")
            results.append({"id": scenario["id"], "status": "error", "error": str(e)})

    # Summary
    passed = sum(1 for r in results if r.get("status") == "pass")
    avg_f1 = sum(r.get("f1", 0) for r in results) / max(len(results), 1)
    avg_mttr = sum(r.get("mttr_seconds", 0) for r in results if "mttr_seconds" in r)
    avg_mttr /= max(sum(1 for r in results if "mttr_seconds" in r), 1)

    print(f"\n{'='*50}")
    print(f"Results: {passed}/{len(results)} passed")
    print(f"Avg RCA F1: {avg_f1:.3f}")
    print(f"Avg MTTR: {avg_mttr:.0f}s ({avg_mttr/60:.1f}min)")

    out_path = Path("evals/results") / f"eval_{int(time.time())}.json"
    out_path.write_text(json.dumps({"summary": {"passed": passed, "total": len(results), "avg_f1": avg_f1, "avg_mttr_seconds": avg_mttr}, "results": results}, indent=2))
    print(f"Results saved: {out_path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", default="staging", choices=["staging", "production"])
    parser.add_argument("--scenarios", default="evals/scenarios/")
    parser.add_argument("--scenario", default=None)
    args = parser.parse_args()

    base_url = os.environ.get(
        "AGENT_BASE_URL",
        f"https://cloudflare-sre-agent-{'staging' if args.env == 'staging' else 'prod'}.workers.dev",
    )
    api_key = os.environ.get("EVAL_API_KEY", "")
    if not api_key:
        raise SystemExit("EVAL_API_KEY environment variable is required")

    scenarios = load_scenarios(args.scenario or args.scenarios)
    print(f"Loaded {len(scenarios)} scenario(s) — target: {base_url}\n")
    run_eval(base_url, scenarios, api_key)


if __name__ == "__main__":
    main()
