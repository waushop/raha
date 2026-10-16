export default function YearLoading() {
  return (
    <main className="min-h-screen py-6 px-4 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-24 lg:pb-20">
      <div className="max-w-4xl mx-auto space-y-5 animate-pulse">
        <div className="card rounded-2xl px-5 py-5 h-20" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="card rounded-2xl p-4 h-20" />
          ))}
        </div>
        <div className="card rounded-2xl p-5 h-52" />
        <div className="card rounded-2xl p-5 h-48" />
        <div className="card rounded-2xl p-5 h-64" />
      </div>
    </main>
  );
}
