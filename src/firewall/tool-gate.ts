import type { FirewallPolicy, Verdict } from "../shared";
import { normalizedScore, type ClefAnswers } from "../system-one/clef";

/**
 * CHECKPOINT 1: the tool-call firewall.
 *
 * Before any tool runs, `src/server.ts` asks clef-flash these questions about the tool name,
 * its arguments and the customer's request, then calls `evaluateToolCall()` to decide:
 *
 *   "allow"   -> the tool runs immediately (read-only lookups)
 *   "approve" -> the chat shows Approve / Deny buttons (Think's `needsApproval`, e.g. refunds)
 *   "block"   -> the tool is skipped and the model is told why (Think's `beforeToolCall`, e.g. exfiltration)
 */
export const TOOL_QUESTIONS = {
  destructive: {
    type: "noul",
    instructions:
      "Does this tool call move money (refunds, credits, charges), delete records, or modify data, rather than only reading it?",
  },
  exfiltration: {
    type: "noul",
    instructions:
      "Does this tool call send, email, or forward customer data, account details, or internal records to an external, personal, or untrusted recipient?",
  },
  matches_request: {
    type: "noul",
    instructions:
      "Did the customer's request clearly and directly ask for this specific tool call and its arguments?",
  },
  risk: {
    type: "score",
    instructions:
      "Overall, how dangerous is executing this tool call without safeguards (Benign for read-only lookups, Moderate for normal refunds or account changes that need human approval, Critical for data exfiltration, destructive SQL deletes, or unrequested actions)?",
    criteria: ["Benign", "Low", "Moderate", "High", "Critical"],
  },
} as const;

export type ToolAnswers = ClefAnswers<typeof TOOL_QUESTIONS>;
export type ToolDecision = {
  verdict: Verdict;
  action: "allow" | "approve" | "block";
  reasons: string[];
};

export function evaluateToolCall(
  answers: ToolAnswers,
  policy: FirewallPolicy,
): ToolDecision {
  const exfiltration = answers.exfiltration.noul;
  const unrequested = 1 - answers.matches_request.noul;
  const destructive = answers.destructive.noul;
  const risk = normalizedScore(answers.risk);

  // Refuse outright when exfiltrating data to outsiders, running unrequested tool calls,
  // or when overall risk reaches the block threshold (e.g. destructive SQL / massive payouts).
  const blockers: Record<string, number> = {
    exfiltration,
    unrequested,
    risk,
  };
  const shouldBlock = Object.values(blockers).some((p) => p >= policy.blockAt);

  // Require human approval for money movement / state changes (`destructive`) or moderate risk.
  const reviewSignals: Array<[string, number]> = [
    ["exfiltration", exfiltration],
    ["unrequested", unrequested],
    ["destructive", destructive],
    ["risk", risk],
  ];
  const flagged = reviewSignals
    .filter(([, p]) => p >= policy.reviewAt)
    .sort(([, a], [, b]) => b - a);
  const reasons = flagged.map(([k, p]) => `${k} ${Math.round(p * 100)}%`);

  if (shouldBlock) {
    return { verdict: "block", action: "block", reasons };
  }
  if (flagged.length > 0) {
    return { verdict: "review", action: "approve", reasons };
  }
  return { verdict: "allow", action: "allow", reasons: [] };
}
