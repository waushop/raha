"use client";

import { useState } from "react";
import { ImageDown } from "lucide-react";
import { useToast } from "./Toast";

export type ReviewStat = { label: string; value: string; sub?: string };

type Props = { year: string; stats: ReviewStat[]; footer?: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** A self-contained SVG (text and rects only, so canvas rasterises it reliably). */
function buildSvg(year: string, stats: ReviewStat[], footer: string | undefined): { svg: string; width: number; height: number } {
  const W = 1200, PAD = 64, COLS = 3, GAP = 20;
  const cellW = (W - PAD * 2 - GAP * (COLS - 1)) / COLS;
  const cellH = 150;
  const rows = Math.ceil(stats.length / COLS);
  const headerH = 170;
  const H = headerH + rows * (cellH + GAP) - GAP + PAD + (footer ? 36 : 0);
  const font = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
  const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  const cells = stats.map((s, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = PAD + col * (cellW + GAP);
    const y = headerH + row * (cellH + GAP);
    const value = clip(s.value, 20);
    const valueSize = value.length > 14 ? 26 : value.length > 10 ? 32 : 38;
    return `
      <rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="20" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" />
      <text x="${x + 24}" y="${y + 40}" font-family="${font}" font-size="12" font-weight="700" letter-spacing="2" fill="#7c86a6">${esc(s.label.toUpperCase())}</text>
      <text x="${x + 24}" y="${y + 88}" font-family="${mono}" font-size="${valueSize}" font-weight="700" fill="#ffffff">${esc(value)}</text>
      ${s.sub ? `<text x="${x + 24}" y="${y + 122}" font-family="${font}" font-size="15" fill="#9ca3c0">${esc(clip(s.sub, 38))}</text>` : ""}`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#14121f"/><stop offset="100%" stop-color="#0b0a12"/></linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#e7e7ec"/><stop offset="50%" stop-color="#c9c9d1"/><stop offset="100%" stop-color="#a9a9b2"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="32" fill="url(#bg)"/>
  <rect x="${PAD}" y="${PAD - 4}" width="72" height="6" rx="3" fill="url(#accent)"/>
  <text x="${PAD}" y="${PAD + 52}" font-family="${font}" font-size="48" font-weight="800" fill="#ffffff">${esc(year)} in review</text>
  <text x="${W - PAD}" y="${PAD + 52}" text-anchor="end" font-family="${font}" font-size="18" font-weight="600" letter-spacing="3" fill="#7c86a6">EMPTY WALLET</text>
  ${cells}
  ${footer ? `<text x="${PAD}" y="${H - PAD + 8}" font-family="${font}" font-size="14" fill="#5a6380">${esc(footer)}</text>` : ""}
</svg>`;
  return { svg, width: W, height: H };
}

function rasterise(svg: string, width: number, height: number, scale: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas is not available")); return; }
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the image"))), "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not render the image")); };
    img.src = url;
  });
}

export default function SaveAsImage({ year, stats, footer }: Props) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function save() {
    setBusy(true);
    try {
      const { svg, width, height } = buildSvg(year, stats, footer);
      const blob = await rasterise(svg, width, height, 2);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `empty-wallet-${year}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      navigator.vibrate?.(10);
      toast.show("Image saved");
    } catch (e) {
      toast.showError(e instanceof Error ? e.message : "Could not save the image");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={save}
      disabled={busy}
      className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-purple-400 hover:text-purple-300 disabled:opacity-50 transition-colors"
    >
      <ImageDown size={12} />
      {busy ? "Rendering…" : "Save as image"}
    </button>
  );
}
