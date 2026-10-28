# Agent Guardrails — Roadmap & Architectural Decisions

## 1. Project Overview: What We Are Building

**Agent Guardrails** is a stateful, defense-in-depth security layer built around **Nimbus**, a customer support agent for the fictional **Acme Cloud** hosting platform.

Instead of relying on slow, expensive LLM self-policing ("please don't get prompt-injected"), every turn passes through fast, calibrated **Cloudflare System One (`clef-flash` and `clef`)** decision models at three distinct enforcement boundaries:

1. **Pre-LLM Input Firewall (`beforeTurn`)** — Screens prompts for prompt injection, jailbreaks (e.g., DAN), secret exfiltration, PII oversharing, and off-topic requests before the main LLM ever sees them.
2. **Escalation Ladder (`clef-flash` → `clef`)** — When `clef-flash` detects a borderline threat (between `reviewAt` and `blockAt`), it automatically escalates to the larger 27B `clef` model for a high-accuracy second opinion.
3. **Tool-Call Firewall (`needsApproval` + `beforeToolCall`)** — Evaluates every proposed tool invocation (`get_account`, `issue_refund`, `send_email`, `run_sql`, `attack_report`) against the user's original intent, data exfiltration risk, and financial/destructive impact.
4. **Post-LLM Output Guardrail (`onChatResponse`)** — Screens completed assistant replies for leaked credentials (including the canary token `sk_live_ACME_CANARY_7f3a9`), leaked system instructions, or unauthorized business promises.
5. **Red-Team Arena (SQLite Attack Log + Live Leaderboard + `attack_report` Tool)** — Persists redacted attack telemetry in Durable Object SQLite, updates a live leaderboard in the UI, and allows querying daily attack statistics without exposing raw prompts back to the LLM.

---

## 2. What Works Today (Current Status)

| Feature / Checkpoint | Status | Key Files |
| :--- | :--- | :--- |
| **Checkpoint 0: Input Firewall** | Working | `src/firewall/policy.ts`, `src/server.ts` |
| **Persistent History Redaction** | Working | `src/firewall/policy.ts` (`redactBlocked`, SHA-256 `fingerprint`) |
| **Checkpoint 1: Tool-Call Firewall** | Working | `src/firewall/tool-gate.ts`, `src/firewall/tools.ts`, `src/server.ts` |
| **Human-in-the-Loop Tool Approval** | Working | `src/server.ts` (`needsApproval`), `src/ui/Message.tsx` |
| **Checkpoint 2: Output Guardrail** | Working | `src/firewall/output-guard.ts`, `src/server.ts` (`onChatResponse`) |
| **Checkpoint 3: Escalation Ladder (`clef-flash` → `clef`)** | Working | `src/firewall/policy.ts` (`needsEscalation`), `src/server.ts` |
| **Checkpoint 3: SQLite Attack Log & Live Leaderboard** | Working | `src/server.ts` (`this.sql`), `src/ui/extensions.tsx` |
| **Checkpoint 3: `attack_report` Tool** | Working | `src/server.ts` (`buildAttackReport`) |
| **Dual Runtime Mode (Live Workers AI + Local Simulator)** | Working | `src/system-one/local-ai.ts`, `src/agent/system-one-agent.ts` |
| **Live Decision Trace & Cost Telemetry** | Working | `src/system-one/trace.ts`, `src/ui/TracePanel.tsx` |
| **Unit Test Suite (34 tests across 4 suites)** | Passing | `test/firewall.test.ts`, `test/clef.test.ts`, `test/clairic.test.ts`, `test/trace.test.ts` |

---

## 3. Key Architectural Decisions (ADRs)

### ADR-01: Single-Pass Calibrated Decision Models (`Clef`) Over LLM-as-a-Judge
- **Context**: Using a generative LLM as a guardrail adds 500–2,000ms of latency per step, bills output tokens, and is itself vulnerable to recursive prompt injection.
- **Decision**: Use `clef-flash` (9B) on the hot path to evaluate up to 64 typed questions (`noul`, `choice`, `score`) in a single forward pass (~40–150ms, zero output tokens).
- **Consequence**: Input, tool, and output checks run in milliseconds at `$0.038 / 1M input tokens` and return calibrated probabilities validated with `zod`.

