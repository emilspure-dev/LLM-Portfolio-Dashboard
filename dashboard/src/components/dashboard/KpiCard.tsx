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
        "dashboard-panel min-h-[100px] rounded-none px-4 py-3 animate-fade-in",
        className
      )}
    >
      <p className="dashboard-label">{label}</p>
      <p
        className="mt-2 text-[26px] font-medium leading-none text-[#111111]"
        style={{
          color,
          fontVariantNumeric: "oldstyle-nums tabular-nums",
        }}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-2 text-[12.5px] leading-5 text-[#555555]">{sub}</p>
      )}
    </div>
  );
}
