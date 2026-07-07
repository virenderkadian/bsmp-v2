# V2 Screen Implementation Checklist

This checklist is focused on UI and flow only.
Business rules, sync behavior, and calculations will be decided separately.

## Shared Standard

- [x] App shell with dark sidebar and light workspace
- [x] Top bar with date/time and sync placeholder
- [x] Shared admin components:
  - `AppLayout`
  - `Sidebar`
  - `TopBar`
  - `PageHeader`
  - `FilterBar`
  - `DataTable`
  - `EmptyState`
  - `PrimaryButton`
  - `SecondaryButton`
  - `FormInput`
  - `SelectInput`
  - `SearchInput`
  - `StatusBadge`
  - `PillToggle`
  - `ActionButton`
  - reusable `Dialog`
  - reusable `ConfirmDialog`
  - keyboard-first `KeyboardForm`
  - shared loading indicators

## 1. Customers

Status: `Complete`

Target:
- [x] Clean table-first customer master layout
- [x] Popup-based create customer flow
- [x] Popup-based edit customer flow
- [x] Row-level edit action
- [x] Active/inactive status control inside table
- [x] Search, route, and status filters
- [x] Keyboard-first customer form flow
- [x] App confirmation modal for active/inactive actions
- [x] Route filter now uses Monthly Route Customer Sequence, not legacy assignment data
- [x] Final visual polish and approval
- [x] Freeze as reference pattern for all master screens

## 2. Routes

Status: `Ready for Review`

Target:
- [x] Clean route master table
- [x] Popup-based create route flow
- [x] Popup-based edit route flow
- [x] Compact filters using shared search/select controls
- [x] Route table rebuilt with shared DataTable pattern
- [x] Route modals aligned with shared Dialog + KeyboardForm pattern
- [x] Route active/inactive confirmation toggle
- [x] Assignment flow separated from route master screen
- [x] Routes page split into Routes and Vehicles tabs
- [x] Vehicle tab with search/status filters
- [x] Popup-based create/edit vehicle flow
- [x] Vehicle table rebuilt with shared DataTable pattern
- [x] Vehicle active/inactive confirmation toggle
- [x] Final visual polish pass
- [ ] User review and approval
- [ ] Freeze route master interaction pattern

## 3. Monthly Route Customer Sequence

Status: `Ready for Review`

Target:
- [x] Separate screen for monthly route customer sequence
- [x] Route and month selection
- [x] Tally-style customer search entry
- [x] Keyboard-first arrows, Enter, and Escape behavior
- [x] Automatic sequence number on add
- [x] Drag-and-drop sequence reorder
- [x] Keyboard reorder from row handle
- [x] Clear/remove customer from monthly sheet
- [x] Default active status for new sequence rows
- [x] V1-style editable sequence sheet table
- [x] Feeds Daily Entry customer order by selected route/month
- [x] Compact toolbar/add bar/toast UI polish pass
- [x] Reusable quick-create customer modal
- [x] Quick-created customer is added directly to selected route/month sequence
- [ ] User review and approval

## 4. Products & Rates

Status: `Needs Migration + Review`

Target:
- [x] Product list in clean master-table format
- [x] Rate-focused columns and actions
- [x] Popup-based create product flow
- [x] Popup-based edit product flow
- [x] Keyboard-first form behavior
- [x] Reuse customer/routes design language
- [x] Product active/inactive confirmation toggle
- [x] Removed vehicle content from Products & Rates screen
- [x] Add dynamic product fields: short name, display order, Daily Entry visibility
- [x] Backfill display order for existing products through migration
- [x] Show product order and Daily Entry visibility in product table
- [x] Product create/edit modal supports dynamic Daily Entry controls
- [x] Product filters include Daily Entry visibility
- [ ] Apply `20260703120000_dynamic_product_catalog` migration to Supabase
- [ ] Review product ordering and short names with real product data
- [ ] User review and approval
- [ ] Freeze product/rate master interaction pattern

