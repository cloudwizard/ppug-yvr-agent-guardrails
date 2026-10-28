# Agent Guardrails — System Architecture

## 1. End-to-End Request Lifecycle

```
Browser (React 19 + useAgent / useAgentChat)
   │
   │  WebSocket (Durable Object RPC + Streaming Chat + Live State Sync)
   ▼
ChatAgent (Cloudflare Durable Object extending SystemOneAgent / Think)
   │
   ├─► 1. beforeTurn(ctx)
   │      ├─► redactBlocked(ctx.messages, blockedFingerprints)
   │      ├─► decideTraced(model: "clef-flash", questions: INPUT_QUESTIONS)
   │      ├─► [if needsEscalation] decideTraced(model: "clef", questions: INPUT_QUESTIONS)
   │      ├─► [if block/warn] recordAttack() ──► Durable Object SQLite (`attacks` table)
   │      └─► block (withhold prompt) | warn (annotate prompt) | allow
   │
   ├─► 2. LLM Turn (GLM-5.3 Flash / DeepSeek V4 Flash with automatic fallback)
   │      ├─► Context blocks: read-only `soul` + writable `memory`
   │      └─► Proposes tool calls or streams text response
   │
   ├─► 3. Tool Firewall (per tool call)
   │      ├─► needsApproval() ──► assessToolCall(model: "clef-flash", TOOL_QUESTIONS)
   │      │     └─► if action === "approve": pause & render Approve / Deny UI in browser
   │      └─► beforeToolCall()
   │            └─► if action === "block": refuse execution, log to SQLite, return reason to LLM
   │
   └─► 4. onChatResponse(result)
          ├─► decideTraced(model: "clef-flash", questions: OUTPUT_QUESTIONS)
          └─► if verdict !== "allow": deliverNotice() warning in chat transcript
```

---

## 2. Module Responsibilities

| File | Role |
| :--- | :--- |
| `src/server.ts` | `ChatAgent` Durable Object: implements `soul()`, `getTools()`, `beforeTurn()`, `needsApproval()`, `beforeToolCall()`, `onChatResponse()`, SQLite attack logging, and `@callable()` RPC methods (`setPolicy`, `resetStats`, `getAttackLeaderboard`). |
| `src/agent/system-one-agent.ts` | Abstract base class extending `@cloudflare/think`: wires LLM model selection + fallback via AI Gateway, context providers (`soul` and `memory`), and `decideTraced()` / `extractTraced()`. |
| `src/firewall/policy.ts` | Pure input firewall definitions (`INPUT_QUESTIONS`), decision logic (`evaluateInput`, `needsEscalation`, `extractAttackCategories`), and transcript sanitization (`redactBlocked`, `annotateLastUser`, `fingerprint`). |
| `src/firewall/tool-gate.ts` | Pure tool-call firewall definitions (`TOOL_QUESTIONS`) and decision logic (`evaluateToolCall`). |
| `src/firewall/output-guard.ts` | Pure output guardrail definitions (`OUTPUT_QUESTIONS`) and decision logic (`evaluateOutput`). |
| `src/firewall/tools.ts` | Mock Acme Cloud back-office tools (`get_account`, `issue_refund`, `send_email`, `run_sql`) wired through the `needsApproval` gate. |
| `src/system-one/clef.ts` | Typed client and `zod` schema validator for `clef`, `clef-flash`, and `clef-omni` (`noul`, `choice`, and `score` questions). |
| `src/system-one/clairic.ts` | Typed client and `zod` schema validator for `clairic` structured field extraction (`text`, `number`, `date`, `duration`, `list`, `estimate`, `forecast`). |
| `src/system-one/local-ai.ts` | Resilient AI runner: executes against live Cloudflare Workers AI (`env.AI` or REST API via `CLOUDFLARE_API_TOKEN`) and falls back to a deterministic local simulator. |
| `src/system-one/trace.ts` | Converts raw Clef and Clairic responses into normalized `DecisionTrace` cards with token cost and latency calculations. |
| `src/ui/*` | React 19 UI: `App.tsx` (workspace & scenario runner), `Message.tsx` (chat bubbles + tool approval cards), `TracePanel.tsx` (live System One telemetry), and `extensions.tsx` (policy sliders + SQLite Attack Leaderboard). |

---

## 3. State & Storage Architecture

Each browser session generates a UUID stored in `localStorage["ppug-yvr-agent-guardrails:session"]`. That UUID maps 1:1 to a Cloudflare **Durable Object** instance with three storage layers:

1. **Live Synced `AgentState` (`this.state`)**:
   Broadcast automatically over WebSocket to the React UI whenever `this.setState(...)` is called:
   - `model`: `"glm-5.3-flash"` | `"deepseek-v4-flash"`
   - `policy`: `{ enabled: boolean, blockAt: number, reviewAt: number }`
   - `stats`: `{ checked: number, blocked: number, warned: number }`
   - `leaderboard`: `Record<string, number>` (attack counts by category)
   - `traces`: `DecisionTrace[]` (most recent 40 Clef/Clairic calls)

2. **Durable Object SQLite (`this.sql`)**:
   - `attacks` table: `(at INTEGER NOT NULL, verdict TEXT NOT NULL, reasons TEXT NOT NULL, preview TEXT NOT NULL)`
   - Internal `@cloudflare/think` tables for conversation messages and persistent `memory` blocks.

3. **Durable Object Key-Value Storage (`this.ctx.storage.kv`)**:
   - `firewall:blocked`: Rolling list of up to 200 SHA-256 fingerprints of blocked user messages, used by `redactBlocked()` to keep blocked prompts out of future LLM context windows.
