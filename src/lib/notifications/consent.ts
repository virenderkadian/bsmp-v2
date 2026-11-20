import "server-only";
import { logAudit } from "@/lib/audit";
import { normalizeIndianMobile } from "@/lib/notifications/phone";
import { getCustomerRoutes, NO_ROUTE } from "@/lib/notifications/customer-routes";
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
  // Customers who also agreed to "your delivery is completed" messages.
  deliveryUpdatesOptedIn: number;
  // Customers who also agreed to "we received your payment" messages.
  paymentUpdatesOptedIn: number;
};

type ConsentRow = {
  id: string;
  code: string;
  name: string;
  mobile: string | null;
  whatsappOptInAt: Date | null;
  deliveryUpdatesOptInAt: Date | null;
  paymentUpdatesOptInAt: Date | null;
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
      select: { id: true, code: true, name: true, mobile: true, whatsappOptInAt: true, deliveryUpdatesOptInAt: true, paymentUpdatesOptInAt: true },
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
    deliveryUpdatesOptedIn: customers.filter((customer) => customer.deliveryUpdatesOptInAt && customer.whatsappOptInAt).length,
    paymentUpdatesOptedIn: customers.filter((customer) => customer.paymentUpdatesOptInAt && customer.whatsappOptInAt).length,
  };
}

export type ConsentCustomer = {
  id: string;
  code: string;
  name: string;
  mobile: string | null;
  optedInAt: Date | null;
  deliveryOptedInAt: Date | null;
  paymentOptedInAt: Date | null;
  unreachableReason: string | null;
};

