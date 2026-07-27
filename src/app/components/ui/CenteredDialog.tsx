"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { ReactNode } from "react";

interface CenteredDialogProps {
  isOpen: boolean;
  onClose: () => void;
  widthClass?: string;
  paddingClass?: string;
  children: ReactNode;
}

const dialogVariants = {
  hidden: { opacity: 0, scale: 0.92, y: 20 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 300, damping: 25 },
  },
  exit: {
    opacity: 0,
    scale: 0.92,
    y: 20,
    transition: { duration: 0.15 },
  },
};

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.2 } },
};

export default function CenteredDialog({
  isOpen,
  onClose,
  widthClass = "max-w-md",
  paddingClass = "p-6",
  children,
}: CenteredDialogProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <motion.div
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            variants={dialogVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={`relative w-full ${widthClass} glass-dialog rounded-[var(--glass-radius-xl)] ${paddingClass}`}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
