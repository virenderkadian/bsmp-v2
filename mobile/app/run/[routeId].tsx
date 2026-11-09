import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { DriverSaveLineRequest, DriverSheetCustomer, DriverSheetResponse } from "@shared/driver-api-types";
import { useActiveRoute } from "@/active-route";
import { EditPrompt } from "@/components/EditPrompt";
import { api, ApiError } from "@/api";
import { getCashSaleEntries, type CashSaleEntry } from "@/cash-sale";
import { CashSaleModal } from "@/components/CashSaleModal";
import { StockPanel } from "@/components/StockPanel";
import { RouteMapModal } from "@/components/RouteMapModal";
import { SlideToConfirm } from "@/components/SlideToConfirm";
import { Stepper } from "@/components/Stepper";
import { StopsListModal } from "@/components/StopsListModal";
import { openNavigation, resolveLocationForSave } from "@/location";
import { productShortLabel } from "@/product-label";
import { summariseRound, summariseRoundCashSales } from "@/round-summary";
import { enqueueSave, getQueueForRoute } from "@/offline-queue";
import { getPaidToday } from "@/payments-today";
import { saveUpi } from "@/upi-cache";
import { useOfflineSync } from "@/offline-sync-context";
import { isRouteCompleted, markRouteCompleted, reopenRoute } from "@/route-completion";
import { isEditableCycleDate, todayStr } from "@/route-progress";
import { isOnline } from "@/sync";
import { radius } from "@/theme";
import { Card, Chip, PrimaryButton, ProgressBar, useColors } from "@/ui";

// The single "more" button; Note, Navigate and Call live in its menu.
const ACTION_BUTTON_SIZE = 42;

// Two SlideToConfirm controls (54 each) plus the 10 gap between them — the
// tallest this zone ever gets.
const ACTION_ZONE_HEIGHT = 118;

// "2026-12" -> "Dec" — the driver only needs to know which month, and the
// card has no room for more.
function formatBillMonth(month: string): string {
  const [year, monthPart] = month.split("-");
  return new Date(Date.UTC(Number(year), Number(monthPart) - 1, 1)).toLocaleDateString("en-IN", {
    month: "short",
    timeZone: "UTC",
  });
}

