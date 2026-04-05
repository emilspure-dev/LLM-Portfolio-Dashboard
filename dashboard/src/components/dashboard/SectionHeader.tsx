interface SectionHeaderProps {
  children: React.ReactNode;
}

export function SectionHeader({ children }: SectionHeaderProps) {
  return (
    <h3 className="mb-3 mt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#b5ada6]">
      {children}
    </h3>
  );
}

export function SoftHr() {
  return <div className="my-4 h-px bg-[rgba(223,216,210,0.8)]" />;
}
