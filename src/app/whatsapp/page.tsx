import { EmptyState } from "@/components/admin/empty-state";
import { WhatsAppTabs } from "@/app/whatsapp/whatsapp-tabs";
import { getCurrentCityId } from "@/lib/current-city";
import { getCurrentUser } from "@/lib/current-user";
import { isNotificationsEnabled } from "@/lib/notifications/config";
import { getConsentCustomers, getConsentSummary } from "@/lib/notifications/consent";
import { getFailedMessages, getRecentBatches, getSendableMonths } from "@/lib/notifications/outbox";

// Single home for everything sent to customers over WhatsApp — bills today,
// rate changes and notices next. Centralised deliberately: the alternative was
// a send button on each screen that produces messages, which scatters an
// outward-facing capability across the app and makes "what did we send, and to
// whom" a question with no single place to ask it.
export default async function WhatsAppPage() {
  if (!isNotificationsEnabled()) {
    return (
      <EmptyState message="WhatsApp messaging is not enabled on this environment. Set NOTIFICATIONS_ENABLED and NOTIFICATIONS_AGENT_SECRET to turn it on." />
    );
  }

  const currentUser = await getCurrentUser();
  const canSend = currentUser?.role === "ADMIN" || currentUser?.role === "SUPERADMIN";

  // Everything on this screen is city-wide: one action reaches every customer
  // in the city, and the customer list plus every phone number is visible on
  // the Consent tab. That is an admin's remit, so the whole page is gated
  // rather than just its buttons — the nav hides the link too, but a hidden
  // link is a convenience and this is the actual control.
  if (!canSend) {
    return (
      <EmptyState message="WhatsApp messaging is limited to admins. Ask an administrator if you need a message sent to customers." />
    );
  }

  const cityId = await getCurrentCityId();

  const [months, batches, failed, consentSummary, consentCustomers] = await Promise.all([
    getSendableMonths(cityId),
    getRecentBatches(cityId),
    getFailedMessages(cityId),
    getConsentSummary(cityId),
    getConsentCustomers(cityId),
  ]);

  return (
    <WhatsAppTabs
      canSend={canSend}
      months={months}
      batches={batches}
      failed={failed}
      consentSummary={consentSummary}
      consentCustomers={consentCustomers}
    />
  );
}
