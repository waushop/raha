import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card rounded-2xl p-8 sm:p-12 max-w-md w-full text-center">
        <div className="text-6xl mb-4">💸</div>
        <h2 className="text-lg font-bold text-white mb-2">Lehte ei leitud</h2>
        <p className="text-sm text-[#8892b0] mb-6">See leht on kadunud nagu raha pärast poeskäiku</p>
        <Link
          href="/"
          className="inline-block px-6 py-2.5 rounded-xl gradient-pink text-white text-sm font-bold shadow-lg shadow-pink-500/20 btn-press hover:opacity-90 transition-opacity"
        >
          Tagasi avalehele
        </Link>
      </div>
    </main>
  );
}
