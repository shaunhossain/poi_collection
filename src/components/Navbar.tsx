'use client';

import React from 'react';
import { Map, Navigation, ShieldCheck, PlayCircle, HelpCircle, Trash2 } from 'lucide-react';
import { ThirdEyePointData } from '@/types/poi';

interface NavbarProps {
  lastWorkedPoint?: ThirdEyePointData | null;
  onResumeLastPoint?: () => void;
  showGuide?: boolean;
  onToggleGuide?: () => void;
  poiCount?: number;
  onClearAllData?: () => void;
}

export default function Navbar({
  lastWorkedPoint,
  onResumeLastPoint,
  showGuide = false,
  onToggleGuide,
  poiCount = 0,
  onClearAllData,
}: NavbarProps) {
  return (
    <header className="h-14 bg-slate-900 border-b border-slate-800 text-white flex items-center justify-between px-5 shrink-0 z-30">
      <div className="flex items-center space-x-3">
        <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-md">
          <Map className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-sm font-bold tracking-tight">POI Collection</h1>
          <p className="text-[11px] text-slate-400">MapLibre GL + ThirdEye360 + Local Ollama LLM</p>
        </div>
      </div>

      <div className="flex items-center space-x-2.5 text-xs">
        {lastWorkedPoint && onResumeLastPoint && (
          <button
            onClick={onResumeLastPoint}
            className="flex items-center space-x-1.5 bg-cyan-600 hover:bg-cyan-500 text-white px-3 py-1.5 rounded-lg font-semibold shadow-sm transition-colors"
            title="Jump back to the last street-view point you worked on"
          >
            <PlayCircle className="w-4 h-4" />
            <span>Resume: Frame {lastWorkedPoint.id}</span>
          </button>
        )}

        {onToggleGuide && (
          <button
            onClick={onToggleGuide}
            className={`flex items-center space-x-1 px-2.5 py-1.5 rounded-lg border font-medium transition-colors ${
              showGuide
                ? 'bg-indigo-600 border-indigo-400 text-white'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Guide</span>
          </button>
        )}

        {onClearAllData && poiCount > 0 && (
          <button
            onClick={onClearAllData}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg border border-rose-700/70 bg-rose-950/60 hover:bg-rose-700 text-rose-200 hover:text-white font-medium transition-colors"
            title="Delete all extracted POIs and crop images"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear All</span>
          </button>
        )}

        <div className="hidden lg:flex items-center space-x-1.5 bg-slate-800/80 px-2.5 py-1.5 rounded-md border border-slate-700 text-slate-300">
          <Navigation className="w-3.5 h-3.5 text-indigo-400" />
          <span className="font-medium">
            {lastWorkedPoint
              ? `Last: ${lastWorkedPoint.id}`
              : 'Click Cyan Road'}
          </span>
        </div>

        <div className="hidden sm:flex items-center space-x-1 bg-emerald-950/60 border border-emerald-800 text-emerald-400 px-2.5 py-1.5 rounded-md">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span className="font-medium text-[11px]">PostGIS + Ollama</span>
        </div>
      </div>
    </header>
  );
}
