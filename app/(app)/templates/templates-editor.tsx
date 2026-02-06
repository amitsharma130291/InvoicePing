"use client";

import { useEffect, useMemo, useState } from "react";

type EmailTemplate = {
  id: string;
  step: number;
  subject: string;
  body: string;
};

type UserSettings = {
  businessName: string | null;
  replyToEmail: string | null;
};

const STEP_LABEL: Record<number, string> = {
  1: "Step 1 (Day 3)",
  2: "Step 2 (Day 7)",
  3: "Step 3 (Day 14)",
};

const SAMPLE_VARS = {
  customer_name: "John Doe",
  customer_email: "john@example.com",
  amount_due: "$1,200.00",
  currency: "USD",
  hosted_invoice_url: "https://invoice.stripe.com/i/acct_123/example",
  due_date: "Jan 10, 2026",
};

function renderVars(text: string, vars: Record<string, string>) {
  return Object.entries(vars).reduce((acc, [k, v]) => {
    return acc.replaceAll(`{{${k}}}`, v);
  }, text);
}

export default function TemplatesEditor({
  templates,
  settings,
}: {
  templates: EmailTemplate[];
  settings: UserSettings | null;
}) {
  const steps = [1, 2, 3] as const;

  const byStep = useMemo(() => {
    const m = new Map<number, EmailTemplate>();
    templates.forEach((t) => m.set(t.step, t));
    return m;
  }, [templates]);

  const [activeStep, setActiveStep] = useState<number>(1);

  const [subject, setSubject] = useState<string>("");
  const [body, setBody] = useState<string>("");

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const t = byStep.get(activeStep);
    setSubject(t?.subject ?? "");
    setBody(t?.body ?? "");
    setStatus(null);
  }, [activeStep, byStep]);

  const previewVars = useMemo(() => {
    return {
      ...SAMPLE_VARS,
      business_name: settings?.businessName ?? "Your Business",
      reply_to_email: settings?.replyToEmail ?? "you@company.com",
    };
  }, [settings]);

  const subjectPreview = useMemo(
    () => renderVars(subject || "(no subject)", previewVars),
    [subject, previewVars],
  );

  const bodyPreview = useMemo(
    () => renderVars(body || "(empty body)", previewVars),
    [body, previewVars],
  );

  async function onSave() {
    setSaving(true);
    setStatus(null);

    try {
      const res = await fetch("/api/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: activeStep,
          subject,
          body,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to save template");
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
      <div className="flex gap-2">
        {steps.map((s) => (
          <button
            key={s}
            onClick={() => setActiveStep(s)}
            className={`px-3 py-1 rounded text-sm ${
              activeStep === s ? "bg-black text-white" : "bg-gray-100"
            }`}
          >
            {STEP_LABEL[s]}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        <label className="block text-sm font-medium">Subject</label>
        <input
          className="w-full border p-2 rounded"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="e.g. Friendly reminder: invoice {{stripe_invoice_id}} is overdue"
        />

        <label className="block text-sm font-medium mt-4">
          Body (plain text)
        </label>
        <textarea
          className="w-full border p-2 rounded h-44"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write the email body here. Use {{business_name}}, {{amount_due}}, etc."
        />

        <div className="flex items-center gap-3 pt-2">
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

      <div className="border rounded p-4 bg-gray-50 space-y-3">
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1">
            Preview Subject
          </div>
          <div className="text-sm">{subjectPreview}</div>
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1">
            Preview Body
          </div>
          <pre className="text-sm whitespace-pre-wrap">{bodyPreview}</pre>
        </div>

        <div className="text-xs text-gray-600 pt-2">
          Available variables:{" "}
          <span className="font-mono">
            {
              "{{customer_name}} {{customer_email}} {{amount_due}} {{currency}} {{hosted_invoice_url}} {{due_date}} {{business_name}} {{reply_to_email}}"
            }
          </span>
        </div>
      </div>
    </div>
  );
}
