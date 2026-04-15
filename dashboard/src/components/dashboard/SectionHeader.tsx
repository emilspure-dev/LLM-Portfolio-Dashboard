interface SectionHeaderProps {
  children: React.ReactNode;
}

export function SectionHeader({ children }: SectionHeaderProps) {
  return (
    <h3 className="mb-3 mt-6 text-[12px] font-medium tracking-[-0.01em] text-[#525252]">
      {children}
    </h3>
  );
}

export function SoftHr() {
  return <div className="my-4 h-px bg-[#ececec]" />;
}
