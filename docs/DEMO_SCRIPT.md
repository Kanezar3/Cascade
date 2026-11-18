# Cascade — 2-Minute Steward Walkthrough Script

**Target Duration:** 2:00  
**Network:** GenLayer StudioNet (Chain ID `61999`)

---

## 0:00 – 0:20 · Problem & StudioNet Parity Check

1. Open the Cascade console. Point out the top telemetry bar:
   - `CASCADE // STUDIONET 61999` with the live `LIVE SYNCED` indicator.
   - Click **Verify Live StudioNet** to show real-time `genlayer-js` RPC reads (`get_protocol_stats` and `getTransaction` parity checks) against the deployed contract.
2. Explain Cascade in one sentence:
   > "Cascade is a bilateral AI-service indemnity protocol on GenLayer. When an AI pipeline fails, an Intelligent Contract decides whether the upstream model/router or the downstream consumer caused the outage—and routes 80% of escrowed collateral to the exonerated party plus a 20% bounty to the auditor."

---

## 0:20 – 1:05 · `01 // INCIDENT DOSSIERS` (2-Gate Consensus & Browser SHA-256)

1. Select the **Upstream Fault** exhibit (`UPSTREAM_AT_FAULT : UPSTREAM_CONFIG_OR_ROUTING_DEFECT`):
   - Highlight the **Bilateral Fault Topology Strip**: `[UPSTREAM NODE (SLASHED)] -> [CHARTER] -> [DOWNSTREAM NODE (EXONERATED)]`.
   - Scroll to the **Telemetry Log Plate** showing the highlighted verbatim `evidence_quote` inside `snippet_excerpt` and line span badge (`L54–L60`).
   - Click **Verify SHA-256 in Browser** to compute WebCrypto SHA-256 live and display `BROWSER SHA-256 MATCH`.
2. Switch to the **Downstream Fault** exhibit (`DOWNSTREAM_AT_FAULT`) to show the opposite slash/exoneration direction.
3. Click the **Too Vague** (`TOO_VAGUE`) and **Prompt Injection Defense** (`INSUFFICIENT_TRACE : ADVERSARIAL_INJECTION_IGNORED`) exhibits to show Gate 1 charter rejection and Gate 2 resistance to untrusted log payloads.
4. Toggle **Matrix Compare** briefly to show all exhibits side-by-side with RPC finality status.

---

## 1:05 – 1:35 · `02 // INDEMNITY DESK` (MetaMask StudioNet & 1-Click Presets)

1. Switch to `02 // INDEMNITY DESK`.
2. Click **Connect MetaMask (61999)** (or point out the live `Refundable Escrow` balance and **Withdraw Escrow** pull button).
3. Click **Preset A · Cloudflare Miami BGP Route Leak (L54–L60)** to populate `open_indemnity_pool` and `submit_fault_audit` with a 40-hex commit-pinned `raw.githubusercontent.com` URL.
4. Point out the live **Pools**, **Audits**, and **Rejected Submissions** tables synced directly from StudioNet.

---

## 1:35 – 2:00 · `03 // CONSENSUS TELEMETRY` (Lifecycle & Appeal Window)

1. Switch to `03 // CONSENSUS TELEMETRY`.
2. Click **Load All Exhibit Txs** to populate all recorded StudioNet transactions and poll `getTransaction` every 8 seconds.
3. Point out the 5-stage pipeline (`1. Submitted` → `2. Pending` → `3. Proposing` → `4. Accepted` → `5. Finalized`) and the **Optimistic Appeal Window** bar (`FINALIZED · IMMUTABLE`, or `Appeal Consensus` during an active appeal window).
