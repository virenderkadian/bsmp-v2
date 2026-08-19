import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import MapView, { Marker, type Region } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import type { DriverSheetCustomer } from "@shared/driver-api-types";
import { ensureForegroundLocationPermission } from "@/location";
import { useColors } from "@/ui";

type Status = { tone: "delivered" | "skipped" | "pending"; label: string };
type Pin = { customer: DriverSheetCustomer; index: number; latitude: number; longitude: number; status: Status };

const FALLBACK_REGION: Region = { latitude: 28.6139, longitude: 77.209, latitudeDelta: 0.15, longitudeDelta: 0.15 };
const FIT_PADDING = { top: 80, right: 60, bottom: 220, left: 60 };

// Route stops on a map — a live-position complement to StopsListModal's
// search/jump list. Same "Modal, not a pushed route" pattern for the same
// reason: it just needs the run screen's already-loaded sheet/cursor via
// props, and a Modal is guaranteed to render above the native tab bar.
export function RouteMapModal({
  visible,
  onClose,
  customers,
  currentIndex,
  statusOf,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  customers: DriverSheetCustomer[];
  currentIndex: number;
  statusOf: (customer: DriverSheetCustomer) => Status;
  onSelect: (index: number) => void;
}) {
  const colors = useColors();
  const mapRef = useRef<MapView>(null);
  const [showsUserLocation, setShowsUserLocation] = useState(false);

  useEffect(() => {
    if (!visible) return;
    ensureForegroundLocationPermission().then(setShowsUserLocation);
  }, [visible]);

  const pins = useMemo<Pin[]>(() => {
    return customers
      .map((customer, index) => {
        const latitude = Number(customer.latitude);
        const longitude = Number(customer.longitude);
        if (!customer.latitude || !customer.longitude || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return null;
        }
        return { customer, index, latitude, longitude, status: statusOf(customer) };
      })
      .filter((pin): pin is Pin => pin !== null);
  }, [customers, statusOf]);

  const missingCount = customers.length - pins.length;

  const fitToPins = () => {
    if (pins.length === 0 || !mapRef.current) return;
    if (pins.length === 1) {
      mapRef.current.animateToRegion(
        { latitude: pins[0].latitude, longitude: pins[0].longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 },
        400,
      );
      return;
    }
    mapRef.current.fitToCoordinates(
      pins.map((pin) => ({ latitude: pin.latitude, longitude: pin.longitude })),
      { edgePadding: FIT_PADDING, animated: true },
    );
  };

  const pinColor = (pin: Pin): string => {
    if (pin.index === currentIndex) return colors.brand;
    if (pin.status.tone === "delivered") return colors.delivered;
    if (pin.status.tone === "skipped") return colors.skipped;
    return colors.pending;
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.ground }} edges={["top", "left", "right"]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "800" }}>Route map</Text>
            {missingCount > 0 ? (
              <Text style={{ color: colors.inkFaint, fontSize: 12, marginTop: 1 }}>
                {missingCount} stop{missingCount === 1 ? "" : "s"} without a saved location
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={onClose}
            style={{ width: 34, height: 34, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: colors.ink, fontSize: 16 }}>✕</Text>
          </Pressable>
        </View>

        <View style={{ flex: 1 }}>
          {pins.length === 0 ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
              <Text style={{ color: colors.inkFaint, fontSize: 14, textAlign: "center" }}>
                No customer on this route has a saved location yet.
              </Text>
            </View>
          ) : (
            <MapView
              ref={mapRef}
              style={{ flex: 1 }}
              initialRegion={FALLBACK_REGION}
              showsUserLocation={showsUserLocation}
              showsMyLocationButton
              onMapReady={fitToPins}
            >
              {pins.map((pin) => (
                <Marker
                  key={pin.customer.customerId}
                  coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
                  pinColor={pinColor(pin)}
                  // Native callout via title/description rather than a custom
                  // <Callout> child. On Android react-native-maps renders
                  // custom callout content as a bitmap snapshot, and a
                  // container without an explicit width collapses to nothing —
                  // which is exactly what happened: the bubble appeared with no
                  // customer name in it. The native one always renders.
                  //
                  // Marker has no onPress on purpose: it used to navigate
                  // immediately, firing before any callout could open, so a tap
                  // meaning "who is this?" closed the map instead.
                  title={`${pin.customer.sequenceNo}. ${pin.customer.name}`}
                  description={[
                    pin.customer.area,
                    pin.index === currentIndex ? "Current stop" : pin.status.label,
                    "Tap to open",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  onCalloutPress={() => onSelect(pin.index)}
                />
              ))}
            </MapView>
          )}
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}>
          <Legend color={colors.brand} label="Current" colors={colors} />
          <Legend color={colors.delivered} label="Delivered" colors={colors} />
          <Legend color={colors.skipped} label="Skipped" colors={colors} />
          <Legend color={colors.pending} label="Pending" colors={colors} />
          <Text style={{ width: "100%", color: colors.inkFaint, fontSize: 11 }}>
            Tap a pin to see who it is, then tap the label to open that stop.
          </Text>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function Legend({ color, label, colors }: { color: string; label: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color }} />
      <Text style={{ color: colors.inkSoft, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}
