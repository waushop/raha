"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { CircleAlert, PenLine, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// In-app replacement for window.confirm / window.prompt: the native dialogs
// break the glass look, can't be styled on iOS and block the page. Both
// return promises, so call sites stay one line:
//   if (!(await dialog.confirm({ title: "Remove goal?", tone: "danger" }))) return;
//   const name = await dialog.prompt({ title: "Rename", defaultValue: u.NAME });

type Tone = "default" | "danger";

export type ConfirmOptions = {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
  icon?: LucideIcon;
};

export type PromptOptions = {
  title: string;
  message?: React.ReactNode;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  inputMode?: "text" | "numeric";
  maxLength?: number;
  mono?: boolean;
  /** Return an error message to keep the dialog open, or null when the value is fine. */
  validate?: (value: string) => string | null;
  icon?: LucideIcon;
};

type Request =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions; resolve: (value: string | null) => void };

type DialogApi = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
};

const DialogContext = createContext<DialogApi>({
  confirm: async () => false,
  prompt: async () => null,
});

export function useDialog() {
  return useContext(DialogContext);
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setRequest({ kind: "confirm", opts, resolve })),
    [],
  );
  const prompt = useCallback(
    (opts: PromptOptions) => new Promise<string | null>((resolve) => setRequest({ kind: "prompt", opts, resolve })),
    [],
  );

  return (
    <DialogContext value={{ confirm, prompt }}>
      {children}
      {request && <DialogView key={request.opts.title} request={request} onDone={() => setRequest(null)} />}
    </DialogContext>
  );
}

function DialogView({ request, onDone }: { request: Request; onDone: () => void }) {
  const titleId = useId();
  const messageId = useId();
  const { opts } = request;
  const danger = request.kind === "confirm" && request.opts.tone === "danger";
  const Icon = opts.icon ?? (request.kind === "prompt" ? PenLine : CircleAlert);
  const [value, setValue] = useState(request.kind === "prompt" ? (request.opts.defaultValue ?? "") : "");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLFormElement>(null);

  const cancel = useCallback(() => {
    if (request.kind === "confirm") request.resolve(false);
    else request.resolve(null);
    onDone();
  }, [request, onDone]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (request.kind === "confirm") {
      request.resolve(true);
    } else {
      const v = value.trim();
      const problem = request.opts.validate?.(v) ?? (v ? null : "Can't be empty");
      if (problem) { setError(problem); inputRef.current?.focus(); return; }
      request.resolve(v);
    }
    navigator.vibrate?.(10);
    onDone();
  }

  // Focus the field (or the safe button for a destructive confirm), lock the
  // page scroll, and hand focus back to whatever opened the dialog.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      if (inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
      else if (!danger) confirmRef.current?.focus();
      else panelRef.current?.querySelector<HTMLButtonElement>("[data-cancel]")?.focus();
    }, 30);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [danger]);

  // Escape cancels; Tab stays inside the dialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); return; }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = panelRef.current.querySelectorAll<HTMLElement>("button, input");
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cancel]);

  const confirmLabel = opts.confirmLabel ?? (request.kind === "prompt" ? "Save" : "Confirm");
  const cancelLabel = request.kind === "confirm" ? (request.opts.cancelLabel ?? "Cancel") : "Cancel";

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm animate-fade-in" onClick={cancel} />
      <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-3 sm:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pointer-events-none">
        <form
          ref={panelRef}
          onSubmit={submit}
          role={danger ? "alertdialog" : "dialog"}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={opts.message ? messageId : undefined}
          className="w-full max-w-sm rounded-2xl p-5 pointer-events-auto animate-fade-up panel border border-white/[0.08] shadow-[0_24px_80px_rgba(0,0,0,0.6)] flex flex-col gap-4"
        >
          <div className="flex items-start gap-3">
            <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${danger ? "bg-red-500/15 text-red-400" : "bg-white/[0.06] text-white/80"}`}>
              <Icon size={16} strokeWidth={2.2} />
            </span>
            <div className="flex-1 min-w-0 pt-1">
              <h3 id={titleId} className="font-bold text-white leading-snug">{opts.title}</h3>
              {opts.message && <div id={messageId} className="text-xs text-[#9ca3c0] mt-1.5 leading-relaxed">{opts.message}</div>}
            </div>
            <button type="button" onClick={cancel} aria-label="Close" tabIndex={-1} className="w-8 h-8 -mr-1 -mt-1 rounded-lg hover:bg-white/5 flex items-center justify-center text-[#5a6380] hover:text-white transition-colors shrink-0">
              <X size={16} />
            </button>
          </div>

          {request.kind === "prompt" && (
            <label className="flex flex-col gap-1.5">
              {request.opts.label && <span className="text-[10px] font-bold uppercase tracking-widest text-[#5a6380]">{request.opts.label}</span>}
              <input
                ref={inputRef}
                value={value}
                onChange={(e) => { setValue(e.target.value); setError(null); }}
                inputMode={request.opts.inputMode}
                maxLength={request.opts.maxLength}
                placeholder={request.opts.placeholder}
                autoComplete="off"
                aria-invalid={error ? true : undefined}
                className={`w-full bg-white/5 border rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-[#5a6380] focus:outline-none ${error ? "border-red-500/50" : "border-white/10 focus:border-white/25"} ${request.opts.mono ? "font-mono tabular-nums tracking-[0.3em]" : ""}`}
              />
              {error && <span role="alert" className="text-[11px] text-red-400">{error}</span>}
            </label>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button type="button" data-cancel onClick={cancel} className="px-4 py-2.5 sm:py-2 text-sm border border-white/[0.08] rounded-xl text-[#9ca3c0] hover:bg-white/5 hover:text-white transition-all">
              {cancelLabel}
            </button>
            <button
              ref={confirmRef}
              type="submit"
              className={danger
                ? "px-5 py-2.5 sm:py-2 text-sm font-bold rounded-xl bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 transition-all btn-press"
                : "btn-primary px-5 py-2.5 sm:py-2 text-sm font-bold rounded-xl btn-press"}
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
