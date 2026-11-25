'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import maplibregl, { GeoJSONSource, Map as MapLibreMap, Marker, Popup } from 'maplibre-gl';
import { POIItem, ThirdEyePointData } from '@/types/poi';
import { Eye, Layers, ShieldCheck, X, Sparkles } from 'lucide-react';

const THIRD_EYE_SOURCE_ID = 'thirdEye';
const THIRD_EYE_CASING_LAYER_ID = 'ThirdEye360_casing';
const THIRD_EYE_LAYER_ID = 'ThirdEye360';
const THIRD_EYE_TILE_URL = 'https://tiles.bmapsbd.com/ThirdEye360';

const EXTRACTED_SOURCE_ID = 'extracted-frames';
const EXTRACTED_HALO_LAYER_ID = 'extracted-frames-halo';
const EXTRACTED_CORE_LAYER_ID = 'extracted-frames-core';
const VIEWPORT_STORAGE_KEY = 'barikoi_last_viewport';

interface MapViewProps {
  pois: POIItem[];
  selectedPoi: POIItem | null;
  onSelectPoi: (poi: POIItem | null) => void;
  selectedThirdEye: ThirdEyePointData | null;
  onSelectThirdEye: (point: ThirdEyePointData | null) => void;
  showGuide?: boolean;
  onDismissGuide?: () => void;
}

