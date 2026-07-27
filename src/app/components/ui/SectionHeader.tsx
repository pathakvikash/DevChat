interface SectionHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export default function SectionHeader({
  children,
  className = "",
}: SectionHeaderProps) {
  return (
    <h3
      className={`text-sm font-semibold text-[var(--foreground)] uppercase tracking-wider mb-3 ${className}`}
    >
      {children}
    </h3>
  );
}
