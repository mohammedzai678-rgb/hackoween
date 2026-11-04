"use client";

import React, { useEffect, useState, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Circle,
  Popup,
  Tooltip,
  useMapEvents,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { StationSummary } from "@/lib/api";
import {
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  CloudRain,
  Sun,
  Zap,
  Star,
  Layers,
  Compass,
} from "lucide-react";

export interface StationMapForecast {
  station: StationSummary;
  distanceKm: number;
  rainMm: number;
  soilMoisture: number;
  predictedCfs: number;
  isExtremeP90: boolean;
  isSevereP99: boolean;
  surgeRatioP90: number;
}

interface StormForecastMapProps {
  theme: "dark" | "light";
  stormLat: number;
  stormLon: number;
  stormRadiusKm: number;
  stormPeakMm: number;
  stationForecasts: StationMapForecast[];
  selectedStationId: string | null;
  selectedModel: string;
  selectedDayOffset?: number;
  onSelectStormCenter: (lat: number, lon: number) => void;
  onSelectStation: (stationId: string) => void;
  onSelectDayOffset?: (offset: number) => void;
}

type MapStyle = "radar_dark" | "satellite" | "topo" | "street";

const MAP_TILES: Record<
  MapStyle,
  { label: string; url: string; referenceUrl?: string; attribution: string }
> = {
  radar_dark: {
    label: "Dark Radar",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    referenceUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; USGS, NOAA",
  },
  satellite: {
    label: "Satellite Imagery",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    referenceUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, USGS, NOAA",
  },
  topo: {
    label: "Hydrological Topo",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; USGS, NOAA",
  },
  street: {
    label: "Street Map",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
};

function MapClickHandler({
  onSelectStormCenter,
}: {
  onSelectStormCenter: (lat: number, lon: number) => void;
}) {
  useMapEvents({
    click(e) {
      onSelectStormCenter(
        Number(e.latlng.lat.toFixed(4)),
        Number(e.latlng.lng.toFixed(4))
      );
    },
  });
  return null;
}

function MapPanController({
  lat,
  lon,
}: {
  lat: number;
  lon: number;
}) {
  const map = useMap();
  useEffect(() => {
    map.panTo([lat, lon], { animate: true, duration: 0.6 });
  }, [lat, lon, map]);
  return null;
}

export default function StormForecastMap({
  theme,
  stormLat,
  stormLon,
  stormRadiusKm,
  stormPeakMm,
  stationForecasts,
  selectedStationId,
  selectedModel,
  selectedDayOffset = 1,
  onSelectStormCenter,
  onSelectStation,
  onSelectDayOffset,
}: StormForecastMapProps) {
  // Default to radar_dark matching Image 4 (Zoom Earth aesthetic)
  const [mapStyle, setMapStyle] = useState<MapStyle>("radar_dark");
  const [isPlaying, setIsPlaying] = useState(false);
  const activeTile = MAP_TILES[mapStyle];

  // Auto-play timeline loop (cycling Day 0 to Day 4)
  useEffect(() => {
    if (!isPlaying || !onSelectDayOffset) return;

    const interval = setInterval(() => {
      onSelectDayOffset((selectedDayOffset + 1) % 5);
    }, 1800);

    return () => clearInterval(interval);
  }, [isPlaying, selectedDayOffset, onSelectDayOffset]);

  // Find currently highlighted station (either selected or highest surge)
  const activeStationForecast =
    stationForecasts.find((s) => s.station.station_id === selectedStationId) ||
    stationForecasts[0];

  const handleStepPrev = () => {
    if (!onSelectDayOffset) return;
    onSelectDayOffset(selectedDayOffset > 0 ? selectedDayOffset - 1 : 4);
  };

  const handleStepNext = () => {
    if (!onSelectDayOffset) return;
    onSelectDayOffset((selectedDayOffset + 1) % 5);
  };

  // Day names for the 5-day weather HUD (like Image 4)
  const dayNames = ["Today", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="relative h-[560px] lg:h-[600px] w-full overflow-hidden rounded-2xl border border-[var(--border-primary)] shadow-lg bg-slate-950">
      {/* ── TOP RIGHT: Floating Glassmorphic 5-Day Weather HUD (Image 4 Zoom Earth Style) ── */}
      {activeStationForecast && (
        <div className="absolute top-3 right-3 z-[400] w-72 rounded-2xl border border-white/10 bg-slate-950/85 p-3.5 text-xs text-white shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <Star className="h-3.5 w-3.5 text-amber-400 shrink-0 fill-amber-400" />
              <span className="font-bold text-sm tracking-tight truncate">
                {activeStationForecast.station.station_name}
              </span>
            </div>
            <span className="text-[10px] font-mono text-cyan-400 font-semibold shrink-0 uppercase">
              USGS #{activeStationForecast.station.station_id}
            </span>
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
            <span>DAY UTC-5 · SATELLITE RADAR</span>
            <span className="font-mono text-cyan-300">
              {activeStationForecast.station.state}
            </span>
          </div>

          {/* 5-Day Vertical / Grid Forecast rows (like Image 4) */}
          <div className="space-y-1.5">
            {dayNames.map((dName, dIdx) => {
              const isToday = dIdx === selectedDayOffset;
              const rainFactor =
                dIdx === 0
                  ? 0.35
                  : dIdx === 1
                  ? 1.0
                  : dIdx === 2
                  ? 0.75
                  : dIdx === 3
                  ? 0.4
                  : 0.15;

              const baseRain = Math.max(activeStationForecast.rainMm, 24);
              const estRain = Math.round(baseRain * rainFactor);

              const baseFlow = Math.max(
                activeStationForecast.predictedCfs,
                activeStationForecast.station.p90_discharge_cfs * 0.8,
                activeStationForecast.station.mean_discharge_cfs * 1.4,
                2400
              );
              const estFlow = Math.round(
                baseFlow * (0.65 + rainFactor * 0.45)
              );

              return (
                <button
                  key={dName}
                  type="button"
                  onClick={() => onSelectDayOffset && onSelectDayOffset(dIdx)}
                  className={`w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 transition-all text-left ${
                    isToday
                      ? "bg-cyan-500/25 border border-cyan-400/40 text-cyan-200"
                      : "hover:bg-white/5 text-slate-300"
                  }`}
                >
                  <span className="font-semibold w-12 text-[11px]">{dName}</span>

                  <div className="flex items-center gap-1.5 text-xs">
                    {estRain >= 25 ? (
                      <Zap className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
                    ) : estRain >= 8 ? (
                      <CloudRain className="h-3.5 w-3.5 text-sky-400" />
                    ) : (
                      <Sun className="h-3.5 w-3.5 text-amber-300" />
                    )}
                    <span className="font-mono text-[11px]">{estRain}mm</span>
                  </div>

                  <span className="font-mono font-bold text-[11px]">
                    {estFlow >= 1000
                      ? `${(estFlow / 1000).toFixed(0)}k`
                      : estFlow}{" "}
                    <span className="text-[9px] text-slate-400 font-normal">
                      cfs
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TOP LEFT: Floating Basemap Switcher Pill ── */}
      <div className="absolute top-3 left-3 z-[400] flex items-center gap-1 rounded-xl border border-white/10 bg-slate-950/80 p-1 text-xs shadow-xl backdrop-blur-md">
        <Layers className="h-3.5 w-3.5 text-cyan-400 ml-1 mr-0.5" />
        {(Object.keys(MAP_TILES) as MapStyle[]).map((styleKey) => {
          const isActive = mapStyle === styleKey;
          return (
            <button
              key={styleKey}
              type="button"
              onClick={() => setMapStyle(styleKey)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                isActive
                  ? "bg-cyan-500 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {MAP_TILES[styleKey].label.split(" ")[0]}
            </button>
          );
        })}
      </div>

      {/* ── BOTTOM CENTER: Floating Satellite Time & Playback Controls (Image 4 Zoom Earth Style) ── */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[400] flex items-center gap-2.5 rounded-2xl border border-white/15 bg-slate-950/90 px-4 py-2 text-white shadow-2xl backdrop-blur-md">
        {/* Step Prev */}
        <button
          type="button"
          onClick={handleStepPrev}
          title="Previous Forecast Day"
          className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {/* Play / Pause Toggle */}
        <button
          type="button"
          onClick={() => setIsPlaying(!isPlaying)}
          title={isPlaying ? "Pause Timeline Loop" : "Play Timeline Loop"}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-500 text-white shadow-md hover:bg-cyan-400 transition"
        >
          {isPlaying ? (
            <Pause className="h-3.5 w-3.5 fill-current" />
          ) : (
            <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
          )}
        </button>

        {/* Live Date / Time Display */}
        <div className="flex flex-col items-center px-2">
          <span className="font-mono text-xs font-bold tracking-wider text-cyan-300">
            4 Nov &middot; 22:30 UTC
          </span>
          <span className="text-[10px] text-slate-400">
            Forecast Horizon: Day +{selectedDayOffset} ({dayNames[selectedDayOffset]})
          </span>
        </div>

        {/* Step Next */}
        <button
          type="button"
          onClick={handleStepNext}
          title="Next Forecast Day"
          className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        {/* Timeline Day Dots */}
        <div className="flex items-center gap-1.5 border-l border-white/15 pl-3">
          {[0, 1, 2, 3, 4].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onSelectDayOffset && onSelectDayOffset(d)}
              className={`h-2.5 rounded-full transition-all ${
                selectedDayOffset === d
                  ? "w-5 bg-cyan-400"
                  : "w-2.5 bg-white/20 hover:bg-white/40"
              }`}
              title={`Jump to Day +${d}`}
            />
          ))}
        </div>
      </div>

      {/* ── Leaflet Interactive Map Canvas ── */}
      <MapContainer
        center={[38.5, -94.0]}
        zoom={4}
        minZoom={3}
        maxZoom={12}
        scrollWheelZoom={true}
        className="h-full w-full z-0"
      >
        <TileLayer
          key={`${mapStyle}-${theme}-base`}
          attribution={activeTile.attribution}
          url={activeTile.url}
        />
        {activeTile.referenceUrl && (
          <TileLayer
            key={`${mapStyle}-${theme}-ref`}
            url={activeTile.referenceUrl}
          />
        )}

        <MapClickHandler onSelectStormCenter={onSelectStormCenter} />
        <MapPanController lat={stormLat} lon={stormLon} />

        {/* ── Realistic Satellite Weather Radar Cloud & Precipitation Bands ── */}
        {stormPeakMm > 0 && (
          <>
            {/* Band 1: Outermost diffuse cloud fringe (translucent smoky white) */}
            <Circle
              center={[stormLat, stormLon]}
              radius={stormRadiusKm * 1150}
              pathOptions={{
                color: "#e2e8f0",
                weight: 1,
                dashArray: "3 6",
                fillColor: "#94a3b8",
                fillOpacity: 0.12,
              }}
            />

            {/* Band 2: Mid-level rainband echo (Doppler cyan/blue) */}
            <Circle
              center={[stormLat, stormLon]}
              radius={stormRadiusKm * 800}
              pathOptions={{
                color: "#38bdf8",
                weight: 1.8,
                dashArray: "6 6",
                fillColor: "#0284c7",
                fillOpacity: 0.22,
              }}
            />

            {/* Band 3: Intense precipitation swath (Doppler emerald/yellow) */}
            <Circle
              center={[stormLat, stormLon]}
              radius={stormRadiusKm * 480}
              pathOptions={{
                color: "#f59e0b",
                weight: 2,
                fillColor: "#eab308",
                fillOpacity: 0.32,
              }}
            />

            {/* Band 4: Torrential storm core / eye (Doppler crimson/red) */}
            <Circle
              center={[stormLat, stormLon]}
              radius={stormRadiusKm * 220}
              pathOptions={{
                color: "#ef4444",
                weight: 2.5,
                fillColor: "#dc2626",
                fillOpacity: 0.45,
              }}
            />
          </>
        )}

        {/* Storm Epicenter Marker */}
        <CircleMarker
          center={[stormLat, stormLon]}
          radius={8}
          pathOptions={{
            color: "#ffffff",
            weight: 2.5,
            fillColor: "#06b6d4",
            fillOpacity: 1,
          }}
        >
          <Tooltip direction="top" offset={[0, -10]} permanent={false}>
            <div className="text-xs font-semibold">
              Storm Center ({stormLat.toFixed(2)}°N, {Math.abs(stormLon).toFixed(2)}°W)
              {"\n"}Peak {stormPeakMm} mm
            </div>
          </Tooltip>
        </CircleMarker>

        {/* ── 32 Monitored USGS Gauge Stations with Glowing Markers ── */}
        {stationForecasts.map((item) => {
          const {
            station,
            rainMm,
            predictedCfs,
            isExtremeP90,
            isSevereP99,
            distanceKm,
          } = item;
          const isSelected = station.station_id === selectedStationId;

          let fillColor = "#10b981"; // Normal baseflow (emerald)
          let strokeColor = "#34d399";
          if (isSevereP99) {
            fillColor = "#ef4444"; // Severe P99+ critical flood (red)
            strokeColor = "#fca5a5";
          } else if (isExtremeP90) {
            fillColor = "#f59e0b"; // P90+ flood surge (amber)
            strokeColor = "#fcd34d";
          } else if (rainMm >= 10) {
            fillColor = "#0284c7"; // Rain-impacted (cyan)
            strokeColor = "#7dd3fc";
          }

          const radius = isSelected
            ? 12
            : isSevereP99
            ? 10
            : isExtremeP90
            ? 8.5
            : rainMm >= 10
            ? 7
            : 5.5;

          return (
            <CircleMarker
              key={station.station_id}
              center={[station.latitude, station.longitude]}
              radius={radius}
              eventHandlers={{
                click: (e) => {
                  e.originalEvent.stopPropagation();
                  onSelectStation(station.station_id);
                },
              }}
              pathOptions={{
                color: isSelected ? "#ffffff" : strokeColor,
                weight: isSelected ? 3.5 : 1.8,
                fillColor,
                fillOpacity: 0.95,
              }}
            >
              <Tooltip direction="top" offset={[0, -8]}>
                <div className="text-xs space-y-0.5">
                  <div className="font-bold">
                    #{station.station_id} &middot; {station.station_name}
                  </div>
                  <div>
                    Forecast:{" "}
                    <span className="font-mono font-bold text-cyan-400">
                      {predictedCfs.toLocaleString("en-US", {
                        maximumFractionDigits: 0,
                      })}{" "}
                      cfs
                    </span>{" "}
                    | Rain: <span className="font-mono">{rainMm.toFixed(1)} mm</span>
                  </div>
                  <div className="text-[10px] opacity-80 uppercase tracking-wide">
                    {isSevereP99
                      ? "CRITICAL P99+ FLOOD SURGE"
                      : isExtremeP90
                      ? "P90+ FLOOD WATCH"
                      : "Normal Baseflow"}
                  </div>
                </div>
              </Tooltip>

              <Popup>
                <div className="min-w-[220px] space-y-2 text-xs text-slate-900">
                  <div className="border-b border-slate-200 pb-1.5">
                    <div className="font-mono text-[11px] font-bold text-cyan-600">
                      USGS #{station.station_id} &middot; {station.state}
                    </div>
                    <div className="font-bold text-sm text-slate-900">
                      {station.station_name}
                    </div>
                    <div className="text-slate-500">{station.river_name}</div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-slate-500 block">Predicted Flow</span>
                      <span className="font-mono font-bold text-slate-900 text-sm">
                        {predictedCfs.toLocaleString("en-US", {
                          maximumFractionDigits: 0,
                        })}{" "}
                        cfs
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Storm Rain</span>
                      <span className="font-mono font-semibold text-cyan-700 text-sm">
                        {rainMm.toFixed(1)} mm
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">P90 Flood Stage</span>
                      <span className="font-mono text-slate-700">
                        {station.p90_discharge_cfs.toLocaleString("en-US", {
                          maximumFractionDigits: 0,
                        })}{" "}
                        cfs
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Distance</span>
                      <span className="font-mono text-slate-700">
                        {distanceKm.toFixed(0)} km
                      </span>
                    </div>
                  </div>

                  <div className="pt-1 flex items-center justify-between gap-2">
                    <a
                      href={`/predict?station=${station.station_id}&model=${encodeURIComponent(
                        selectedModel
                      )}`}
                      className="inline-block rounded-lg bg-cyan-600 px-2.5 py-1.5 text-white font-semibold hover:bg-cyan-700 transition text-center w-full"
                    >
                      Open 7-Day Simulator &rarr;
                    </a>
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
