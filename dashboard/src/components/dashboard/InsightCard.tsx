import type { InsightType } from "@/lib/types";
import { COLORS } from "@/lib/constants";

const config: Record<InsightType, { color: string; bg: string; icon: string }> = {
  pos: { color: COLORS.green, bg: "rgba(156, 199, 164, 0.14)", icon: "↗" },
  neg: { color: COLORS.red, bg: "rgba(212, 151, 144, 0.14)", icon: "↘" },
  warn: { color: COLORS.amber, bg: "rgba(216, 182, 146, 0.16)", icon: "•" },
  info: { color: COLORS.accent, bg: "rgba(201, 141, 134, 0.14)", icon: "◦" },
};

interface InsightCardProps {
  type: InsightType;
  title: string;
  body: string;
}

export function InsightCard({ type, title, body }: InsightCardProps) {
  const c = config[type];
  return (
    <div
      className="dashboard-panel rounded-[16px] p-4 animate-fade-in"
      style={{ backgroundColor: c.bg, borderColor: `${c.color}66` }}
    >
      <p className="text-[12px] font-semibold tracking-[-0.02em]" style={{ color: c.color }}>
        {c.icon} {title}
      </p>
      <p className="mt-2 text-[11px] leading-5 text-[#938b84]">
        {body}
      </p>
    </div>
  );
}
