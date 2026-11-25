'use client';

import React, { useEffect, useRef, useState } from 'react';
import { POIItem } from '@/types/poi';
import {
  X,
  Phone,
  Building2,
  ExternalLink,
  CheckCircle2,
  Compass,
  Clock,
  User,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react';

interface CropLightboxModalProps {
  poi: POIItem | null;
  onClose: () => void;
}

export default function CropLightboxModal({ poi, onClose }: CropLightboxModalProps) {
  const [zoom, setZoom] = useState<number>(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStart = useRef<{ x: number; y: number; ox: number; oy: number }>({
    x: 0,
    y: 0,
    ox: 0,
    oy: 0,
  });

  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [poi]);

  useEffect(() => {
    if (!poi) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [poi, onClose]);

  const updateZoom = (next: number) => {
    const clamped = Math.max(1, Math.min(5, Number(next.toFixed(2))));
    setZoom(clamped);
    if (clamped === 1) {
      setOffset({ x: 0, y: 0 });
    }
  };

  const resetZoom = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  if (!poi) return null;

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
  const resolvedCropUrl = poi.cropUrl
    ? poi.cropUrl.startsWith('http')
      ? poi.cropUrl
      : `${apiBase}${poi.cropUrl}`
    : null;

  const phones = poi.metadata?.phones?.length
    ? poi.metadata.phones
    : poi.phone
      ? [poi.phone]
      : [];

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col md:flex-row"
      >
        {/* Left: Full-Size Cropped Signboard Image with Zoom & Pan */}
        <div
          onWheel={(e) => {
            e.preventDefault();
            updateZoom(zoom + (e.deltaY < 0 ? 0.35 : -0.35));
          }}
          onPointerDown={(e) => {
            if (zoom <= 1) return;
            setIsDragging(true);
            dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
          }}
          onPointerMove={(e) => {
            if (!isDragging) return;
            setOffset({
              x: dragStart.current.ox + (e.clientX - dragStart.current.x),
              y: dragStart.current.oy + (e.clientY - dragStart.current.y),
            });
          }}
          onPointerUp={() => setIsDragging(false)}
          onPointerLeave={() => setIsDragging(false)}
          className={`md:w-3/5 bg-slate-950 flex items-center justify-center p-4 min-h-[300px] max-h-[65vh] md:max-h-[90vh] relative overflow-hidden select-none ${
            zoom > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'
          }`}
          onDoubleClick={() => (zoom > 1 ? resetZoom() : updateZoom(2.5))}
        >
          {resolvedCropUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={resolvedCropUrl}
              alt={`${poi.nameEn} signboard crop`}
              draggable={false}
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                transition: isDragging ? 'none' : 'transform 120ms ease-out',
              }}
              className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
            />
          ) : (
            <div className="text-slate-400 text-xs">No cropped image available</div>
          )}

          {/* Top-Right Zoom Controls */}
          <div className="absolute top-3 right-3 flex items-center gap-1 bg-black/80 backdrop-blur-sm border border-slate-700 rounded-lg p-1 text-white shadow-lg">
            <button
              onClick={() => updateZoom(zoom - 0.5)}
              disabled={zoom <= 1}
              className="p-1.5 rounded hover:bg-slate-800 disabled:opacity-40"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-[11px] font-mono px-1.5 min-w-[42px] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => updateZoom(zoom + 0.5)}
              disabled={zoom >= 5}
              className="p-1.5 rounded hover:bg-slate-800 disabled:opacity-40"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            {zoom > 1 && (
              <button
                onClick={resetZoom}
                className="p-1.5 rounded hover:bg-slate-800 text-cyan-300"
                title="Reset Zoom (1x)"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="absolute bottom-3 left-3 bg-black/75 text-white text-[11px] font-mono px-2.5 py-1 rounded-md border border-slate-700">
            Track: {poi.trackId} • Frame: {poi.frameId}
          </div>
        </div>

        {/* Right: Complete Extracted POI Info */}
        <div className="md:w-2/5 p-5 flex flex-col overflow-y-auto space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold uppercase">
                  {poi.category}
                </span>
                <span className="text-[11px] font-semibold text-emerald-600 flex items-center">
                  <CheckCircle2 className="w-3.5 h-3.5 mr-0.5" />
                  {Math.round(poi.confidence * 100)}%
                </span>
              </div>
              <h3 className="text-xl font-bold text-slate-900 mt-1.5">{poi.nameBn}</h3>
              <p className="text-sm text-slate-600 font-medium">{poi.nameEn}</p>
              {poi.metadata?.tagline && (
                <p className="text-xs italic text-slate-500 mt-0.5">{poi.metadata.tagline}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-2.5 text-xs border-t border-slate-100 pt-3">
            {phones.length > 0 && (
              <div className="flex items-start gap-2 text-slate-700">
                <Phone className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                <div className="flex flex-wrap gap-1.5">
                  {phones.map((num) => (
                    <a
                      key={num}
                      href={`tel:${num}`}
                      className="font-mono px-2 py-0.5 rounded bg-slate-100 hover:bg-indigo-50 border border-slate-200 text-slate-800"
                    >
                      {num}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {poi.address && (
              <div className="flex items-start gap-2 text-slate-700">
                <Building2 className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                <span>{poi.address}</span>
              </div>
            )}

            {poi.metadata?.proprietor && (
              <div className="flex items-start gap-2 text-slate-700">
                <User className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                <span>{poi.metadata.proprietor}</span>
              </div>
            )}

            {poi.metadata?.openingHours && (
              <div className="flex items-start gap-2 text-slate-700">
                <Clock className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                <span>{poi.metadata.openingHours}</span>
              </div>
            )}

            <div className="flex items-center gap-2 text-slate-500 text-[11px]">
              <Compass className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>
                {poi.coordinates[1].toFixed(5)}, {poi.coordinates[0].toFixed(5)}
              </span>
            </div>
          </div>

          {poi.metadata?.services && poi.metadata.services.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {poi.metadata.services.map((svc) => (
                <span
                  key={svc}
                  className="px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-medium"
                >
                  {svc}
                </span>
              ))}
            </div>
          )}

          {poi.metadata?.rawText && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Verbatim OCR Text
              </div>
              <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                {poi.metadata.rawText}
              </p>
            </div>
          )}

          <div className="mt-auto pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
            {poi.panoramaUrl && (
              <a
                href={poi.panoramaUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open Full 8K Panorama</span>
              </a>
            )}
            <button
              onClick={onClose}
              className="ml-auto px-4 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
