interface SectionHeaderProps {
  children: React.ReactNode;
}

export function SectionHeader({ children }: SectionHeaderProps) {
  return (
    <h3 className="mb-3 mt-6 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#aca396]">
      {children}
    </h3>
  );
}

export function SoftHr() {
  return <div className="my-4 h-px bg-[rgba(216,209,198,0.9)]" />;
}
