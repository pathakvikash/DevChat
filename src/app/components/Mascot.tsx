"use client";

import { motion } from "framer-motion";

export default function Mascot({ size = 96 }: { size?: number }) {
  return (
    <motion.div
      className="relative"
      style={{ width: size, height: size }}
      animate={{ y: [0, -8, 0] }}
      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
    >
      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-green-400 to-yellow-400 blur-2xl opacity-30" />
      <svg viewBox="0 0 100 100" className="relative" width={size} height={size}>
        <defs>
          <linearGradient id="mascot-body" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4ade80" />
            <stop offset="100%" stopColor="#facc15" />
          </linearGradient>
        </defs>

        <circle cx="50" cy="52" r="38" fill="url(#mascot-body)" />

        <motion.g
          animate={{ scaleY: [1, 1, 0.1, 1, 1] }}
          transition={{ duration: 4, repeat: Infinity, times: [0, 0.92, 0.96, 1, 1] }}
          style={{ transformOrigin: "50px 48px" }}
        >
          <circle cx="37" cy="48" r="6" fill="white" />
          <circle cx="63" cy="48" r="6" fill="white" />
          <circle cx="37" cy="48" r="3" fill="#1e293b" />
          <circle cx="63" cy="48" r="3" fill="#1e293b" />
        </motion.g>

        <path
          d="M 38 66 Q 50 76 62 66"
          stroke="#1e293b"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />

        <motion.circle
          cx="50"
          cy="8"
          r="4"
          fill="#facc15"
          animate={{ scale: [1, 1.3, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
        <line x1="50" y1="12" x2="50" y2="20" stroke="#94a3b8" strokeWidth="2" />
      </svg>
    </motion.div>
  );
}
