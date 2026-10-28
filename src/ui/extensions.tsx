import {
  ArrowCounterClockwise,
  Crown,
  Fire,
  Lightning,
  Medal,
  ShieldCheck,
  ShieldSlash,
  Skull,
  Sparkle,
  Sword,
  Trophy,
  WarningOctagon,
  X,
} from "@phosphor-icons/react";
import { useState } from "react";
import { APP } from "../app";
import type { AgentState, FirewallPolicy } from "../shared";
import { cx } from "./primitives";

export type ExtensionProps = {
  state: AgentState;
  /** Call a `@callable()` method on your agent, e.g. `call("setPolicy", [policy])`. */
  call: (method: string, args: unknown[]) => Promise<unknown>;
  /** Optional callback to fire a prompt directly into the chat from the leaderboard. */
  onLaunchAttack?: (prompt: string) => void;
  /** Optional callback to open the expanded Live Attack Leaderboard Arena modal. */
  onOpenArena?: () => void;
  /** Highlights the leaderboard section when navigated to from the top header link. */
  highlighted?: boolean;
};

type CategoryMeta = {
  label: string;
  tagline: string;
  tone: string;
  bar: string;
};

export const CATEGORY_META: Record<string, CategoryMeta> = {
  prompt_injection: {
    label: "Prompt Injection",
    tagline: "System override & instruction hijack",
    tone: "text-block",
    bar: "bg-block",
  },
  jailbreak: {
    label: "Jailbreak",
    tagline: "DAN persona & rule-bypass attempt",
    tone: "text-brand",
    bar: "bg-brand",
  },
  secret_exfiltration: {
    label: "Secret Exfiltration",
    tagline: "Canary token & system prompt heist",
    tone: "text-block",
    bar: "bg-block",
  },
  pii_shared: {
    label: "PII Overshare",
    tagline: "SSN, credit card & sensitive data leak",
    tone: "text-review",
    bar: "bg-review",
  },
  attack_intent: {
    label: "Attack Intent",
    tagline: "Adversarial red-team probe",
    tone: "text-brand",
    bar: "bg-brand",
  },
  exfiltration: {
    label: "Data Exfiltration",
    tagline: "Unauthorized external email transfer",
    tone: "text-block",
    bar: "bg-block",
  },
  destructive: {
    label: "Destructive Tool",
    tagline: "High-risk SQL / large refund action",
    tone: "text-review",
    bar: "bg-review",
  },
  unrequested: {
    label: "Unrequested Tool",
    tagline: "Hidden side-effect tool invocation",
    tone: "text-info",
    bar: "bg-info",
  },
  off_topic: {
    label: "Off-Topic",
    tagline: "Out-of-scope support distraction",
    tone: "text-info",
    bar: "bg-info",
  },
};

const WIDTH_STEPS = [
  "w-[10%]",
  "w-[20%]",
  "w-[30%]",
  "w-[40%]",
  "w-[50%]",
  "w-[60%]",
  "w-[70%]",
  "w-[80%]",
  "w-[90%]",
  "w-full",
] as const;

function barWidthClass(count: number, maxCount: number): string {
  if (maxCount <= 0 || count <= 0) return "w-[10%]";
  const idx = Math.min(
    WIDTH_STEPS.length - 1,
    Math.max(0, Math.ceil((count / maxCount) * WIDTH_STEPS.length) - 1),
  );
  return WIDTH_STEPS[idx] ?? "w-full";
}

function getDefenseRank(totalHits: number, blocked: number) {
  if (totalHits === 0 && blocked === 0) {
    return {
      title: "ARENA READY",
      subtitle: "Fire an attack scenario to test the shield",
      badgeClass: "bg-info/15 text-info ring-info/30",
    };
  }
  if (totalHits <= 2) {
    return {
      title: "FIRST BLOOD DEFENDED",
      subtitle: "Clef-flash intercepted initial probes",
      badgeClass: "bg-allow/15 text-allow ring-allow/30",
    };
  }
  if (totalHits <= 5) {
    return {
      title: "ACTIVE RED-TEAM SIEGE",
      subtitle: "Multi-vector attacks neutralized live",
      badgeClass: "bg-brand/15 text-brand ring-brand/30",
    };
  }
  return {
    title: "UNBREAKABLE FORTRESS",
    subtitle: "Boss-level defense holding strong",
    badgeClass: "bg-block/15 text-block ring-block/30",
  };
}

