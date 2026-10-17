"use client";

import { useEffect, useState, useCallback, createContext, useContext } from "react";
import { Check, CircleAlert, X } from "lucide-react";

type ToastData = {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
  variant?: "success" | "error";
};

type ToastContextType = {
  show: (message: string, action?: { label: string; onClick: () => void }) => void;
  showError: (message: string) => void;
};

const ToastContext = createContext<ToastContextType>({ show: () => {}, showError: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<(ToastData & { exiting?: boolean })[]>([]);

  const show = useCallback((message: string, action?: { label: string; onClick: () => void }) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, action, variant: "success" }]);
  }, []);

  const showError = useCallback((message: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, variant: "error" }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const latest = toasts[toasts.length - 1];
    if (latest.exiting) return;
    const timer = setTimeout(() => dismiss(latest.id), 5000);
    return () => clearTimeout(timer);
  }, [toasts, dismiss]);

  return (
    <ToastContext value={{ show, showError }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 pointer-events-none" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-xl panel border border-white/[0.08] shadow-2xl shadow-black/40 ${
              toast.exiting ? "toast-exit" : "toast-enter"
            }`}
          >
            {toast.variant === "error" ? (
              <CircleAlert size={16} color="#f87171" strokeWidth={2.5} className="shrink-0" />
            ) : (
              <Check size={16} color="#2dd4bf" strokeWidth={2.5} className="shrink-0" />
            )}
            <span className="text-sm text-white/90 font-medium">{toast.message}</span>
            {toast.action && (
              <button
                onClick={() => {
                  toast.action!.onClick();
                  dismiss(toast.id);
                }}
                className="text-sm font-bold text-pink-400 hover:text-pink-300 transition-colors ml-2 shrink-0"
              >
                {toast.action.label}
              </button>
            )}
            <button
              onClick={() => dismiss(toast.id)}
              className="text-white/30 hover:text-white/60 transition-colors ml-1 shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}
