import type { InsightType } from "@/lib/types";
import { COLORS } from "@/lib/constants";

const config: Record<InsightType, { color: string; bg: string; icon: string }> = {
  pos: { color: COLORS.green, bg: "#0F2922", icon: "▲" },
  neg: { color: COLORS.red, bg: "#2D1518", icon: "▼" },
  warn: { color: COLORS.amber, bg: "#2D2410", icon: "⚠" },
  info: { color: COLORS.accent, bg: "#1A2E4A", icon: "◈" },
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
      className="rounded-lg border border-border p-4 animate-fade-in"
      style={{ backgroundColor: c.bg, borderColor: `${c.color}30` }}
    >
      <p className="text-sm font-semibold" style={{ color: c.color }}>
        {c.icon} {title}
      </p>
      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
        {body}
      </p>
    </div>
  );
}
