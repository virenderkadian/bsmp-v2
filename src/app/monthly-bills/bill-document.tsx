import { CompactBillDocument } from "@/app/monthly-bills/compact-bill-document";
import { MonthlyBillDocument } from "@/app/monthly-bills/monthly-bill-document";
import type { BillFormat } from "@/lib/city-settings.shared";
import type { MonthlyBillDetail } from "@/lib/monthly-bills";

// Picks the printed layout for a city. Both pages that render a bill go
// through here, so a single bill and the batch print can never disagree about
// which format the city chose.
export function BillDocument({
  bill,
  qrDataUrl,
  format,
  className,
}: {
  bill: MonthlyBillDetail;
  qrDataUrl: string | null;
  format: BillFormat;
  className?: string;
}) {
  return format === "compact" ? (
    <CompactBillDocument bill={bill} qrDataUrl={qrDataUrl} className={className} />
  ) : (
    <MonthlyBillDocument bill={bill} qrDataUrl={qrDataUrl} className={className} />
  );
}
