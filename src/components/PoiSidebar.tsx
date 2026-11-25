'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { POICategory, POIItem, ThirdEyePointData } from '@/types/poi';
import {
  MapPin,
  Phone,
  Building2,
  Search,
  Eye,
  Pencil,
  Trash2,
  Save,
  ZoomIn,
  Crosshair,
  ChevronDown,
} from 'lucide-react';

const POI_CATEGORIES: POICategory[] = [
  'Tailor & Fashion',
  'Coaching & Education',
  'Beauty & Parlor',
  'Pharmacy & Healthcare',
  'Grocery & Superstore',
  'Restaurant & Cafe',
  'Commercial Building',
];

export type SidebarTab = 'frame' | 'all' | 'tracks';

interface PoiSidebarProps {
  pois: POIItem[];
  selectedPoi: POIItem | null;
  onSelectPoi: (poi: POIItem | null) => void;
  onOpenPanorama?: (point: ThirdEyePointData) => void;
  onPreviewCrop?: (poi: POIItem) => void;
  activeFrameId?: string | null;
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  newPoiIds?: Set<string>;
  editingPoiId?: string | null;
  onSetEditingPoiId?: (id: string | null) => void;
  onUpdatePoi?: (
    id: string,
    updates: {
      nameBn: string;
      nameEn: string;
      category: string;
      phone?: string | null;
      address?: string | null;
    },
  ) => Promise<void> | void;
  onDeletePoi?: (id: string) => Promise<void> | void;
}

