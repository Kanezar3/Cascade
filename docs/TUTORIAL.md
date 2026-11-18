# Cascade Developer Tutorial: Building a 2-Gate Bilateral AI-Service Indemnity Protocol on GenLayer

Cascade (`contracts/cascade.py`) is an Intelligent Contract on **GenLayer StudioNet (Chain ID `61999`)** that settles bilateral AI-service outage and SLA disputes using immutable post-mortem evidence, deterministic SHA-256 anchoring, and Optimistic Democracy consensus.

This guide walks through the contract architecture, the two-gate LLM consensus pipeline, bilateral 80/20 indemnity routing, and how to run tests and the frontend locally.

---

## 1. Architecture Overview

Every dispute in Cascade moves through two distinct consensus gates and a pull-based settlement ledger:

1. **Gate 1 — Charter Observability (`open_indemnity_pool`)**:
   - An operator or service consumer opens an escrow pool by posting collateral (`msg.value > 0`) along with `title`, `upstream_id`, `downstream_id`, `upstream_beneficiary`, `downstream_beneficiary`, `sla_charter`, `allowed_source_prefix`, and `deadline_ts`.
   - Before locking the pool, `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)` evaluates whether the `sla_charter` is **concrete and causally testable** against immutable logs (`OBSERVABLE_CHARTER : CONCRETE_CAUSAL_CHARTER`) or subjective/unmeasurable (`TOO_VAGUE : SUBJECTIVE_OR_UNMEASURABLE`).
   - If Gate 1 rejects the charter as `TOO_VAGUE` (or if address/prefix validation fails), the deposited collateral is immediately credited to `refundable_balances[sender]` for safe pull withdrawal, and the rejection is recorded in `rejected_submissions`.

2. **Gate 2 — Causal Fault Attribution (`submit_fault_audit`)**:
   - Any auditor posts an audit bond (`msg.value > 0`) and submits an immutable `evidence_url` plus a bounded line window (`start_line..end_line`, up to `MAX_LINE_WINDOW = 120`).
   - **Immutable URL Allowlist**: `_validate_evidence_url` enforces HTTPS and restricts evidence to:
     - `raw.githubusercontent.com` pinned to an exact 40-hex commit SHA (`/<owner>/<repo>/<40-hex-sha>/<path>`)
     - `web.archive.org` pinned to an immutable raw snapshot (`/web/<14-digit>id_/https://...`)
     - `en.wikipedia.org` pinned via `/w/api.php?action=parse&oldid=<digits>`
     - Optional prefix matching against the pool's `allowed_source_prefix`
   - **Deterministic Snippet Slicing & SHA-256**: Inside `leader_fn` and `validator_fn`, the contract fetches the raw text via `gl.nondet.web.get`, slices `start_line..end_line`, collapses whitespace runs (`" ".join(" ".join(selected).split())[:3000]`), and computes `hashlib.sha256(snippet.encode("utf-8")).hexdigest()`.
   - **Verbatim Quote & Verdict Consistency**: The LLM returns JSON containing `verdict`, `reason_code`, `evidence_quote`, and `rationale`. The validator enforces that:
     - `snippet_sha256` matches deterministically across leader and validator.
     - `verdict` is a key in `VERDICT_COMPATIBLE_REASONS` and `reason_code` is in `VERDICT_COMPATIBLE_REASONS[verdict]`.
     - For fault verdicts (`UPSTREAM_AT_FAULT` or `DOWNSTREAM_AT_FAULT`), `evidence_quote` (12–220 chars) appears **verbatim** inside the normalized `snippet`.

---

## 2. `VERDICT_COMPATIBLE_REASONS` Matrix

| Verdict | Allowed `reason_code` Values | Settlement Effect |
| :--- | :--- | :--- |
| `UPSTREAM_AT_FAULT` | `UPSTREAM_CONFIG_OR_ROUTING_DEFECT`, `UPSTREAM_OVERLOAD_OR_LOOP`, `UPSTREAM_BAD_DEPLOY` | 80% indemnity to `downstream_beneficiary`, 20% bounty + bond to auditor |
| `DOWNSTREAM_AT_FAULT` | `DOWNSTREAM_DEPENDENCY_FAILURE`, `DOWNSTREAM_STORAGE_OR_DB_OUTAGE`, `DOWNSTREAM_NETWORK_DROP` | 80% indemnity to `upstream_beneficiary`, 20% bounty + bond to auditor |
| `INSUFFICIENT_TRACE` | `UNRELATED_TELEMETRY_WINDOW`, `NO_CAUSAL_PROOF_IN_SLICE`, `ADVERSARIAL_INJECTION_IGNORED` | Pool remains `OPEN`; auditor bond refunded |
| `UNVERIFIABLE_FETCH` | `HTTP_FETCH_FAILURE`, `EMPTY_LINE_SLICE` | Pool remains `OPEN`; auditor bond refunded |

---

## 3. Bilateral 80/20 Indemnity Routing & Pull Escrow

When `submit_fault_audit` reaches a fault verdict (`UPSTREAM_AT_FAULT` or `DOWNSTREAM_AT_FAULT`):

```python
auditor_bounty = pool_collateral // u256(5)          # 20%
indemnity_payout = pool_collateral - auditor_bounty  # 80%
auditor_total = stake_wei + auditor_bounty
```

- **Exact Wei Conservation**: `indemnity_payout + auditor_total == pool_collateral + stake_wei`.
- **Pull-Based Withdrawals**: Credits are stored in `refundable_balances[address]`. Beneficiaries and auditors call `withdraw_refundable()`, which zeroes their balance first (checks-effects-interactions) and transfers GEN via `_EoaRecipient(sender).emit_transfer(value=amount)`.
- **Pool Expiry (`settle_expired_pool`)**: Once `now > deadline_ts + CLAIM_GRACE_SECONDS` (or `now > deadline_ts` when no fault was settled), the pool transitions to `EXPIRED_REFUNDED` and returns `pool_collateral` to the pool creator's refundable balance.

---

## 4. Browser Verification & Local Setup

Every settled audit stores the full normalized `snippet_excerpt` (up to 3,000 characters) and `snippet_sha256` on-chain. In the Cascade frontend (`01 // INCIDENT DOSSIERS`), clicking **Verify SHA-256 in Browser** runs WebCrypto `crypto.subtle.digest('SHA-256', ...)` over `snippet_excerpt` and confirms a bit-for-bit match against the on-chain hash.

### Running Tests & Frontend Locally

```bash
# 1. Python contract unit tests
pytest tests/test_cascade.py -v

# 2. Frontend dependencies, unit tests, and production build
npm --prefix frontend install
npm --prefix frontend run test
npm --prefix frontend run build

# 3. Verify live StudioNet proof bundle
python deploy/verify_proof.py
```