const isPersistedUuid = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export default function MapView({
  pois,
  selectedPoi,
  onSelectPoi,
  selectedThirdEye,
  onSelectThirdEye,
  showGuide = false,
  onDismissGuide,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const thirdEyeMarkerRef = useRef<Marker | null>(null);
  const [styleSource, setStyleSource] = useState<string>('Initializing');
  const [thirdEyeActive, setThirdEyeActive] = useState<boolean>(true);

  const extractedGeoJson = useMemo(() => {
    const seenFrames = new globalThis.Map<string, { coords: [number, number]; count: number }>();
    pois.forEach((poi) => {
      if (!isPersistedUuid(poi.id)) return;
      const key = poi.frameId || poi.id;
      const existing = seenFrames.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        seenFrames.set(key, { coords: poi.coordinates, count: 1 });
      }
    });

    return {
      type: 'FeatureCollection' as const,
      features: Array.from(seenFrames.entries()).map(([frameId, info]) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: info.coords,
        },
        properties: {
          frameId,
          poiCount: info.count,
        },
      })),
    };
  }, [pois]);

  const extractedGeoJsonRef = useRef(extractedGeoJson);
  extractedGeoJsonRef.current = extractedGeoJson;

  // Setup ThirdEye + Extracted Coverage layers on style load
  const attachThirdEyeLayers = useCallback((map: MapLibreMap) => {
    try {
      if (!map.getSource(THIRD_EYE_SOURCE_ID)) {
        map.addSource(THIRD_EYE_SOURCE_ID, {
          type: 'vector',
          url: THIRD_EYE_TILE_URL,
        });
      }

      if (!map.getLayer(THIRD_EYE_CASING_LAYER_ID)) {
        map.addLayer({
          id: THIRD_EYE_CASING_LAYER_ID,
          type: 'circle',
          source: THIRD_EYE_SOURCE_ID,
          'source-layer': 'ThirdEye360',
          minzoom: 7,
          paint: {
            'circle-color': '#0077C2',
            'circle-radius': [
              'interpolate',
              ['linear'],
              ['zoom'],
              7, 0.5,
              10, 0.8,
              12, 1.3,
              14, 2.2,
              16, 3.8,
              18, 6.0,
            ],
            'circle-stroke-width': 0,
            'circle-opacity': 0.75,
          },
        });
      }

      if (!map.getLayer(THIRD_EYE_LAYER_ID)) {
        map.addLayer({
          id: THIRD_EYE_LAYER_ID,
          type: 'circle',
          source: THIRD_EYE_SOURCE_ID,
          'source-layer': 'ThirdEye360',
          minzoom: 7,
          paint: {
            'circle-color': '#00B0FF',
            'circle-radius': [
              'interpolate',
              ['linear'],
              ['zoom'],
              7, 0.3,
              10, 0.5,
              12, 0.85,
              14, 1.5,
              16, 2.8,
              18, 4.5,
            ],
            'circle-stroke-width': 0,
            'circle-opacity': 0.95,
          },
        });
      }

      // Extracted coverage overlay (Emerald Green dots for already-extracted frames)
      if (!map.getSource(EXTRACTED_SOURCE_ID)) {
        map.addSource(EXTRACTED_SOURCE_ID, {
          type: 'geojson',
          data: extractedGeoJsonRef.current,
        });
      }

      if (!map.getLayer(EXTRACTED_HALO_LAYER_ID)) {
        map.addLayer({
          id: EXTRACTED_HALO_LAYER_ID,
          type: 'circle',
          source: EXTRACTED_SOURCE_ID,
          paint: {
            'circle-color': '#10B981',
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 8, 18, 13],
            'circle-opacity': 0.35,
          },
        });
      }

      if (!map.getLayer(EXTRACTED_CORE_LAYER_ID)) {
        map.addLayer({
          id: EXTRACTED_CORE_LAYER_ID,
          type: 'circle',
          source: EXTRACTED_SOURCE_ID,
          paint: {
            'circle-color': '#10B981',
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 14, 4.5, 18, 7],
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#FFFFFF',
            'circle-opacity': 1,
          },
        });
      }

      setThirdEyeActive(true);
    } catch (err) {
      console.warn('ThirdEye layer attachment warning:', err);
    }
  }, []);

  useEffect(() => {
    if (!mapContainer.current || mapInstance.current) return;

    const apiKey = process.env.NEXT_PUBLIC_BARIKOI_API_KEY || 'MTYyNDpFQVg4VlFaMUtB';
    const baseStyleUrl =
      process.env.NEXT_PUBLIC_MAP_STYLE_URL ||
      'https://map.barikoi.com/styles/osm_barikoi_v1/style.json';

    let resolvedStyleUrl = baseStyleUrl;
    if (baseStyleUrl.includes('barikoi.com') && !baseStyleUrl.includes('key=')) {
      resolvedStyleUrl = `${baseStyleUrl}?key=${apiKey}`;
    }

    setStyleSource('Barikoi Vector Tiles (osm_barikoi_v1)');

    let initialLat = parseFloat(process.env.NEXT_PUBLIC_DEFAULT_LAT || '23.8103');
    let initialLng = parseFloat(process.env.NEXT_PUBLIC_DEFAULT_LNG || '90.4125');
    let initialZoom = parseFloat(process.env.NEXT_PUBLIC_DEFAULT_ZOOM || '14');

    try {
      const saved = localStorage.getItem(VIEWPORT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { lng?: number; lat?: number; zoom?: number };
        if (
          typeof parsed.lng === 'number' &&
          typeof parsed.lat === 'number' &&
          typeof parsed.zoom === 'number'
        ) {
          initialLng = parsed.lng;
          initialLat = parsed.lat;
          initialZoom = parsed.zoom;
        }
      }
    } catch {
      // Ignore storage errors
    }

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: resolvedStyleUrl,
      center: [initialLng, initialLat],
      zoom: initialZoom,
      pitch: 30,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

    map.on('load', () => {
      mapInstance.current = map;
      attachThirdEyeLayers(map);
      map.resize();
    });

    map.on('style.load', () => {
      attachThirdEyeLayers(map);
    });

    map.on('moveend', () => {
      try {
        const c = map.getCenter();
        localStorage.setItem(
          VIEWPORT_STORAGE_KEY,
          JSON.stringify({ lng: c.lng, lat: c.lat, zoom: map.getZoom() }),
        );
      } catch {
        // Ignore storage errors
      }
    });

    map.on('mouseenter', THIRD_EYE_LAYER_ID, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', THIRD_EYE_LAYER_ID, () => {
      map.getCanvas().style.cursor = '';
    });

    map.on('click', THIRD_EYE_LAYER_ID, (e) => {
      if (!e.features || e.features.length === 0) return;
      const feat = e.features[0];
      const props = (feat.properties as Record<string, unknown>) || {};

      const id = String(props.id || feat.id || '');
      const imageUrlHigh = String(
        props.imageUrl_High || props.driveUrl_High || props.imageUrl_Comp || '',
      );
      const imageUrlComp = String(props.imageUrl_Comp || props.driveUrl_Comp || '');

      const lat =
        props.latitude_snapped != null
          ? parseFloat(String(props.latitude_snapped))
          : e.lngLat.lat;
      const lng =
        props.longitude_snapped != null
          ? parseFloat(String(props.longitude_snapped))
          : e.lngLat.lng;

      const pointData: ThirdEyePointData = {
        id,
        imageUrlHigh,
        imageUrlComp,
        initialYaw: parseFloat(String(props.initialYaw ?? 0)) || 0,
        initialPitch: parseFloat(String(props.initialPitch ?? 0)) || 0,
        initialHfov: parseFloat(String(props.initialHfov ?? 100)) || 100,
        coordinates: [lng, lat],
        captureDate: (props.capture_date || props.capture_date_raw) as string | undefined,
        nextId: props.next_id as string | undefined,
        previousId: props.previous_id as string | undefined,
      };

      onSelectThirdEye(pointData);
    });

    map.on('error', (e) => {
      console.warn('MapLibre style load error:', e);
    });

    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    resizeObserver.observe(mapContainer.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapInstance.current = null;
    };
  }, [attachThirdEyeLayers, onSelectThirdEye]);

  // Keep extracted-frames coverage layer synced with persisted POIs
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    const source = map.getSource(EXTRACTED_SOURCE_ID) as GeoJSONSource | undefined;
    if (source) {
      source.setData(extractedGeoJson);
    }
  }, [extractedGeoJson]);

  // Update POI markers grouped by (lat, lon) coordinate
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    const groups = new globalThis.Map<
      string,
      { coordKey: string; coords: [number, number]; pois: POIItem[] }
    >();
    pois.forEach((poi) => {
      const coordKey = `${poi.coordinates[1].toFixed(5)}, ${poi.coordinates[0].toFixed(5)}`;
      const existing = groups.get(coordKey);
      if (existing) {
        existing.pois.push(poi);
      } else {
        groups.set(coordKey, { coordKey, coords: poi.coordinates, pois: [poi] });
      }
    });

    groups.forEach((group) => {
      const el = document.createElement('div');
      el.className = 'custom-poi-marker';

      const groupHasSelected = group.pois.some((p) => p.id === selectedPoi?.id);
      const primaryPoi = group.pois.find((p) => p.id === selectedPoi?.id) || group.pois[0];
      const isPersisted = group.pois.some((p) => isPersistedUuid(p.id));
      const extraCount = group.pois.length - 1;

      const pinBg = groupHasSelected
        ? 'bg-amber-500 ring-amber-300 scale-125 z-30'
        : isPersisted
          ? 'bg-emerald-600 ring-white hover:bg-emerald-700'
          : 'bg-indigo-600 ring-white hover:bg-indigo-700';

      el.innerHTML = `
        <div class="relative flex items-center justify-center">
          <div class="w-8 h-8 rounded-full shadow-lg flex items-center justify-center text-white text-xs font-bold ring-2 transition-all ${pinBg}">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
          </div>
          ${
            group.pois.length > 1
              ? `<span class="absolute -top-2 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-slate-900 border border-white text-white text-[10px] font-bold flex items-center justify-center shadow">${group.pois.length}</span>`
              : ''
          }
          <div class="absolute -bottom-6 bg-slate-900/90 text-white text-[10px] px-1.5 py-0.5 rounded shadow whitespace-nowrap pointer-events-none font-medium">
            ${primaryPoi.nameBn}${extraCount > 0 ? ` (+${extraCount})` : ''}
          </div>
        </div>
      `;

      const popupEl = document.createElement('div');
      popupEl.className = 'p-1.5 space-y-1.5 max-w-[260px]';

      const coordHeader = document.createElement('div');
      coordHeader.className =
        'text-[10px] font-mono font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded flex items-center justify-between gap-2';
      coordHeader.textContent = `${group.coordKey} (${group.pois.length})`;
      popupEl.appendChild(coordHeader);

      const listEl = document.createElement('div');
      listEl.className = 'space-y-1 max-h-48 overflow-y-auto';

      group.pois.forEach((p) => {
        const itemBtn = document.createElement('button');
        itemBtn.type = 'button';
        itemBtn.className =
          'w-full text-left p-1.5 rounded border border-slate-200 hover:bg-slate-50 transition-colors block';

        const cat = document.createElement('div');
        cat.className = 'text-[9px] font-semibold uppercase tracking-wider text-indigo-600';
        cat.textContent = p.category;

        const bn = document.createElement('div');
        bn.className = 'font-bold text-xs text-slate-900 leading-tight';
        bn.textContent = p.nameBn;

        const en = document.createElement('div');
        en.className = 'text-[11px] text-slate-500 truncate';
        en.textContent = p.nameEn;

        itemBtn.appendChild(cat);
        itemBtn.appendChild(bn);
        itemBtn.appendChild(en);
        itemBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          onSelectPoi(p);
        });
        listEl.appendChild(itemBtn);
      });

      popupEl.appendChild(listEl);

      const popup = new Popup({ offset: 25, closeButton: true }).setDOMContent(popupEl);

      const marker = new Marker({ element: el })
        .setLngLat(group.coords)
        .setPopup(popup)
        .addTo(map);

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelectPoi(primaryPoi);
      });

      markersRef.current.push(marker);
    });
  }, [pois, selectedPoi, onSelectPoi]);

  // Update active ThirdEye Street View Marker with a pulsing camera ring
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    if (thirdEyeMarkerRef.current) {
      thirdEyeMarkerRef.current.remove();
      thirdEyeMarkerRef.current = null;
    }

    if (selectedThirdEye) {
      const el = document.createElement('div');
      el.className = 'thirdeye-active-marker';
      el.innerHTML = `
        <div class="relative flex items-center justify-center">
          <div class="absolute w-8 h-8 rounded-full bg-cyan-400/40 animate-ping"></div>
          <div class="w-6 h-6 rounded-full bg-cyan-500 border-2 border-white shadow-xl flex items-center justify-center text-white">
            <div class="w-2 h-2 rounded-full bg-white"></div>
          </div>
        </div>
      `;

      thirdEyeMarkerRef.current = new Marker({ element: el })
        .setLngLat(selectedThirdEye.coordinates)
        .addTo(map);

      map.flyTo({
        center: selectedThirdEye.coordinates,
        zoom: Math.max(map.getZoom(), 16),
        duration: 800,
        essential: true,
      });
    }
  }, [selectedThirdEye]);

  // Center on selected POI
  useEffect(() => {
    if (selectedPoi && mapInstance.current) {
      mapInstance.current.flyTo({
        center: selectedPoi.coordinates,
        zoom: 17,
        pitch: 45,
        essential: true,
      });
    }
  }, [selectedPoi]);

  const extractedCount = extractedGeoJson.features.length;

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />

      {/* Style & Layer Badges */}
      <div className="absolute top-4 left-4 z-10 flex flex-col space-y-1.5 max-w-[calc(100%-4.5rem)]">
        <div className="flex items-center space-x-2 bg-white/95 backdrop-blur-sm px-3 py-1.5 rounded-lg shadow-sm border border-slate-200 text-xs font-medium text-slate-700 w-fit">
          <Layers className="w-4 h-4 text-indigo-600 shrink-0" />
          <span className="truncate">{styleSource}</span>
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 ml-1 shrink-0" />
        </div>

        {thirdEyeActive && (
          <div className="flex items-center space-x-2 bg-white/95 backdrop-blur-sm px-3 py-1.5 rounded-lg shadow-sm border border-cyan-200 text-xs font-semibold text-cyan-800 w-fit">
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-500 animate-pulse shrink-0" />
            <Eye className="w-3.5 h-3.5 text-cyan-600 shrink-0" />
            <span>
              ThirdEye360 Active • {extractedCount} frame{extractedCount === 1 ? '' : 's'} extracted
            </span>
          </div>
        )}

        {/* Dismissible 3-Step Guide Banner */}
        {showGuide && (
          <div className="mt-1 bg-slate-900/95 text-white backdrop-blur-md px-4 py-3 rounded-xl shadow-xl border border-slate-700 max-w-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-bold text-cyan-300">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>How to Extract Street-View POIs</span>
                </div>
                <ol className="text-[11px] text-slate-200 space-y-1 list-decimal list-inside">
                  <li>
                    <strong>Pick a Cyan Road:</strong> Cyan lines have unextracted street views;{' '}
                    <span className="text-emerald-400 font-semibold">Green dots</span> are already extracted.
                  </li>
                  <li>
                    <strong>Click Any Point:</strong> Opens HD 360° &amp; auto-extracts shops (or zoom onto a sign and click <strong>Capture &amp; Extract View</strong>).
                  </li>
                  <li>
                    <strong>Review &amp; Save:</strong> Check cropped signboards, addresses, and phones on the right—use <strong>Edit Details</strong> anytime.
                  </li>
                </ol>
              </div>
              {onDismissGuide && (
                <button
                  onClick={onDismissGuide}
                  className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 shrink-0"
                  title="Dismiss guide"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom-Left Map Legend (hidden while 360 viewer is open) */}
      {!selectedThirdEye && (
        <div className="absolute bottom-8 left-4 z-10 bg-white/95 backdrop-blur-sm px-3.5 py-2.5 rounded-xl shadow-md border border-slate-200 text-[11px] space-y-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Map Legend
          </div>
          <div className="flex items-center gap-2 text-slate-700">
            <span className="w-3 h-3 rounded-full bg-[#00B0FF] ring-2 ring-[#0077C2]/40 shrink-0" />
            <span>Cyan Road = Not Extracted Yet (Click to open 360°)</span>
          </div>
          <div className="flex items-center gap-2 text-slate-700">
            <span className="w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-emerald-500/30 shrink-0" />
            <span>Green Dot = Already Extracted Frame</span>
          </div>
          <div className="flex items-center gap-2 text-slate-700">
            <span className="w-3 h-3 rounded-full bg-indigo-600 ring-2 ring-indigo-200 shrink-0" />
            <span>Pin = Saved Shop / Building POI</span>
          </div>
        </div>
      )}
    </div>
  );
}
