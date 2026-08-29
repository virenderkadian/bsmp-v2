"use client";

import { useState } from "react";
import { ConsentPanel } from "@/app/whatsapp/consent-panel";
import { NoticesPanel } from "@/app/whatsapp/notices-panel";
import { OutboxPanel } from "@/app/whatsapp/outbox-panel";
import { SendBillsPanel } from "@/app/whatsapp/send-bills-panel";
import { MasterTabs } from "@/components/admin/master-tabs";
import type { ConsentCustomer, ConsentSummary } from "@/lib/notifications/consent";
import type { BatchProgress, FailedMessage, SendableMonth } from "@/lib/notifications/outbox";

type WhatsAppTab = "bills" | "notices" | "outbox" | "consent";

export function WhatsAppTabs({
  canSend,
  months,
  batches,
  failed,
  consentSummary,
  consentCustomers,
}: {
  canSend: boolean;
  months: SendableMonth[];
  batches: BatchProgress[];
  failed: FailedMessage[];
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
          { value: "notices", label: "Notices" },
          { value: "outbox", label: "Outbox", count: inFlight },
          { value: "consent", label: "Consent", count: consentSummary.optedIn },
        ]}
        onChange={setActiveTab}
      />

      {activeTab === "bills" ? (
        <SendBillsPanel canSend={canSend} months={months} consentSummary={consentSummary} />
      ) : null}
      {activeTab === "notices" ? <NoticesPanel /> : null}
      {activeTab === "outbox" ? (
        <OutboxPanel canSend={canSend} batches={batches} failed={failed} />
      ) : null}
      {activeTab === "consent" ? (
        <ConsentPanel canSend={canSend} summary={consentSummary} customers={consentCustomers} />
      ) : null}
    </>
  );
}
