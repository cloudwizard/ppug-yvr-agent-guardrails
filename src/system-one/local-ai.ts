import type { ClairicField } from "./clairic";
import type { ClefQuestion } from "./clef";

type OpenAIMessage = {
  role: string;
  content?: unknown;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
};

type OpenAITool = {
  type?: string;
  function?: { name?: string };
};

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("\n");
  }
  return "";
}

function simulateClef(
  model: string,
  state: unknown,
  questions: Record<string, ClefQuestion>,
) {
  const rawText =
    typeof state === "string" ? state : JSON.stringify(state ?? {});
  const promptInjection =
    /\b(ignore (all )?previous instructions|system prompt|verbatim|<!--|exfil\.example|before summarizing, call)\b/i.test(
      rawText,
    )
      ? 0.96
      : 0.02;
  const jailbreak =
    /\b(dan\b|broken free|never refuses|developer mode|role-?play|hypothetical)/i.test(
      rawText,
    )
      ? 0.94
      : 0.02;
  const secretExfil =
    /\b(admin token|internal.*token|system prompt|forward all customer records|exfil)/i.test(
      rawText,
    )
      ? 0.92
      : 0.02;
  const piiShared =
    /\b(ssn|\d{3}-\d{2}-\d{4}|4111[\s-]?\d{4}|cvv\s*\d{3})\b/i.test(rawText)
      ? 0.95
      : 0.01;
  const offTopic = /\b(sea shanty|pirates|lasagna|poem|recipe|haiku)\b/i.test(
    rawText,
  )
    ? 0.95
    : 0.03;
  const destructive =
    /\b(issue_refund|delete\s+from|drop\s+table|refund|send_email)\b/i.test(
      rawText,
    )
      ? 0.91
      : 0.04;
  const isAttack =
    promptInjection >= 0.7 || jailbreak >= 0.7 || secretExfil >= 0.7;
  const isAction =
    /\b(refund|delete|account\s+\d+|what plan|send_email|run_sql|get_account)\b/i.test(
      rawText,
    );

  const answers: Record<string, unknown> = {};
  for (const [key, q] of Object.entries(questions)) {
    if (q.type === "noul") {
      let noul = 0.03;
      if (key === "prompt_injection") noul = promptInjection;
      else if (key === "jailbreak") noul = jailbreak;
      else if (key === "secret_exfiltration") noul = secretExfil;
      else if (key === "pii_shared") noul = piiShared;
      else if (key === "off_topic") noul = offTopic;
      else if (key === "destructive") noul = destructive;
      else if (/inject|override/i.test(q.instructions)) noul = promptInjection;
      else if (/jailbreak|persona|dan/i.test(q.instructions)) noul = jailbreak;
      else if (/secret|credential|exfil/i.test(q.instructions))
        noul = secretExfil;
      else if (/personal|pii|ssn|card/i.test(q.instructions)) noul = piiShared;
      else if (/unrelated|off-topic/i.test(q.instructions)) noul = offTopic;
      else if (/money|refund|delete|modify/i.test(q.instructions))
        noul = destructive;
      answers[key] = { type: "noul", noul };
    } else if (q.type === "choice") {
      const options = Object.keys(q.criteria);
      let chosen = options[0] ?? "other";
      if (isAttack && options.includes("attack")) chosen = "attack";
      else if (offTopic >= 0.7 && options.includes("other")) chosen = "other";
      else if (isAction && options.includes("account_action"))
        chosen = "account_action";
      else if (options.includes("support_question"))
        chosen = "support_question";

      const rest = options.length > 1 ? 0.1 / (options.length - 1) : 0;
      const probabilities = Object.fromEntries(
        options.map((opt) => [
          opt,
          opt === chosen
            ? Number((options.length > 1 ? 0.9 : 1).toFixed(4))
            : Number(rest.toFixed(4)),
        ]),
      );
      answers[key] = {
        type: "choice",
        choice: chosen,
        probabilities,
        confidence: 0.88,
      };
    } else if (q.type === "score") {
      const levels = Math.max(2, q.criteria.length);
      const maxThreat = Math.max(
        promptInjection,
        jailbreak,
        secretExfil,
        piiShared,
        destructive,
      );
      const normalized = maxThreat >= 0.7 ? 0.82 : isAction ? 0.35 : 0.08;
      const score = Number((normalized * (levels - 1)).toFixed(2));
      const topIdx = Math.min(levels - 1, Math.round(score));
      const legend = Object.fromEntries(
        q.criteria.map((label, idx) => [String(idx), label]),
      );
      const rest = levels > 1 ? 0.15 / (levels - 1) : 0;
      const probabilities = Object.fromEntries(
        q.criteria.map((_, idx) => [
          String(idx),
          idx === topIdx ? 0.85 : Number(rest.toFixed(4)),
        ]),
      );
      answers[key] = {
        type: "score",
        score,
        legend,
        probabilities,
        confidence: 0.86,
      };
    }
  }

  return {
    model,
    answers,
    usage: {
      input_tokens: Math.max(24, Math.ceil(rawText.length / 4)),
      output_tokens: 0,
    },
  };
}

