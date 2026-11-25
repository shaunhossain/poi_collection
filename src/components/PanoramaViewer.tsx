'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { POIItem, ThirdEyePointData } from '@/types/poi';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Compass,
  Calendar,
  Sparkles,
  RotateCw,
  Loader2,
  Camera,
  Zap,
  CheckCircle2,
  Pencil,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export interface PanoramaCapturePayload {
  imageBase64?: string;
  yaw: number;
  pitch: number;
  fov: number;
}

interface PanoramaViewerProps {
  point: ThirdEyePointData;
  onClose: () => void;
  onNavigateAdjacent?: (targetId: string) => void;
  onExtractViewport?: (point: ThirdEyePointData, capture?: PanoramaCapturePayload) => void;
  isExtracting?: boolean;
  extractionStatus?: string | null;
  autoExtract?: boolean;
  onToggleAutoExtract?: () => void;
  latestExtractedPois?: POIItem[];
  onEditPoi?: (poi: POIItem) => void;
  onPreviewCrop?: (poi: POIItem) => void;
  onDismissResults?: () => void;
}

export default function PanoramaViewer({
  point,
  onClose,
  onNavigateAdjacent,
  onExtractViewport,
  isExtracting = false,
  extractionStatus = null,
  autoExtract = false,
  onToggleAutoExtract,
  latestExtractedPois = [],
  onEditPoi,
  onPreviewCrop,
  onDismissResults,
}: PanoramaViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sphereRef = useRef<THREE.Mesh | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [fov, setFov] = useState<number>(point.initialHfov || 85);
  const fovRef = useRef<number>(point.initialHfov || 85);

  const isUserInteracting = useRef<boolean>(false);
  const onPointerDownPointerX = useRef<number>(0);
  const onPointerDownPointerY = useRef<number>(0);
  const onPointerDownLon = useRef<number>(0);
  const onPointerDownLat = useRef<number>(0);
  const lon = useRef<number>(point.initialYaw || 0);
  const lat = useRef<number>(point.initialPitch || 0);
  const phi = useRef<number>(0);
  const theta = useRef<number>(0);

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

  const resolveNextId = (): string | null => {
    if (point.nextId) return point.nextId;
    const match = point.id.match(/^(\d+)[\-_](\d+)$/);
    if (match) {
      const track = match[1];
      const idx = parseInt(match[2], 10);
      return `${track}_${idx + 1}`;
    }
    return null;
  };

  const resolvePrevId = (): string | null => {
    if (point.previousId) return point.previousId;
    const match = point.id.match(/^(\d+)[\-_](\d+)$/);
    if (match) {
      const track = match[1];
      const idx = parseInt(match[2], 10);
      if (idx > 1) return `${track}_${idx - 1}`;
    }
    return null;
  };

  const nextId = resolveNextId();
  const prevId = resolvePrevId();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const initialFov = point.initialHfov || 85;
    fovRef.current = initialFov;
    setFov(initialFov);
    lon.current = point.initialYaw || 0;
    lat.current = point.initialPitch || 0;

    setIsLoading(true);
    setLoadError(null);

    const width = container.clientWidth || 640;
    const height = container.clientHeight || 360;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(initialFov, width / height, 1, 1100);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    rendererRef.current = renderer;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const geometry = new THREE.SphereGeometry(500, 60, 40);
    geometry.scale(-1, 1, 1);

    const textureLoader = new THREE.TextureLoader();
    textureLoader.setCrossOrigin('anonymous');

    const targetUrl = point.imageUrlHigh || point.imageUrlComp || '';

    textureLoader.load(
      targetUrl,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        textureRef.current = texture;

        const material = new THREE.MeshBasicMaterial({ map: texture });
        const sphere = new THREE.Mesh(geometry, material);
        sphereRef.current = sphere;
        scene.add(sphere);

        setIsLoading(false);
      },
      undefined,
      (err) => {
        console.error('HD Panorama Texture load failed:', err);
        if (point.imageUrlComp && targetUrl !== point.imageUrlComp) {
          textureLoader.load(point.imageUrlComp, (fallbackTex) => {
            fallbackTex.colorSpace = THREE.SRGBColorSpace;
            textureRef.current = fallbackTex;
            const material = new THREE.MeshBasicMaterial({ map: fallbackTex });
            const sphere = new THREE.Mesh(geometry, material);
            sphereRef.current = sphere;
            scene.add(sphere);
            setIsLoading(false);
          });
        } else {
          setLoadError('Failed to load high-definition 360° panorama image.');
          setIsLoading(false);
        }
      },
    );

    let animationFrameId: number;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      lat.current = Math.max(-85, Math.min(85, lat.current));
      phi.current = THREE.MathUtils.degToRad(90 - lat.current);
      theta.current = THREE.MathUtils.degToRad(lon.current);

      camera.position.x = 100 * Math.sin(phi.current) * Math.cos(theta.current);
      camera.position.y = 100 * Math.cos(phi.current);
      camera.position.z = 100 * Math.sin(phi.current) * Math.sin(theta.current);

      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      if (newWidth <= 0 || newHeight <= 0) return;
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);

      if (textureRef.current) textureRef.current.dispose();
      geometry.dispose();
      renderer.dispose();
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [point]);

  const handlePointerDown = (e: React.PointerEvent) => {
    isUserInteracting.current = true;
    onPointerDownPointerX.current = e.clientX;
    onPointerDownPointerY.current = e.clientY;
    onPointerDownLon.current = lon.current;
    onPointerDownLat.current = lat.current;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isUserInteracting.current) return;
    lon.current = (onPointerDownPointerX.current - e.clientX) * 0.15 + onPointerDownLon.current;
    lat.current = (e.clientY - onPointerDownPointerY.current) * 0.15 + onPointerDownLat.current;
  };

  const handlePointerUp = () => {
    isUserInteracting.current = false;
  };

  const applyFov = (nextFov: number) => {
    const clamped = Math.max(25, Math.min(100, nextFov));
    fovRef.current = clamped;
    setFov(clamped);
    if (cameraRef.current) {
      cameraRef.current.fov = clamped;
      cameraRef.current.updateProjectionMatrix();
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    applyFov(fovRef.current + e.deltaY * 0.05);
  };

  const resetOrientation = () => {
    lon.current = point.initialYaw || 0;
    lat.current = point.initialPitch || 0;
    applyFov(85);
  };

  const handleCaptureClick = () => {
    if (!rendererRef.current || !onExtractViewport || isLoading || isExtracting) return;
    const dataUrl = rendererRef.current.domElement.toDataURL('image/jpeg', 0.92);
    onExtractViewport(point, {
      imageBase64: dataUrl,
      yaw: lon.current,
      pitch: lat.current,
      fov: fovRef.current,
    });
  };

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-50 flex flex-col bg-black text-white'
          : 'relative w-full h-full flex flex-col bg-black text-white overflow-hidden border-t-2 border-cyan-500/70'
      }
    >
      {/* Top Header Bar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3.5 py-2.5 bg-gradient-to-b from-black/85 via-black/45 to-transparent pointer-events-auto">
        <div className="flex items-center space-x-2.5">
          <div className="flex items-center space-x-1.5 bg-cyan-500/90 text-slate-950 px-2.5 py-0.5 rounded-full text-xs font-bold shadow-sm">
            <Sparkles className="w-3.5 h-3.5" />
            <span>HD 360°</span>
          </div>

          <div className="flex items-center space-x-2 text-xs text-slate-300 font-mono">
            <span className="font-semibold text-white">Frame: {point.id}</span>
            {point.captureDate && (
              <span className="hidden sm:flex items-center text-slate-400">
                <Calendar className="w-3 h-3 mr-1" />
                {point.captureDate}
              </span>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-1.5">
          {onToggleAutoExtract && (
            <button
              onClick={onToggleAutoExtract}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors border ${
                autoExtract
                  ? 'bg-emerald-600/90 border-emerald-400 text-white'
                  : 'bg-black/60 border-slate-600 text-slate-300 hover:text-white'
              }`}
              title="Automatically extract POIs when clicking ThirdEye points"
            >
              <Zap className="w-3 h-3" />
              <span>Auto-Extract: {autoExtract ? 'ON' : 'OFF'}</span>
            </button>
          )}
          <button
            onClick={() => applyFov(fovRef.current - 12)}
            className="p-1.5 rounded-lg bg-black/60 text-slate-300 hover:text-white hover:bg-black/80 transition-colors"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => applyFov(fovRef.current + 12)}
            className="p-1.5 rounded-lg bg-black/60 text-slate-300 hover:text-white hover:bg-black/80 transition-colors"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={resetOrientation}
            className="p-1.5 rounded-lg bg-black/60 text-slate-300 hover:text-white hover:bg-black/80 transition-colors"
            title="Reset View"
          >
            <RotateCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsFullscreen((prev) => !prev)}
            className="p-1.5 rounded-lg bg-black/60 text-slate-300 hover:text-white hover:bg-black/80 transition-colors"
            title={isFullscreen ? 'Exit Fullscreen' : 'Maximize 360°'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-rose-600/85 text-white hover:bg-rose-600 transition-colors"
            title="Close 360° Viewer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Extraction Status Pill */}
      {extractionStatus && (
        <div className="absolute top-12 left-4 right-4 z-20 flex items-center justify-center pointer-events-none">
          <div className="flex items-center space-x-2 bg-slate-900/95 border border-slate-700 text-xs text-cyan-200 px-3.5 py-1.5 rounded-full shadow-lg">
            {isExtracting && <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />}
            <span>{extractionStatus}</span>
          </div>
        </div>
      )}

      {/* WebGL Panorama Canvas */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        className="relative w-full h-full cursor-grab active:cursor-grabbing select-none"
      />

      {/* Subtle Capture Center Viewfinder */}
      {!isLoading && !loadError && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="w-12 h-12 rounded-full border border-cyan-400/40 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/70" />
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/75 backdrop-blur-sm">
          <Loader2 className="w-9 h-9 text-cyan-400 animate-spin mb-2" />
          <p className="text-sm font-semibold text-white">Loading HD 360° Panorama...</p>
          <p className="text-xs text-slate-400 mt-0.5">7680 × 3840 Equirectangular</p>
        </div>
      )}

      {/* Error Notice */}
      {loadError && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/85 p-6 text-center">
          <p className="text-rose-400 text-sm font-medium mb-3">{loadError}</p>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 text-white text-xs hover:bg-slate-700"
          >
            Close
          </button>
        </div>
      )}

      {/* Multi-POI Horizontal Extraction Results Strip (Shows ALL extracted POIs) */}
      {latestExtractedPois.length > 0 && (
        <div className="absolute bottom-14 left-3 right-3 z-20 rounded-xl bg-slate-950/90 border border-emerald-500/40 p-2 backdrop-blur-md shadow-2xl">
          <div className="flex items-center justify-between px-1 pb-1.5">
            <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Extracted {latestExtractedPois.length} POI{latestExtractedPois.length === 1 ? '' : 's'} from Frame {point.id}
            </span>
            {onDismissResults && (
              <button
                onClick={onDismissResults}
                className="text-slate-400 hover:text-white p-0.5"
                title="Hide strip"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
            {latestExtractedPois.map((poi) => {
              const cropSrc = poi.cropUrl
                ? poi.cropUrl.startsWith('http')
                  ? poi.cropUrl
                  : `${apiBase}${poi.cropUrl}`
                : null;
              return (
                <div
                  key={poi.id}
                  className="min-w-[260px] max-w-[300px] shrink-0 rounded-lg bg-slate-900 border border-slate-700 p-2 flex items-center gap-2.5"
                >
                  {cropSrc && (
                    <button
                      onClick={() => onPreviewCrop?.(poi)}
                      className="relative group w-16 h-12 rounded overflow-hidden border border-slate-600 shrink-0 bg-black cursor-zoom-in"
                      title="Click to inspect cropped image"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={cropSrc} alt={poi.nameEn} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <ZoomIn className="w-4 h-4 text-white" />
                      </div>
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-white truncate">{poi.nameBn}</div>
                    <div className="text-[11px] text-slate-400 truncate">{poi.nameEn}</div>
                    {poi.phone && (
                      <div className="text-[10px] font-mono text-cyan-300 truncate">{poi.phone}</div>
                    )}
                  </div>
                  {onEditPoi && (
                    <button
                      onClick={() => {
                        if (isFullscreen) setIsFullscreen(false);
                        onEditPoi(poi);
                      }}
                      className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 shrink-0"
                      title="Edit POI"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bottom Controls */}
      <div className="absolute bottom-3 left-0 right-0 z-20 flex items-center justify-between px-4 pointer-events-none">
        <div className="flex items-center space-x-1.5 text-[11px] text-slate-300 bg-black/70 backdrop-blur-sm px-3 py-1 rounded-full pointer-events-auto">
          <Compass className="w-3.5 h-3.5 text-cyan-400" />
          <span>
            {point.coordinates[1].toFixed(5)}, {point.coordinates[0].toFixed(5)}
          </span>
        </div>

        {onExtractViewport && (
          <button
            onClick={handleCaptureClick}
            disabled={isLoading || isExtracting}
            className="pointer-events-auto flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white shadow-lg border border-indigo-400/50 transition-all"
          >
            {isExtracting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Camera className="w-3.5 h-3.5" />
            )}
            <span>{isExtracting ? 'Extracting...' : 'Capture & Extract View'}</span>
          </button>
        )}

        <div className="flex items-center space-x-2 pointer-events-auto">
          {prevId && (
            <button
              onClick={() => onNavigateAdjacent && onNavigateAdjacent(prevId)}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-black/75 hover:bg-cyan-600 border border-slate-700 text-xs font-semibold text-white shadow-lg transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Prev</span>
            </button>
          )}

          {nextId && (
            <button
              onClick={() => onNavigateAdjacent && onNavigateAdjacent(nextId)}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-black/75 hover:bg-cyan-600 border border-slate-700 text-xs font-semibold text-white shadow-lg transition-all"
            >
              <span>Next</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
