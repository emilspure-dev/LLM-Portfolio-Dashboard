import type { InsightType } from "@/lib/types";

const config: Record<InsightType, { color: string; bg: string; border: string; label: string }> = {
  pos: { color: "#1b5e20", bg: "#ffffff", border: "#bcd6bf", label: "Positive" },
  neg: { color: "#7f1d1d", bg: "#ffffff", border: "#e0bcbc", label: "Negative" },
  warn: { color: "#7c4a03", bg: "#ffffff", border: "#e2cfa8", label: "Caveat" },
  info: { color: "#1e3a8a", bg: "#ffffff", border: "#c2cce6", label: "Note" },
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
      className="rounded-[2px] border p-4 animate-fade-in"
      style={{ backgroundColor: c.bg, borderColor: c.border }}
    >
      <p className="text-[13px]" style={{ color: c.color }}>
        <span className="font-semibold italic">{c.label}.</span>{" "}
        <span className="font-semibold">{title}</span>
      </p>
      <p className="mt-1.5 text-[13px] leading-[1.55] text-[#222222]">
        {body}
      </p>
    </div>
  );
}
