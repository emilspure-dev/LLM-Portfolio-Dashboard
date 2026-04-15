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
        "dashboard-panel min-h-[108px] rounded-[18px] px-4 py-4 animate-fade-in",
        className
      )}
    >
      <p className="dashboard-label">
        {label}
      </p>
      <p
        className="mt-3 text-[24px] font-semibold leading-none tracking-[-0.06em] text-[#3a342f]"
        style={{ color }}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-2.5 text-[11px] leading-4 text-[#938a80]">{sub}</p>
      )}
    </div>
  );
}
