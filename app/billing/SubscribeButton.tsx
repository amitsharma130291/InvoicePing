"use client";

import { useState } from "react";

export default function SubscribeButton() {
  const [loading, setLoading] = useState(false);

  return (
    <button
      disabled={loading}
      onClick={async () => {
        try {
          setLoading(true);
          console.log("Subscribe clicked");

          const res = await fetch("/api/billing/checkout", { method: "POST" });

          // If API returns error text, surface it
          if (!res.ok) {
            const txt = await res.text();
            console.error("Checkout API failed:", res.status, txt);
            alert(`Checkout failed (${res.status}): ${txt}`);
            return;
          }

          const data = (await res.json()) as { url?: string };

          if (!data.url) {
            console.error("No url returned from checkout API:", data);
            alert("Checkout failed: no url returned");
            return;
          }

          window.location.assign(data.url);
        } catch (e: any) {
          console.error("Subscribe click error:", e);
          alert(`Subscribe error: ${e?.message ?? String(e)}`);
        } finally {
          setLoading(false);
        }
      }}
      style={{
        display: "inline-block",
        background: "black",
        color: "white",
        padding: "10px 14px",
        borderRadius: 8,
        border: "none",
        cursor: loading ? "not-allowed" : "pointer",
        opacity: loading ? 0.7 : 1,
      }}
    >
      {loading ? "Redirecting..." : "Subscribe ($29/mo)"}
    </button>
  );
}
