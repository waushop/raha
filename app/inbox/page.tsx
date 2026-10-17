import { connection } from "next/server";
import Link from "next/link";
import { Bell, BellOff } from "lucide-react";
import { currentContext } from "@/lib/auth";
import { inboxCount, listInbox, unreadCount } from "@/lib/nudges-db";
import { pageInfo, parsePage } from "@/lib/pagination";
import Pagination, { pageHref } from "@/components/Pagination";
import InboxList from "@/components/InboxList";

const PAGE_SIZE = 30;

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await connection();
  const { workspaceId: ws } = await currentContext();
  const params = await searchParams;
  const [total, unread] = await Promise.all([inboxCount(ws), unreadCount(ws)]);
  const info = pageInfo(total, parsePage(params.page), PAGE_SIZE);
  const items = await listInbox(ws, PAGE_SIZE, info.offset);

  return (
    <main className="min-h-screen py-6 px-4 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-24 lg:pb-20">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-fade-up">
          <Link href="/dashboard" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">← Back</Link>
          <h1 className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1" style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}>
            Inbox
          </h1>
          <p className="text-xs text-[#5a6380] mt-1">
            {total === 0 ? "Nudges land here: bills due tomorrow, trials ending, plan lines running hot, tight weeks." : `${unread} unread · ${total} total`}
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
            <>
              <InboxList items={items} />
              {info.pages > 1 && <Pagination info={info} href={pageHref("/inbox", params)} label="nudges" />}
            </>
          )}
        </div>

        <p className="text-[10px] text-[#5a6380] flex items-center gap-1.5 px-1"><Bell size={10} /> Push and email delivery are configured in Settings.</p>
      </div>
    </main>
  );
}
