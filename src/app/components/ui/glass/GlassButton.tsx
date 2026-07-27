"use client";

import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import type { ReactNode, MouseEventHandler } from "react";

interface GlassButtonProps {
  onClick: MouseEventHandler<HTMLButtonElement>;
  loading?: boolean;
  children: ReactNode;
  loadingText?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  className?: string;
  loaderSize?: number;
  type?: "button" | "submit" | "reset";
  title?: string;
  variant?: "default" | "primary" | "danger";
  "aria-label"?: string;
}

const BASE = "inline-flex items-center justify-center gap-2 rounded-[var(--glass-radius-md)] px-4 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";

export default function GlassButton({
  onClick,
  loading = false,
  children,
  loadingText = "Loading…",
  icon,
  disabled = false,
  className = "",
  loaderSize = 16,
  type = "button",
  title,
  variant = "default",
  "aria-label": ariaLabel,
}: GlassButtonProps) {
  const variantClass = {
    default: "glass-button text-[var(--foreground)]",
    primary: "glass-button-primary text-white",
    danger: "glass-button-danger text-red-200",
  }[variant];

  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={loading || disabled}
      whileHover={disabled || loading ? undefined : { scale: 1.02 }}
      whileTap={disabled || loading ? undefined : { scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 17 }}
      className={`${BASE} ${variantClass} ${className}`}
      title={title}
      aria-label={ariaLabel}
    >
      {loading ? (
        <>
          <Loader2 size={loaderSize} className="animate-spin" />
          {loadingText}
        </>
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </motion.button>
  );
}
