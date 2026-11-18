"""Independent live StudioNet verifier for Cascade deploy/proof.json."""

import hashlib
import json
import sys
import time
from pathlib import Path
from typing import Any

import requests
from genlayer_py import create_account, create_client
from genlayer_py.chains import studionet
from genlayer_py.exceptions import GenLayerError
from genlayer_py.provider import GenLayerProvider

ROOT_DIR = Path(__file__).resolve().parent.parent
CONTRACT_PATH = ROOT_DIR / "contracts" / "cascade.py"
PROOF_PATH = ROOT_DIR / "deploy" / "proof.json"
FRONTEND_PROOF_PATH = ROOT_DIR / "frontend" / "src" / "data" / "proof.json"

RPC_URL = "https://studio.genlayer.com/api"
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def patch_provider_user_agent() -> None:
    def _make_request(self, method, params):
        payload = {
            "jsonrpc": "2.0",
            "id": int(time.time() * 1000),
            "method": method,
            "params": params,
        }
        for attempt in range(4):
            try:
                response = requests.post(
                    self.url,
                    json=payload,
                    headers={"Content-Type": "application/json", "User-Agent": BROWSER_UA},
                    timeout=30,
                )
            except requests.exceptions.RequestException as err:
                if attempt == 3:
                    raise GenLayerError(f"Request to {self.url} failed: {err}") from err
                time.sleep(3 * (attempt + 1))
                continue
            if response.status_code == 429:
                time.sleep(8 * (attempt + 1))
                continue
            resp = response.json()
            self._raise_on_error(resp, method)
            return resp
        raise GenLayerError(f"{method} failed after retries")

    GenLayerProvider.make_request = _make_request


def unwrap_json(val: Any) -> Any:
    if isinstance(val, str):
        return json.loads(val)
    return val


def verify_tx_finalized(client, tx_hash: str, label: str) -> None:
    tx = client.get_transaction(transaction_hash=tx_hash)
    tx_dict = tx if isinstance(tx, dict) else dict(tx)
    status = str(tx_dict.get("status", "")).upper()
    if status not in ("FINALIZED", "7"):
        raise AssertionError(f"Tx [{label}] {tx_hash} status is {status}, expected FINALIZED (7)")
    lr = (tx_dict.get("consensus_data") or {}).get("leader_receipt") or []
    if not lr or lr[0].get("execution_result") != "SUCCESS":
        raise AssertionError(f"Tx [{label}] {tx_hash} execution_result != SUCCESS")
    print(f"  [OK] tx {label}: {tx_hash} (FINALIZED / SUCCESS)", flush=True)


