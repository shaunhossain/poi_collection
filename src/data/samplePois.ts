import { POIItem, POIFeatureCollection } from '@/types/poi';

export const SAMPLE_POIS: POIItem[] = [
  {
    id: 'poi-1',
    nameBn: 'জি. এ লেডিস টেইলার্স',
    nameEn: 'G.A. Ladies Tailors',
    category: 'Tailor & Fashion',
    confidence: 0.96,
    coordinates: [90.41285, 23.81055],
    address: 'Shop # 12, Ground Floor, Main Road',
    trackId: 'track2105',
    frameId: '2105_204',
    panoramaUrl: 'https://streetview.bmapsbd.com/api/api/r2-proxy/track2105/2105_204.jpg',
    detectedAt: '2026-03-16 11:09:41',
  },
  {
    id: 'poi-2',
    nameBn: 'ফ্রিডম কোচিং একাডেমি',
    nameEn: 'Freedom Coaching Academy',
    category: 'Coaching & Education',
    confidence: 0.94,
    coordinates: [90.41225, 23.81042],
    phone: '01715-763720',
    address: 'বাংলা মাধ্যম & English Version (৫ম - ১২শ)',
    trackId: 'track2105',
    frameId: '2105_204',
    panoramaUrl: 'https://streetview.bmapsbd.com/api/api/r2-proxy/track2105/2105_204.jpg',
    detectedAt: '2026-03-16 11:09:41',
  },
  {
    id: 'poi-3',
    nameBn: 'হ্যালো বিউটি পার্লার',
    nameEn: 'Hello Beauty Parlor',
    category: 'Beauty & Parlor',
    confidence: 0.91,
    coordinates: [90.41242, 23.81068],
    address: '1st Floor, Plaza Building',
    trackId: 'track2105',
    frameId: '2105_204',
    panoramaUrl: 'https://streetview.bmapsbd.com/api/api/r2-proxy/track2105/2105_204.jpg',
    detectedAt: '2026-03-16 11:09:41',
  },
];

export const SAMPLE_GEOJSON: POIFeatureCollection = {
  type: 'FeatureCollection',
  features: SAMPLE_POIS.map((poi) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: poi.coordinates,
    },
    properties: poi,
  })),
};