Later:
- [ ] Add drag/drop or quick reorder controls for product display order
- [ ] Add Product Rate History with effective dates
- [ ] Add bulk product visibility/order editing if office workflow needs it

## 5. Daily Entry

Status: `Partially Done`

Target:
- [x] Core table-based entry screen exists
- [x] Customer rows now load from Monthly Route Customer Sequence
- [x] Active product catalog drives entry columns
- [x] Daily Entry now uses only products marked `showInDailyEntry`
- [x] Daily Entry product columns follow Product display order
- [x] Daily Entry headers use product short names when available
- [x] Empty state points user to Route Sequence setup
- [x] Enter key moves through quantity inputs and saves on last input
- [ ] Match final V1-inspired operational entry flow exactly
- [ ] Review date/route/action placement
- [ ] Tight keyboard data-entry behavior
- [ ] Review save/reload/empty-state UX

Later:
- [ ] Replace delete/recreate save with diff-based upsert/update
- [ ] Add audit-friendly change tracking if required
- [ ] Tune billing/report indexes after real data volume is known

## 6. Payments

Status: `Needs Migration + Review`

Target:
- [x] Clean payment list with proper filters
- [x] Popup add/edit payment pattern
- [x] Confirmation-based status update from table row
- [x] Consistent table-first business UI
- [x] Revalidates payments, monthly bills, and reconciliation after payment changes
- [x] Added route-aware payments so collections apply to one customer-route bill only
- [x] Applied route-aware payment migration and cleared old payment/monthly bill records
- [x] Added route-wise bulk payment entry screen
- [x] Added tally-style customer search with focus suggestions and keyboard selection
- [x] Added customer balance preview: opening, monthly bill/estimate, paid, and pending
- [x] Added draft payment sheet with editable amounts and Save All action
- [x] Added PaymentBatch model so bulk entries are auditable
- [x] Apply `20260707130000_payment_batches` migration to Supabase
- [ ] Review bulk payment flow with real route/month sequence data
- [ ] Fast searchable customer selection flow
- [ ] Review split-payment allocation model if one collection must be shared across multiple routes

Later:
- [ ] Add payment batch history/reprint screen if office workflow needs it
- [ ] Add batch-level reverse/cancel flow after approval rules are finalized

## 7. Monthly Bills

Status: `In Progress`

Target:
- [x] Cleaner list and bill-generation flow
- [x] Strong month/customer/route filtering
- [x] Better status visibility
- [x] Popup monthly bill generation pattern
- [x] Confirmation-based bill status update from table row
- [x] Added bill register View action
- [x] Added customer bill detail page with summary, product totals, daily delivery rows, and verified payments
- [x] Added loading state for bill detail navigation
- [x] Added printable monthly route summary for all routes or selected route
- [x] Summary follows Monthly Route Customer Sequence order and includes product totals, amount, opening, paid, and pending columns
- [x] Payment totals now use customer + route, not customer-only matching
- [ ] Review bill detail and summary presentation with real generated bills

## 8. Reconciliation

Status: `Pending UI Polish`

Target:
- [x] Removed legacy assignment dependency from collection-to-route mapping
- [x] Verified collections now use Payment route directly
- [ ] Cleaner reconciliation review table
- [ ] Better route/date/group filtering
- [ ] Strong status and totals visibility
- [ ] Consistent action patterns

Later:
- [ ] Add route/payment allocation model if payments can be collected without a same-day Daily Entry row
- [ ] Add vehicle snapshot to Daily Entry for historical reconciliation accuracy
- [ ] Remove or migrate legacy assignment tables after dashboard and old assignment pages are retired

## 9. Settings

Status: `Pending`

Target:
- [ ] Separate true settings from diagnostics/maintenance tools
- [ ] Consistent admin layout
- [ ] Cleaner grouped controls

## Review Order

1. Customers
2. Routes
3. Monthly Route Customer Sequence
4. Products & Rates
5. Daily Entry
6. Payments
7. Monthly Bills
8. Reconciliation
9. Settings
