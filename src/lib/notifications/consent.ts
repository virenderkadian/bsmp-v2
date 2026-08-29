import "server-only";
import { logAudit } from "@/lib/audit";
import { normalizeIndianMobile } from "@/lib/notifications/phone";
import { prisma } from "@/lib/prisma";
import { withDbTimeout } from "@/lib/db-timeout";

// Consent bookkeeping. Kept separate from queueing because it outlives any one
// send: consent is a standing fact about a customer, and the same record has to
// satisfy two different audiences — WhatsApp's Business Messaging Policy, which
// requires opt-in before a business messages anyone, and India's DPDP Act,
// which requires knowing when it was given and letting people withdraw it.

export type ConsentSummary = {
  total: number;
  optedIn: number;
  // Has a usable mobile but has never been opted in — the group a bulk opt-in
  // would affect, and the number the UI needs to show before someone commits.
  eligibleNotOptedIn: number;
  // No number on file, or one that cannot receive WhatsApp. These cannot be
  // messaged at all and need fixing on the customer record, not here.
  unreachable: number;
};

type ConsentRow = {
  id: string;
  code: string;
  name: string;
  mobile: string | null;
  whatsappOptInAt: Date | null;
};

function partition(customers: ConsentRow[]) {
  const optedIn: ConsentRow[] = [];
  const eligible: ConsentRow[] = [];
  const unreachable: ConsentRow[] = [];

  for (const customer of customers) {
    if (!normalizeIndianMobile(customer.mobile).ok) {
      unreachable.push(customer);
    } else if (customer.whatsappOptInAt) {
      optedIn.push(customer);
    } else {
      eligible.push(customer);
    }
  }

  return { optedIn, eligible, unreachable };
}

export async function getConsentSummary(cityId: string): Promise<ConsentSummary> {
  const customers = await withDbTimeout(
    prisma.customer.findMany({
      where: { cityId, isActive: true },
      select: { id: true, code: true, name: true, mobile: true, whatsappOptInAt: true },
    }),
    "Loading consent summary",
    10_000,
  );

  const { optedIn, eligible, unreachable } = partition(customers);

  return {
    total: customers.length,
    optedIn: optedIn.length,
    eligibleNotOptedIn: eligible.length,
    unreachable: unreachable.length,
  };
}

export type ConsentCustomer = {
  id: string;
  code: string;
  name: string;
  mobile: string | null;
  optedInAt: Date | null;
  unreachableReason: string | null;
};

export async function getConsentCustomers(cityId: string): Promise<ConsentCustomer[]> {
  const customers = await withDbTimeout(
    prisma.customer.findMany({
      where: { cityId, isActive: true },
      select: { id: true, code: true, name: true, mobile: true, whatsappOptInAt: true },
      orderBy: { code: "asc" },
    }),
    "Loading customers for consent",
    10_000,
  );

  return customers.map((customer) => {
    const phone = normalizeIndianMobile(customer.mobile);

    return {
      id: customer.id,
      code: customer.code,
      name: customer.name,
      mobile: customer.mobile,
      optedInAt: customer.whatsappOptInAt,
      unreachableReason: phone.ok ? null : phone.reason,
    };
  });
}

export async function setCustomerConsent(input: {
  cityId: string;
  customerId: string;
  optIn: boolean;
}): Promise<void> {
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, cityId: input.cityId },
    select: { code: true, name: true, whatsappOptInAt: true },
  });

  if (!customer) {
    throw new Error("Customer not found in the active city.");
  }

  await prisma.customer.update({
    where: { id: input.customerId },
    data: { whatsappOptInAt: input.optIn ? new Date() : null },
  });

  await logAudit(prisma, {
    cityId: input.cityId,
    entityType: "Customer",
    entityId: input.customerId,
    action: input.optIn ? "WHATSAPP_OPT_IN" : "WHATSAPP_OPT_OUT",
    summary: `${customer.code} ${customer.name} ${input.optIn ? "opted in to" : "opted out of"} WhatsApp messages`,
    before: { whatsappOptInAt: customer.whatsappOptInAt },
    after: { whatsappOptInAt: input.optIn ? new Date() : null },
  });
}

// One-time backfill for customers who already have a billing relationship and
// gave their number for exactly this purpose.
//
// Deliberately narrow: only active customers, only those with a usable mobile,
// and only those never opted in before — so it can never resurrect someone who
// has explicitly opted out. It is also audited as a single bulk act, because
// "who agreed to this, and when" is precisely the question consent records
// exist to answer, and a backfill is the weakest kind of consent there is.
export async function bulkOptIn(cityId: string): Promise<number> {
  const customers = await prisma.customer.findMany({
    where: { cityId, isActive: true, whatsappOptInAt: null },
    select: { id: true, mobile: true },
  });

  const reachableIds = customers
    .filter((customer) => normalizeIndianMobile(customer.mobile).ok)
    .map((customer) => customer.id);

  if (reachableIds.length === 0) {
    return 0;
  }

  const now = new Date();
  const result = await prisma.customer.updateMany({
    where: { id: { in: reachableIds }, cityId, whatsappOptInAt: null },
    data: { whatsappOptInAt: now },
  });

  await logAudit(prisma, {
    cityId,
    entityType: "Customer",
    entityId: null,
    action: "WHATSAPP_BULK_OPT_IN",
    summary: `Bulk opted in ${result.count} existing customer(s) to WhatsApp messages`,
    after: { count: result.count, at: now },
  });

  return result.count;
}
