"use client";

import type { ReactNode } from "react";

interface GlassNavbarProps {
  children: ReactNode;
  className?: string;
}

export default function GlassNavbar({
  children,
  className = "",
}: GlassNavbarProps) {
  return (
    <nav
      className={`glass-nav ${className}`}
    >
      {children}
    </nav>
  );
}
