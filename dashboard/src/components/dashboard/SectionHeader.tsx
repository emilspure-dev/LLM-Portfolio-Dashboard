interface SectionHeaderProps {
  children: React.ReactNode;
}

export function SectionHeader({ children }: SectionHeaderProps) {
  return (
    <h3 className="mb-3 mt-6 text-[14px] font-semibold italic text-[#222222]">
      {children}
    </h3>
  );
}

export function SoftHr() {
  return <div className="my-4 h-px bg-[#d9d9d9]" />;
}
