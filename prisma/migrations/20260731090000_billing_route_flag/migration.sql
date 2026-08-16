-- Which route carries a customer's ONE monthly bill when they run on more than
-- one route in a month (the normal morning + evening pairing).
--
-- Background: bills were keyed (customer, route), so a two-route customer got
-- TWO bills — while openingBalance and paymentAmount are looked up by CUSTOMER
-- alone. Both bills therefore repeated the same opening balance and the same
-- payments, and month-end carry-forward picked one of the two arbitrarily,
-- silently dropping the other route's deliveries from the next month's
-- opening balance.
ALTER TABLE "MonthlyRouteCustomerSequence"
  ADD COLUMN "billsHere" BOOLEAN NOT NULL DEFAULT true;

-- Backfill. The default of true is already correct for every single-route
-- customer; only customers on more than one route in the same month need
-- narrowing down to one. Keep the route they were added to FIRST — a stable,
-- explainable rule — and let the Settings review screen reassign any the
-- office would rather bill elsewhere.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "customerId", "sequenceMonth"
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "MonthlyRouteCustomerSequence"
  WHERE status = 'ACTIVE'
)
UPDATE "MonthlyRouteCustomerSequence" AS s
SET "billsHere" = false
FROM ranked
WHERE s.id = ranked.id
  AND ranked.rn > 1;

-- At most one billing route per customer per month. A PARTIAL unique index, so
-- it constrains only the rows that claim to be the billing route (and only
-- while ACTIVE) instead of forbidding a customer from being on two routes.
-- Prisma's schema language can't express an indexed WHERE clause, which is why
-- this lives here rather than in schema.prisma.
CREATE UNIQUE INDEX "MonthlyRouteCustomerSequence_one_billing_route_per_month"
  ON "MonthlyRouteCustomerSequence" ("customerId", "sequenceMonth")
  WHERE "billsHere" = true AND status = 'ACTIVE';
