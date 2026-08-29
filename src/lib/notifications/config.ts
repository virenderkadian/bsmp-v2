// Feature gate for the whole customer-notifications module.
//
// The module is opt-in and off by default. With NOTIFICATIONS_ENABLED unset,
// the WhatsApp screen and its nav entry disappear, the agent API routes reject
// every request, and nothing is ever queued — the app behaves exactly as it did
// before the feature existed. That is deliberate: this talks to customers, so
// the failure mode of a half-configured deployment must be silence, not
// accidental messages.

// Sending also needs a shared secret for the office-PC agent. Enabled but
// unconfigured is treated as disabled rather than as an error, so a partial
// rollout (env var set on one environment, not another) can't half-work.
export function isNotificationsEnabled(): boolean {
  return process.env.NOTIFICATIONS_ENABLED === "true" && Boolean(process.env.NOTIFICATIONS_AGENT_SECRET);
}

// Raised by server actions rather than returning a soft error: reaching a
// queue/send action while the feature is off means the UI leaked through a
// gate it should have respected, and failing closed is the safe direction.
export function assertNotificationsEnabled(): void {
  if (!isNotificationsEnabled()) {
    throw new Error("Customer notifications are not enabled on this environment.");
  }
}
