"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import Link from "next/link";

type ToastType = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  href: string;
}

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const addToast = useCallback(
    (message: string, type: ToastType = "info", action?: ToastAction) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message, type, action }]);
    },
    [],
  );

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div className="fixed top-4 right-4 z-[10000] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onRemove={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onRemove,
}: {
  toast: Toast;
  onRemove: (id: number) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), 4000);
    return () => clearTimeout(timer);
  }, [toast.id, onRemove]);

  const borderColor =
    toast.type === "error"
      ? "border-red-500"
      : toast.type === "success"
        ? "border-green-500"
        : "border-blue-500";

  return (
    <div
      className={`pointer-events-auto glass-strong border ${borderColor} rounded-[var(--glass-radius-md)] px-4 py-3 shadow-lg flex items-center gap-3 min-w-[280px] max-w-[400px]`}
    >
      <span className="flex-1 text-sm text-[var(--foreground)]">{toast.message}</span>
      {toast.action && (
        <Link href={toast.action.href} className="focus-ring shrink-0 rounded-sm text-sm font-medium text-[var(--foreground)] underline hover:no-underline">
          {toast.action.label}
        </Link>
      )}
      <button
        onClick={() => onRemove(toast.id)}
        className="text-zinc-400 hover:text-zinc-200 transition shrink-0"
        aria-label="Dismiss"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 3L11 11M11 3L3 11"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
