import { connection } from "next/server";
import Link from "next/link";
import { Bell, BellOff } from "lucide-react";
import { currentContext } from "@/lib/auth";
import { listInbox } from "@/lib/nudges-db";
import InboxList from "@/components/InboxList";

export default async function InboxPage() {
  await connection();
  const { workspaceId: ws } = await currentContext();
  const items = await listInbox(ws, 100);
  const unread = items.filter((i) => i.READ_AT === null).length;

  return (
    <main className="min-h-screen py-6 px-4 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-24 lg:pb-20">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-fade-up">
          <Link href="/dashboard" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">← Back</Link>
          <h1 className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1" style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}>
            Inbox
          </h1>
          <p className="text-xs text-[#5a6380] mt-1">
            {items.length === 0 ? "Nudges land here: bills due tomorrow, trials ending, plan lines running hot, tight weeks." : `${unread} unread · ${items.length} total`}
          </p>
        </div>

        <div className="animate-fade-up" style={{ animationDelay: "0.05s" }}>
          {items.length === 0 ? (
            <div className="card rounded-2xl p-8 text-center">
              <BellOff size={28} strokeWidth={1.5} className="mx-auto text-[#5a6380] mb-2" />
              <p className="text-sm text-[#9ca3c0]">Nothing yet</p>
              <p className="text-xs text-[#5a6380] mt-1">Checks run every hour. Turn on push in Settings to get them on your phone.</p>
              <InboxList items={[]} />
            </div>
          ) : (
            <InboxList items={items} />
          )}
        </div>

        <p className="text-[10px] text-[#5a6380] flex items-center gap-1.5 px-1"><Bell size={10} /> Push and email delivery are configured in Settings.</p>
      </div>
    </main>
  );
}
