import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string;
  color?: string;
  sub?: string;
  className?: string;
}

export function KpiCard({ label, value, color, sub, className }: KpiCardProps) {
  return (
    <div
      className={cn(
        "dashboard-panel min-h-[108px] rounded-[8px] px-4 py-4 animate-fade-in",
        className
      )}
    >
      <p className="dashboard-label">
        {label}
      </p>
      <p
        className="mt-3 text-[24px] font-medium leading-none tracking-[-0.04em] text-[#0a0a0a]"
        style={{ color }}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-2.5 text-[12px] leading-4 text-[#737373]">{sub}</p>
      )}
    </div>
  );
}