const RED_TEAM_SCENARIOS = APP.scenarios.filter(
  (s) => s.label !== "Benign question" && s.label !== "Safe tool call",
);

function rankBadge(index: number) {
  if (index === 0) {
    return (
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-review/20 font-mono text-[11px] font-bold text-review ring-1 ring-review/40">
        <Crown size={12} weight="fill" />
      </span>
    );
  }
  if (index === 1) {
    return (
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-ink/15 font-mono text-[11px] font-bold text-ink ring-1 ring-ink/30">
        2
      </span>
    );
  }
  if (index === 2) {
    return (
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-brand/20 font-mono text-[11px] font-bold text-brand ring-1 ring-brand/40">
        3
      </span>
    );
  }
  return (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-raised font-mono text-[10px] text-muted">
      {index + 1}
    </span>
  );
}

function Slider({
  label,
  value,
  tone,
  onChange,
}: {
  label: string;
  value: number;
  tone: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="flex justify-between text-[11px] text-muted">
        <span>{label}</span>
        <span className={cx("font-mono tabular-nums", tone)}>
          {Math.round(value * 100)}%
        </span>
      </span>
      <input
        type="range"
        min={5}
        max={100}
        step={5}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="w-full accent-brand"
      />
    </label>
  );
}

/** Live firewall policy + Red-Team attack leaderboard. */
export function SidebarExtras({
  state,
  call,
  onLaunchAttack,
  onOpenArena,
  highlighted = false,
}: ExtensionProps) {
  // Optimistic value while the RPC is in flight; the synced agent state is the source of truth.
  const [pending, setPending] = useState<FirewallPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draft = pending ?? state.policy;

  const save = (next: FirewallPolicy) => {
    setPending(next);
    setError(null);
    call("setPolicy", [next])
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setPending(null));
  };

  const reset = () => {
    void call("resetStats", []);
  };

  const launchRandomAttack = () => {
    if (!onLaunchAttack || RED_TEAM_SCENARIOS.length === 0) return;
    const pick =
      RED_TEAM_SCENARIOS[Math.floor(Math.random() * RED_TEAM_SCENARIOS.length)];
    if (pick) onLaunchAttack(pick.prompt);
  };

  const { stats, leaderboard = {} } = state;
  const entries = Object.entries(leaderboard).sort(([, a], [, b]) => b - a);
  const maxCount = entries[0]?.[1] ?? 1;
  const totalHits = entries.reduce((sum, [, c]) => sum + c, 0);
  const escalations = state.traces.filter((t) =>
    t.step.includes("escalated"),
  ).length;
  const rank = getDefenseRank(totalHits, stats.blocked);

  return (
    <section className="space-y-3 border-b border-line px-4 py-3">
      <div className="flex items-center gap-2">
        {draft.enabled ? (
          <ShieldCheck weight="fill" className="text-allow" />
        ) : (
          <ShieldSlash weight="fill" className="text-block" />
        )}
        <h2 className="text-sm font-semibold tracking-tight">
          Agent Guardrails
        </h2>
        <div className="ml-auto flex items-center gap-1.5">
          {(stats.checked > 0 || entries.length > 0) && (
            <button
              type="button"
              onClick={reset}
              className="rounded-md p-1 text-faint transition hover:bg-raised hover:text-ink"
              title="Reset stats and attack leaderboard"
            >
              <ArrowCounterClockwise size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={() => save({ ...draft, enabled: !draft.enabled })}
            className={cx(
              "rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1",
              draft.enabled
                ? "bg-allow/10 text-allow ring-allow/30"
                : "bg-block/10 text-block ring-block/30",
            )}
          >
            {draft.enabled ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          ["checked", stats.checked, "text-ink"],
          ["warned", stats.warned, "text-review"],
          ["blocked", stats.blocked, "text-block"],
        ].map(([label, value, tone]) => (
          <div key={label} className="rounded-lg bg-raised/60 py-1.5">
            <div
              className={cx(
                "font-mono text-lg font-semibold tabular-nums",
                String(tone),
              )}
            >
              {value}
            </div>
            <div className="text-[10px] tracking-wider text-faint uppercase">
              {label}
            </div>
          </div>
        ))}
      </div>

      <Slider
        label="Block at"
        value={draft.blockAt}
        tone="text-block"
        onChange={(blockAt) =>
          save({
            ...draft,
            blockAt,
            reviewAt: Math.min(draft.reviewAt, blockAt),
          })
        }
      />
      <Slider
        label="Review / approval at"
        value={draft.reviewAt}
        tone="text-review"
        onChange={(reviewAt) =>
          save({
            ...draft,
            reviewAt,
            blockAt: Math.max(draft.blockAt, reviewAt),
          })
        }
      />

      <div
        id="live-attack-leaderboard"
        className={cx(
          "space-y-2 rounded-xl border p-3 transition-all duration-300",
          highlighted
            ? "border-brand bg-brand/10 ring-2 ring-brand/40"
            : "border-line bg-panel/90",
        )}
      >
        <div className="flex items-center gap-1.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-brand/20 text-brand ring-1 ring-brand/30">
            <Trophy size={14} weight="fill" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xs font-semibold tracking-tight text-ink">
                Live Attack Leaderboard
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-block/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-block tabular-nums ring-1 ring-block/30">
                <Fire size={10} weight="fill" />
                {totalHits}
              </span>
            </div>
          </div>
          {onOpenArena && (
            <button
              type="button"
              onClick={onOpenArena}
              className="rounded-md border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand transition hover:bg-brand/20"
            >
              Arena
            </button>
          )}
        </div>

        <div className="flex items-center justify-between rounded-lg border border-line/80 bg-raised/50 px-2.5 py-1.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                className={cx(
                  "rounded px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider uppercase ring-1",
                  rank.badgeClass,
                )}
              >
                {rank.title}
              </span>
              {escalations > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded bg-review/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-review tabular-nums ring-1 ring-review/30">
                  <Lightning size={9} weight="fill" />
                  {escalations} escalated
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[10px] text-muted">
              {rank.subtitle}
            </p>
          </div>
          {onLaunchAttack && (
            <button
              type="button"
              onClick={launchRandomAttack}
              className="ml-2 inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand px-2.5 py-1 text-[11px] font-semibold text-bg transition hover:brightness-110"
              title="Fire a random red-team attack into chat"
            >
              <Sword size={12} weight="fill" />
              Attack!
            </button>
          )}
        </div>

        {entries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line bg-raised/30 px-3 py-3 text-center">
            <Skull size={20} weight="duotone" className="mx-auto text-muted" />
            <p className="mt-1 text-xs font-medium text-ink">
              Zero breaches on the board
            </p>
            <p className="mt-0.5 text-[11px] text-faint">
              Click <span className="font-semibold text-brand">Attack!</span> or
              open the{" "}
              <button
                type="button"
                onClick={onOpenArena}
                className="font-semibold text-brand underline underline-offset-2 hover:text-ink"
              >
                Red-Team Arena
              </button>{" "}
              to try breaking Nimbus live.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {entries.slice(0, 5).map(([category, count], index) => {
              const meta = CATEGORY_META[category] ?? {
                label: category,
                tagline: "Intercepted policy violation",
                tone: "text-block",
                bar: "bg-block",
              };
              const share =
                totalHits > 0 ? Math.round((count / totalHits) * 100) : 0;
              return (
                <div
                  key={category}
                  className="rounded-lg border border-line/60 bg-raised/50 px-2.5 py-1.5 transition hover:border-brand/40"
                >
                  <div className="flex items-center gap-2">
                    {rankBadge(index)}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="truncate font-semibold text-ink">
                          {meta.label}
                        </span>
                        <span className="ml-2 flex items-center gap-1.5 font-mono text-xs tabular-nums">
                          <span className="text-[10px] text-faint">
                            {share}%
                          </span>
                          <span className={cx("font-bold", meta.tone)}>
                            {count}
                          </span>
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg">
                        <div
                          className={cx(
                            "h-full rounded-full transition-all duration-300",
                            meta.bar,
                            barWidthClass(count, maxCount),
                          )}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {error && <p className="text-xs text-block">{error}</p>}
    </section>
  );
}

/** Full-screen interactive Live Attack Leaderboard Arena modal triggered from the top bar. */
export function LiveAttackLeaderboardModal({
  open,
  onClose,
  state,
  onLaunchAttack,
  onReset,
}: {
  open: boolean;
  onClose: () => void;
  state: AgentState;
  onLaunchAttack: (prompt: string) => void;
  onReset: () => void;
}) {
  if (!open) return null;

  const { stats, leaderboard = {} } = state;
  const entries = Object.entries(leaderboard).sort(([, a], [, b]) => b - a);
  const maxCount = entries[0]?.[1] ?? 1;
  const totalHits = entries.reduce((sum, [, c]) => sum + c, 0);
  const escalations = state.traces.filter((t) =>
    t.step.includes("escalated"),
  ).length;
  const rank = getDefenseRank(totalHits, stats.blocked);
  const interceptRate =
    stats.checked > 0
      ? Math.min(
          100,
          Math.round(((stats.blocked + stats.warned) / stats.checked) * 100),
        )
      : 0;

  const fireAttack = (prompt: string) => {
    onLaunchAttack(prompt);
    onClose();
  };

  const fireRandom = () => {
    if (RED_TEAM_SCENARIOS.length === 0) return;
    const pick =
      RED_TEAM_SCENARIOS[Math.floor(Math.random() * RED_TEAM_SCENARIOS.length)];
    if (pick) fireAttack(pick.prompt);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        {/* Arena Header */}
        <div className="flex items-center justify-between border-b border-line bg-raised/60 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/20 text-brand ring-1 ring-brand/40">
              <Trophy size={22} weight="fill" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold tracking-tight text-ink">
                  Live Attack Leaderboard Arena
                </h2>
                <span
                  className={cx(
                    "rounded-full px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider uppercase ring-1",
                    rank.badgeClass,
                  )}
                >
                  {rank.title}
                </span>
              </div>
              <p className="text-xs text-muted">
                Real-time SQLite attack telemetry powered by Clef-flash &amp;
                Clef second-opinion escalation
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fireRandom}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-bg transition hover:brightness-110"
            >
              <Sword size={14} weight="fill" />
              Roll Random Attack
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line bg-panel p-1.5 text-muted transition hover:text-ink"
              title="Close Arena"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Arena Body */}
        <div className="scrollbar-thin space-y-5 overflow-y-auto p-5">
          {/* Scoreboard Metrics */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-line bg-raised/50 p-3">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Total Threat Hits</span>
                <Fire size={15} weight="fill" className="text-block" />
              </div>
              <div className="mt-1 font-mono text-2xl font-bold text-block tabular-nums">
                {totalHits}
              </div>
              <div className="text-[11px] text-faint">
                Logged in Durable Object SQLite
              </div>
            </div>

            <div className="rounded-xl border border-line bg-raised/50 p-3">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Hard Blocks</span>
                <WarningOctagon
                  size={15}
                  weight="fill"
                  className="text-brand"
                />
              </div>
              <div className="mt-1 font-mono text-2xl font-bold text-brand tabular-nums">
                {stats.blocked}
              </div>
              <div className="text-[11px] text-faint">
                {stats.warned} warnings issued
              </div>
            </div>

            <div className="rounded-xl border border-line bg-raised/50 p-3">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Clef Escalations</span>
                <Lightning size={15} weight="fill" className="text-review" />
              </div>
              <div className="mt-1 font-mono text-2xl font-bold text-review tabular-nums">
                {escalations}
              </div>
              <div className="text-[11px] text-faint">
                clef-flash → clef second opinion
              </div>
            </div>

            <div className="rounded-xl border border-line bg-raised/50 p-3">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Intercept Ratio</span>
                <ShieldCheck size={15} weight="fill" className="text-allow" />
              </div>
              <div className="mt-1 font-mono text-2xl font-bold text-allow tabular-nums">
                {interceptRate}%
              </div>
              <div className="text-[11px] text-faint">
                Out of {stats.checked} turns screened
              </div>
            </div>
          </div>

          {/* Top 3 Podium when populated */}
          {entries.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-3">
              {entries.slice(0, 3).map(([category, count], idx) => {
                const meta = CATEGORY_META[category] ?? {
                  label: category,
                  tagline: "Intercepted policy violation",
                  tone: "text-block",
                  bar: "bg-block",
                };
                const share =
                  totalHits > 0 ? Math.round((count / totalHits) * 100) : 0;
                const podiumStyles = [
                  "border-review/50 bg-review/10",
                  "border-line bg-raised/70",
                  "border-brand/40 bg-brand/10",
                ];
                const podiumLabels = [
                  "#1 TOP THREAT VECTOR",
                  "#2 RUNNER-UP",
                  "#3 THIRD PLACE",
                ];
                return (
                  <div
                    key={category}
                    className={cx(
                      "rounded-xl border p-3.5",
                      podiumStyles[idx] ?? "border-line bg-raised/50",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] font-bold tracking-wider text-muted uppercase">
                        {podiumLabels[idx]}
                      </span>
                      <Medal
                        size={16}
                        weight="fill"
                        className={
                          idx === 0
                            ? "text-review"
                            : idx === 1
                              ? "text-ink"
                              : "text-brand"
                        }
                      />
                    </div>
                    <div className="mt-1.5 truncate text-sm font-bold text-ink">
                      {meta.label}
                    </div>
                    <p className="truncate text-[11px] text-muted">
                      {meta.tagline}
                    </p>
                    <div className="mt-3 flex items-baseline justify-between font-mono tabular-nums">
                      <span className={cx("text-xl font-bold", meta.tone)}>
                        {count} {count === 1 ? "hit" : "hits"}
                      </span>
                      <span className="text-xs text-faint">
                        {share}% of attacks
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Ranked Standings Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-wider text-muted uppercase">
                Attack Vector Standings
              </h3>
              {(stats.checked > 0 || entries.length > 0) && (
                <button
                  type="button"
                  onClick={onReset}
                  className="inline-flex items-center gap-1 text-xs text-muted transition hover:text-block"
                >
                  <ArrowCounterClockwise size={12} />
                  Reset Arena Board
                </button>
              )}
            </div>

            {entries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line bg-raised/30 p-6 text-center">
                <Sparkle
                  size={26}
                  weight="duotone"
                  className="mx-auto text-brand"
                />
                <h4 className="mt-2 text-sm font-semibold text-ink">
                  The Arena Board Is Clean!
                </h4>
                <p className="mx-auto mt-1 max-w-md text-xs text-muted">
                  Pick any red-team challenge below or click{" "}
                  <span className="font-semibold text-brand">
                    Roll Random Attack
                  </span>{" "}
                  to launch an adversarial prompt and watch Clef-flash &amp;
                  Clef intercept it live.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised/40">
                {entries.map(([category, count], index) => {
                  const meta = CATEGORY_META[category] ?? {
                    label: category,
                    tagline: "Intercepted policy violation",
                    tone: "text-block",
                    bar: "bg-block",
                  };
                  const share =
                    totalHits > 0 ? Math.round((count / totalHits) * 100) : 0;
                  return (
                    <div
                      key={category}
                      className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-raised/80"
                    >
                      {rankBadge(index)}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-xs font-semibold text-ink">
                              {meta.label}
                            </span>
                            <span className="ml-2 hidden text-[11px] text-muted sm:inline">
                              {meta.tagline}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 font-mono text-xs tabular-nums">
                            <span className="text-faint">{share}%</span>
                            <span
                              className={cx(
                                "min-w-[3rem] text-right font-bold",
                                meta.tone,
                              )}
                            >
                              {count} {count === 1 ? "hit" : "hits"}
                            </span>
                          </div>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-bg">
                          <div
                            className={cx(
                              "h-full rounded-full transition-all duration-300",
                              meta.bar,
                              barWidthClass(count, maxCount),
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Interactive Red-Team Challenge Deck */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-wider text-muted uppercase">
                Quick-Fire Red-Team Challenges
              </h3>
              <button
                type="button"
                onClick={() =>
                  fireAttack(
                    "What attacks have you seen today? Summarize the top attack categories.",
                  )
                }
                className="text-xs font-medium text-brand hover:underline"
              >
                Ask Nimbus for Live Attack Report →
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {RED_TEAM_SCENARIOS.map((scenario) => (
                <button
                  key={scenario.label}
                  type="button"
                  onClick={() => fireAttack(scenario.prompt)}
                  className="group flex flex-col justify-between rounded-xl border border-line bg-raised/40 p-3 text-left transition hover:border-brand/50 hover:bg-raised"
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-ink group-hover:text-brand">
                      {scenario.label}
                    </span>
                    <span className="rounded-md bg-brand/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-brand">
                      Launch →
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 font-mono text-[11px] text-muted">
                    {scenario.prompt}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
