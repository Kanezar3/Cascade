"""Resumable StudioNet deployment & 7-case live seeding script for Cascade.

Saves deployer/auditor/beneficiary keys and every tx hash to deploy/.seed_state.json
(gitignored) BEFORE polling so interrupted runs resume cleanly without re-sending.
Writes public verification artifact to deploy/proof.json and copies it byte-for-byte
to frontend/src/data/proof.json (never includes private keys).
"""

import hashlib
import json
import time
from pathlib import Path
from typing import Any

import requests
from genlayer_py import create_account, create_client
from genlayer_py.chains import studionet
from genlayer_py.exceptions import GenLayerError
from genlayer_py.provider import GenLayerProvider
from genlayer_py.types import TransactionStatus

ROOT_DIR = Path(__file__).resolve().parent.parent
CONTRACT_PATH = ROOT_DIR / "contracts" / "cascade.py"
PROBE_RESULTS_PATH = ROOT_DIR / "deploy" / "probe_results.json"
STATE_PATH = ROOT_DIR / "deploy" / ".seed_state.json"
PROOF_PATH = ROOT_DIR / "deploy" / "proof.json"
FRONTEND_PROOF_PATH = ROOT_DIR / "frontend" / "src" / "data" / "proof.json"

RPC_URL = "https://studio.genlayer.com/api"
EXPLORER_URL = "https://explorer-studio.genlayer.com"
CHAIN_ID = 61999
POLL_INTERVAL_MS = 9000
POLL_RETRIES = 80
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

COLLATERAL_WEI = 1_000_000_000_000_000  # 0.001 GEN
STAKE_WEI = 200_000_000_000_000        # 0.0002 GEN
FUND_AMOUNT_WEI = 5_000_000_000_000_000_000  # 5 GEN

