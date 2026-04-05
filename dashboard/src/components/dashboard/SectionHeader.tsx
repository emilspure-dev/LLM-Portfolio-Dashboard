interface SectionHeaderProps {
  children: React.ReactNode;
}

export function SectionHeader({ children }: SectionHeaderProps) {
  return (
    <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-4 mt-6">
      {children}
    </h3>
  );
}

export function SoftHr() {
  return <hr className="border-border my-6 opacity-40" />;
}
