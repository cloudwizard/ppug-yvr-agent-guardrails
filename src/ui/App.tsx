import { useAgentChat } from "@cloudflare/ai-chat/react";
import {
  ArrowsClockwise,
  Fire,
  Lightning,
  Sparkle,
  Trophy,
} from "@phosphor-icons/react";
import { useAgent } from "agents/react";
import type { FileUIPart } from "ai";
import { useEffect, useRef, useState } from "react";
import { APP, type Scenario } from "../app";
import {
  INITIAL_STATE,
  MODELS,
  type AgentState,
  type ModelKey,
} from "../shared";
import { Composer, fileToPart } from "./Composer";
import { LiveAttackLeaderboardModal, SidebarExtras } from "./extensions";
import { Message } from "./Message";
import { cx } from "./primitives";
import { TracePanel } from "./TracePanel";

const SESSION_KEY = `${APP.slug}:session`;

function loadSession() {
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, id);
  return id;
}

export function App() {
  const [session, setSession] = useState(loadSession);
  const newSession = () => {
    const id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
    setSession(id);
  };
  // Each session id is its own Durable Object: its own memory, history and traces.
  return (
    <Workspace key={session} session={session} onNewSession={newSession} />
  );
}

function Workspace({
  session,
  onNewSession,
}: {
  session: string;
  onNewSession: () => void;
}) {
  const [state, setState] = useState<AgentState>(INITIAL_STATE);
  const [connected, setConnected] = useState(false);
  const [tab, setTab] = useState<"chat" | "trace">("chat");
  const [arenaOpen, setArenaOpen] = useState(false);
  const [highlightLeaderboard, setHighlightLeaderboard] = useState(false);

  const agent = useAgent<AgentState>({
    agent: "ChatAgent",
    name: session,
    onStateUpdate: setState,
    onOpen: () => setConnected(true),
    onClose: () => setConnected(false),
  });
  const {
    messages,
    sendMessage,
    stop,
    status,
    addToolApprovalResponse,
    clearHistory,
  } = useAgentChat({
    agent,
  });
  const busy = status === "submitted" || status === "streaming";
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length)
      bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const send = (text: string, files: FileUIPart[] = []) =>
    sendMessage({ text, files });

  const runScenario = async (scenario: Scenario) => {
    if (!scenario.attachment) return send(scenario.prompt);
    const res = await fetch(scenario.attachment);
    if (!res.ok)
      throw new Error(`Could not load ${scenario.attachment}: ${res.status}`);
    const name = scenario.attachment.split("/").pop() ?? "attachment";
    return send(scenario.prompt, [await fileToPart(await res.blob(), name)]);
  };

  const setModel = (model: ModelKey) => void agent.call("setModel", [model]);

  const totalAttackHits = Object.values(state.leaderboard ?? {}).reduce(
    (sum, count) => sum + count,
    0,
  );

  const openLeaderboardFromTop = () => {
    setArenaOpen(true);
    setHighlightLeaderboard(true);
    document
      .getElementById("live-attack-leaderboard")
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    window.setTimeout(() => setHighlightLeaderboard(false), 2200);
  };

  return (
    <div className="glow flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3 md:px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/15 ring-1 ring-brand/30">
          <Lightning weight="fill" className="text-brand" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold tracking-tight">
            {APP.name}
          </h1>
          <p className="hidden truncate text-xs text-muted sm:block">
            {APP.tagline}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <a
            href="#live-attack-leaderboard"
            onClick={(e) => {
              e.preventDefault();
              openLeaderboardFromTop();
            }}
            className="group flex shrink-0 items-center gap-1.5 rounded-lg border border-brand/40 bg-brand/10 px-2.5 py-1.5 text-xs font-semibold text-brand transition hover:border-brand hover:bg-brand/20"
            title="Open the Live Attack Leaderboard Arena"
          >
            <Trophy
              size={14}
              weight="fill"
              className="text-brand transition-transform group-hover:scale-110"
            />
            <span className="hidden sm:inline">Live Attack Leaderboard</span>
            <span className="sm:hidden">Leaderboard</span>
            <span
              className={cx(
                "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums",
                totalAttackHits > 0
                  ? "bg-block text-bg"
                  : "bg-raised text-muted",
              )}
            >
              <Fire size={10} weight="fill" />
              {totalAttackHits}
            </span>
          </a>

          <span
            className={cx(
              "h-2 w-2 rounded-full",
              connected ? "bg-allow" : "animate-pulse-dot bg-review",
            )}
            title={connected ? "Connected to your agent" : "Connecting…"}
          />
          <select
            value={state.model}
            onChange={(e) => setModel(e.target.value as ModelKey)}
            className="rounded-lg border border-line bg-panel px-2 py-1.5 text-xs focus:border-brand/60 focus:outline-none"
            title="LLM for the chat loop (the other model is the automatic fallback)"
          >
            {(Object.keys(MODELS) as ModelKey[]).map((key) => (
              <option key={key} value={key}>
                {MODELS[key].label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              clearHistory();
              onNewSession();
            }}
            className="flex items-center gap-1 rounded-lg border border-line px-2 py-1.5 text-xs text-muted transition hover:text-ink"
            title="Start a fresh agent (new Durable Object)"
          >
            <ArrowsClockwise size={13} /> New
          </button>
        </div>
      </header>

      <nav className="flex border-b border-line text-sm lg:hidden">
        {(["chat", "trace"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cx(
              "flex-1 py-2 capitalize",
              tab === t ? "border-b-2 border-brand text-ink" : "text-muted",
            )}
          >
            {t === "trace" ? `Guardrails & Trace (${state.traces.length})` : t}
          </button>
        ))}
      </nav>

      <main className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section
          className={cx(
            "min-h-0 flex-col",
            tab === "chat" ? "flex" : "hidden lg:flex",
          )}
        >
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:px-6">
              {messages.length === 0 && (
                <div className="py-10 text-center">
                  <Sparkle
                    size={28}
                    weight="duotone"
                    className="mx-auto text-brand"
                  />
                  <h2 className="mt-3 text-xl font-semibold tracking-tight">
                    {APP.name}
                  </h2>
                  <p className="mt-1 text-sm text-muted">{APP.tagline}</p>
                </div>
              )}
              {messages.map((m, i) => (
                <Message
                  key={m.id}
                  message={m}
                  streaming={busy && i === messages.length - 1}
                  onApproval={(id, approved) =>
                    void addToolApprovalResponse({ id, approved })
                  }
                />
              ))}
              {status === "submitted" && (
                <p className="animate-pulse-dot text-sm text-faint">
                  Thinking…
                </p>
              )}
              <div ref={bottom} />
            </div>
          </div>
          <div className="mx-auto w-full max-w-3xl space-y-2 px-4 pb-4 md:px-6">
            <div className="scrollbar-thin flex gap-2 overflow-x-auto pb-1">
              {APP.scenarios.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  disabled={busy}
                  onClick={() => void runScenario(s)}
                  className="shrink-0 rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted transition hover:border-brand/50 hover:text-ink disabled:opacity-40"
                >
                  {s.label}
                </button>
              ))}
            </div>
            <Composer busy={busy} onSend={send} onStop={stop} />
          </div>
        </section>
        <div
          className={cx(
            "min-h-0 border-line lg:flex lg:border-l",
            tab === "trace" ? "flex" : "hidden",
          )}
        >
          <div className="flex min-h-0 w-full flex-col bg-bg/40">
            <SidebarExtras
              state={state}
              call={(method, args) => agent.call(method, args)}
              onLaunchAttack={(prompt) => {
                setTab("chat");
                void send(prompt);
              }}
              onOpenArena={() => setArenaOpen(true)}
              highlighted={highlightLeaderboard}
            />
            <TracePanel
              traces={state.traces}
              onClear={() => void agent.call("clearTraces", [])}
            />
          </div>
        </div>
      </main>

      <LiveAttackLeaderboardModal
        open={arenaOpen}
        onClose={() => setArenaOpen(false)}
        state={state}
        onLaunchAttack={(prompt) => {
          setTab("chat");
          void send(prompt);
        }}
        onReset={() => void agent.call("resetStats", [])}
      />
    </div>
  );
}
