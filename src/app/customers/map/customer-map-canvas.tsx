"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { CustomerMapPin } from "@/lib/customer-map";

// OpenStreetMap tiles: no API key, no billing. The existing Google Maps key
// can't be reused here anyway — it's restricted to the Android package and
// signing certificate, so a web map would need a second key and a per-load
// bill. For placing and correcting pins, these tiles are enough.
const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Numbered, colour-coded markers drawn as inline SVG rather than image assets,
// so the sequence number is legible on the pin itself — a round that zig-zags
// is then obvious at a glance instead of needing each pin clicked.
function pinIcon(label: string, tone: "normal" | "outlier" | "selected" | "draft"): L.DivIcon {
  const fill =
    tone === "selected" ? "#0f766e" : tone === "outlier" ? "#b45309" : tone === "draft" ? "#15803d" : "#334155";
  const size = tone === "selected" || tone === "draft" ? 34 : 28;

  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:${size}px;height:${size}px;">
        <svg viewBox="0 0 24 24" width="${size}" height="${size}">
          <path fill="${fill}" stroke="#ffffff" stroke-width="1.5"
            d="M12 2c-4 0-7 3-7 7 0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z"/>
        </svg>
        <span style="position:absolute;inset:0;top:-2px;display:flex;align-items:center;justify-content:center;
                     color:#fff;font-size:${size > 30 ? 11 : 10}px;font-weight:700;">${label}</span>
      </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size + 4],
  });
}

// Keeps the view on whatever is currently shown. Without this, changing the
// route filter leaves the map looking at the previous round.
function FitToPins({ pins }: { pins: CustomerMapPin[] }) {
  const map = useMap();

  useEffect(() => {
    if (pins.length === 0) return;
    const bounds = L.latLngBounds(pins.map((pin) => [pin.latitude!, pin.longitude!] as [number, number]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
  }, [map, pins]);

  return null;
}

// Placing a location for a customer who has none. Clicking the map is the whole
// interaction — there's no existing pin to drag, which is the case for every
// customer the driver app hasn't reached yet.
function ClickToPlace({ active, onPlace }: { active: boolean; onPlace: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (event) => {
      if (active) {
        onPlace(event.latlng.lat, event.latlng.lng);
      }
    },
  });
  return null;
}

export function CustomerMapCanvas({
  pins,
  centre,
  selectedId,
  draft,
  placing,
  onSelect,
  onDraftMove,
}: {
  pins: CustomerMapPin[];
  centre: { latitude: number; longitude: number } | null;
  selectedId: string | null;
  draft: { latitude: number; longitude: number } | null;
  placing: boolean;
  onSelect: (pin: CustomerMapPin) => void;
  onDraftMove: (latitude: number, longitude: number) => void;
}) {
  const markerRef = useRef<L.Marker | null>(null);

  // Falls back to Bahadurgarh only when there is nothing at all to show, which
  // is the state a city has before any delivery has captured a location.
  const initialCentre = useMemo<[number, number]>(
    () => (centre ? [centre.latitude, centre.longitude] : [28.6939, 76.9105]),
    [centre],
  );

  return (
    <div className="overflow-hidden rounded-lg border border-surface-border">
      {placing ? (
        <p className="bg-accent/10 px-4 py-2 text-sm font-medium text-text-primary">
          Click the map where this customer is.
        </p>
      ) : null}
      <MapContainer
        center={initialCentre}
        zoom={centre ? 15 : 13}
        scrollWheelZoom
        style={{ height: 520, width: "100%", cursor: placing ? "crosshair" : undefined }}
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <FitToPins pins={pins} />
        <ClickToPlace active={placing} onPlace={onDraftMove} />

        {pins.map((pin) => {
          const isSelected = pin.customerId === selectedId;
          // While dragging a correction, the marker follows the draft rather
          // than the stored position, so what's on screen is what will save.
          const position: [number, number] =
            isSelected && draft ? [draft.latitude, draft.longitude] : [pin.latitude!, pin.longitude!];

          return (
            <Marker
              key={pin.customerId}
              position={position}
              draggable={isSelected}
              icon={pinIcon(
                pin.sequenceNo ? String(pin.sequenceNo) : "•",
                isSelected ? "selected" : pin.outlierKm !== null ? "outlier" : "normal",
              )}
              ref={isSelected ? markerRef : undefined}
              eventHandlers={{
                click: () => onSelect(pin),
                dragend: (event) => {
                  const { lat, lng } = (event.target as L.Marker).getLatLng();
                  onDraftMove(lat, lng);
                },
              }}
            >
              <Popup>
                <span className="text-xs font-semibold">{pin.name}</span>
                <br />
                <span className="text-xs">{pin.code}</span>
                {pin.outlierKm !== null ? (
                  <>
                    <br />
                    <span className="text-xs">{pin.outlierKm.toFixed(1)} km from this route</span>
                  </>
                ) : null}
              </Popup>
            </Marker>
          );
        })}

        {/* Where a not-yet-located customer is being placed. Separate from the
            markers above because that customer has no position to render. */}
        {placing && draft ? (
          <Marker
            position={[draft.latitude, draft.longitude]}
            draggable
            icon={pinIcon("＋", "draft")}
            eventHandlers={{
              dragend: (event) => {
                const { lat, lng } = (event.target as L.Marker).getLatLng();
                onDraftMove(lat, lng);
              },
            }}
          />
        ) : null}
      </MapContainer>
    </div>
  );
}