function cycleDateForRoute(date: string, shift: "MORNING" | "EVENING") {
  if (shift === "MORNING") return date;
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

function statusOf(
  customer: DriverSheetCustomer,
  isQueued: boolean,
): { tone: "delivered" | "skipped" | "pending"; label: string } {
  if (!customer.saved) return { tone: "pending", label: "Pending" };
  if (isQueued) return { tone: "pending", label: customer.skipped ? "Skipped · queued" : "Delivered · queued" };
  return customer.skipped ? { tone: "skipped", label: "Skipped" } : { tone: "delivered", label: "Delivered" };
}

// Mirrors what the server would compute for a save, so a queued (offline)
// delivery shows correctly in the UI immediately — sheet state is always the
// optimistic local truth regardless of whether the save has actually reached
// the server yet; the offline queue is purely "what still needs sending".
function buildOptimisticCustomer(
  customer: DriverSheetCustomer,
  skipped: boolean,
  remarks: string,
  products: Array<{ productId: string; quantity: number; rateSnapshot: number }>,
): DriverSheetCustomer {
  const byProduct = new Map(products.map((product) => [product.productId, product]));
  return {
    ...customer,
    saved: true,
    skipped,
    remarks: remarks.trim() || null,
    products: customer.products.map((product) => {
      const match = byProduct.get(product.productId);
      return match ? { ...product, deliveredQty: String(match.quantity) } : { ...product, deliveredQty: "0" };
    }),
  };
}

export default function RunScreen() {
  const colors = useColors();
  const router = useRouter();
  // android edgeToEdgeEnabled draws content under the system navigation bar, and
  // this screen's SafeAreaView deliberately excludes the bottom edge so the
  // save/undo overlays can sit flush. That left the slide-to-deliver controls
  // partly behind the nav buttons, so the inset is applied to the scroll
  // content and the overlays instead.
  const insets = useSafeAreaInsets();
  const { routeId, date } = useLocalSearchParams<{ routeId: string; date?: string }>();
  const runDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayStr();
  const { refresh: refreshActiveRoute, routesInfo } = useActiveRoute();
  const { pendingCount, isOnline: online, syncing, syncNow } = useOfflineSync();

  const [sheet, setSheet] = useState<DriverSheetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [draftQty, setDraftQty] = useState<Record<string, number>>({});
  // Which product rows are showing on the stop card. The card stays short:
  // only what the customer usually takes (or already has a quantity), with the
  // rest one tap away under "Add product".
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [footerHeight, setFooterHeight] = useState(0);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const menuButtonRef = useRef<View>(null);
  // iOS drops a modal opened while another is still dismissing, so a menu
  // choice runs once the menu is fully gone (see onDismiss on the menu Modal).
  const pendingMenuAction = useRef<(() => void) | null>(null);
  const { width: screenWidth } = useWindowDimensions();
  const [saving, setSaving] = useState(false);
  // What the save is currently waiting on. A delivery can take several seconds
  // — GPS fix, then the network round-trip — and previously nothing on screen
  // said so, which reads as the app having frozen.
  const [savingStage, setSavingStage] = useState<"location" | "saving" | null>(null);
  const [snackbar, setSnackbar] = useState<{ index: number; label: string } | null>(null);
  // Which of THIS route's customers have a save sitting in the local offline
  // queue right now — display-only (sheet state is already the optimistic
  // source of truth for saved/skipped/quantities either way), used just to
  // label a stop "queued" instead of "Delivered" until it's actually synced.
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set());
  // A saved stop opens read-only by default (see canEdit below) so browsing
  // with Prev/Next can't silently overwrite an already-recorded delivery;
  // this explicitly unlocks it. Resets whenever the viewed stop changes.
  const [editMode, setEditMode] = useState(false);
  // The ONLY thing that ends a round. Never inferred from "every stop is
  // saved" — a short or partly-filled monthly sequence would otherwise report
  // itself complete while the driver still had customers to visit. Persisted
  // locally per route+date (see route-completion.ts), so it survives leaving
  // the screen or restarting the app.
  const [completed, setCompleted] = useState(false);
  const [stopsListOpen, setStopsListOpen] = useState(false);
  const [cashSaleOpen, setCashSaleOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  // Today's cash sales for this route, for the round summary. Local-only data
  // (see cash-sale.ts) — never sent to the server, so it has to be read here
  // rather than arriving with the sheet.
  const [cashSales, setCashSales] = useState<CashSaleEntry[]>([]);
  // Customers a payment has been recorded for today, so the card can say so —
  // the pill alone would otherwise still read "unpaid" (the office has not
  // verified it yet) and a driver would reasonably ask again. Read from storage
  // rather than held here: collecting now happens on the customer's dues screen,
  // and the marker has to survive leaving this screen and restarting the app.
  const [paidNow, setPaidNow] = useState<Set<string>>(new Set());
  useFocusEffect(
    useCallback(() => {
      void getPaidToday().then(setPaidNow);
    }, []),
  );
  // Drivers are the ones who find a wrong or missing number, so they can fix it
  // where they notice it. Held locally so the card updates without refetching
  // the whole sheet.
  const [mobileEditOpen, setMobileEditOpen] = useState(false);
  const [mobileDraft, setMobileDraft] = useState("");
  const [savingMobile, setSavingMobile] = useState(false);

  const load = useCallback(async () => {
    if (!routeId) return;
    try {
      setError(null);
      const result = await api.sheet(routeId, runDate);
      void saveUpi(result.upi);
      // A queued save hasn't reached the server, so the fetched sheet shows
      // that stop as untouched — its quantities would fall back to the
      // prefill and it would look undelivered after an app restart. Re-apply
      // the queue over the response so a round reads the same either side of
      // a restart, and so the end-of-round summary counts work the driver
      // has actually done rather than only what has synced.
      const queued = await getQueueForRoute(routeId);
      const queuedByCustomer = new Map(queued.map((item) => [item.customerId, item]));
      const customers = result.customers.map((customer) => {
        const pending = queuedByCustomer.get(customer.customerId);
        return pending
          ? buildOptimisticCustomer(
              customer,
              pending.request.skipped,
              pending.request.remarks ?? "",
              pending.request.products,
            )
          : customer;
      });
      setSheet({ ...result, customers });
      const firstPending = customers.findIndex((customer) => !customer.saved);
      setCursor(firstPending >= 0 ? firstPending : 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load this route.");
    }
  }, [routeId, runDate]);

  useEffect(() => {
    load();
  }, [load]);

  // Completion lives on the device, not in the sheet response — read it back
  // on mount so re-entering a finished route shows the summary, not the run.
  useEffect(() => {
    if (!routeId) return;
    isRouteCompleted(routeId, runDate).then(setCompleted);
  }, [routeId, runDate]);

  // Refreshed whenever the round is finished or the cash sale sheet closes, so
  // the summary reflects sales entered right up to the end of the round.
  useEffect(() => {
    if (!routeId || cashSaleOpen) return;
    getCashSaleEntries(routeId, runDate).then(setCashSales);
  }, [routeId, runDate, cashSaleOpen, completed]);

  const refreshQueuedIds = useCallback(async () => {
    if (!routeId) return;
    const items = await getQueueForRoute(routeId);
    setQueuedIds(new Set(items.map((item) => item.customerId)));
  }, [routeId]);

  useEffect(() => {
    refreshQueuedIds();
    // Also re-check whenever the GLOBAL pending count changes — covers a
    // background auto-sync (triggered by the provider on reconnect/foreground)
    // completing while this screen happens to be open.
  }, [refreshQueuedIds, pendingCount]);

  const customer = sheet?.customers[cursor];
  const custId = customer?.customerId;

  // Reset the editable draft whenever we move to a different stop.
  useEffect(() => {
    if (!customer) return;
    const next: Record<string, number> = {};
    customer.products.forEach((product) => {
      next[product.productId] = Number(product.deliveredQty) || 0;
    });
    setDraftQty(next);
    setRevealed(
      new Set(
        customer.products
          .filter((product) => Number(product.deliveredQty) > 0 || Number(product.defaultQty) > 0)
          .map((product) => product.productId),
      ),
    );
    setPickerOpen(false);
    setNoteOpen(false);
    setMenuPos(null);
    setRemarks(customer.remarks ?? "");
    setEditMode(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custId]);

  // Auto-hide the undo snackbar.
  useEffect(() => {
    if (!snackbar) return;
    const timer = setTimeout(() => setSnackbar(null), 5000);
    return () => clearTimeout(timer);
  }, [snackbar]);

  const total = sheet?.customers.length ?? 0;
  const done = sheet?.customers.filter((entry) => entry.saved).length ?? 0;
  const allDone = total > 0 && done === total;
  const isLastStop = total > 0 && cursor === total - 1;
  const routeQueueCount = queuedIds.size;

  const commitFinish = async () => {
    if (!routeId) return;
    await markRouteCompleted(routeId, runDate);
    setCompleted(true);
    // Releases the one-active-route guard and clears the resume pill.
    refreshActiveRoute();
  };

  const finishRoute = () => {
    if (!sheet) return;
    const pendingStops = sheet.customers.filter((entry) => !entry.saved).length;
    if (pendingStops > 0) {
      Alert.alert(
        "Finish route?",
        `${pendingStops} stop${pendingStops === 1 ? "" : "s"} still pending. You can finish now and come back to ${pendingStops === 1 ? "it" : "them"} later.`,
        [
          { text: "Keep going", style: "cancel" },
          { text: "Finish anyway", style: "destructive", onPress: () => void commitFinish() },
        ],
      );
      return;
    }
    void commitFinish();
  };

  // Explicit completion would otherwise be a one-way door for the rest of the
  // day — these put the driver back on the run if they tapped Finish early or
  // a stop still needs correcting. Clearing the stored marker (not just local
  // state) is what makes it stick across a reload.
  const reopenAt = async (index: number) => {
    if (!routeId) return;
    await reopenRoute(routeId, runDate);
    setCompleted(false);
    setCursor(index);
    refreshActiveRoute();
  };

  const reopen = async () => {
    const firstPending = sheet?.customers.findIndex((entry) => !entry.saved) ?? -1;
    await reopenAt(firstPending >= 0 ? firstPending : 0);
  };

  const saveMobile = async () => {
    if (!customer || savingMobile) return;
    setSavingMobile(true);
    try {
      const next = mobileDraft.trim() ? mobileDraft.trim() : null;
      const result = await api.updateCustomerMobile(customer.customerId, { mobile: next });
      setSheet((prev) =>
        prev
          ? {
              ...prev,
              customers: prev.customers.map((entry) =>
                entry.customerId === customer.customerId ? { ...entry, mobile: result.customer.mobile } : entry,
              ),
            }
          : prev,
      );
      setMobileEditOpen(false);
    } catch (err) {
      // Deliberately not queued offline. A phone number is a correction, not a
      // record of something that happened — losing it costs nothing, whereas a
      // queued edit could silently overwrite a better number entered elsewhere
      // in the meantime.
      setError(err instanceof ApiError ? err.message : "Couldn't save the number. Try again when online.");
    } finally {
      setSavingMobile(false);
    }
  };

  const advance = () => {
    if (!sheet) return;
    const after = sheet.customers.findIndex((entry, index) => index > cursor && !entry.saved);
    if (after >= 0) {
      setCursor(after);
      return;
    }
    const anyPending = sheet.customers.findIndex((entry) => !entry.saved);
    setCursor(anyPending >= 0 ? anyPending : cursor);
  };

  const doSave = async (skipped: boolean) => {
    if (!customer || !sheet || !routeId || saving) return;
    setSaving(true);
    setSavingStage(skipped ? "saving" : "location");
    try {
      // A skip carries no deliverables — the backend already discards
      // products when skipped is true, so send none rather than whatever
      // happens to be sitting in the (irrelevant) quantity steppers.
      const products = skipped
        ? []
        : customer.products.map((product) => ({
            productId: product.productId,
            quantity: draftQty[product.productId] ?? 0,
            rateSnapshot: Number(product.rate),
          }));
      // GPS works fully offline — only the actual network save is
      // connectivity-sensitive, so location resolution always runs first.
      // Backfills silently if the customer has no saved location yet; if they
      // do and this fix is >12m off, prompts the driver before agreeing to
      // move it. Skipped visits never touch location at all.
      const locationFields = skipped ? {} : await resolveLocationForSave(customer.latitude, customer.longitude);
      setSavingStage("saving");
      const request: DriverSaveLineRequest = {
        date: runDate,
        skipped,
        remarks: remarks.trim() || undefined,
        products,
        ...locationFields,
      };

      let queued = false;
      if (await isOnline()) {
        try {
          const result = await api.saveLine(routeId, customer.customerId, request);
          setSheet((prev) =>
            prev
              ? {
                  ...prev,
                  customers: prev.customers.map((entry) =>
                    entry.customerId === result.saved.customerId ? result.saved : entry,
                  ),
                }
              : prev,
          );
        } catch (err) {
          // status 0 = never reached the server (see api.ts) — a real
          // connectivity failure, worth queuing for later. Any other status
          // means the server responded and rejected it (e.g. bill locked) —
          // retrying later won't change that, so surface it now instead of
          // silently queuing a save that's certain to fail again.
          if (err instanceof ApiError && err.status !== 0) {
            throw err;
          }
          queued = true;
        }
      } else {
        queued = true;
      }

      if (queued) {
        await enqueueSave(routeId, customer.customerId, request);
        // Sheet is always the optimistic local truth regardless of sync
        // state — this is what lets total/done/advance/round-complete all
        // keep working unchanged whether a stop is confirmed or still queued.
        setSheet((prev) =>
          prev
            ? {
                ...prev,
                customers: prev.customers.map((entry) =>
                  entry.customerId === customer.customerId
                    ? buildOptimisticCustomer(entry, skipped, remarks, products)
                    : entry,
                ),
              }
            : prev,
        );
        refreshQueuedIds();
      }

      setSnackbar({
        index: cursor,
        label: `${skipped ? "Skipped" : "Delivered"}${queued ? " (offline, will sync)" : ""}`,
      });
      setEditMode(false); // freshly saved — lock again even if we don't move (e.g. last stop)
      advance();
      // Progress just changed (and may have just hit 100%) — let the pill and
      // the route-start guard pick that up without waiting for their poll.
      refreshActiveRoute();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
      setSavingStage(null);
    }
  };

  const header = (
    <>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 16,
          paddingTop: 4,
          paddingBottom: 10,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={{
            width: 36,
            height: 36,
            borderRadius: 11,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="chevron-back" size={20} color={colors.ink} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "800" }} numberOfLines={1}>
            {sheet ? `${sheet.route.code} · ${sheet.route.name}` : "Loading…"}
          </Text>
          {sheet ? (
            <Text style={{ color: colors.inkFaint, fontSize: 12 }}>
              {completed
                ? `Finished · ${done} of ${total} stops`
                : customer
                  ? `Stop ${cursor + 1} of ${total}`
                  : `${done} of ${total} done`}
            </Text>
          ) : null}
        </View>
        {/* Only while a round is actually in progress. A cash sale belongs to
            a run, so offering it before starting or after finishing would file
            it against a session that isn't happening. */}
        {sheet && total > 0 && !completed ? (
          <Pressable
            onPress={() => setCashSaleOpen(true)}
            style={{
              width: 36,
              height: 36,
              borderRadius: 11,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="cash-outline" size={20} color={colors.ink} />
          </Pressable>
        ) : null}
        {sheet && total > 0 ? (
          <Pressable
            onPress={() => setMapOpen(true)}
            style={{
              width: 36,
              height: 36,
              borderRadius: 11,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="map-outline" size={20} color={colors.ink} />
          </Pressable>
        ) : null}
        {sheet && total > 0 && !completed ? (
          <Pressable
            onPress={() => setStopsListOpen(true)}
            style={{
              width: 36,
              height: 36,
              borderRadius: 11,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="list" size={20} color={colors.ink} />
          </Pressable>
        ) : null}
      </View>
      {sheet && total > 0 ? (
        <View style={{ paddingHorizontal: 18, paddingBottom: 10 }}>
          <ProgressBar value={total === 0 ? 0 : done / total} />
        </View>
      ) : null}
      {routeQueueCount > 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingBottom: 10 }}>
          <View
            style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: online ? colors.brand : colors.inkFaint }}
          />
          <Text style={{ flex: 1, color: colors.inkSoft, fontSize: 12 }}>
            {online
              ? `${routeQueueCount} stop${routeQueueCount === 1 ? "" : "s"} syncing…`
              : `${routeQueueCount} stop${routeQueueCount === 1 ? "" : "s"} waiting to sync (offline)`}
          </Text>
          <Pressable onPress={() => syncNow()} disabled={syncing || !online} hitSlop={6}>
            <Text
              style={{ color: colors.brand, fontSize: 12, fontWeight: "700", opacity: syncing || !online ? 0.4 : 1 }}
            >
              {syncing ? "Syncing…" : "Sync now"}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );

  if (error && !sheet) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={["top", "left", "right"]}>
        {header}
        <View style={{ padding: 18 }}>
          <Card>
            <Text style={{ color: colors.danger, fontSize: 14, marginBottom: 12 }}>{error}</Text>
            <PrimaryButton label="Retry" onPress={load} />
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  if (!sheet) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={["top", "left", "right"]}>
        {header}
        <ActivityIndicator color={colors.brand} style={{ marginTop: 30 }} />
      </SafeAreaView>
    );
  }

  // Round complete — ONLY when the driver explicitly finished it. Reaching
  // done === total no longer ends the round on its own (see `completed`).
  if (completed || !customer) {
    const { delivered, skipped, notVisited, products: totals } = summariseRound(sheet.customers);
    // Already scoped to this session by getCashSaleEntries — no date filter
    // here, which would also have wrongly dropped a sale recorded just after
    // midnight on a round that started the previous day.
    const { totalAmount: cashSaleAmount, products: cashSaleTotals } = summariseRoundCashSales(cashSales);

    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={["top", "left", "right"]}>
        {header}
        <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 18 + insets.bottom }}>
          <View style={{ alignItems: "center", paddingVertical: 12 }}>
            <View
              style={{
                width: 60,
                height: 60,
                borderRadius: 30,
                backgroundColor: colors.deliveredTint,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 12,
              }}
            >
              <Ionicons name="checkmark" size={34} color={colors.delivered} />
            </View>
            <Text style={{ color: colors.ink, fontSize: 22, fontWeight: "800" }}>Round complete</Text>
            <Text style={{ color: colors.inkSoft, fontSize: 14, marginTop: 2 }}>
              {sheet.route.code} · {sheet.route.name}
            </Text>
          </View>
          <Card style={{ marginBottom: 12 }}>
            <Row label="Delivered" value={String(delivered)} color={colors.delivered} colors={colors} />
            <Row
              label="Skipped"
              value={String(skipped)}
              color={colors.skipped}
              colors={colors}
              last={notVisited === 0}
            />
            {/* Shown only when there are any. The totals below count saved
                stops only, so a round finished early would otherwise just
                read low with nothing saying why. */}
            {notVisited > 0 ? (
              <Row label="Not visited" value={String(notVisited)} color={colors.inkSoft} colors={colors} last />
            ) : null}
          </Card>
          {cashSaleTotals.length > 0 ? (
            <>
              <Text
                style={{
                  color: colors.inkFaint,
                  fontSize: 11,
                  fontWeight: "700",
                  letterSpacing: 1.2,
                  textTransform: "uppercase",
                  marginBottom: 8,
                  marginLeft: 4,
                }}
              >
                Cash sales today
              </Text>
              {/* Deliberately a SEPARATE card from the delivered totals rather
                  than folded into them. Cash sales never reach the server and
                  are not part of anyone's bill — merging the two would make the
                  delivery figures disagree with what actually gets billed. */}
              <Card style={{ marginBottom: 12 }}>
                {cashSaleTotals.map((item) => (
                  <Row key={item.productId} label={item.label} value={`${item.qty} ${item.unit}`} colors={colors} />
                ))}
                <Row
                  label="Cash collected"
                  value={`₹ ${Math.round(cashSaleAmount)}`}
                  color={colors.delivered}
                  colors={colors}
                  last
                />
              </Card>
            </>
          ) : null}
          {totals.length > 0 ? (
            <Card style={{ marginBottom: 16 }}>
              {totals.map((info, index, arr) => (
                <Row
                  key={info.productId}
                  // info.label, NOT the product id — rendering the key printed
                  // a raw uuid instead of the product name.
                  label={info.label}
                  value={`${info.qty} ${info.unit}`}
                  colors={colors}
                  last={index === arr.length - 1}
                />
              ))}
            </Card>
          ) : null}
          <StockPanel
            compact
            cycleDate={cycleDateForRoute(sheet.date, sheet.route.shift)}
            routeShift={sheet.route.shift}
          />
          <PrimaryButton label="Back to routes" onPress={() => router.back()} />
          <Pressable
            onPress={() => void reopen()}
            style={({ pressed }) => ({
              marginTop: 12,
              paddingVertical: 12,
              alignItems: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={{ color: colors.inkSoft, fontSize: 13.5, fontWeight: "700" }}>Reopen route</Text>
          </Pressable>
        </ScrollView>

        <CashSaleModal
          visible={cashSaleOpen}
          onClose={() => setCashSaleOpen(false)}
          routeId={sheet.route.id}
          sessionDate={runDate}
          products={sheet.customers[0]?.products ?? []}
        />

        <RouteMapModal
          visible={mapOpen}
          onClose={() => setMapOpen(false)}
          customers={sheet.customers}
          currentIndex={cursor}
          statusOf={(c) => statusOf(c, queuedIds.has(c.customerId))}
          onSelect={(index) => {
            // Jumping to a stop from the summary means the driver isn't done
            // after all — reopen the route rather than silently showing a
            // stop card behind a still-recorded completion.
            setMapOpen(false);
            void reopenAt(index);
          }}
        />
      </SafeAreaView>
    );
  }

  const status = statusOf(customer, queuedIds.has(customer.customerId));
  // Offered, not pre-filled: only while the driver hasn't already added it.
  const shownProducts = customer.products.filter(
    (product) => revealed.has(product.productId) || (draftQty[product.productId] ?? 0) > 0,
  );
  const shownIds = new Set(shownProducts.map((product) => product.productId));
  // Occasional products are offered in the "Taken before" box instead.
  const hiddenProducts = customer.products.filter((product) => !shownIds.has(product.productId) && !product.occasional);
  const reveal = (productId: string) => setRevealed((prev) => new Set(prev).add(productId));
  const takenBefore = customer.products.filter(
    (product) => product.occasional && (draftQty[product.productId] ?? 0) === 0,
  );
  const stopTotal = customer.products.reduce(
    (sum, product) => sum + (draftQty[product.productId] ?? 0) * Number(product.rate),
    0,
  );
  // A saved stop is read-only until explicitly unlocked, so browsing with
  // Prev/Next can't silently overwrite an already-recorded delivery.
  // Only the current cycle can be changed from the phone; a previous cycle is
  // view-only. (Unknown while the routes list is still loading: treated as
  // editable rather than locking a driver out for a moment.)
  const cycleEditable = !routesInfo || isEditableCycleDate(sheet.route.shift, runDate, routesInfo.cycleDate);
  const canEdit = cycleEditable && (!customer.saved || editMode);
  // Width the corner buttons take (phone-add appears only when there is no
  // number), kept clear of the status row and the name.
  const actionsWidth = customer.mobile ? ACTION_BUTTON_SIZE : ACTION_BUTTON_SIZE * 2 + 8;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={["top", "left", "right"]}>
      {header}
      <ScrollView
        contentContainerStyle={{ padding: 18, paddingBottom: 30 }}
        keyboardShouldPersistTaps="handled"
        // The decimal keypad has no Done key on iOS; dragging the card dismisses it.
        keyboardDismissMode="on-drag"
      >
        <Card>
          <View>
          {/* Status and unpaid amount on the left, the buttons on the right. The
              left group wraps rather than cutting the amount short, so when the
              text is large the pill drops under the status instead. */}
          <View style={{ flexDirection: "row", alignItems: "flex-start", paddingRight: actionsWidth + 10 }}>
          <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <Chip label={status.label} tone={status.tone} />
                {/* Unpaid / payment state sits beside the delivery status so the
                    driver sees it in one glance, and tapping it collects. One
                    line only (the end truncates, never the amount), so the card
                    never changes height. */}
                {paidNow.has(customer.customerId) ? (
                  <View
                    style={{
                      flexShrink: 1,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                      paddingVertical: 4,
                      paddingHorizontal: 9,
                      borderRadius: radius.pill,
                      backgroundColor: colors.deliveredTint,
                    }}
                  >
                    <Ionicons name="checkmark" size={13} color={colors.delivered} />
                    <Text numberOfLines={1} style={{ color: colors.delivered, fontSize: 12.5, fontWeight: "800" }}>
                      Paid
                    </Text>
                  </View>
                ) : customer.previousBill ? (
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/dues/customer/[customerId]",
                        params: {
                          customerId: customer.customerId,
                          // Lets the dues screen still offer "Collect payment" when
                          // it can't load (no signal at the door).
                          routeId,
                          name: customer.name,
                          code: customer.customerCode,
                          outstanding: customer.previousBill?.outstanding ?? "",
                        },
                      })
                    }
                    style={({ pressed }) => ({
                      flexShrink: 1,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 3,
                      paddingVertical: 4,
                      paddingLeft: 9,
                      paddingRight: 6,
                      borderRadius: radius.pill,
                      backgroundColor: colors.skippedTint,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text
                      numberOfLines={1}
                      style={{ flexShrink: 1, color: colors.skipped, fontSize: 12.5, fontWeight: "800" }}
                    >
                      ₹ {Math.round(Number(customer.previousBill.outstanding))} unpaid ·{" "}
                      {formatBillMonth(customer.previousBill.month)}
                    </Text>
                    <Ionicons name="chevron-forward" size={13} color={colors.skipped} />
                  </Pressable>
                ) : null}
          </View>
            {/* Both actions are conditional — Navigate needs a saved location,
                Call needs a number. Reserving both slots keeps the row a fixed
                size, which matters twice over: the card height stays put, and
                so does the width left for the customer name, which would
                otherwise wrap differently between stops. */}
            {/* Note, Navigate and Call used to be three separate buttons here,
                which cluttered the card. They live in this menu now, with their
                names, so each one is also easier to understand. */}
            {/* Pinned to the corner so the buttons (taller than the status chip)
                do not stretch the row and push the name away from it. */}
            <View style={{ position: "absolute", top: 0, right: 0, flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
              {!customer.mobile ? (
                // No number on file: the missing number is fixable right where
                // the driver notices it, not only from the menu.
                <Pressable
                  onPress={() => {
                    setMobileDraft("");
                    setMobileEditOpen(true);
                  }}
                  accessibilityLabel="Add phone number"
                  style={{
                    width: ACTION_BUTTON_SIZE,
                    height: ACTION_BUTTON_SIZE,
                    borderRadius: 13,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="call-outline" size={21} color={colors.brand} style={{ opacity: 0.55 }} />
                  <View
                    style={{
                      position: "absolute",
                      right: 5,
                      bottom: 5,
                      width: 16,
                      height: 16,
                      borderRadius: 8,
                      backgroundColor: colors.brand,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name="add" size={13} color={colors.onBrand} />
                  </View>
                </Pressable>
              ) : null}
              <Pressable
                ref={menuButtonRef}
                onPress={() =>
                  menuButtonRef.current?.measureInWindow((x, y, width, height) =>
                    setMenuPos({ top: y + height + 6, right: Math.max(12, screenWidth - (x + width)) }),
                  )
                }
                accessibilityLabel="More actions"
                style={{
                  width: ACTION_BUTTON_SIZE,
                  height: ACTION_BUTTON_SIZE,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="ellipsis-vertical" size={22} color={colors.ink} />
                {remarks.trim() ? (
                  <View
                    style={{
                      position: "absolute",
                      top: 7,
                      right: 7,
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: colors.brand,
                    }}
                  />
                ) : null}
              </Pressable>
            </View>
          </View>
          {/* The name now has the full width: it no longer shares its row with
              the buttons, so long names and large text wrap instead of squeezing. */}
          <View style={{ marginTop: 6, paddingRight: actionsWidth + 10 }}>
            <View>
              <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "800" }}>
                {customer.name}
              </Text>
              {/* No reserved space: a customer with no area gets no empty line. The
                  slide controls below can therefore sit a line higher for such a
                  stop — a deliberate trade for a tighter card. */}
              {customer.area ? (
                <Text style={{ color: colors.inkSoft, fontSize: 13.5, marginTop: 2 }}>{customer.area}</Text>
              ) : null}
            </View>
          </View>
          </View>

          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 5 }} />

          {customer.products.length === 0 ? (
            <Text style={{ color: colors.inkFaint, fontSize: 13 }}>No deliverables set for this customer.</Text>
          ) : shownProducts.length === 0 ? (
            <Text style={{ color: colors.inkFaint, fontSize: 13 }}>No usual order for this customer.</Text>
          ) : (
            shownProducts.map((product, index) => (
              <View
                key={product.productId}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingVertical: 11,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                }}
              >
                <View>
                  <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "700" }}>
                    {productShortLabel(product)}
                  </Text>
                </View>
                {canEdit ? (
                  <Stepper
                    value={draftQty[product.productId] ?? 0}
                    onChange={(next) => setDraftQty((prev) => ({ ...prev, [product.productId]: next }))}
                  />
                ) : (
                  <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "800" }}>
                    {draftQty[product.productId] ?? 0} {product.unit}
                  </Text>
                )}
              </View>
            ))
          )}

          {canEdit && takenBefore.length > 0 ? (
            // Products this customer took recently but not regularly. They are
            // deliberately NOT pre-filled — a one-off item used to come back on
            // every visit and had to be zeroed by hand, which silently billed
            // customers for things they never received. One tap adds it.
            <View
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface2,
              }}
            >
              <Text style={{ color: colors.inkFaint, fontSize: 12, fontWeight: "700", marginBottom: 6 }}>
                Taken before
              </Text>
              {takenBefore.map((product) => (
                <View
                  key={product.productId}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingVertical: 4,
                  }}
                >
                  <Text style={{ color: colors.ink, fontSize: 14, flex: 1 }}>
                    {productShortLabel(product)} ×{Number(product.occasional!.quantity)} ·{" "}
                    {product.occasional!.daysAgo === 0
                      ? "today"
                      : product.occasional!.daysAgo === 1
                        ? "yesterday"
                        : `${product.occasional!.daysAgo} days ago`}
                  </Text>
                  <Pressable
                    onPress={() => {
                      reveal(product.productId);
                      setDraftQty((prev) => ({ ...prev, [product.productId]: Number(product.occasional!.quantity) }));
                    }}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                      paddingVertical: 6,
                      paddingHorizontal: 12,
                      borderRadius: radius.pill,
                      borderWidth: 1,
                      borderColor: colors.brand,
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <Ionicons name="add" size={16} color={colors.brand} />
                    <Text style={{ color: colors.brand, fontSize: 13, fontWeight: "700" }}>Add</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {canEdit && hiddenProducts.length > 0 ? (
            <View style={{ marginTop: 12 }}>
              <Pressable
                onPress={() => setPickerOpen((open) => !open)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingVertical: 8,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Ionicons name="add-circle-outline" size={20} color={colors.brand} />
                <Text style={{ flex: 1, color: colors.brand, fontSize: 14, fontWeight: "700" }}>Add product</Text>
                <Ionicons name={pickerOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.inkFaint} />
              </Pressable>
              {pickerOpen ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 4 }}>
                  {hiddenProducts.map((product) => (
                    <Pressable
                      key={product.productId}
                      onPress={() => {
                        reveal(product.productId);
                        setPickerOpen(false);
                      }}
                      style={({ pressed }) => ({
                        paddingVertical: 8,
                        paddingHorizontal: 12,
                        borderRadius: radius.pill,
                        borderWidth: 1,
                        borderColor: colors.borderStrong,
                        backgroundColor: colors.surface2,
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <Text style={{ color: colors.ink, fontSize: 13, fontWeight: "600" }}>
                        {productShortLabel(product)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 14,
              paddingTop: 13,
              borderTopWidth: 1,
              borderTopColor: colors.borderStrong,
            }}
          >
            <Text style={{ color: colors.inkSoft, fontSize: 13, fontWeight: "600" }}>Stop total</Text>
            <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "800" }}>₹ {Math.round(stopTotal)}</Text>
          </View>
        </Card>

        <Modal
          visible={menuPos !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setMenuPos(null)}
          onDismiss={() => {
            const action = pendingMenuAction.current;
            pendingMenuAction.current = null;
            action?.();
          }}
        >
          <Pressable style={{ flex: 1 }} onPress={() => setMenuPos(null)}>
            {menuPos ? (
              <View
                style={{
                  position: "absolute",
                  top: menuPos.top,
                  right: menuPos.right,
                  minWidth: 210,
                  backgroundColor: colors.surface,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: colors.borderStrong,
                  paddingVertical: 6,
                  shadowColor: "#000",
                  shadowOpacity: 0.18,
                  shadowRadius: 14,
                  shadowOffset: { width: 0, height: 6 },
                  elevation: 8,
                }}
              >
                {(
                  [
                    {
                      key: "call",
                      icon: "call-outline",
                      label: customer.mobile ? customer.mobile : "Add phone number",
                      show: true,
                      onPress: () => {
                        if (customer.mobile) {
                          Linking.openURL(`tel:${customer.mobile}`);
                        } else {
                          setMobileDraft("");
                          setMobileEditOpen(true);
                        }
                      },
                    },
                    {
                      key: "navigate",
                      icon: "navigate-outline",
                      label: "Directions",
                      show: Boolean(customer.latitude && customer.longitude),
                      onPress: () => openNavigation(Number(customer.latitude), Number(customer.longitude)),
                    },
                    {
                      key: "edit-phone",
                      icon: "create-outline",
                      label: "Edit phone number",
                      show: Boolean(customer.mobile),
                      onPress: () => {
                        setMobileDraft(customer.mobile ?? "");
                        setMobileEditOpen(true);
                      },
                    },
                    {
                      key: "note",
                      icon: remarks.trim() ? "document-text" : "document-text-outline",
                      label: remarks.trim() ? "Edit note" : "Add note",
                      show: true,
                      onPress: () => setNoteOpen(true),
                    },
                  ] as const
                )
                  .filter((item) => item.show)
                  .map((item) => (
                    <Pressable
                      key={item.key}
                      onPress={() => {
                        if (Platform.OS === "ios") {
                          pendingMenuAction.current = item.onPress;
                          setMenuPos(null);
                        } else {
                          setMenuPos(null);
                          item.onPress();
                        }
                      }}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        paddingVertical: 12,
                        paddingHorizontal: 16,
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <Ionicons name={item.icon} size={20} color={colors.brand} />
                      <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "600" }}>{item.label}</Text>
                    </Pressable>
                  ))}
              </View>
            ) : null}
          </Pressable>
        </Modal>

        <Modal visible={noteOpen} transparent animationType="fade" onRequestClose={() => setNoteOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
            <Pressable
              style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 18 }}
              onPress={() => setNoteOpen(false)}
            >
              <Pressable
                onPress={() => undefined}
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: radius.lg,
                  borderWidth: 1,
                  borderColor: colors.border,
                  padding: 16,
                }}
              >
                <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "800", marginBottom: 10 }}>Note</Text>
                <TextInput
                  value={remarks}
                  onChangeText={setRemarks}
                  editable={canEdit}
                  autoFocus={canEdit}
                  multiline
                  placeholder={canEdit ? "Add a note (optional)" : "No note"}
                  placeholderTextColor={colors.inkFaint}
                  style={{
                    minHeight: 90,
                    textAlignVertical: "top",
                    backgroundColor: canEdit ? colors.ground : colors.surface2,
                    borderColor: colors.border,
                    borderWidth: 1,
                    borderRadius: radius.md,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    color: canEdit ? colors.ink : colors.inkSoft,
                    fontSize: 14,
                  }}
                />
                <Pressable
                  onPress={() => setNoteOpen(false)}
                  style={({ pressed }) => ({
                    marginTop: 12,
                    paddingVertical: 12,
                    borderRadius: radius.md,
                    backgroundColor: colors.brand,
                    alignItems: "center",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ color: colors.onBrand, fontSize: 14, fontWeight: "800" }}>Done</Text>
                </Pressable>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </Modal>

        {/* Fixed height. Two 54px slide controls become one small button once
            the stop is saved, and that ~70px collapse moved the whole lower
            half of the card — including the controls a driver reaches for
            without looking. The zone keeps its size either way. */}
        <View style={{ marginTop: 14, minHeight: ACTION_ZONE_HEIGHT, justifyContent: "center" }}>
          {canEdit ? (
            <View style={{ gap: 10 }}>
              <SlideToConfirm
                direction="right"
                tone="delivered"
                label="Slide to deliver"
                resetKey={customer.customerId}
                disabled={saving}
                onConfirm={() => doSave(false)}
              />
              <SlideToConfirm
                direction="left"
                tone="skipped"
                label="Slide to skip"
                resetKey={customer.customerId}
                disabled={saving}
                onConfirm={() => doSave(true)}
              />
            </View>
          ) : !cycleEditable ? (
            <View style={{ paddingVertical: 14, borderRadius: radius.md, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}>
              <Text style={{ color: colors.inkSoft, fontSize: 13.5, fontWeight: "700", textAlign: "center" }}>
                Previous cycle · view only
              </Text>
            </View>
          ) : (
            <EditPrompt
              summary={`Recorded as ${status.label.toLowerCase()}`}
              onPress={() => setEditMode(true)}
              bounceKey={customer.customerId}
            />
          )}
        </View>

        {error ? (
          <Text style={{ color: colors.danger, fontSize: 13, marginTop: 12, textAlign: "center" }}>{error}</Text>
        ) : null}
      </ScrollView>

      {/* Pinned to the bottom of the screen so Previous/Next (and Finish route
          on the last stop) are always in the same place, under the thumb,
          however long the stop card is. */}
      <View
        onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
        style={{
          paddingHorizontal: 18,
          paddingTop: 10,
          paddingBottom: Math.max(insets.bottom, 10),
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.ground,
        }}
      >
        {/* Explicit navigation — separate from the slide controls, which
            always advance to the next PENDING stop after a save. These move
            freely between adjacent stops (including already-saved ones, to
            review or correct), one at a time. */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable
            onPress={() => setCursor((current) => Math.max(0, current - 1))}
            disabled={cursor === 0}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: 13,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.borderStrong,
              backgroundColor: colors.surface,
              alignItems: "center",
              opacity: cursor === 0 ? 0.4 : pressed ? 0.7 : 1,
            })}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Ionicons name="chevron-back" size={16} color={colors.ink} />
              <Text style={{ color: colors.ink, fontSize: 14, fontWeight: "700" }}>Previous</Text>
            </View>
          </Pressable>
          <Pressable
            onPress={() => setCursor((current) => Math.min(total - 1, current + 1))}
            disabled={cursor >= total - 1}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: 13,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.borderStrong,
              backgroundColor: colors.surface,
              alignItems: "center",
              opacity: cursor >= total - 1 ? 0.4 : pressed ? 0.7 : 1,
            })}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Text style={{ color: colors.ink, fontSize: 14, fontWeight: "700" }}>Next</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.ink} />
            </View>
          </Pressable>
        </View>

        {/* The only way to end a round. Filled once every stop is marked, so
            the driver can see at a glance that this is the remaining step. */}
        {isLastStop && cycleEditable ? (
          <Pressable
            onPress={finishRoute}
            style={({ pressed }) => ({
              marginTop: 10,
              paddingVertical: 13,
              borderRadius: radius.md,
              borderWidth: 1.5,
              borderColor: colors.brand,
              backgroundColor: allDone ? colors.brand : "transparent",
              alignItems: "center",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: allDone ? colors.onBrand : colors.brand, fontSize: 14, fontWeight: "800" }}>
              Finish route
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* A delivery can take several seconds — GPS fix, then the network
          round-trip. Without this the controls simply stop responding and the
          screen reads as frozen, which is what drivers reported. */}
      {savingStage ? (
        <View
          style={{
            position: "absolute",
            left: 18,
            right: 18,
            bottom: footerHeight + 12,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            backgroundColor: colors.ink,
            borderRadius: radius.md,
            paddingVertical: 14,
            paddingHorizontal: 16,
          }}
        >
          <ActivityIndicator color={colors.ground} />
          <Text style={{ flex: 1, color: colors.ground, fontSize: 14, fontWeight: "600" }}>
            {savingStage === "location" ? "Getting location…" : "Saving delivery…"}
          </Text>
        </View>
      ) : null}

      {snackbar ? (
        <View
          style={{
            position: "absolute",
            left: 18,
            right: 18,
            bottom: footerHeight + 12,
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: colors.ink,
            borderRadius: radius.md,
            paddingVertical: 13,
            paddingHorizontal: 16,
          }}
        >
          <Text style={{ flex: 1, color: colors.ground, fontSize: 14, fontWeight: "600" }}>
            {snackbar.label} · stop {snackbar.index + 1}
          </Text>
          <Pressable
            onPress={() => {
              setCursor(snackbar.index);
              setSnackbar(null);
            }}
          >
            <Text style={{ color: colors.brand, fontSize: 14, fontWeight: "800" }}>UNDO</Text>
          </Pressable>
        </View>
      ) : null}

      <StopsListModal
        visible={stopsListOpen}
        onClose={() => setStopsListOpen(false)}
        customers={sheet.customers}
        currentIndex={cursor}
        statusOf={(c) => statusOf(c, queuedIds.has(c.customerId))}
        onSelect={(index) => {
          setCursor(index);
          setStopsListOpen(false);
        }}
      />

      <CashSaleModal
        visible={cashSaleOpen}
        onClose={() => setCashSaleOpen(false)}
        routeId={sheet.route.id}
        sessionDate={runDate}
        products={sheet.customers[0]?.products ?? []}
      />

      <Modal visible={mobileEditOpen} transparent animationType="fade" onRequestClose={() => setMobileEditOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: 18 }}>
            <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "800" }}>
              {customer.mobile ? "Update phone number" : "Add phone number"}
            </Text>
            <Text style={{ color: colors.inkFaint, fontSize: 12.5, marginTop: 2 }} numberOfLines={1}>
              {customer.name}
            </Text>
            <TextInput
              value={mobileDraft}
              onChangeText={setMobileDraft}
              keyboardType="phone-pad"
              autoFocus
              placeholder="Phone number"
              placeholderTextColor={colors.inkFaint}
              style={{
                marginTop: 14,
                backgroundColor: colors.surface2,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: radius.md,
                paddingHorizontal: 14,
                paddingVertical: 12,
                color: colors.ink,
                fontSize: 16,
              }}
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <View style={{ flex: 1 }}>
                <Pressable
                  onPress={() => setMobileEditOpen(false)}
                  disabled={savingMobile}
                  style={({ pressed }) => ({
                    paddingVertical: 13,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: colors.borderStrong,
                    alignItems: "center",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ color: colors.inkSoft, fontSize: 14, fontWeight: "700" }}>Cancel</Text>
                </Pressable>
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  label={savingMobile ? "Saving…" : "Save"}
                  onPress={() => void saveMobile()}
                  loading={savingMobile}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>


      <RouteMapModal
        visible={mapOpen}
        onClose={() => setMapOpen(false)}
        customers={sheet.customers}
        currentIndex={cursor}
        statusOf={(c) => statusOf(c, queuedIds.has(c.customerId))}
        onSelect={(index) => {
          setCursor(index);
          setMapOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

function Row({
  label,
  value,
  color,
  colors,
  last,
}: {
  label: string;
  value: string;
  color?: string;
  colors: ReturnType<typeof useColors>;
  last?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingVertical: 12,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
      }}
    >
      <Text style={{ color: colors.inkSoft, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: color ?? colors.ink, fontSize: 15, fontWeight: "800" }}>{value}</Text>
    </View>
  );
}
