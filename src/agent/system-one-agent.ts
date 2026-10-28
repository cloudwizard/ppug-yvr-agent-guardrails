import { Think } from "@cloudflare/think";
import { callable } from "agents";
import type { ContextConfig } from "agents/context";
import { createAI } from "agents/models/ai-sdk";
import {
  INITIAL_STATE,
  MODELS,
  type AgentState,
  type DecisionTrace,
  type ModelKey,
  type Verdict,
} from "../shared";
import {
  decide,
  type ClefAnswers,
  type ClefQuestions,
  type DecideInput,
  type DecideResult,
} from "../system-one/clef";
import {
  extract,
  type ClairicAnswers,
  type ClairicFields,
  type ExtractInput,
  type ExtractResult,
} from "../system-one/clairic";
import { createLocalAi } from "../system-one/local-ai";
import {
  appendTrace,
  buildTrace,
  clairicRows,
  clefRows,
  preview,
} from "../system-one/trace";

type TraceOptions<A> = {
  /** Label shown in the Decision Trace panel. */
  step: string;
  verdict?: (answers: A) => Verdict | undefined;
  summary?: (answers: A) => string | undefined;
};

/**
 * Shared plumbing for every PPUG starter. You normally do not need to edit this file:
 * customize the agent in `src/server.ts` instead.
 *
 * - LLM turns run through AI Gateway (`createAI`) with the model picked in the UI and the
 *   other model as automatic fallback.
 * - `decideTraced()` / `extractTraced()` call Clef / Clairic through the same gateway and push a
 *   DecisionTrace into agent state, which syncs live to the UI over the agent WebSocket.
 * - Memory: a read-only `soul` block (your persona) plus a writable `memory` block the model
 *   updates with `set_context`. Both persist in this Durable Object's SQLite.
 */
export abstract class SystemOneAgent extends Think<Env, AgentState> {
  override initialState: AgentState = INITIAL_STATE;

  /** Short app id attached to every AI Gateway log entry. */
  abstract readonly appSlug: string;
  /** System identity for the LLM. */
  abstract soul(): string;

  protected get ai(): Ai {
    return createLocalAi(
      this.env as unknown as {
        AI?: Ai;
        CLOUDFLARE_API_TOKEN?: string;
        CLOUDFLARE_ACCOUNT_ID?: string;
      },
    );
  }

  override getModel() {
    const key: ModelKey =
      this.state.model in MODELS ? this.state.model : INITIAL_STATE.model;
    const ai = createAI({
      binding: this.ai,
      id: this.env.AI_GATEWAY_ID,
      metadata: { app: this.appSlug, model: key },
    });
    const fallback = (Object.keys(MODELS) as ModelKey[])
      .filter((k) => k !== key)
      .map((k) => MODELS[k].id);
    return ai(MODELS[key].id, {
      fallback,
      // DeepSeek V4 Flash can turn reasoning off entirely; GLM-5.3 Flash always reasons, keep it light.
      reasoningEffort: key === "deepseek-v4-flash" ? null : "low",
    });
  }

  override configureContext(): ContextConfig[] {
    return [
      { label: "soul", provider: { get: async () => this.soul() } },
      {
        label: "memory",
        description:
          "Durable facts about the user, their preferences, and decisions made so far.",
        maxTokens: 2000,
      },
    ];
  }

  @callable()
  setModel(model: ModelKey) {
    if (!(model in MODELS)) throw new Error(`Unknown model "${model}"`);
    this.setState({ ...this.state, model });
  }

  @callable()
  clearTraces() {
    this.setState({ ...this.state, traces: [] });
  }

  protected recordTrace(trace: DecisionTrace) {
    this.setState({
      ...this.state,
      traces: appendTrace(this.state.traces, trace),
    });
  }

  protected get gateway() {
    return {
      gatewayId: this.env.AI_GATEWAY_ID,
      metadata: { app: this.appSlug },
    };
  }

  /** Run a Clef decision and record it in the Decision Trace panel. */
  protected async decideTraced<const Q extends ClefQuestions>(
    input: DecideInput<Q>,
    trace: TraceOptions<ClefAnswers<Q>>,
  ): Promise<DecideResult<Q>> {
    const result = await decide(this.ai, input, {
      ...this.gateway,
      metadata: { ...this.gateway.metadata, step: trace.step },
    });
    this.recordTrace(
      buildTrace(result, clefRows(input.questions, result.answers), {
        step: trace.step,
        verdict: trace.verdict?.(result.answers),
        summary: trace.summary?.(result.answers),
        inputPreview: preview(
          typeof input.state === "string"
            ? input.state
            : JSON.stringify(input.state),
        ),
      }),
    );
    return result;
  }

  /** Run a Clairic extraction and record it in the Decision Trace panel. */
  protected async extractTraced<const F extends ClairicFields>(
    input: ExtractInput<F>,
    trace: TraceOptions<ClairicAnswers<F>>,
  ): Promise<ExtractResult<F>> {
    const result = await extract(this.ai, input, {
      ...this.gateway,
      metadata: { ...this.gateway.metadata, step: trace.step },
    });
    this.recordTrace(
      buildTrace(result, clairicRows(input.fields, result.answers), {
        step: trace.step,
        verdict: trace.verdict?.(result.answers),
        summary: trace.summary?.(result.answers),
        inputPreview: preview(input.state),
      }),
    );
    return result;
  }
}
