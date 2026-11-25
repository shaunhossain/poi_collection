'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Navbar from '@/components/Navbar';
import PoiSidebar, { SidebarTab } from '@/components/PoiSidebar';
import PanoramaViewer, { PanoramaCapturePayload } from '@/components/PanoramaViewer';
import CropLightboxModal from '@/components/CropLightboxModal';
import { POIItem, ThirdEyePointData } from '@/types/poi';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
const LAST_POINT_KEY = 'barikoi_last_point';
const GUIDE_DISMISSED_KEY = 'barikoi_guide_dismissed';

const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex flex-col items-center justify-center bg-slate-100 text-slate-500">
      <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
      <span className="text-xs font-medium">Loading MapLibre GL Vector Map &amp; ThirdEye Layers...</span>
    </div>
  ),
});

export default function DashboardPage() {
  const [pois, setPois] = useState<POIItem[]>([]);
  const [selectedPoi, setSelectedPoi] = useState<POIItem | null>(null);
  const [selectedThirdEye, setSelectedThirdEye] = useState<ThirdEyePointData | null>(null);
  const [lastWorkedPoint, setLastWorkedPoint] = useState<ThirdEyePointData | null>(null);
  const [showGuide, setShowGuide] = useState<boolean>(true);
  const [autoExtract, setAutoExtract] = useState<boolean>(false);
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [extractionStatus, setExtractionStatus] = useState<string | null>(null);
  const [latestExtractedPois, setLatestExtractedPois] = useState<POIItem[]>([]);
  const [newPoiIds, setNewPoiIds] = useState<Set<string>>(new Set());
  const [editingPoiId, setEditingPoiId] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('all');
  const [lightboxPoi, setLightboxPoi] = useState<POIItem | null>(null);
  const extractionAbortRef = useRef<AbortController | null>(null);

  const saveLastPoint = useCallback((point: ThirdEyePointData) => {
    setLastWorkedPoint(point);
    try {
      localStorage.setItem(LAST_POINT_KEY, JSON.stringify(point));
    } catch {
      // Ignore storage errors
    }
  }, []);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(GUIDE_DISMISSED_KEY);
      if (dismissed === 'true') setShowGuide(false);

      const savedPoint = localStorage.getItem(LAST_POINT_KEY);
      if (savedPoint) {
        setLastWorkedPoint(JSON.parse(savedPoint) as ThirdEyePointData);
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  const loadPois = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/pois`);
      if (!res.ok) return;
      const dbPois = (await res.json()) as POIItem[];
      if (Array.isArray(dbPois)) {
        setPois(dbPois);
        setSelectedPoi(dbPois[0] ?? null);

        if (dbPois.length > 0) {
          setLastWorkedPoint((prev) => {
            if (prev) return prev;
            const newest = dbPois[0];
            const trackNum = newest.trackId.replace('track', '');
            const idx = parseInt(newest.frameId.split('_')[1] || '1', 10);
            return {
              id: newest.frameId,
              imageUrlHigh:
                newest.panoramaUrl ||
                `https://streetview.bmapsbd.com/api/api/r2-proxy/${newest.trackId}/${newest.frameId}.jpg`,
              initialYaw: 0,
              initialPitch: 0,
              initialHfov: 85,
              coordinates: newest.coordinates,
              captureDate: newest.detectedAt,
              nextId: `${trackNum}_${idx + 1}`,
              previousId: idx > 1 ? `${trackNum}_${idx - 1}` : undefined,
            };
          });
        }
      }
    } catch (err) {
      console.warn('Could not fetch POIs from backend yet:', err);
    }
  }, []);

  useEffect(() => {
    loadPois();
  }, [loadPois]);

  const triggerExtraction = useCallback(
    async (point: ThirdEyePointData, capture?: PanoramaCapturePayload) => {
      extractionAbortRef.current?.abort();
      const controller = new AbortController();
      extractionAbortRef.current = controller;

      setIsExtracting(true);
      setLatestExtractedPois([]);
      setExtractionStatus(
        capture
          ? 'Projecting HD rectilinear view & running 2-stage Bengali/English OCR...'
          : `Auto-extracting street facades for frame ${point.id}...`,
      );

      try {
        const res = await fetch(`${API_BASE}/api/pois/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            frameId: point.id,
            latitude: point.coordinates[1],
            longitude: point.coordinates[0],
            imageUrlHigh: point.imageUrlHigh,
            panoramaUrl: point.imageUrlHigh,
            imageBase64: capture?.imageBase64,
            yaw: capture?.yaw,
            pitch: capture?.pitch,
            fov: capture?.fov,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          setExtractionStatus(data.message || `Extraction failed (${res.status})`);
          return;
        }

        const extracted = Array.isArray(data.pois) ? (data.pois as POIItem[]) : [];
        if (extracted.length > 0) {
          setPois((prev) => [...extracted, ...prev]);
          setSelectedPoi(extracted[0]);
          setLatestExtractedPois(extracted);
          setSidebarTab('frame');
          setNewPoiIds((prev) => {
            const next = new Set(prev);
            extracted.forEach((p) => next.add(p.id));
            return next;
          });
          setExtractionStatus(
            `Saved ${extracted.length} POI(s) & crop(s) to PostGIS (LLM unloaded from RAM).`,
          );
        } else {
          setExtractionStatus(
            'No permanent shops detected in this view. Try zooming onto a sign & clicking Capture.',
          );
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setExtractionStatus(
          `Backend unreachable at ${API_BASE}: ${(err as Error).message}`,
        );
      } finally {
        if (extractionAbortRef.current === controller) {
          setIsExtracting(false);
        }
      }
    },
    [],
  );

  const handleUpdatePoi = useCallback(
    async (
      id: string,
      updates: {
        nameBn: string;
        nameEn: string;
        category: string;
        phone?: string | null;
        address?: string | null;
      },
    ) => {
      const res = await fetch(`${API_BASE}/api/pois/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) return;
      const updated = (await res.json()) as POIItem;

      setPois((prev) => prev.map((p) => (p.id === id ? updated : p)));
      setSelectedPoi((prev) => (prev?.id === id ? updated : prev));
      setLatestExtractedPois((prev) => prev.map((p) => (p.id === id ? updated : p)));
      setLightboxPoi((prev) => (prev?.id === id ? updated : prev));
    },
    [],
  );

  const handleDeletePoi = useCallback(async (id: string) => {
    const res = await fetch(`${API_BASE}/api/pois/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) return;

    setPois((prev) => prev.filter((p) => p.id !== id));
    setLatestExtractedPois((prev) => prev.filter((p) => p.id !== id));
    setSelectedPoi((prev) => (prev?.id === id ? null : prev));
    setEditingPoiId((prev) => (prev === id ? null : prev));
    setLightboxPoi((prev) => (prev?.id === id ? null : prev));
  }, []);

  const handleClearAllData = useCallback(async () => {
    if (!window.confirm('Clear all extracted POIs and saved signboard crop images?')) {
      return;
    }
    const res = await fetch(`${API_BASE}/api/pois`, { method: 'DELETE' });
    if (!res.ok) return;

    setPois([]);
    setSelectedPoi(null);
    setLatestExtractedPois([]);
    setNewPoiIds(new Set());
    setEditingPoiId(null);
    setLightboxPoi(null);
    setExtractionStatus('All POIs and crop images cleared.');
  }, []);

  const handleSelectThirdEye = useCallback(
    (point: ThirdEyePointData | null) => {
      extractionAbortRef.current?.abort();
      setIsExtracting(false);
      setSelectedThirdEye(point);
      setExtractionStatus(null);
      setLatestExtractedPois([]);
      if (point) {
        saveLastPoint(point);
        setSidebarTab('frame');
        if (autoExtract) {
          triggerExtraction(point);
        }
      }
    },
    [autoExtract, saveLastPoint, triggerExtraction],
  );

  const handleNavigateAdjacent = (targetId: string) => {
    extractionAbortRef.current?.abort();
    setIsExtracting(false);
    const match = targetId.match(/^(\d+)[\-_](\d+)$/);
    const track = match ? match[1] : '2105';
    const idx = match ? parseInt(match[2], 10) : 204;
    const hdUrl = `https://streetview.bmapsbd.com/api/api/r2-proxy/track${track}/${targetId}.jpg`;

    setExtractionStatus(null);
    setLatestExtractedPois([]);
    setSelectedThirdEye((prev) => {
      if (!prev) return null;
      const updated: ThirdEyePointData = {
        ...prev,
        id: targetId,
        imageUrlHigh: hdUrl,
        nextId: `${track}_${idx + 1}`,
        previousId: idx > 1 ? `${track}_${idx - 1}` : undefined,
      };
      saveLastPoint(updated);
      return updated;
    });
  };

  const handleDismissGuide = () => {
    setShowGuide(false);
    try {
      localStorage.setItem(GUIDE_DISMISSED_KEY, 'true');
    } catch {
      // Ignore
    }
  };

  const handleToggleGuide = () => {
    setShowGuide((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(GUIDE_DISMISSED_KEY, next ? 'false' : 'true');
      } catch {
        // Ignore
      }
      return next;
    });
  };

  return (
    <main className="flex flex-col h-screen w-screen overflow-hidden bg-slate-100">
      <Navbar
        lastWorkedPoint={lastWorkedPoint}
        onResumeLastPoint={() => {
          if (lastWorkedPoint) {
            setExtractionStatus(null);
            setLatestExtractedPois([]);
            setSelectedThirdEye(lastWorkedPoint);
            setSidebarTab('frame');
          }
        }}
        showGuide={showGuide}
        onToggleGuide={handleToggleGuide}
        poiCount={pois.length}
        onClearAllData={handleClearAllData}
      />

      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Workspace: True Flex Split (Map top + HD 360° Viewer bottom) */}
        <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
          <section className={selectedThirdEye ? 'h-[42%] w-full relative' : 'flex-1 w-full relative'}>
            <MapView
              pois={pois}
              selectedPoi={selectedPoi}
              onSelectPoi={setSelectedPoi}
              selectedThirdEye={selectedThirdEye}
              onSelectThirdEye={handleSelectThirdEye}
              showGuide={showGuide}
              onDismissGuide={handleDismissGuide}
            />
          </section>

          {selectedThirdEye && (
            <section className="h-[58%] w-full relative">
              <PanoramaViewer
                point={selectedThirdEye}
                onClose={() => {
                  setSelectedThirdEye(null);
                  setExtractionStatus(null);
                  setLatestExtractedPois([]);
                }}
                onNavigateAdjacent={handleNavigateAdjacent}
                onExtractViewport={triggerExtraction}
                isExtracting={isExtracting}
                extractionStatus={extractionStatus}
                autoExtract={autoExtract}
                onToggleAutoExtract={() => setAutoExtract((prev) => !prev)}
                latestExtractedPois={latestExtractedPois}
                onEditPoi={(poi) => {
                  setSelectedPoi(poi);
                  setEditingPoiId(poi.id);
                  setSidebarTab('frame');
                }}
                onPreviewCrop={(poi) => setLightboxPoi(poi)}
                onDismissResults={() => setLatestExtractedPois([])}
              />
            </section>
          )}
        </div>

        {/* Right Panel: Fast Multi-Card POI Feed */}
        <PoiSidebar
          pois={pois}
          selectedPoi={selectedPoi}
          onSelectPoi={setSelectedPoi}
          onOpenPanorama={(pt) => {
            setExtractionStatus(null);
            setLatestExtractedPois([]);
            saveLastPoint(pt);
            setSelectedThirdEye(pt);
            setSidebarTab('frame');
          }}
          onPreviewCrop={(poi) => setLightboxPoi(poi)}
          activeFrameId={selectedThirdEye?.id ?? null}
          activeTab={sidebarTab}
          onTabChange={setSidebarTab}
          newPoiIds={newPoiIds}
          editingPoiId={editingPoiId}
          onSetEditingPoiId={setEditingPoiId}
          onUpdatePoi={handleUpdatePoi}
          onDeletePoi={handleDeletePoi}
        />
      </div>

      {/* Full-Size Cropped Signboard Lightbox Modal */}
      <CropLightboxModal poi={lightboxPoi} onClose={() => setLightboxPoi(null)} />
    </main>
  );
}
