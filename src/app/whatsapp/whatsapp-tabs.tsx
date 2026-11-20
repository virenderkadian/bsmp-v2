"use client";

import { useState } from "react";
import { ConsentPanel } from "@/app/whatsapp/consent-panel";
import { NoticesPanel } from "@/app/whatsapp/notices-panel";
import { OutboxPanel } from "@/app/whatsapp/outbox-panel";
import { RemindersPanel } from "@/app/whatsapp/reminders-panel";
import { TemplatesPanel } from "@/app/whatsapp/templates-panel";
import { SendBillsPanel } from "@/app/whatsapp/send-bills-panel";
import { MasterTabs } from "@/components/admin/master-tabs";
import type { ConsentCustomer, ConsentSummary } from "@/lib/notifications/consent";
import type { NoticeProduct } from "@/lib/notifications/notices";
import type { BatchProgress, FailedMessage, PendingMessage, SendableMonth } from "@/lib/notifications/outbox";

type WhatsAppTab = "bills" | "reminders" | "notices" | "outbox" | "consent" | "templates";

export function WhatsAppTabs({
  canSend,
  months,
  batches,
  failed,
  waiting,
  products,
  consentSummary,
  consentCustomers,
}: {
  canSend: boolean;
  months: SendableMonth[];
  batches: BatchProgress[];
  failed: FailedMessage[];
  waiting: PendingMessage[];
  products: NoticeProduct[];
  consentSummary: ConsentSummary;
  consentCustomers: ConsentCustomer[];
}) {
  const [activeTab, setActiveTab] = useState<WhatsAppTab>("bills");

  // Rows still moving. Surfaced on the tab itself because a send spans one to
  // two days — the question "is it still running?" gets asked far more often
  // than the outbox screen gets opened.
  const inFlight = batches.reduce((total, batch) => total + batch.pending + batch.sending, 0);

  return (
    <>
      <MasterTabs
        activeValue={activeTab}
        tabs={[
          { value: "bills", label: "Send bills" },
          { value: "reminders", label: "Reminders" },
          { value: "notices", label: "Notices" },
          { value: "outbox", label: "Outbox", count: inFlight },
          { value: "consent", label: "Consent", count: consentSummary.optedIn },
          { value: "templates", label: "Templates" },
        ]}
        onChange={setActiveTab}
      />

      {activeTab === "bills" ? (
        <SendBillsPanel canSend={canSend} months={months} consentSummary={consentSummary} />
      ) : null}
      {activeTab === "reminders" ? <RemindersPanel canSend={canSend} /> : null}
      {activeTab === "notices" ? <NoticesPanel canSend={canSend} products={products} /> : null}
      {activeTab === "outbox" ? (
        <OutboxPanel canSend={canSend} batches={batches} failed={failed} waiting={waiting} />
      ) : null}
      {activeTab === "templates" ? <TemplatesPanel /> : null}
      {activeTab === "consent" ? (
        <ConsentPanel canSend={canSend} summary={consentSummary} customers={consentCustomers} />
      ) : null}
    </>
  );
}
