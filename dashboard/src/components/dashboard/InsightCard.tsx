import type { InsightType } from "@/lib/types";

const config: Record<InsightType, { color: string; bg: string; border: string; icon: string }> = {
  pos: { color: "#15803d", bg: "#f0fdf4", border: "#bbf7d0", icon: "↗" },
  neg: { color: "#b91c1c", bg: "#fef2f2", border: "#fecaca", icon: "↘" },
  warn: { color: "#b45309", bg: "#fffbeb", border: "#fde68a", icon: "•" },
  info: { color: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe", icon: "◦" },
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
      className="rounded-[8px] border p-4 animate-fade-in"
      style={{ backgroundColor: c.bg, borderColor: c.border }}
    >
      <p className="text-[12px] font-medium tracking-[-0.01em]" style={{ color: c.color }}>
        {c.icon} {title}
      </p>
      <p className="mt-2 text-[12px] leading-5 text-[#404040]">
        {body}
      </p>
    </div>
  );
}