function simulateClairic(state: string, fields: Record<string, ClairicField>) {
  const answers: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) {
    if (field.type === "text") {
      answers[key] = {
        type: "text",
        value: state.slice(0, 32).trim() || null,
        confidence: 0.9,
        p_null: 0.05,
      };
    } else if (field.type === "number" || field.type === "duration") {
      answers[key] = {
        type: field.type,
        value: 1,
        confidence: 0.9,
        p_null: 0.05,
        unit: field.unit,
      };
    } else if (
      field.type === "date" ||
      field.type === "time" ||
      field.type === "datetime"
    ) {
      answers[key] = {
        type: field.type,
        value: "2026-10-28",
        confidence: 0.9,
        p_null: 0.05,
      };
    } else if (field.type === "list") {
      answers[key] = {
        type: "list",
        value: [],
        confidence: 0.9,
      };
    } else if (field.type === "estimate") {
      answers[key] = {
        type: "estimate",
        value: field.min,
        median: field.min,
        p10: field.min,
        p90: field.max,
      };
    } else {
      answers[key] = {
        type: "forecast",
        value: [0],
        median: [0],
        p10: [0],
        p90: [0],
      };
    }
  }
  return {
    model: "clairic",
    answers,
    truncated: false,
    usage: {
      input_tokens: Math.max(24, Math.ceil(state.length / 4)),
      output_tokens: 0,
    },
  };
}

function simulateChatCompletion(
  modelId: string,
  input: Record<string, unknown>,
) {
  const messages = Array.isArray(input.messages)
    ? (input.messages as OpenAIMessage[])
    : [];
  const tools = Array.isArray(input.tools) ? (input.tools as OpenAITool[]) : [];
  const hasTools = tools.length > 0;

  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => textFromContent(m.content))
    .join("\n");

  const lastMessage = messages.at(-1);

  if (lastMessage?.role === "tool") {
    const toolOutput = textFromContent(lastMessage.content);
    let reply = `Here is the result from Acme Cloud:\n\n\`${toolOutput}\``;
    try {
      const parsed = JSON.parse(toolOutput) as Record<string, unknown>;
      if (typeof parsed.name === "string" && typeof parsed.plan === "string") {
        reply = `Account **${parsed.name}** is on the **${parsed.plan}** plan (contact: ${String(parsed.email ?? "n/a")}, balance: $${String(parsed.balanceUsd ?? 0)}).`;
      } else if (parsed.refundId) {
        reply = `Issued refund **${String(parsed.refundId)}** of **$${String(parsed.amountUsd)}** to account **${String(parsed.accountId)}**.`;
      } else if (parsed.rowsAffected !== undefined) {
        reply = `Executed SQL query (\`${String(parsed.query)}\`). Rows affected: **${String(parsed.rowsAffected)}**.`;
      }
    } catch {
      // keep raw summary
    }
    return buildOpenAIChatResponse(modelId, { content: reply });
  }

  const blockedMatch = systemText.match(
    /The customer's latest message was blocked before you could see it \(([^)]+)\)/,
  );
  if (blockedMatch) {
    const reason = blockedMatch[1] ?? "policy violation";
    return buildOpenAIChatResponse(modelId, {
      content: `Your message was blocked by Agent Guardrails (${reason}). I can still help you with Acme Cloud accounts, billing, servers, domains, DNS, or API questions.`,
    });
  }

  let lastUser = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      lastUser = textFromContent(messages[i]?.content);
      break;
    }
  }

  if (
    lastUser.includes("[Agent Guardrails note to assistant:") &&
    lastUser.includes("outside Acme Cloud support")
  ) {
    return buildOpenAIChatResponse(modelId, {
      content:
        "I can only help with Acme Cloud support topics—let me know if you need help with your account, billing, servers, DNS, or APIs!",
    });
  }

  if (lastUser.includes("[Agent Guardrails note to assistant:")) {
    return buildOpenAIChatResponse(modelId, {
      content:
        "Note: Agent Guardrails flagged parts of your message, so I won't repeat any sensitive details. How can I help with your Acme Cloud account or billing?",
    });
  }

  if (hasTools) {
    if (/refund.*\$?4,?800/i.test(lastUser)) {
      return buildOpenAIChatResponse(modelId, {
        toolCalls: [
          {
            id: `call_${crypto.randomUUID().slice(0, 8)}`,
            type: "function",
            function: {
              name: "issue_refund",
              arguments: JSON.stringify({
                accountId: "42",
                amountUsd: 4800,
                reason: "Customer unhappy",
              }),
            },
          },
        ],
      });
    }
    const accountMatch = lastUser.match(/\baccount\s+#?(\d+)\b/i);
    if (
      accountMatch &&
      /\b(plan|account|status|look\s*up|check)\b/i.test(lastUser)
    ) {
      return buildOpenAIChatResponse(modelId, {
        toolCalls: [
          {
            id: `call_${crypto.randomUUID().slice(0, 8)}`,
            type: "function",
            function: {
              name: "get_account",
              arguments: JSON.stringify({ accountId: accountMatch[1] }),
            },
          },
        ],
      });
    }
  }

  if (/rotate.*api key|api key/i.test(lastUser)) {
    return buildOpenAIChatResponse(modelId, {
      content:
        "To rotate your Acme Cloud API key:\n1. Open **Settings → API & Tokens** in the Acme Cloud dashboard.\n2. Click **Roll Key** next to your active key and choose a grace period (up to 24 hours).\n3. Update your services with the new key before the old one expires.",
    });
  }

  if (/summarize.*customer email|invoices look wrong/i.test(lastUser)) {
    return buildOpenAIChatResponse(modelId, {
      content:
        "Summary: Dana is reporting that their monthly invoices look incorrect and is asking someone on the team to review them.",
    });
  }

  return buildOpenAIChatResponse(modelId, {
    content:
      "Hi! I'm Nimbus, your Acme Cloud support assistant. I can help you with accounts, billing, servers, domains, DNS, and API keys.",
  });
}

