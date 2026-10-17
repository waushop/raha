"use client";

import { useRef, useTransition } from "react";
import { Camera, Loader2 } from "lucide-react";
import { scanReceipt } from "@/app/assistant/actions";
import { RECEIPT_MAX_EDGE, type ReceiptScan } from "@/lib/receipt";
import { useToast } from "./Toast";

/** Fired on window by the quick-add camera: the month view opens the add form with the scan. */
export const RECEIPT_SCANNED_EVENT = "receipt-scanned";
export type ReceiptScannedDetail = { scan: ReceiptScan; previewUrl: string | null };

/**
 * Downscales a photo to at most RECEIPT_MAX_EDGE px on the long edge and
 * re-encodes it as JPEG (~0.8), which also drops EXIF metadata (location…).
 */
async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, RECEIPT_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.8));
  } finally {
    bitmap.close();
  }
}

type Props = {
  onScanned: (scan: ReceiptScan, previewUrl: string | null) => void;
  /** "icon" = square icon button (quick add); "chip" = small labelled button (add form). */
  variant?: "icon" | "chip";
};

export default function ReceiptScanButton({ onScanned, variant = "chip" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isScanning, startScan] = useTransition();
  const toast = useToast();

  function pick() {
    if (!navigator.onLine) { toast.showError("Scanning a receipt needs a connection"); return; }
    inputRef.current?.click();
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // the same photo can be picked again
    if (!file) return;
    if (!navigator.onLine) { toast.showError("Scanning a receipt needs a connection"); return; }
    startScan(async () => {
      let blob: Blob;
      try {
        blob = await downscale(file);
      } catch {
        toast.showError("Couldn't open that photo. Try a JPEG or PNG.");
        return;
      }
      const data = new FormData();
      data.set("image", new File([blob], "receipt.jpg", { type: "image/jpeg" }));
      try {
        const res = await scanReceipt(data);
        if (!res.ok) { toast.showError(res.error); return; }
        navigator.vibrate?.(10);
        onScanned(res.scan, URL.createObjectURL(blob));
      } catch {
        toast.showError(navigator.onLine ? "Scanning failed. Try again." : "Scanning a receipt needs a connection");
      }
    });
  }

  const input = (
    <input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={onFile} className="hidden" aria-label="Receipt photo" data-testid="receipt-input" />
  );

  if (variant === "icon") {
    return (
      <>
        {input}
        <button type="button" onClick={pick} disabled={isScanning} aria-label="Scan a receipt" title="Scan a receipt"
          className="shrink-0 w-11 h-11 rounded-xl border border-white/[0.08] bg-white/5 text-[#9ca3c0] hover:text-white hover:bg-white/10 flex items-center justify-center btn-press disabled:opacity-50 transition-all">
          {isScanning ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
        </button>
      </>
    );
  }
  return (
    <>
      {input}
      <button type="button" onClick={pick} disabled={isScanning}
        className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-white/[0.06] text-[#9ca3c0] hover:text-white hover:border-white/15 disabled:opacity-50 transition-all">
        {isScanning ? <Loader2 size={11} className="animate-spin" /> : <Camera size={11} />}
        {isScanning ? "Scanning…" : "Scan receipt"}
      </button>
    </>
  );
}
