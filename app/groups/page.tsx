import { connection } from "next/server";
import { getGroups } from "@/app/actions";
import Link from "next/link";
import GroupList from "@/components/GroupList";

export default async function GroupsPage() {
  await connection();
  const groups = await getGroups();

  return (
    <main className="min-h-screen py-6 px-4 pl-16 sm:pl-20 lg:pl-[19.5rem] lg:pr-6 sm:py-10 pb-28 lg:pb-20">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 animate-fade-up">
          <Link href="/dashboard" className="text-xs text-[#5a6380] hover:text-pink-400 transition-colors">← Back</Link>
          <h1
            className="text-3xl sm:text-4xl bg-gradient-to-r from-pink-500 via-purple-400 to-violet-500 bg-clip-text text-transparent leading-tight mt-1"
            style={{ fontFamily: "var(--font-hand), cursive", fontWeight: 700 }}
          >
            Groups
          </h1>
          <p className="text-xs text-[#5a6380] mt-1">Organize your expenses into custom groups</p>
        </div>

        <div className="animate-fade-up" style={{ animationDelay: "0.05s" }}>
          <GroupList groups={groups} />
        </div>
      </div>
    </main>
  );
}
