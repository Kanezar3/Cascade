"""Live StudioNet probe deploying EvidenceProbe and verifying 3 evidence URL slices."""

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
PROBE_CONTRACT_PATH = ROOT_DIR / "contracts" / "evidence_probe.py"
PROBE_RESULTS_PATH = ROOT_DIR / "deploy" / "probe_results.json"

RPC_URL = "https://studio.genlayer.com/api"
POLL_INTERVAL_MS = 9000
POLL_RETRIES = 80
FUND_AMOUNT_WEI = 5_000_000_000_000_000_000
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

PROBE_TARGETS = [
    {
        "name": "danluu_cloudflare_miami_bgp",
        "url": "https://raw.githubusercontent.com/danluu/post-mortems/630562e55281ff28961704e8042a7dc9569a96e7/README.md",
        "start_line": 54,
        "end_line": 60,
    },
    {
        "name": "danluu_workers_kv_downstream",
        "url": "https://raw.githubusercontent.com/danluu/post-mortems/630562e55281ff28961704e8042a7dc9569a96e7/README.md",
        "start_line": 303,
        "end_line": 308,
    },
    {
        "name": "protectai_rebuff_injection_test",
        "url": "https://raw.githubusercontent.com/protectai/rebuff/4d2fe064abf164e7381556d23e48e210080f8afa/python-sdk/tests/test_sdk.py",
        "start_line": 1,
        "end_line": 30,
    },
]


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
        raise RuntimeError(f"sim_fundAccount failed: {data['error']}")


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
    lr = (rec.get("consensus_data") or {}).get("leader_receipt") or []
    if not lr or lr[0].get("execution_result") != "SUCCESS":
        raise RuntimeError(f"Tx [{label}] failed: {json.dumps(rec, default=str)[:800]}")
    return rec


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


def main() -> None:
    patch_provider_user_agent()
    account = create_account()
    print(f"Probe account: {account.address}", flush=True)
    rpc_fund_account(account.address, FUND_AMOUNT_WEI)
    time.sleep(2)

    client = create_client(chain=studionet, endpoint=RPC_URL, account=account)
    code = PROBE_CONTRACT_PATH.read_text(encoding="utf-8")

    deploy_tx = client.deploy_contract(code=code, args=[])
    deploy_receipt = wait_finalized(client, deploy_tx, "deploy_evidence_probe")
    probe_addr = extract_contract_address(deploy_receipt)
    print(f"EvidenceProbe deployed at: {probe_addr}", flush=True)

    results = {
        "network": "studionet",
        "rpc_url": RPC_URL,
        "evidence_probe_address": probe_addr,
        "deploy_tx": deploy_tx,
        "probes": [],
    }

    for target in PROBE_TARGETS:
        tx_hash = client.write_contract(
            address=probe_addr,
            function_name="probe_url_slice",
            args=[target["url"], target["start_line"], target["end_line"]],
        )
        wait_finalized(client, tx_hash, target["name"])
        last_probe_raw = client.read_contract(
            address=probe_addr,
            function_name="get_last_probe",
            args=[],
        )
        last_probe = json.loads(last_probe_raw) if isinstance(last_probe_raw, str) else last_probe_raw
        print(
            f"Probe [{target['name']}]: ok={last_probe.get('ok')} "
            f"len={last_probe.get('snippet_len')} sha256={last_probe.get('snippet_sha256')}",
            flush=True,
        )
        assert last_probe.get("ok") is True, f"Probe failed for {target['name']}: {last_probe}"
        assert int(last_probe.get("snippet_len", 0)) > 0
        results["probes"].append(
            {
                "name": target["name"],
                "tx_hash": tx_hash,
                "start_line": target["start_line"],
                "end_line": target["end_line"],
                "result": last_probe,
            }
        )

    PROBE_RESULTS_PATH.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"Saved probe results to {PROBE_RESULTS_PATH}", flush=True)


if __name__ == "__main__":
    main()
