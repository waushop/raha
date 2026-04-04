"use client";

import { useEffect, useState, useCallback, createContext, useContext } from "react";

type ToastData = {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
};

type ToastContextType = {
  show: (message: string, action?: { label: string; onClick: () => void }) => void;
};

const ToastContext = createContext<ToastContextType>({ show: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<(ToastData & { exiting?: boolean })[]>([]);

  const show = useCallback((message: string, action?: { label: string; onClick: () => void }) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, action }]);
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
    <ToastContext value={{ show }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 pointer-events-none" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-2xl bg-[#1f2940]/95 backdrop-blur-xl border border-white/10 shadow-2xl shadow-black/40 ${
              toast.exiting ? "toast-exit" : "toast-enter"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M20 6L9 17l-5-5" />
            </svg>
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
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}
