/**
 * The Orrery mark: an orbit with one body on its rim. The orbit uses currentColor, the body the accent var.
 * The body circles the orbit (CSS keyframes in globals.css). `fast` speeds it up for busy states.
 * Reduced motion: no animation, the body rests at the upper right.
 */
export function OrreryMark({
  size = 22,
  className = "",
  spinning = true,
  fast = false,
}: {
  size?: number;
  className?: string;
  spinning?: boolean;
  fast?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 22 22"
      role="img"
      aria-label="Orrery"
      className={`shrink-0 rounded-md bg-zinc-900 text-zinc-100 ${className}`}
    >
      <circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <g className={spinning ? `orrery-orbit${fast ? " orrery-orbit-fast" : ""}` : undefined}>
        <circle cx="15.24" cy="6.76" r="1.8" fill="var(--glass-accent, #3b82f6)" />
      </g>
    </svg>
  );
}

export default OrreryMark;
