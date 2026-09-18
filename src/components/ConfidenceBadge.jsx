import { confidenceTier } from "../services/complianceAssistant";

// Renders the 🟢/🟡/🔴 confidence indicator. The score itself always comes
// from the deterministic reconciliation engine — this component only
// formats it, never computes it.
export default function ConfidenceBadge({ score }) {
  if (score === null || score === undefined) return null;
  const tier = confidenceTier(score);
  return (
    <span className={`confidence-badge confidence-${tier.label.split(" ")[0].toLowerCase()}`}>
      {tier.emoji} {score}% · {tier.label}
    </span>
  );
}
