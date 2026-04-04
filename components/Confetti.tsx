"use client";

import { useEffect, useState } from "react";

const COLORS = ["#ec4899", "#8b5cf6", "#2dd4bf", "#3b82f6", "#f97316", "#22c55e"];

type Particle = {
  id: number;
  x: number;
  y: number;
  color: string;
  angle: number;
  speed: number;
  spin: number;
  size: number;
};

export default function Confetti({ trigger }: { trigger: boolean }) {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    if (!trigger) return;

    const newParticles: Particle[] = [];
    for (let i = 0; i < 40; i++) {
      newParticles.push({
        id: i,
        x: 50 + (Math.random() - 0.5) * 20,
        y: 40,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        angle: Math.random() * Math.PI * 2,
        speed: 2 + Math.random() * 4,
        spin: (Math.random() - 0.5) * 10,
        size: 4 + Math.random() * 4,
      });
    }
    setParticles(newParticles);

    const timer = setTimeout(() => setParticles([]), 3000);
    return () => clearTimeout(timer);
  }, [trigger]);

  if (particles.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size * 0.6,
            backgroundColor: p.color,
            borderRadius: "1px",
            animation: `confettiFall 2.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards`,
            animationDelay: `${Math.random() * 0.3}s`,
            transform: `rotate(${p.spin * 30}deg)`,
            ["--tx" as string]: `${Math.cos(p.angle) * p.speed * 15}vw`,
            ["--ty" as string]: `${60 + Math.random() * 40}vh`,
            ["--rot" as string]: `${p.spin * 360}deg`,
          }}
        />
      ))}
    </div>
  );
}
