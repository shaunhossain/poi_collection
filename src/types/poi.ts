export type POICategory =
  | 'Tailor & Fashion'
  | 'Coaching & Education'
  | 'Beauty & Parlor'
  | 'Pharmacy & Healthcare'
  | 'Grocery & Superstore'
  | 'Restaurant & Cafe'
  | 'Commercial Building';

export interface PoiMetadata {
  holdingNo?: string;
  road?: string;
  area?: string;
  floor?: string;
  phones?: string[];
  proprietor?: string;
  services?: string[];
  openingHours?: string;
  website?: string;
  email?: string;
  social?: string;
  tagline?: string;
  rawText?: string;
}

export interface POIItem {
  id: string;
  nameBn: string;
  nameEn: string;
  category: POICategory;
  confidence: number;
  coordinates: [number, number]; // [longitude, latitude]
  address?: string;
  phone?: string;
  trackId: string;
  frameId: string;
  cropUrl?: string;
  panoramaUrl?: string;
  metadata?: PoiMetadata;
  detectedAt?: string;
}

export interface ThirdEyePointData {
  id: string;
  imageUrlHigh: string;
  imageUrlComp?: string;
  initialYaw: number;
  initialPitch: number;
  initialHfov: number;
  coordinates: [number, number]; // [longitude, latitude]
  captureDate?: string;
  nextId?: string;
  previousId?: string;
}

export interface GeoJSONFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  properties: POIItem;
}

export interface POIFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}
