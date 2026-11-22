import type { SenderStatus } from "@/lib/notifications/zoepact-sender";

function hourLabel(hour: number) {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${hour % 24 < 12 ? "am" : "pm"}`;
}

// Says out loud why queued messages are not leaving yet. Shown only when something is
// holding sending back, so a healthy screen stays quiet.
export function SenderStatusNote({ status }: { status: SenderStatus }) {
  const problems: string[] = [];
  if (!status.keyConfigured) problems.push("The Zoepact API key is not set on this deployment, so nothing can be sent.");
  if (status.wallet.state === "low") problems.push(`The Zoepact wallet balance is ₹${status.wallet.balance}; sending pauses below ₹10. Top it up.`);
  if (status.wallet.state === "unreadable" && status.keyConfigured) problems.push(`The Zoepact wallet could not be read: ${status.wallet.message}`);
  if (!status.inWindow) {
    problems.push(`Messages are only sent between ${hourLabel(status.fromHour)} and ${hourLabel(status.untilHour)} (India time). Anything queued now goes out when that opens.`);
  }
  if (problems.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-surface-border bg-surface-muted p-4 text-sm text-text-secondary">
      <p className="font-medium text-text-primary">Sending status</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {problems.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
    </div>
  );
}
