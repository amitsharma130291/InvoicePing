"use client";

import { useState } from "react";

export function PauseRemindersToggle({
  initialEnabled,
}: {
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [loading, setLoading] = useState(false);

  return (
    <label className="flex items-center gap-3">
      <input
        type="checkbox"
        checked={enabled}
        disabled={loading}
        onChange={async (e) => {
          const next = e.target.checked;
          setLoading(true);
          setEnabled(next);
          await fetch("/api/settings/reminders-enabled", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: next }),
          });
          setLoading(false);
        }}
      />
      <span>{enabled ? "Reminders ON" : "Reminders PAUSED"}</span>
    </label>
  );
}