def main() -> int:
    patch_provider_user_agent()

    if not PROOF_PATH.exists():
        print(f"ERROR: {PROOF_PATH} not found", file=sys.stderr)
        return 1

    proof_text = PROOF_PATH.read_text(encoding="utf-8")
    for forbidden in ("private_key", "deployer_key", "auditor_key", "upstream_ben_key", "downstream_ben_key"):
        if forbidden in proof_text:
            print(f"ERROR: Private key material ({forbidden}) detected in proof.json!", file=sys.stderr)
            return 1

    if not FRONTEND_PROOF_PATH.exists() or FRONTEND_PROOF_PATH.read_text(encoding="utf-8") != proof_text:
        print("ERROR: frontend/src/data/proof.json is missing or differs from deploy/proof.json", file=sys.stderr)
        return 1

    proof = json.loads(proof_text)
    expected_sha = hashlib.sha256(CONTRACT_PATH.read_text(encoding="utf-8").encode("utf-8")).hexdigest()
    assert proof["contract_source_sha256"] == expected_sha, (
        f"Source SHA mismatch: {proof['contract_source_sha256']} != {expected_sha}"
    )
    print(f"[OK] contract_source_sha256 matches ({expected_sha[:16]}...)", flush=True)

    assert len(proof["cases"]) == 7, f"Expected 7 cases in proof.json, got {len(proof['cases'])}"
    exhibit_codes = [c["exhibit_code"] for c in proof["cases"]]
    assert exhibit_codes == ["EX-01", "EX-02", "EX-03", "EX-04", "EX-05", "EX-06", "EX-07"]

    contract_addr = proof["contract_address"]
    client = create_client(chain=studionet, endpoint=RPC_URL, account=create_account())

    ctxs = proof["case_txs"]
    tx_checks = [
        ("deploy_tx", proof["deploy_tx"]),
        ("case_1_too_vague_rejection", ctxs["case_1_too_vague_rejection"]),
        ("case_2_pool_1", ctxs["case_2_pool_1"]),
        ("case_2_pool_2", ctxs["case_2_pool_2"]),
        ("case_2_pool_3", ctxs["case_2_pool_3"]),
        ("case_2_pool_4", ctxs["case_2_pool_4"]),
        ("case_3_upstream_at_fault", ctxs["case_3_upstream_at_fault"]),
        ("case_4_downstream_at_fault", ctxs["case_4_downstream_at_fault"]),
        ("case_5_insufficient_unrelated", ctxs["case_5_insufficient_unrelated"]),
        ("case_6_insufficient_injection", ctxs["case_6_insufficient_injection"]),
        ("case_7_settle_expired_pool4", ctxs["case_7_settle_expired_pool4"]),
        ("case_7_withdraw_auditor", ctxs["case_7_withdraw_auditor"]),
        ("case_7_withdraw_downstream", ctxs["case_7_withdraw_downstream"]),
        ("case_7_withdraw_upstream", ctxs["case_7_withdraw_upstream"]),
        ("case_7_withdraw_deployer", ctxs["case_7_withdraw_deployer"]),
    ]
    print("Verifying all 15 finalized transactions on StudioNet...", flush=True)
    for label, tx_hash in tx_checks:
        verify_tx_finalized(client, tx_hash, label)

    print("Verifying live contract state on StudioNet...", flush=True)
    stats = unwrap_json(client.read_contract(address=contract_addr, function_name="get_protocol_stats", args=[]))
    pools = unwrap_json(client.read_contract(address=contract_addr, function_name="get_all_pools", args=[]))
    audits = unwrap_json(client.read_contract(address=contract_addr, function_name="get_all_audits", args=[]))
    rejections = unwrap_json(client.read_contract(address=contract_addr, function_name="get_rejected_submissions", args=[]))

    for role_key in ("auditor_address", "deployer_address", "upstream_beneficiary_address", "downstream_beneficiary_address"):
        bal = unwrap_json(client.read_contract(address=contract_addr, function_name="get_refundable_balance", args=[proof[role_key]]))
        assert int(bal["refundable_wei"]) == 0, f"{role_key} refundable balance not 0: {bal}"

    assert int(stats["total_pools"]) == 4, f"Expected 4 pools, got {stats}"
    assert int(stats["open_pools"]) == 1, f"Expected 1 open pool (Pool #3), got {stats}"
    assert int(stats["settled_upstream_pools"]) == 1
    assert int(stats["settled_downstream_pools"]) == 1
    assert int(stats["expired_pools"]) == 1
    assert int(stats["total_audits"]) == 4
    assert int(stats["total_rejections"]) >= 1
    assert int(stats["total_locked_wei"]) == 1_000_000_000_000_000  # Pool #3 remains OPEN (0.001 GEN)
    assert int(stats["total_withdrawn_wei"]) > 0

    by_pool = {int(p["pool_id"]): p for p in pools}
    assert by_pool[1]["status"] == "SETTLED_UPSTREAM_FAULT"
    assert by_pool[2]["status"] == "SETTLED_DOWNSTREAM_FAULT"
    assert by_pool[3]["status"] == "OPEN" and int(by_pool[3]["audit_attempts"]) == 2
    assert by_pool[4]["status"] == "EXPIRED_REFUNDED"

    # Verify full snippet_excerpt SHA-256 matches snippet_sha256 for every audit!
    for a in audits:
        excerpt_sha = hashlib.sha256(a["snippet_excerpt"].encode("utf-8")).hexdigest()
        assert excerpt_sha == a["snippet_sha256"], f"Audit {a['audit_id']} excerpt SHA mismatch!"

    verdicts = [(int(a["pool_id"]), a["verdict"], a["reason_code"]) for a in audits]
    assert (1, "UPSTREAM_AT_FAULT", "UPSTREAM_CONFIG_OR_ROUTING_DEFECT") in verdicts, f"Missing Case 3 in {verdicts}"
    assert any(
        p == 2
        and v == "DOWNSTREAM_AT_FAULT"
        and r in ("DOWNSTREAM_DEPENDENCY_FAILURE", "DOWNSTREAM_STORAGE_OR_DB_OUTAGE", "DOWNSTREAM_NETWORK_DROP")
        for p, v, r in verdicts
    ), f"Missing Case 4 in {verdicts}"
    assert any(p == 3 and v == "INSUFFICIENT_TRACE" for p, v, _ in verdicts), f"Missing Case 5/6 in {verdicts}"
    assert any(p == 3 and v == "INSUFFICIENT_TRACE" and r == "ADVERSARIAL_INJECTION_IGNORED" for p, v, r in verdicts), (
        f"Missing Case 6 ADVERSARIAL_INJECTION_IGNORED in {verdicts}"
    )
    assert any(r["kind"] == "GATE1_TOO_VAGUE" for r in rejections), f"Missing Case 1 rejection in {rejections}"

    print("[OK] All 7 Cascade live cases, 15 finalized txs, full snippet SHA-256s, and zero post-withdrawal balances verified!", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