### ADR-02: Two-Tier Escalation Ladder (`clef-flash` → `clef`)
- **Context**: `clef-flash` is optimized for speed and cost, but subtle role-play or social-engineering prompts can score in the uncertain middle band (`reviewAt <= p < blockAt`).
- **Decision**: Implement `needsEscalation(answers, policy)`. When a threat signal falls between `reviewAt` and `blockAt` without crossing `blockAt`, re-run `INPUT_QUESTIONS` on the 27B `clef` model and record both traces.
- **Consequence**: Clean prompts and obvious attacks only pay for `clef-flash`, while borderline attacks get `clef`-grade accuracy and full observability in the Decision Trace panel.

### ADR-03: Three-Tier Tool Gate (`allow` vs. `approve` vs. `block`)
- **Context**: Not all sensitive tool calls are attacks. A $120 refund is destructive (moves money) but legitimate if a human approves it, whereas emailing customer records to an external address (`jake@protonmail.example`) or running `DELETE FROM invoices` should never be executed.
- **Decision**: Separate `destructive` (triggers `action: "approve"` → human Approve/Deny UI) from `exfiltration`, `unrequested` (`1 - matches_request`), and critical `risk` (which trigger `action: "block"` → refused outright in `beforeToolCall`).
- **Consequence**: Read-only lookups (`get_account`, `attack_report`) execute with zero friction; refunds pause for human approval; data exfiltration and unrequested/destructive SQL calls are refused automatically.

### ADR-04: SHA-256 Fingerprinting & Transcript Redaction
- **Context**: Blocking a malicious prompt on Turn $N$ is ineffective if the raw text remains in the chat transcript on Turn $N+1$ when the user sends a benign follow-up.
- **Decision**: Hash blocked messages with `crypto.subtle.digest("SHA-256", ...)` (`fingerprint()`), store the hashes in Durable Object KV (`firewall:blocked`), and replace matching user messages with `[message withheld by Agent Guardrails]` on every turn via `redactBlocked()`.
- **Consequence**: Blocked payloads never reach the LLM on the current turn or any future turn, and raw attack payloads are never persisted in full.

### ADR-05: Privacy-Preserving SQLite Attack Log & `attack_report` Isolation
- **Context**: Storing full attacker prompts in SQLite or feeding them back into an LLM via a reporting tool creates a secondary stored-prompt-injection vector.
- **Decision**:
  1. Store only `at`, `verdict`, `reasons`, and a truncated 60-character `preview` in the Durable Object's `attacks` SQLite table.
  2. When the LLM calls `attack_report`, query only `SELECT at, verdict, reasons FROM attacks` (omitting `preview` entirely).
- **Consequence**: Nimbus can answer *"What attacks have you seen today?"* accurately while never seeing the attacker's raw text.

### ADR-06: Resilient Local Simulator + Direct Workers AI REST Fallback
- **Context**: Wrangler's `remoteBindings: true` mode attempts to deploy a remote proxy worker at `vite dev` startup, which crashes in non-interactive environments if `CLOUDFLARE_API_TOKEN` is absent or lacks `Workers Scripts: Edit` permission.
- **Decision**: Disable Wrangler's startup proxy (`remoteBindings: false` in `vite.config.ts`) and wrap `env.AI` in `createLocalAi()` (`src/system-one/local-ai.ts`). When `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are provided, call the Cloudflare Workers AI REST API directly; otherwise (or on `401`/`403`), fall back to the deterministic local simulator.
- **Consequence**: `npm run dev` boots reliably in under a second in any environment, while supporting live Cloudflare Workers AI inference when credentials are configured.

---

## 4. Future Roadmap

### Phase 1: Multimodal & Extraction Guardrails (Next Up)
- **Multimodal Screenshot Screening (`clef-omni`)**: Screen attached images, PDFs, and audio clips in `beforeTurn` using `clef-omni` to catch visual prompt injections embedded in screenshots.
- **Structured PII & IOC Extraction (`clairic`)**: Use `this.extractTraced()` with `clairic` to extract structured indicators (account IDs, invoice numbers, dollar amounts) from customer messages and cross-check that tool arguments match extracted entities.

### Phase 2: Fine-Tuning & Policy Automation
- **AI Gateway Dataset Export**: Use the `app`, `step`, and `verdict` metadata attached to every AI Gateway request to export labeled guardrail datasets for reinforcement fine-tuning.
- **Per-Tenant Custom Policies**: Allow organizations to configure custom domain rules (e.g., banned competitor names, jurisdiction-specific compliance checks) directly from the UI and persist them in Durable Object SQLite.

### Phase 3: Multi-Session Global Telemetry
- **Cross-Session Red-Team Scoreboard**: Aggregate attack counts across all Durable Object sessions into a shared D1 database or Analytics Engine dataset for live multi-player red-team competitions.