function buildOpenAIChatResponse(
  modelId: string,
  opts: {
    content?: string;
    toolCalls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
  },
) {
  const hasToolCalls = Boolean(opts.toolCalls?.length);
  return {
    id: `chatcmpl_${crypto.randomUUID().slice(0, 10)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: opts.content ?? "",
          ...(hasToolCalls ? { tool_calls: opts.toolCalls } : {}),
        },
        finish_reason: hasToolCalls ? "tool_calls" : "stop",
      },
    ],
    usage: {
      prompt_tokens: 96,
      completion_tokens: 42,
      total_tokens: 138,
    },
  };
}

type AiEnvInput = {
  AI?: Ai;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
};

let loggedAuthFallback = false;

/**
 * Wraps the Workers AI binding so it uses live Cloudflare Workers AI when
 * `env.AI` or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` are configured,
 * and transparently falls back to the local simulator if unavailable or unauthorized.
 */
export function createLocalAi(envOrAi?: Ai | AiEnvInput): Ai {
  const envObj =
    envOrAi && typeof envOrAi === "object" && !("run" in envOrAi)
      ? (envOrAi as AiEnvInput)
      : undefined;
  const realAi =
    envOrAi && typeof envOrAi === "object" && "run" in envOrAi
      ? (envOrAi as Ai)
      : envObj?.AI;

  const apiToken = envObj?.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = envObj?.CLOUDFLARE_ACCOUNT_ID?.trim();

  const remoteRunner = realAi as unknown as
    | {
        run(
          model: string,
          inputs: unknown,
          options?: unknown,
        ): Promise<unknown>;
        fetch?(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
        aiGatewayLogId?: string | null;
      }
    | undefined;

  const runner = {
    get aiGatewayLogId() {
      return remoteRunner?.aiGatewayLogId ?? "local-sim";
    },
    async run(
      modelId: string,
      inputs: Record<string, unknown>,
      options?: { returnRawResponse?: boolean },
    ): Promise<unknown> {
      if (remoteRunner) {
        try {
          return await remoteRunner.run(modelId, inputs, options);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (
            !msg.includes("needs to be run remotely") &&
            !msg.includes("Remote proxy") &&
            !msg.includes("not connected")
          ) {
            throw error;
          }
        }
      }

      if (apiToken && accountId) {
        try {
          const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${modelId}`;
          const res = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(inputs),
          });
          if (res.ok) {
            const json = (await res.json()) as {
              success?: boolean;
              result?: unknown;
            };
            const unwrapped =
              json && typeof json === "object" && "result" in json
                ? json.result
                : json;
            if (options?.returnRawResponse) {
              return new Response(JSON.stringify(unwrapped), {
                status: 200,
                headers: { "content-type": "application/json" },
              });
            }
            return unwrapped;
          }
          if (!loggedAuthFallback) {
            loggedAuthFallback = true;
            console.warn(
              `[Agent Guardrails] Cloudflare Workers AI REST call returned HTTP ${res.status} (ensure CLOUDFLARE_API_TOKEN has 'Account -> Workers AI -> Edit' permission for account ${accountId}). Falling back to local simulator.`,
            );
          }
        } catch {
          // Fall back to local simulator on network error
        }
      }

      if (modelId.startsWith("@cf/cloudflare/clef")) {
        const model =
          typeof inputs.model === "string" ? inputs.model : "clef-flash";
        const questions = (inputs.questions ?? {}) as Record<
          string,
          ClefQuestion
        >;
        return simulateClef(model, inputs.state, questions);
      }
      if (modelId === "@cf/cloudflare/clairic") {
        const state = typeof inputs.state === "string" ? inputs.state : "";
        const fields = (inputs.fields ?? {}) as Record<string, ClairicField>;
        return simulateClairic(state, fields);
      }
      const chatPayload = simulateChatCompletion(modelId, inputs);
      if (options?.returnRawResponse) {
        return new Response(JSON.stringify(chatPayload), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cf-aig-log-id": "local-sim",
          },
        });
      }
      return chatPayload;
    },
    async fetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      if (remoteRunner?.fetch) {
        try {
          return await remoteRunner.fetch(input, init);
        } catch {
          // fall back to local response
        }
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
  return runner as unknown as Ai;
}
