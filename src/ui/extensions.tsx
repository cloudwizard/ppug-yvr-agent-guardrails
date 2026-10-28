import {
  ArrowCounterClockwise,
  ShieldCheck,
  ShieldSlash,
  Trophy,
} from "@phosphor-icons/react";
import { useState } from "react";
import type { AgentState, FirewallPolicy } from "../shared";
import { cx } from "./primitives";

export type ExtensionProps = {
  state: AgentState;
  /** Call a `@callable()` method on your agent, e.g. `call("setPolicy", [policy])`. */
  call: (method: string, args: unknown[]) => Promise<unknown>;
};

const CATEGORY_LABELS: Record<string, string> = {
  prompt_injection: "Prompt Injection",
  jailbreak: "Jailbreak",
  secret_exfiltration: "Secret Exfiltration",
  pii_shared: "PII Overshare",
  attack_intent: "Attack Intent",
  off_topic: "Off-Topic",
  exfiltration: "Data Exfiltration",
  unrequested: "Unrequested Tool",
  destructive: "Destructive Tool",
};

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
        <span className={cx("font-mono", tone)}>
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
export function SidebarExtras({ state, call }: ExtensionProps) {
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

  const { stats, leaderboard = {} } = state;
  const entries = Object.entries(leaderboard).sort(([, a], [, b]) => b - a);
  const maxCount = entries[0]?.[1] ?? 1;

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
      <div className="space-y-1.5 pt-1">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
          <Trophy size={13} weight="fill" className="text-brand" />
          <span>Attack Leaderboard</span>
          <span className="ml-auto font-mono text-[10px] text-faint">
            SQLite
          </span>
        </div>
        {entries.length === 0 ? (
          <p className="rounded-lg bg-raised/40 px-2.5 py-2 text-[11px] text-faint">
            No attacks recorded yet. Try a red-team scenario to populate the
            leaderboard.
          </p>
        ) : (
          <div className="space-y-1.5 rounded-lg bg-raised/40 p-2">
            {entries.slice(0, 5).map(([category, count]) => (
              <div key={category} className="space-y-0.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="truncate font-mono text-ink">
                    {CATEGORY_LABELS[category] ?? category}
                  </span>
                  <span className="font-mono font-semibold text-block tabular-nums">
                    {count}
                  </span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-raised">
                  <div
                    className="h-full rounded-full bg-block transition-[width] duration-300"
                    style={{
                      width: `${Math.max(8, Math.round((count / maxCount) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-block">{error}</p>}
    </section>
  );
}
