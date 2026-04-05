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
        "rounded-lg border border-border bg-card p-4 animate-fade-in",
        className
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold" style={{ color }}>
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
      )}
    </div>
  );
}
