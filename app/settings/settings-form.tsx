"use client";

import { useMemo, useState } from "react";

type UserSettings = {
  businessName: string | null;
  replyToEmail: string | null;
  remindersEnabled: boolean;
};

export default function SettingsForm({
  settings,
}: {
  settings: UserSettings | null;
}) {
  const initial = useMemo(() => {
    return {
      businessName: settings?.businessName ?? "",
      replyToEmail: settings?.replyToEmail ?? "",
      remindersEnabled: settings?.remindersEnabled ?? true,
    };
  }, [settings]);

  const [businessName, setBusinessName] = useState(initial.businessName);
  const [replyToEmail, setReplyToEmail] = useState(initial.replyToEmail);
  const [remindersEnabled, setRemindersEnabled] = useState(
    initial.remindersEnabled,
  );

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function onSave() {
    setSaving(true);
    setStatus(null);

    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: businessName.trim() || null,
          replyToEmail: replyToEmail.trim() || null,
          remindersEnabled,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to save settings");
      }

      setStatus("Saved ✅");
    } catch (e: any) {
      setStatus(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="block text-sm font-medium">Business name</label>
        <input
          className="w-full border p-2 rounded"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          placeholder="e.g. InvoicePing"
        />
        <p className="text-xs text-gray-600">
          Used in email sign-offs (e.g. “Thanks, {`{{business_name}}`}”).
        </p>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium">Reply-to email</label>
        <input
          className="w-full border p-2 rounded"
          value={replyToEmail}
          onChange={(e) => setReplyToEmail(e.target.value)}
          placeholder="e.g. accounts@youragency.com"
        />
        <p className="text-xs text-gray-600">
          Replies will go here (instead of the sending address).
        </p>
      </div>

      <div className="flex items-center justify-between border rounded p-3">
        <div>
          <div className="text-sm font-medium">Pause reminders</div>
          <div className="text-xs text-gray-600">
            When paused, no reminder emails will be sent.
          </div>
        </div>

        <button
          type="button"
          onClick={() => setRemindersEnabled((v) => !v)}
          className={`px-3 py-1 rounded text-sm ${
            remindersEnabled ? "bg-gray-100" : "bg-black text-white"
          }`}
        >
          {remindersEnabled ? "On" : "Paused"}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={saving}
          className="bg-black text-white px-4 py-2 rounded text-sm disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {status && <span className="text-sm text-gray-700">{status}</span>}
      </div>
    </div>
  );
}
