"use client";

import { useRef, useState, useCallback } from "react";

type Props = {
  children: React.ReactNode;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  leftLabel?: string;
  rightLabel?: string;
};

export default function SwipeRow({ children, onSwipeLeft, onSwipeRight, leftLabel = "Kustuta", rightLabel = "Muuda" }: Props) {
  const touchStartX = useRef(0);
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const threshold = 70;

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    setSwiping(true);
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!swiping) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    // Limit range and add rubber band
    const clamped = Math.sign(dx) * Math.min(Math.abs(dx) * 0.5, 100);
    setOffset(clamped);
  }, [swiping]);

  const onTouchEnd = useCallback(() => {
    setSwiping(false);
    if (offset < -threshold && onSwipeLeft) {
      onSwipeLeft();
    } else if (offset > threshold && onSwipeRight) {
      onSwipeRight();
    }
    setOffset(0);
  }, [offset, onSwipeLeft, onSwipeRight]);

  return (
    <div className="relative overflow-hidden sm:overflow-visible">
      {/* Background action indicators */}
      {offset > 20 && (
        <div className="absolute inset-y-0 left-0 flex items-center pl-4 text-xs font-bold text-purple-400">
          {rightLabel}
        </div>
      )}
      {offset < -20 && (
        <div className="absolute inset-y-0 right-0 flex items-center pr-4 text-xs font-bold text-red-400">
          {leftLabel}
        </div>
      )}
      {/* Content */}
      <div
        className="sm:transform-none"
        style={{
          transform: offset !== 0 ? `translateX(${offset}px)` : undefined,
          transition: swiping ? "none" : "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}
