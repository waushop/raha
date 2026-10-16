export default function Loading() {
  return (
    <main className="min-h-screen py-6 px-4 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-24 lg:pb-20">
      <div className="max-w-4xl mx-auto space-y-5 animate-pulse">
        {/* Header skeleton */}
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 flex items-center justify-between">
          <div>
            <div className="h-7 w-32 bg-white/5 rounded-lg" />
            <div className="h-3 w-24 bg-white/5 rounded mt-2" />
          </div>
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-white/5 rounded-xl" />
            <div className="w-32 h-5 bg-white/5 rounded" />
            <div className="w-9 h-9 bg-white/5 rounded-xl" />
          </div>
        </div>

        {/* Stats skeleton */}
        <div className="flex gap-3 sm:grid sm:grid-cols-3 sm:gap-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="card rounded-2xl p-4 sm:p-5 min-w-[60vw] sm:min-w-0 shrink-0">
              <div className="h-3 w-20 bg-white/5 rounded mb-3" />
              <div className="h-8 w-28 bg-white/5 rounded" />
              <div className="mt-3 h-1 w-full bg-white/5 rounded-full" />
            </div>
          ))}
        </div>

        {/* Charts skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="card rounded-2xl p-5 h-48" />
          <div className="card rounded-2xl p-5 h-48" />
        </div>

        {/* Category cards skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="card rounded-2xl overflow-hidden border-t-2 border-white/[0.06]">
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
                <div className="h-4 w-20 bg-white/5 rounded" />
                <div className="h-4 w-16 bg-white/5 rounded" />
              </div>
              {[0, 1, 2].map(j => (
                <div key={j} className="px-4 py-3 flex items-center justify-between">
                  <div className="h-3 w-24 bg-white/5 rounded" />
                  <div className="h-3 w-16 bg-white/5 rounded" />
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Summary skeleton */}
        <div className="card rounded-2xl p-5 sm:p-6 h-56" />
      </div>
    </main>
  );
}
