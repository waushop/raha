"use client";

import { useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export default function SwipeContainer({ month, children }: { month: string; children: React.ReactNode }) {
  const router = useRouter();
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const threshold = 80;

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    setSwiping(true);
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!swiping) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    // Only horizontal swipes
    if (Math.abs(dy) > Math.abs(dx) * 0.5) {
      setSwiping(false);
      setOffset(0);
      return;
    }
    // Rubber-band effect
    setOffset(dx * 0.3);
  }, [swiping]);

  const onTouchEnd = useCallback(() => {
    const dx = offset;
    setOffset(0);
    setSwiping(false);

    if (Math.abs(dx) > threshold * 0.3) {
      if (dx > 0 && month > "2026-01") {
        router.push(`/?month=${addMonths(month, -1)}`);
      } else if (dx < 0) {
        router.push(`/?month=${addMonths(month, 1)}`);
      }
    }
  }, [offset, month, router]);

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{
        transform: offset !== 0 ? `translateX(${offset}px)` : undefined,
        transition: swiping ? "none" : "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {children}
    </div>
  );
}