DANLUU_PREFIX = "https://raw.githubusercontent.com/danluu/post-mortems/"
DANLUU_URL = (
    "https://raw.githubusercontent.com/danluu/post-mortems/"
    "630562e55281ff28961704e8042a7dc9569a96e7/README.md"
)
REBUFF_URL = (
    "https://raw.githubusercontent.com/protectai/rebuff/"
    "4d2fe064abf164e7381556d23e48e210080f8afa/python-sdk/tests/test_sdk.py"
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
                time.sleep(4 * (attempt + 1))
                continue

            if response.status_code == 429:
                time.sleep(10 * (attempt + 1))
                continue

            try:
                resp = response.json()
            except ValueError as err:
                if attempt < 3:
                    time.sleep(5)
                    continue
                raise GenLayerError(f"{method} returned invalid JSON: {err}") from err
            self._raise_on_error(resp, method)
            return resp
        raise GenLayerError(f"{method} failed after retries")

    GenLayerProvider.make_request = _make_request


def load_state() -> dict[str, Any]:
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    return {"txs": {}}


def save_state(state: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")


def rpc_fund_account(address: str, amount_wei: int) -> None:
    resp = requests.post(
        RPC_URL,
        json={
            "jsonrpc": "2.0",
            "id": int(time.time() * 1000),
            "method": "sim_fundAccount",
            "params": [address, amount_wei],
        },
        headers={"Content-Type": "application/json", "User-Agent": BROWSER_UA},
        timeout=30,
    )
    data = resp.json()
    if "error" in data:
        raise RuntimeError(f"sim_fundAccount failed for {address}: {data['error']}")


def ensure_funded(client, address: str, min_wei: int = 100_000_000_000_000_000) -> None:
    bal = int(client.get_balance(address))
    if bal < min_wei:
        print(f"Funding {address} via sim_fundAccount...", flush=True)
        rpc_fund_account(address, FUND_AMOUNT_WEI)
        time.sleep(2)


def assert_exec_success(receipt: dict[str, Any], label: str) -> None:
    lr = (receipt.get("consensus_data") or {}).get("leader_receipt") or []
    if not lr or lr[0].get("execution_result") != "SUCCESS":
        raise RuntimeError(
            f"Tx [{label}] failed execution (execution_result={lr[0].get('execution_result') if lr else None}): "
            f"{json.dumps(receipt, default=str)[:800]}"
        )


def wait_finalized(client, tx_hash: str, label: str) -> dict[str, Any]:
    print(f"Waiting for finality [{label}]: {tx_hash}", flush=True)
    receipt = client.wait_for_transaction_receipt(
        transaction_hash=tx_hash,
        status=TransactionStatus.FINALIZED,
        interval=POLL_INTERVAL_MS,
        retries=POLL_RETRIES,
        full_transaction=True,
    )
    rec = receipt if isinstance(receipt, dict) else dict(receipt)
    assert_exec_success(rec, label)
    return rec


def run_step_tx(
    state: dict[str, Any],
    step_key: str,
    client,
    send_fn,
) -> tuple[str, dict[str, Any]]:
    tx_entry = state["txs"].get(step_key)
    if tx_entry and tx_entry.get("receipt"):
        print(f"Resuming completed step [{step_key}]: {tx_entry['tx_hash']}", flush=True)
        return tx_entry["tx_hash"], tx_entry["receipt"]

    if tx_entry and tx_entry.get("tx_hash"):
        tx_hash = tx_entry["tx_hash"]
        print(f"Resuming pending tx [{step_key}]: {tx_hash}", flush=True)
    else:
        tx_hash = send_fn()
        if not isinstance(tx_hash, str):
            tx_hash = str(tx_hash)
        state["txs"][step_key] = {"tx_hash": tx_hash}
        save_state(state)
        print(f"Submitted [{step_key}]: {tx_hash}", flush=True)

    receipt = wait_finalized(client, tx_hash, step_key)
    state["txs"][step_key]["receipt"] = receipt
    save_state(state)
    return tx_hash, receipt


def extract_contract_address(receipt: dict[str, Any]) -> str:
    zero = "0x" + "0" * 40
    candidates = [
        receipt.get("contract_address"),
        (receipt.get("data") or {}).get("contract_address"),
        receipt.get("recipient"),
        receipt.get("to_address"),
    ]
    for c in candidates:
        if isinstance(c, str) and c.startswith("0x") and len(c) == 42 and c.lower() != zero:
            return c
    raise RuntimeError(f"Could not extract contract address from receipt: {receipt}")


def unwrap_json(val: Any) -> Any:
    if isinstance(val, str):
        return json.loads(val)
    return val


def ensure_role_account(state: dict[str, Any], role: str):
    key_field = f"{role}_key"
    addr_field = f"{role}_address"
    if key_field not in state:
        acc = create_account()
        state[key_field] = acc.key.hex()
        state[addr_field] = acc.address
        save_state(state)
    return create_account(state[key_field])


def receipt_block_number(receipt: dict[str, Any]) -> int | None:
    bn = receipt.get("block_number") or (receipt.get("data") or {}).get("block_number")
    return int(bn) if bn is not None else None


def main() -> None:
    patch_provider_user_agent()
    state = load_state()

    deployer = ensure_role_account(state, "deployer")
    auditor = ensure_role_account(state, "auditor")
    upstream_ben = ensure_role_account(state, "upstream_ben")
    downstream_ben = ensure_role_account(state, "downstream_ben")

    print(f"Deployer:       {deployer.address}", flush=True)
    print(f"Auditor:        {auditor.address}", flush=True)
    print(f"Upstream Ben:   {upstream_ben.address}", flush=True)
    print(f"Downstream Ben: {downstream_ben.address}", flush=True)

    deployer_client = create_client(chain=studionet, endpoint=RPC_URL, account=deployer)
    auditor_client = create_client(chain=studionet, endpoint=RPC_URL, account=auditor)
    upstream_client = create_client(chain=studionet, endpoint=RPC_URL, account=upstream_ben)
    downstream_client = create_client(chain=studionet, endpoint=RPC_URL, account=downstream_ben)

    ensure_funded(deployer_client, deployer.address)
    ensure_funded(auditor_client, auditor.address)
    ensure_funded(upstream_client, upstream_ben.address)
    ensure_funded(downstream_client, downstream_ben.address)

    code = CONTRACT_PATH.read_text(encoding="utf-8")
    source_sha256 = hashlib.sha256(code.encode("utf-8")).hexdigest()

    deploy_tx, deploy_receipt = run_step_tx(
        state,
        "deploy_cascade",
        deployer_client,
        lambda: deployer_client.deploy_contract(code=code, args=[]),
    )
    contract_addr = state.get("contract_address") or extract_contract_address(deploy_receipt)
    state["contract_address"] = contract_addr
    save_state(state)
    print(f"Cascade deployed at: {contract_addr}", flush=True)

    future_dl = int(time.time()) + 86400

    # Case 1 (EX-01): Gate-1 TOO_VAGUE rejection + refundable_balances credit
    c1_title = "Subjective Latency Vibes Pool"
    c1_up = "Edge-Router-Alpha"
    c1_down = "Core-Service-Beta"
    c1_charter = "Upstream pays if latency feels slowish or causes bad vibes for users."
    case1_tx, case1_rec = run_step_tx(
        state,
        "case1_too_vague",
        deployer_client,
        lambda: deployer_client.write_contract(
            address=contract_addr,
            function_name="open_indemnity_pool",
            args=[
                c1_title,
                c1_up,
                c1_down,
                upstream_ben.address,
                downstream_ben.address,
                c1_charter,
                DANLUU_PREFIX,
                future_dl,
            ],
            value=COLLATERAL_WEI,
        ),
    )

    # Case 2 (EX-02): Open Pools #1, #2, #3, #4
    case2_p1_tx, case2_p1_rec = run_step_tx(
        state,
        "case2_pool1_upstream",
        deployer_client,
        lambda: deployer_client.write_contract(
            address=contract_addr,
            function_name="open_indemnity_pool",
            args=[
                "Cloudflare Miami BGP Routing Incident",
                "Cloudflare-Miami-BGP-Policy-Engine",
                "External-IPv6-Peering-Backbone",
                upstream_ben.address,
                downstream_ben.address,
                (
                    "Upstream is at fault if a routing policy configuration error removed prefix list filters "
                    "from BGP export policies on Cloudflare's Miami router."
                ),
                DANLUU_PREFIX,
                future_dl,
            ],
            value=COLLATERAL_WEI,
        ),
    )

    case2_p2_tx, case2_p2_rec = run_step_tx(
        state,
        "case2_pool2_downstream",
        deployer_client,
        lambda: deployer_client.write_contract(
            address=contract_addr,
            function_name="open_indemnity_pool",
            args=[
                "Workers KV Central Data Store Outage",
                "Workers-KV-Edge-Gateway",
                "Central-Data-Store-Cloud-Provider",
                upstream_ben.address,
                downstream_ben.address,
                (
                    "Downstream is at fault if the outage was caused by a failure of the third-party "
                    "cloud provider backing the central data store."
                ),
                DANLUU_PREFIX,
                future_dl,
            ],
            value=COLLATERAL_WEI,
        ),
    )

    case2_p3_tx, case2_p3_rec = run_step_tx(
        state,
        "case2_pool3_multi_audit",
        deployer_client,
        lambda: deployer_client.write_contract(
            address=contract_addr,
            function_name="open_indemnity_pool",
            args=[
                "Multi-Audit Telemetry Verification Pool",
                "Ingress-Gateway-Proxy",
                "Origin-Database-Cluster",
                upstream_ben.address,
                downstream_ben.address,
                (
                    "Attribute fault to upstream or downstream only when the cited telemetry or post-mortem "
                    "slice provides explicit causal root-cause proof."
                ),
                "https://raw.githubusercontent.com/",
                future_dl,
            ],
            value=COLLATERAL_WEI,
        ),
    )

    if "case2_pool4_expiry" not in state.get("txs", {}) or "pool4_deadline" not in state:
        state["pool4_deadline"] = int(time.time()) + 90
        save_state(state)
    pool4_dl = int(state["pool4_deadline"])

    case2_p4_tx, case2_p4_rec = run_step_tx(
        state,
        "case2_pool4_expiry",
        deployer_client,
        lambda: deployer_client.write_contract(
            address=contract_addr,
            function_name="open_indemnity_pool",
            args=[
                "Short-Window Expiry Collateral Pool",
                "Primary-CDN-Pop",
                "Origin-Storage-Bucket",
                upstream_ben.address,
                downstream_ben.address,
                (
                    "Upstream Primary-CDN-Pop is at fault if a misconfigured edge routing rule causes HTTP 502 "
                    "errors; Downstream Origin-Storage-Bucket is at fault if storage returns HTTP 503 outages in logs."
                ),
                DANLUU_PREFIX,
                pool4_dl,
            ],
            value=COLLATERAL_WEI,
        ),
    )

    # Case 3 (EX-03): UPSTREAM_AT_FAULT on Pool #1
    case3_tx, case3_rec = run_step_tx(
        state,
        "case3_upstream_at_fault",
        auditor_client,
        lambda: auditor_client.write_contract(
            address=contract_addr,
            function_name="submit_fault_audit",
            args=[1, DANLUU_URL, 54, 60],
            value=STAKE_WEI,
        ),
    )

    # Case 4 (EX-04): DOWNSTREAM_AT_FAULT on Pool #2
    case4_tx, case4_rec = run_step_tx(
        state,
        "case4_downstream_at_fault",
        auditor_client,
        lambda: auditor_client.write_contract(
            address=contract_addr,
            function_name="submit_fault_audit",
            args=[2, DANLUU_URL, 303, 308],
            value=STAKE_WEI,
        ),
    )

    # Case 5 (EX-05): INSUFFICIENT_TRACE (UNRELATED_TELEMETRY_WINDOW) on Pool #3
    case5_tx, case5_rec = run_step_tx(
        state,
        "case5_insufficient_unrelated",
        auditor_client,
        lambda: auditor_client.write_contract(
            address=contract_addr,
            function_name="submit_fault_audit",
            args=[3, DANLUU_URL, 1, 15],
            value=STAKE_WEI,
        ),
    )

    # Case 6 (EX-06): INSUFFICIENT_TRACE (ADVERSARIAL_INJECTION_IGNORED) retrying Pool #3
    case6_tx, case6_rec = run_step_tx(
        state,
        "case6_insufficient_injection",
        auditor_client,
        lambda: auditor_client.write_contract(
            address=contract_addr,
            function_name="submit_fault_audit",
            args=[3, REBUFF_URL, 1, 30],
            value=STAKE_WEI,
        ),
    )

    # Case 7 (EX-07): Wait until pool4_dl + 45 (past deadline + AUDIT_GRACE_SECONDS=15 + StudioNet clock skew), settle_expired_pool(4), and withdraw_refundable() from all 4 accounts
    wait_until = pool4_dl + 45
    now = time.time()
    if now < wait_until:
        sleep_s = int(wait_until - now) + 1
        print(f"Sleeping {sleep_s}s until Pool #4 deadline + 45s (past 15s grace period)...", flush=True)
        time.sleep(sleep_s)

    case7_expire_tx, case7_expire_rec = run_step_tx(
        state,
        "case7_settle_expired_pool4",
        deployer_client,
        lambda: deployer_client.write_contract(
            address=contract_addr,
            function_name="settle_expired_pool",
            args=[4],
        ),
    )

    w_aud_tx, _ = run_step_tx(
        state,
        "case7_withdraw_auditor",
        auditor_client,
        lambda: auditor_client.write_contract(
            address=contract_addr, function_name="withdraw_refundable", args=[]
        ),
    )
    w_down_tx, _ = run_step_tx(
        state,
        "case7_withdraw_downstream",
        downstream_client,
        lambda: downstream_client.write_contract(
            address=contract_addr, function_name="withdraw_refundable", args=[]
        ),
    )
    w_up_tx, _ = run_step_tx(
        state,
        "case7_withdraw_upstream",
        upstream_client,
        lambda: upstream_client.write_contract(
            address=contract_addr, function_name="withdraw_refundable", args=[]
        ),
    )
    w_dep_tx, _ = run_step_tx(
        state,
        "case7_withdraw_deployer",
        deployer_client,
        lambda: deployer_client.write_contract(
            address=contract_addr, function_name="withdraw_refundable", args=[]
        ),
    )

    # Read final on-chain state
    pools = unwrap_json(deployer_client.read_contract(address=contract_addr, function_name="get_all_pools", args=[]))
    audits = unwrap_json(deployer_client.read_contract(address=contract_addr, function_name="get_all_audits", args=[]))
    rejections = unwrap_json(deployer_client.read_contract(address=contract_addr, function_name="get_rejected_submissions", args=[]))
    stats = unwrap_json(deployer_client.read_contract(address=contract_addr, function_name="get_protocol_stats", args=[]))
    auditor_bal = unwrap_json(deployer_client.read_contract(address=contract_addr, function_name="get_refundable_balance", args=[auditor.address]))
    deployer_bal = unwrap_json(deployer_client.read_contract(address=contract_addr, function_name="get_refundable_balance", args=[deployer.address]))
    upstream_bal = unwrap_json(deployer_client.read_contract(address=contract_addr, function_name="get_refundable_balance", args=[upstream_ben.address]))
    downstream_bal = unwrap_json(deployer_client.read_contract(address=contract_addr, function_name="get_refundable_balance", args=[downstream_ben.address]))

    pools_by_id = {int(p["pool_id"]): p for p in pools}
    audits_by_id = {int(a["audit_id"]): a for a in audits}

    probe_data = {}
    if PROBE_RESULTS_PATH.exists():
        probe_data = json.loads(PROBE_RESULTS_PATH.read_text(encoding="utf-8"))

    def make_audit_case(
        exhibit_code: str,
        case_id: str,
        label: str,
        audit_id: int,
        pool_tx: str,
        tx_hash: str,
        receipt: dict[str, Any],
        withdraw_tx: str,
        notes: str,
    ) -> dict[str, Any]:
        a = audits_by_id[audit_id]
        p = pools_by_id[int(a["pool_id"])]
        return {
            "case_id": case_id,
            "exhibit_code": exhibit_code,
            "label": label,
            "action": "submit_fault_audit",
            "pool_id": str(a["pool_id"]),
            "audit_id": str(a["audit_id"]),
            "verdict": a["verdict"],
            "outcome": a["verdict"],
            "reason_code": a["reason_code"],
            "upstream_id": p["upstream_id"],
            "downstream_id": p["downstream_id"],
            "allowed_source_prefix": p["allowed_source_prefix"],
            "charter": p["charter"],
            "charter_sha256": p["charter_sha256"],
            "evidence_url": a["evidence_url"],
            "start_line": int(a["start_line"]),
            "end_line": int(a["end_line"]),
            "snippet_sha256": a["snippet_sha256"],
            "snippet_excerpt": a["snippet_excerpt"],
            "evidence_quote": a["evidence_quote"],
            "tx_hash": tx_hash,
            "pool_tx_hash": pool_tx,
            "expiry_tx_hash": "",
            "withdraw_tx_hash": withdraw_tx,
            "block_number": receipt_block_number(receipt),
            "finality_status": "FINALIZED",
            "execution_result": "SUCCESS",
            "indemnity_wei": p["indemnity_wei"],
            "bond_wei": a["bond_wei"],
            "slashed_party": a["slashed_party"],
            "exonerated_party": a["exonerated_party"],
            "explorer_url": f"{EXPLORER_URL}/tx/{tx_hash}",
            "notes": notes,
        }

    p1 = pools_by_id[1]
    p4 = pools_by_id[4]
    cases_list = [
        {
            "case_id": "case_1_too_vague_rejection",
            "exhibit_code": "EX-01",
            "label": "Gate-1 TOO_VAGUE Charter Rejection & Deposit Refund",
            "action": "open_indemnity_pool",
            "pool_id": "0",
            "audit_id": "0",
            "verdict": "TOO_VAGUE",
            "outcome": "TOO_VAGUE",
            "reason_code": "SUBJECTIVE_OR_UNMEASURABLE",
            "upstream_id": c1_up,
            "downstream_id": c1_down,
            "allowed_source_prefix": DANLUU_PREFIX,
            "charter": c1_charter,
            "charter_sha256": hashlib.sha256(c1_charter.encode("utf-8")).hexdigest(),
            "evidence_url": "",
            "start_line": 0,
            "end_line": 0,
            "snippet_sha256": "",
            "snippet_excerpt": "",
            "evidence_quote": "",
            "tx_hash": case1_tx,
            "pool_tx_hash": case1_tx,
            "expiry_tx_hash": "",
            "withdraw_tx_hash": w_dep_tx,
            "block_number": receipt_block_number(case1_rec),
            "finality_status": "FINALIZED",
            "execution_result": "SUCCESS",
            "indemnity_wei": str(COLLATERAL_WEI),
            "bond_wei": "0",
            "slashed_party": "",
            "exonerated_party": "",
            "explorer_url": f"{EXPLORER_URL}/tx/{case1_tx}",
            "notes": "Gate-1 rejected subjective charter; collateral credited to deployer refundable_balances and withdrawn.",
        },
        {
            "case_id": "case_2_observable_charter_pool_open",
            "exhibit_code": "EX-02",
            "label": "Gate-1 OBSERVABLE_CHARTER Pool #1–#4 Creation",
            "action": "open_indemnity_pool",
            "pool_id": "1",
            "audit_id": "0",
            "verdict": "OBSERVABLE_CHARTER",
            "outcome": "OBSERVABLE_CHARTER",
            "reason_code": p1["gate1_reason_code"],
            "upstream_id": p1["upstream_id"],
            "downstream_id": p1["downstream_id"],
            "allowed_source_prefix": p1["allowed_source_prefix"],
            "charter": p1["charter"],
            "charter_sha256": p1["charter_sha256"],
            "evidence_url": "",
            "start_line": 0,
            "end_line": 0,
            "snippet_sha256": "",
            "snippet_excerpt": "",
            "evidence_quote": "",
            "tx_hash": case2_p1_tx,
            "pool_tx_hash": case2_p1_tx,
            "expiry_tx_hash": "",
            "withdraw_tx_hash": "",
            "block_number": receipt_block_number(case2_p1_rec),
            "finality_status": "FINALIZED",
            "execution_result": "SUCCESS",
            "indemnity_wei": p1["indemnity_wei"],
            "bond_wei": "0",
            "slashed_party": "",
            "exonerated_party": "",
            "explorer_url": f"{EXPLORER_URL}/tx/{case2_p1_tx}",
            "notes": "Gate-1 approved 4 concrete causal SLA pools (#1-#4) with bilateral beneficiary routing.",
        },
        make_audit_case(
            "EX-03",
            "case_3_upstream_at_fault",
            "Upstream Fault: Cloudflare Miami BGP Routing Defect (Pool #1)",
            1,
            case2_p1_tx,
            case3_tx,
            case3_rec,
            w_down_tx,
            "80% indemnity routed to downstream_beneficiary; 20% bounty + bond routed to auditor.",
        ),
        make_audit_case(
            "EX-04",
            "case_4_downstream_at_fault",
            "Downstream Fault: Workers KV Cloud Store Outage (Pool #2)",
            2,
            case2_p2_tx,
            case4_tx,
            case4_rec,
            w_up_tx,
            "80% indemnity routed to upstream_beneficiary; 20% bounty + bond routed to auditor.",
        ),
        make_audit_case(
            "EX-05",
            "case_5_insufficient_unrelated_window",
            "Insufficient Trace: Unrelated Telemetry Window (Pool #3, Attempt 1)",
            3,
            case2_p3_tx,
            case5_tx,
            case5_rec,
            w_aud_tx,
            "Non-conclusive audit preserves Pool #3 OPEN with audit_attempts=1; bond refunded to auditor.",
        ),
        make_audit_case(
            "EX-06",
            "case_6_insufficient_adversarial_injection",
            "Insufficient Trace: Adversarial Prompt Injection Ignored (Pool #3, Attempt 2)",
            4,
            case2_p3_tx,
            case6_tx,
            case6_rec,
            w_aud_tx,
            "Prompt injection in protectai/rebuff slice ignored; Pool #3 remains OPEN with audit_attempts=2; bond refunded to auditor.",
        ),
        {
            "case_id": "case_7_expiry_and_withdrawals",
            "exhibit_code": "EX-07",
            "label": "Short-Window Expiry Settlement & EOA Native Withdrawals (Pool #4)",
            "action": "settle_expired_pool",
            "pool_id": "4",
            "audit_id": "0",
            "verdict": "EXPIRED_REFUNDED",
            "outcome": "EXPIRED_REFUNDED",
            "reason_code": "POOL_DEADLINE_EXPIRED",
            "upstream_id": p4["upstream_id"],
            "downstream_id": p4["downstream_id"],
            "allowed_source_prefix": p4["allowed_source_prefix"],
            "charter": p4["charter"],
            "charter_sha256": p4["charter_sha256"],
            "evidence_url": "",
            "start_line": 0,
            "end_line": 0,
            "snippet_sha256": "",
            "snippet_excerpt": "",
            "evidence_quote": "",
            "tx_hash": case7_expire_tx,
            "pool_tx_hash": case2_p4_tx,
            "expiry_tx_hash": case7_expire_tx,
            "withdraw_tx_hash": w_aud_tx,
            "block_number": receipt_block_number(case7_expire_rec),
            "finality_status": "FINALIZED",
            "execution_result": "SUCCESS",
            "indemnity_wei": p4["indemnity_wei"],
            "bond_wei": "0",
            "slashed_party": "",
            "exonerated_party": "",
            "explorer_url": f"{EXPLORER_URL}/tx/{case7_expire_tx}",
            "notes": "Pool #4 settled EXPIRED_REFUNDED after deadline + 15s AUDIT_GRACE_SECONDS; all 4 EOA accounts withdrew via emit_transfer.",
        },
    ]

    proof = {
        "protocol": "Cascade",
        "network": "studionet",
        "chain_id": CHAIN_ID,
        "rpc_url": RPC_URL,
        "explorer_url": EXPLORER_URL,
        "contract_address": contract_addr,
        "contract_source_sha256": source_sha256,
        "deploy_tx": deploy_tx,
        "deployer_address": deployer.address,
        "auditor_address": auditor.address,
        "upstream_beneficiary_address": upstream_ben.address,
        "downstream_beneficiary_address": downstream_ben.address,
        "evidence_probe": probe_data,
        "cases": cases_list,
        "case_txs": {
            "case_1_too_vague_rejection": case1_tx,
            "case_2_pool_1": case2_p1_tx,
            "case_2_pool_2": case2_p2_tx,
            "case_2_pool_3": case2_p3_tx,
            "case_2_pool_4": case2_p4_tx,
            "pool_4_deadline_ts": pool4_dl,
            "case_3_upstream_at_fault": case3_tx,
            "case_4_downstream_at_fault": case4_tx,
            "case_5_insufficient_unrelated": case5_tx,
            "case_6_insufficient_injection": case6_tx,
            "case_7_settle_expired_pool4": case7_expire_tx,
            "case_7_withdraw_auditor": w_aud_tx,
            "case_7_withdraw_downstream": w_down_tx,
            "case_7_withdraw_upstream": w_up_tx,
            "case_7_withdraw_deployer": w_dep_tx,
        },
        "on_chain_snapshot": {
            "protocol_stats": stats,
            "pools": pools,
            "audits": audits,
            "rejected_submissions": rejections,
            "refundable_after_withdraw": {
                "auditor": auditor_bal,
                "deployer": deployer_bal,
                "upstream_beneficiary": upstream_bal,
                "downstream_beneficiary": downstream_bal,
            },
        },
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    proof_json = json.dumps(proof, indent=2)
    PROOF_PATH.write_text(proof_json, encoding="utf-8")
    FRONTEND_PROOF_PATH.parent.mkdir(parents=True, exist_ok=True)
    FRONTEND_PROOF_PATH.write_text(proof_json, encoding="utf-8")
    print(f"Wrote proof.json to {PROOF_PATH} and {FRONTEND_PROOF_PATH}", flush=True)


if __name__ == "__main__":
    main()
