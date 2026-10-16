// Generic route-level skeleton. Mirrors the page shell (same padding as every
// <main>, including the room for the pinned sidebar) so content doesn't jump
// when the real page streams in.
type Props = { width?: "3xl" | "4xl" | "5xl"; blocks?: number[] };

const WIDTH = { "3xl": "max-w-3xl", "4xl": "max-w-4xl", "5xl": "max-w-5xl" } as const;

export default function PageSkeleton({ width = "4xl", blocks = [20, 48, 64] }: Props) {
  return (
    <main className="min-h-screen py-6 px-4 pl-16 sm:pl-20 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-28 lg:pb-20">
      <div className={`${WIDTH[width]} mx-auto space-y-5 animate-pulse`}>
        {blocks.map((h, i) => (
          <div key={i} className="card rounded-2xl" style={{ height: `${h * 0.25}rem` }} />
        ))}
      </div>
    </main>
  );
}
