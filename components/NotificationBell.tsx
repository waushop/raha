"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { getUnreadCount } from "@/app/inbox/actions";

// Unread badge for the sidebar header; refreshes every five minutes and
// whenever the route changes.
export default function NotificationBell() {
  const [count, setCount] = useState(0);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let alive = true;
    const load = () => getUnreadCount().then((n) => { if (alive) setCount(n); }).catch(() => {});
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [pathname]);

  return (
    <button
      onClick={() => router.push("/inbox")}
      aria-label={count > 0 ? `${count} unread nudges` : "Inbox"}
      className={`relative w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${pathname === "/inbox" ? "text-white bg-white/10" : "text-[#5a6380] hover:text-white hover:bg-white/5"}`}
    >
      <Bell size={15} />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-pink-500 text-[9px] font-bold text-white flex items-center justify-center">{count > 99 ? "99+" : count}</span>
      )}
    </button>
  );
}
