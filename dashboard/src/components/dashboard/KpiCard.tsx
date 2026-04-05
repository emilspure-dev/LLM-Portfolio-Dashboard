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
        "dashboard-panel min-h-[96px] rounded-[16px] px-4 py-3.5 animate-fade-in",
        className
      )}
    >
      <p className="dashboard-label">
        {label}
      </p>
      <p
        className="mt-2 text-[22px] font-semibold leading-none tracking-[-0.05em] text-[#605955]"
        style={{ color }}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-2 text-[11px] leading-4 text-[#9f978f]">{sub}</p>
      )}
    </div>
  );
}