const isPersistedUuid = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export default function PoiSidebar({
  pois,
  selectedPoi,
  onSelectPoi,
  onOpenPanorama,
  onPreviewCrop,
  activeFrameId,
  activeTab,
  onTabChange,
  newPoiIds,
  editingPoiId,
  onSetEditingPoiId,
  onUpdatePoi,
  onDeletePoi,
}: PoiSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editBn, setEditBn] = useState('');
  const [editEn, setEditEn] = useState('');
  const [editCategory, setEditCategory] = useState<string>('Commercial Building');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

  useEffect(() => {
    const target = pois.find((p) => p.id === editingPoiId);
    if (target) {
      setEditBn(target.nameBn);
      setEditEn(target.nameEn);
      setEditCategory(target.category);
      setEditPhone(target.phone || '');
      setEditAddress(target.address || '');
    }
  }, [editingPoiId, pois]);

  const framePois = useMemo(() => {
    if (!activeFrameId) return [];
    return pois.filter((p) => p.frameId === activeFrameId);
  }, [pois, activeFrameId]);

  const filteredAllPois = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return pois;
    return pois.filter(
      (poi) =>
        poi.nameBn.toLowerCase().includes(q) ||
        poi.nameEn.toLowerCase().includes(q) ||
        (poi.phone && poi.phone.toLowerCase().includes(q)) ||
        (poi.address && poi.address.toLowerCase().includes(q)) ||
        poi.trackId.toLowerCase().includes(q) ||
        poi.frameId.toLowerCase().includes(q),
    );
  }, [pois, searchQuery]);

  const trackSummaries = useMemo(() => {
    const map = new globalThis.Map<
      string,
      {
        trackId: string;
        poiCount: number;
        frames: Set<string>;
        latestPoi: POIItem;
      }
    >();
    pois.forEach((poi) => {
      const key = poi.trackId || 'unknown';
      const existing = map.get(key);
      if (existing) {
        existing.poiCount += 1;
        existing.frames.add(poi.frameId);
      } else {
        map.set(key, {
          trackId: key,
          poiCount: 1,
          frames: new Set([poi.frameId]),
          latestPoi: poi,
        });
      }
    });
    return Array.from(map.values());
  }, [pois]);

  const handleLaunchPanorama = (poi: POIItem) => {
    if (!onOpenPanorama) return;
    const trackNum = poi.trackId.replace('track', '');
    const idx = parseInt(poi.frameId.split('_')[1] || '1', 10);
    onOpenPanorama({
      id: poi.frameId,
      imageUrlHigh:
        poi.panoramaUrl ||
        `https://streetview.bmapsbd.com/api/api/r2-proxy/${poi.trackId}/${poi.frameId}.jpg`,
      initialYaw: 0,
      initialPitch: 0,
      initialHfov: 85,
      coordinates: poi.coordinates,
      captureDate: poi.detectedAt,
      nextId: `${trackNum}_${idx + 1}`,
      previousId: idx > 1 ? `${trackNum}_${idx - 1}` : undefined,
    });
  };

  const handleSaveEdit = async (poi: POIItem) => {
    if (!onUpdatePoi) return;
    setIsSaving(true);
    try {
      await onUpdatePoi(poi.id, {
        nameBn: editBn.trim() || poi.nameBn,
        nameEn: editEn.trim() || editBn.trim() || poi.nameEn,
        category: editCategory,
        phone: editPhone.trim() || null,
        address: editAddress.trim() || null,
      });
      onSetEditingPoiId?.(null);
    } finally {
      setIsSaving(false);
    }
  };

  const displayedPois = activeTab === 'frame' ? framePois : filteredAllPois;

  const coordGroups = useMemo(() => {
    const groups = new globalThis.Map<
      string,
      { coordKey: string; coords: [number, number]; pois: POIItem[] }
    >();
    displayedPois.forEach((poi) => {
      const coordKey = `${poi.coordinates[1].toFixed(5)}, ${poi.coordinates[0].toFixed(5)}`;
      const existing = groups.get(coordKey);
      if (existing) {
        existing.pois.push(poi);
      } else {
        groups.set(coordKey, { coordKey, coords: poi.coordinates, pois: [poi] });
      }
    });
    return Array.from(groups.values());
  }, [displayedPois]);

  const renderPoiCard = (poi: POIItem) => {
    const isSelected = selectedPoi?.id === poi.id;
    const isNew = newPoiIds?.has(poi.id);
    const isEditing = editingPoiId === poi.id;
    const persisted = isPersistedUuid(poi.id);
    const cropSrc = poi.cropUrl
      ? poi.cropUrl.startsWith('http')
        ? poi.cropUrl
        : `${apiBase}${poi.cropUrl}`
      : null;
    const phones = poi.metadata?.phones?.length
      ? poi.metadata.phones
      : poi.phone
        ? [poi.phone]
        : [];
    const coordLabel = `${poi.coordinates[1].toFixed(5)}, ${poi.coordinates[0].toFixed(5)}`;

    return (
      <div
        key={poi.id}
        onClick={() => onSelectPoi(poi)}
        className={`rounded-xl bg-white border p-3 shadow-sm transition-all cursor-pointer space-y-2 ${
          isSelected
            ? 'border-indigo-500 ring-2 ring-indigo-500/20'
            : isNew
              ? 'border-emerald-300 bg-emerald-50/20'
              : 'border-slate-200 hover:border-slate-300'
        }`}
      >
        {/* Top Row: Clickable Thumbnail + Title + Badges */}
        <div className="flex items-start gap-3">
          {cropSrc ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPreviewCrop?.(poi);
              }}
              className="relative group w-20 h-16 rounded-lg overflow-hidden border border-slate-200 bg-slate-900 shrink-0 cursor-zoom-in"
              title="Click to view full cropped image"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cropSrc}
                alt={`${poi.nameEn} crop`}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <ZoomIn className="w-4 h-4 text-white" />
              </div>
            </button>
          ) : (
            <div className="w-12 h-12 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 shrink-0">
              <MapPin className="w-5 h-5" />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1 flex-wrap">
                {isNew && (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[9px] font-bold uppercase">
                    NEW
                  </span>
                )}
                <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600 truncate">
                  {poi.category}
                </span>
              </div>
              <span className="text-[11px] font-mono text-emerald-600 font-semibold shrink-0">
                {Math.round(poi.confidence * 100)}%
              </span>
            </div>

            <h4 className="text-sm font-bold text-slate-900 leading-snug mt-0.5">
              {poi.nameBn}
            </h4>
            <p className="text-xs text-slate-500 truncate">{poi.nameEn}</p>
          </div>
        </div>

        {/* Inline Edit Form (right inside card) */}
        {isEditing ? (
          <div
            onClick={(e) => e.stopPropagation()}
            className="space-y-2 bg-slate-50 p-2.5 rounded-lg border border-indigo-200"
          >
            <input
              type="text"
              value={editBn}
              onChange={(e) => setEditBn(e.target.value)}
              placeholder="Bengali Name"
              className="w-full px-2.5 py-1 text-xs border border-slate-200 rounded bg-white"
            />
            <input
              type="text"
              value={editEn}
              onChange={(e) => setEditEn(e.target.value)}
              placeholder="English Name"
              className="w-full px-2.5 py-1 text-xs border border-slate-200 rounded bg-white"
            />
            <select
              value={editCategory}
              onChange={(e) => setEditCategory(e.target.value)}
              className="w-full px-2.5 py-1 text-xs border border-slate-200 rounded bg-white"
            >
              {POI_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                type="text"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                placeholder="Phone"
                className="w-full px-2 py-1 text-xs border border-slate-200 rounded bg-white"
              />
              <input
                type="text"
                value={editAddress}
                onChange={(e) => setEditAddress(e.target.value)}
                placeholder="Address"
                className="w-full px-2 py-1 text-xs border border-slate-200 rounded bg-white"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleSaveEdit(poi)}
                disabled={isSaving}
                className="flex-1 flex items-center justify-center gap-1 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
              >
                <Save className="w-3 h-3" />
                <span>{isSaving ? 'Saving...' : 'Save'}</span>
              </button>
              <button
                onClick={() => onSetEditingPoiId?.(null)}
                className="px-3 py-1 rounded bg-white border border-slate-200 text-slate-600 text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            {(phones.length > 0 || poi.address || poi.metadata?.proprietor) && (
              <div className="space-y-1 text-[11px] text-slate-600 pt-1 border-t border-slate-100">
                {phones.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                    {phones.map((num) => (
                      <a
                        key={num}
                        href={`tel:${num}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-mono px-1.5 py-0.5 rounded bg-slate-100 hover:bg-indigo-50 border border-slate-200 text-slate-800"
                      >
                        {num}
                      </a>
                    ))}
                  </div>
                )}
                {poi.address && (
                  <div className="flex items-start gap-1.5">
                    <Building2 className="w-3 h-3 text-slate-400 mt-0.5 shrink-0" />
                    <span className="leading-snug">{poi.address}</span>
                  </div>
                )}
                {poi.metadata?.proprietor && (
                  <div className="text-slate-500">
                    <span className="font-semibold text-slate-700">Proprietor:</span>{' '}
                    {poi.metadata.proprietor}
                  </div>
                )}
              </div>
            )}

            {poi.metadata?.services && poi.metadata.services.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {poi.metadata.services.map((svc) => (
                  <span
                    key={svc}
                    className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 text-[10px] font-medium"
                  >
                    {svc}
                  </span>
                ))}
              </div>
            )}

            {poi.metadata?.rawText && (
              <details
                onClick={(e) => e.stopPropagation()}
                className="text-[11px] text-slate-600 bg-slate-50 rounded border border-slate-200 px-2 py-1"
              >
                <summary className="cursor-pointer font-medium text-slate-700 flex items-center gap-1 select-none">
                  <ChevronDown className="w-3 h-3" />
                  <span>Raw OCR Text</span>
                </summary>
                <p className="mt-1 whitespace-pre-wrap text-[10px] leading-relaxed">
                  {poi.metadata.rawText}
                </p>
              </details>
            )}
          </>
        )}

        {/* Quick Card Actions + Explicit Lat/Lon */}
        {!isEditing && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex items-center justify-between gap-1.5 pt-1.5 border-t border-slate-100 text-[11px]"
          >
            <div className="min-w-0 flex flex-col">
              <span className="text-slate-600 font-mono text-[10px] flex items-center gap-1 truncate">
                <MapPin className="w-2.5 h-2.5 text-indigo-500 shrink-0" />
                {coordLabel}
              </span>
              <span className="text-slate-400 font-mono text-[10px] truncate">
                {poi.trackId}/{poi.frameId}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => onSelectPoi(poi)}
                className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium flex items-center gap-1"
                title="Focus on Map"
              >
                <Crosshair className="w-3 h-3" />
                <span>Map</span>
              </button>
              {poi.panoramaUrl && (
                <button
                  onClick={() => handleLaunchPanorama(poi)}
                  className="px-2 py-1 rounded bg-cyan-50 hover:bg-cyan-100 text-cyan-700 border border-cyan-200 font-medium flex items-center gap-1"
                  title="Open 360° View"
                >
                  <Eye className="w-3 h-3" />
                  <span>360°</span>
                </button>
              )}
              {persisted && onSetEditingPoiId && (
                <button
                  onClick={() => onSetEditingPoiId(poi.id)}
                  className="p-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700"
                  title="Edit POI"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              )}
              {persisted && onDeletePoi && (
                <button
                  onClick={() => onDeletePoi(poi.id)}
                  className="p-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-600"
                  title="Delete POI"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="w-[400px] h-full bg-slate-50 border-l border-slate-200 flex flex-col shadow-xl z-20 shrink-0">
      {/* Compact Header */}
      <div className="px-4 py-3 bg-white border-b border-slate-200 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Extracted POIs &amp; Coverage</h2>
          <p className="text-[11px] text-slate-500">
            {pois.length} total POIs • {trackSummaries.length} track
            {trackSummaries.length === 1 ? '' : 's'}
          </p>
        </div>
        {activeFrameId && (
          <span className="px-2 py-0.5 rounded-md bg-cyan-50 border border-cyan-200 text-cyan-800 text-[11px] font-mono font-semibold">
            Frame {activeFrameId}
          </span>
        )}
      </div>

      {/* 3-Tab Switcher: This Frame | All POIs | Tracks */}
      <div className="grid grid-cols-3 border-b border-slate-200 bg-white text-[11px] font-semibold">
        <button
          onClick={() => onTabChange('frame')}
          className={`py-2.5 text-center border-b-2 transition-colors ${
            activeTab === 'frame'
              ? 'border-cyan-600 text-cyan-700 bg-cyan-50/40'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          This Frame ({framePois.length})
        </button>
        <button
          onClick={() => onTabChange('all')}
          className={`py-2.5 text-center border-b-2 transition-colors ${
            activeTab === 'all'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/40'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          All POIs ({pois.length})
        </button>
        <button
          onClick={() => onTabChange('tracks')}
          className={`py-2.5 text-center border-b-2 transition-colors ${
            activeTab === 'tracks'
              ? 'border-emerald-600 text-emerald-700 bg-emerald-50/40'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Tracks ({trackSummaries.length})
        </button>
      </div>

      {/* Search Bar (shown on All POIs tab) */}
      {activeTab === 'all' && (
        <div className="p-2.5 bg-white border-b border-slate-200">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search name, phone, address, frame..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white"
            />
          </div>
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'tracks' ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {trackSummaries.map((track) => (
            <div
              key={track.trackId}
              className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-sm space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="font-bold text-sm text-slate-900">{track.trackId}</div>
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">
                  {track.poiCount} POI{track.poiCount === 1 ? '' : 's'}
                </span>
              </div>
              <div className="text-xs text-slate-500 space-y-0.5">
                <div>
                  Extracted frames:{' '}
                  <span className="font-semibold text-slate-700">{track.frames.size}</span>
                </div>
                <div>
                  Latest frame:{' '}
                  <span className="font-mono text-slate-700">{track.latestPoi.frameId}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => {
                    onSelectPoi(track.latestPoi);
                    handleLaunchPanorama(track.latestPoi);
                  }}
                  className="flex-1 py-1.5 px-3 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold"
                >
                  Resume Here &rarr;
                </button>
                <button
                  onClick={() => {
                    onSelectPoi(track.latestPoi);
                    onTabChange('all');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium"
                >
                  View POIs
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {displayedPois.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs bg-white rounded-xl border border-dashed border-slate-200">
              {activeTab === 'frame'
                ? 'Click any Cyan road point on the map (or Capture & Extract in 360°) to inspect POIs for that frame.'
                : 'No POIs match your search.'}
            </div>
          ) : (
            coordGroups.map((group) =>
              group.pois.length > 1 ? (
                <div
                  key={group.coordKey}
                  className="rounded-xl border border-indigo-200/80 bg-indigo-50/40 p-2 space-y-2"
                >
                  <div className="flex items-center justify-between px-1.5 pt-0.5">
                    <span className="text-[11px] font-mono font-semibold text-indigo-800 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      {group.coordKey}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-indigo-600 text-white text-[10px] font-bold">
                      {group.pois.length} POIs at location
                    </span>
                  </div>
                  <div className="space-y-2">{group.pois.map(renderPoiCard)}</div>
                </div>
              ) : (
                renderPoiCard(group.pois[0])
              ),
            )
          )}
        </div>
      )}
    </aside>
  );
}
