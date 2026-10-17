"use client";

import { useEffect, useState, useTransition } from "react";
import { BellRing, Send } from "lucide-react";
import { useToast } from "./Toast";
import { getPushConfig, removePushSubscription, savePushSubscription, sendTestPush } from "@/app/inbox/actions";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Settings card: enable or disable web push on this device.
export default function PushSettings() {
  const [config, setConfig] = useState<{ publicKey: string | null; devices: number } | null>(null);
  const [supported, setSupported] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  useEffect(() => {
    const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    // Deferred so the first render matches the server (the rule forbids a sync setState here).
    const t = setTimeout(() => {
      if (!ok) { setSupported(false); return; }
      getPushConfig().then(setConfig).catch(() => {});
      navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((s) => setSubscribed(!!s)).catch(() => {});
    }, 0);
    return () => clearTimeout(t);
  }, []);

  function enable() {
    if (!config?.publicKey) return;
    const key = config.publicKey;
    startTransition(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") { toast.showError("Notifications are blocked for this site"); return; }
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
        const json = sub.toJSON();
        const res = await savePushSubscription({ endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" } }, navigator.userAgent);
        if (!res.ok) { toast.showError(res.error); return; }
        setSubscribed(true);
        setConfig((c) => (c ? { ...c, devices: c.devices + 1 } : c));
        toast.show("Push enabled on this device");
      } catch (e) {
        toast.showError((e as Error).message || "Could not enable push");
      }
    });
  }

  function disable() {
    startTransition(async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await removePushSubscription(sub.endpoint); await sub.unsubscribe(); }
      setSubscribed(false);
      setConfig((c) => (c ? { ...c, devices: Math.max(0, c.devices - 1) } : c));
      toast.show("Push disabled on this device");
    });
  }

  function test() {
    startTransition(async () => {
      const res = await sendTestPush();
      if (!res.ok) { toast.showError(res.error); return; }
      toast.show(res.sent > 0 ? `Sent to ${res.sent} device${res.sent !== 1 ? "s" : ""}` : "No subscribed devices");
    });
  }

  return (
    <div className="card rounded-2xl p-5">
      <h2 className="text-sm font-bold text-white mb-1 flex items-center gap-2"><BellRing size={14} className="text-pink-400" /> Push notifications</h2>
      <p className="text-xs text-[#5a6380] mb-4">Bills due tomorrow, trials ending, plan lines running hot and tight weeks, delivered to this device. Everything also lands in the Inbox.</p>
      {!supported ? (
        <p className="text-xs text-amber-400/90">This browser does not support web push. On iPhone, add the app to the Home Screen first.</p>
      ) : config === null ? (
        <p className="text-xs text-[#5a6380]">Checking…</p>
      ) : !config.publicKey ? (
        <div className="text-xs text-[#9ca3c0] space-y-1">
          <p>Push is not configured on the server yet.</p>
          <p className="text-[#5a6380]">Generate keys with <code className="font-mono text-white/70">npx web-push generate-vapid-keys</code> and set <code className="font-mono text-white/70">VAPID_PUBLIC_KEY</code>, <code className="font-mono text-white/70">VAPID_PRIVATE_KEY</code> and <code className="font-mono text-white/70">VAPID_SUBJECT</code>.</p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {subscribed ? (
            <button onClick={disable} disabled={isPending} className="text-xs font-semibold rounded-xl px-3 py-2 bg-white/5 text-[#9ca3c0] hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50">Turn off on this device</button>
          ) : (
            <button onClick={enable} disabled={isPending} className="text-xs font-semibold rounded-xl px-3 py-2 bg-gradient-to-r from-pink-500 to-purple-500 text-white hover:opacity-90 transition-opacity disabled:opacity-50">Enable on this device</button>
          )}
          <button onClick={test} disabled={isPending || config.devices === 0} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-xl px-3 py-2 bg-white/5 text-[#9ca3c0] hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"><Send size={12} /> Send a test</button>
          <span className="text-[10px] text-[#5a6380]">{config.devices} device{config.devices !== 1 ? "s" : ""} subscribed</span>
        </div>
      )}
    </div>
  );
}