export async function getConsentCustomers(cityId: string): Promise<ConsentCustomer[]> {
  const customers = await withDbTimeout(
    prisma.customer.findMany({
      where: { cityId, isActive: true },
      select: { id: true, code: true, name: true, mobile: true, whatsappOptInAt: true, deliveryUpdatesOptInAt: true, paymentUpdatesOptInAt: true },
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
      deliveryOptedInAt: customer.deliveryUpdatesOptInAt,
      paymentOptedInAt: customer.paymentUpdatesOptInAt,
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
    // Withdrawing WhatsApp consent withdraws the extra opt-ins (delivery, payment updates)
    // with it: they only ever mean something on top of this one.
    data: input.optIn
      ? { whatsappOptInAt: new Date() }
      : { whatsappOptInAt: null, deliveryUpdatesOptInAt: null, paymentUpdatesOptInAt: null },
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

// ---- Extra opt-ins: delivery updates and payment updates ----
//
// "Your delivery is completed" can arrive every delivery day and "we received your payment"
// after every payment, both far more often than a monthly bill, so each has its own dated
// consent. A customer needs BOTH the extra one and general WhatsApp consent. Opting someone in
// here never grants the general one: a customer who has not agreed to WhatsApp at all must be
// asked about that first.

export type UpdatesKind = "delivery" | "payment";

const KIND = {
  delivery: { column: "deliveryUpdatesOptInAt", label: "delivery updates", audit: "DELIVERY_UPDATES" },
  payment: { column: "paymentUpdatesOptInAt", label: "payment updates", audit: "PAYMENT_UPDATES" },
} as const satisfies Record<UpdatesKind, { column: "deliveryUpdatesOptInAt" | "paymentUpdatesOptInAt"; label: string; audit: string }>;

export async function setUpdatesConsent(input: { cityId: string; customerId: string; kind: UpdatesKind; optIn: boolean }): Promise<void> {
  const { column, label, audit } = KIND[input.kind];
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, cityId: input.cityId },
    select: { code: true, name: true, whatsappOptInAt: true, deliveryUpdatesOptInAt: true, paymentUpdatesOptInAt: true },
  });
  if (!customer) throw new Error("Customer not found in the active city.");
  if (input.optIn && !customer.whatsappOptInAt) {
    throw new Error("This customer has not opted in to WhatsApp messages yet. Record that consent first.");
  }

  const at = input.optIn ? new Date() : null;
  await prisma.customer.update({ where: { id: input.customerId }, data: { [column]: at } });

  await logAudit(prisma, {
    cityId: input.cityId,
    entityType: "Customer",
    entityId: input.customerId,
    action: input.optIn ? `${audit}_OPT_IN` : `${audit}_OPT_OUT`,
    summary: `${customer.code} ${customer.name} ${input.optIn ? "opted in to" : "opted out of"} ${label}`,
    before: { [column]: customer[column] },
    after: { [column]: at },
  });
}

export type OptInCandidate = {
  customerId: string;
  customerCode: string;
  customerName: string;
  mobile: string;
  routeId: string;
  routeLabel: string;
  vehicleId: string;
  vehicleLabel: string;
};

export type OptInPlan = {
  candidates: OptInCandidate[];
  // Active customers who could not be listed, counted so the office knows what is left.
  alreadyOptedIn: number;
  noWhatsAppConsent: number;
  noNumber: number;
};

// Customers who COULD be opted in: general WhatsApp consent, a usable mobile, and not already
// opted in to this kind. Read-only, so the office sees the list before choosing.
export async function planUpdatesOptIn(cityId: string, kind: UpdatesKind): Promise<OptInPlan> {
  const { column } = KIND[kind];
  const [customers, routes] = await withDbTimeout(
    Promise.all([
      prisma.customer.findMany({
        where: { cityId, isActive: true },
        select: { id: true, code: true, name: true, mobile: true, whatsappOptInAt: true, deliveryUpdatesOptInAt: true, paymentUpdatesOptInAt: true },
        orderBy: { code: "asc" },
      }),
      getCustomerRoutes(cityId),
    ]),
    "Loading opt-in list",
    20_000,
  );

  const candidates: OptInCandidate[] = [];
  let alreadyOptedIn = 0;
  let noWhatsAppConsent = 0;
  let noNumber = 0;

  for (const customer of customers) {
    if (!customer.whatsappOptInAt) {
      noWhatsAppConsent += 1;
      continue;
    }
    const phone = normalizeIndianMobile(customer.mobile);
    if (!phone.ok) {
      noNumber += 1;
      continue;
    }
    if (customer[column]) {
      alreadyOptedIn += 1;
      continue;
    }
    candidates.push({
      customerId: customer.id,
      customerCode: customer.code,
      customerName: customer.name,
      mobile: phone.msisdn,
      ...(routes.get(customer.id) ?? NO_ROUTE),
    });
  }

  return { candidates, alreadyOptedIn, noWhatsAppConsent, noNumber };
}

// Opts the chosen customers in. It re-checks every one, so it can only NARROW the plan:
// someone without WhatsApp consent, without a usable number, or already opted in is ignored
// even if named. Audited as one bulk act, because "who agreed to this, and when" is exactly
// what a consent record exists to answer.
export async function bulkOptInUpdates(input: { cityId: string; kind: UpdatesKind; customerIds: string[] }): Promise<number> {
  if (input.customerIds.length === 0) return 0;
  const { column, label, audit } = KIND[input.kind];
  const plan = await planUpdatesOptIn(input.cityId, input.kind);
  const chosen = new Set(input.customerIds);
  const ids = plan.candidates.filter((candidate) => chosen.has(candidate.customerId)).map((candidate) => candidate.customerId);
  if (ids.length === 0) return 0;

  const now = new Date();
  const result = await prisma.customer.updateMany({
    where: { id: { in: ids }, cityId: input.cityId, whatsappOptInAt: { not: null }, [column]: null },
    data: { [column]: now },
  });

  await logAudit(prisma, {
    cityId: input.cityId,
    entityType: "Customer",
    entityId: null,
    action: `${audit}_BULK_OPT_IN`,
    summary: `Opted ${result.count} customer(s) in to ${label}`,
    after: { count: result.count, at: now, requested: input.customerIds.length },
  });

  return result.count;
}

// The delivery-updates names the rest of the app already uses.
export const setDeliveryUpdatesConsent = (input: { cityId: string; customerId: string; optIn: boolean }) =>
  setUpdatesConsent({ ...input, kind: "delivery" });
export const planDeliveryOptIn = (cityId: string) => planUpdatesOptIn(cityId, "delivery");
export const bulkOptInDeliveryUpdates = (input: { cityId: string; customerIds: string[] }) => bulkOptInUpdates({ ...input, kind: "delivery" });
export type DeliveryOptInCandidate = OptInCandidate;
export type DeliveryOptInPlan = OptInPlan;
