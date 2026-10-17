"use client";

import { useEffect } from "react";

// Last-resort error screen (errors above the page's own error boundary, e.g.
// in the sidebar or bottom bar). After a deploy, a tab still running the old
// build can fail to load a code chunk; one automatic reload fixes that.
const RELOAD_KEY = "raha-global-error-reload";

function looksLikeStaleBuild(error: Error): boolean {
  const text = `${error.name} ${error.message}`;
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|Failed to find Server Action|NEXT_NOT_FOUND|Load failed|Failed to fetch/i.test(text);
}

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (!looksLikeStaleBuild(error)) return;
    try {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
      if (Date.now() - last < 30_000) return; // reloaded a moment ago; don't loop
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch { /* storage blocked: still try once */ }
    window.location.reload();
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#111112", color: "#f5f5f7", fontFamily: "system-ui, -apple-system, sans-serif", padding: 16 }}>
        <div style={{ maxWidth: 360, width: "100%", textAlign: "center", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 20, padding: 28 }}>
          <p style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>Something went wrong</p>
          <p style={{ fontSize: 13, color: "#9ca3c0", margin: "0 0 20px" }}>
            {looksLikeStaleBuild(error) ? "The app was just updated. Reloading…" : "Try again, or reload the page."}
            {error.digest ? <span style={{ display: "block", marginTop: 6, fontSize: 11, color: "#5a6380" }}>Ref {error.digest}</span> : null}
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button onClick={() => reset()} style={{ padding: "10px 18px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#fff", fontWeight: 600 }}>Try again</button>
            <button onClick={() => window.location.reload()} style={{ padding: "10px 18px", borderRadius: 12, border: 0, background: "linear-gradient(180deg,#ffffff,#d9d9de)", color: "#0b0b0c", fontWeight: 700 }}>Reload</button>
          </div>
        </div>
      </body>
    </html>
  );
}
