import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card rounded-2xl p-8 sm:p-12 max-w-md w-full text-center">
        <div className="text-6xl mb-4">💸</div>
        <h2 className="text-lg font-bold text-white mb-2">Page not found</h2>
        <p className="text-sm text-[#9ca3c0] mb-6">This page is gone like money after grocery shopping</p>
        <Link
          href="/"
          className="inline-block px-6 py-2.5 rounded-xl gradient-pink text-white text-sm font-bold shadow-lg shadow-pink-500/20 btn-press hover:opacity-90 transition-opacity"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
