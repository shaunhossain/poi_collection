import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { OllamaService, PoiMetadata } from '../llm/ollama.service';
import { CropService } from './crop.service';
import { OcrGateService } from './ocr-gate.service';

export interface PoiRecord {
  id: string;
  nameBn: string;
  nameEn: string;
  category: string;
  confidence: number;
  coordinates: [number, number];
  address?: string;
  phone?: string;
  trackId: string;
  frameId: string;
  cropUrl?: string;
  panoramaUrl?: string;
  metadata?: PoiMetadata;
  detectedAt: string;
}

export interface CreatePoiDto {
  trackId?: string;
  frameId: string;
  nameBn: string;
  nameEn?: string;
  category?: string;
  phone?: string;
  address?: string;
  confidence?: number;
  cropUrl?: string;
  panoramaUrl?: string;
  metadata?: PoiMetadata;
  latitude: number;
  longitude: number;
}

export interface ExtractPoiDto {
  trackId?: string;
  frameId: string;
  latitude: number;
  longitude: number;
  imageUrlHigh?: string;
  panoramaUrl?: string;
  imageBase64?: string;
  yaw?: number;
  pitch?: number;
  fov?: number;
}

export interface UpdatePoiDto {
  nameBn?: string;
  nameEn?: string;
  category?: string;
  phone?: string | null;
  address?: string | null;
}

interface PoiRow {
  id: string;
  track_id: string;
  frame_id: string;
  name_bn: string;
  name_en: string;
  category: string;
  phone: string | null;
  address: string | null;
  confidence: number;
  crop_url: string | null;
  panorama_url: string | null;
  metadata: PoiMetadata | null;
  latitude: number;
  longitude: number;
  detected_at: Date;
}

@Injectable()
export class PoisService {
  private readonly logger = new Logger(PoisService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly ollama: OllamaService,
    private readonly cropService: CropService,
    private readonly ocrGate: OcrGateService,
  ) {}

  private mapRow(row: PoiRow): PoiRecord {
    const meta = row.metadata && Object.keys(row.metadata).length > 0 ? row.metadata : undefined;
    return {
      id: row.id,
      trackId: row.track_id,
      frameId: row.frame_id,
      nameBn: row.name_bn,
      nameEn: row.name_en,
      category: row.category,
      phone: row.phone ?? undefined,
      address: row.address ?? undefined,
      confidence: Number(row.confidence),
      cropUrl: row.crop_url ?? undefined,
      panoramaUrl: row.panorama_url ?? undefined,
      metadata: meta,
      coordinates: [Number(row.longitude), Number(row.latitude)],
      detectedAt: new Date(row.detected_at).toISOString().replace('T', ' ').slice(0, 19),
    };
  }

  async findAll(): Promise<PoiRecord[]> {
    await this.db.ensureSchema();
    const result = await this.db.query<PoiRow>(`
      SELECT id, track_id, frame_id, name_bn, name_en, category, phone, address,
             confidence, crop_url, panorama_url, metadata, latitude, longitude, detected_at
      FROM pois
      ORDER BY created_at DESC
    `);
    return result.rows.map((row) => this.mapRow(row));
  }

  async create(dto: CreatePoiDto): Promise<PoiRecord> {
    if (!dto.nameBn || dto.latitude == null || dto.longitude == null) {
      throw new BadRequestException('nameBn, latitude, and longitude are required.');
    }

    await this.db.ensureSchema();
    const trackId =
      dto.trackId ||
      (dto.frameId?.includes('_') ? `track${dto.frameId.split('_')[0]}` : 'track_unknown');

    const result = await this.db.query<PoiRow>(
      `
      INSERT INTO pois (
        track_id, frame_id, name_bn, name_en, category, phone, address,
        confidence, crop_url, panorama_url, metadata, latitude, longitude, geom
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11::jsonb, $12, $13, ST_SetSRID(ST_MakePoint($13, $12), 4326)
      )
      RETURNING id, track_id, frame_id, name_bn, name_en, category, phone, address,
                confidence, crop_url, panorama_url, metadata, latitude, longitude, detected_at
      `,
      [
        trackId,
        dto.frameId || '',
        dto.nameBn,
        dto.nameEn || dto.nameBn,
        dto.category || 'Commercial Building',
        dto.phone || null,
        dto.address || null,
        dto.confidence ?? 0.85,
        dto.cropUrl || null,
        dto.panoramaUrl || null,
        JSON.stringify(dto.metadata || {}),
        dto.latitude,
        dto.longitude,
      ],
    );

    return this.mapRow(result.rows[0]);
  }

  async update(id: string, dto: UpdatePoiDto): Promise<PoiRecord> {
    await this.db.ensureSchema();
    const result = await this.db.query<PoiRow>(
      `
      UPDATE pois
      SET
        name_bn = COALESCE($2, name_bn),
        name_en = COALESCE($3, name_en),
        category = COALESCE($4, category),
        phone = CASE WHEN $5::boolean THEN $6 ELSE phone END,
        address = CASE WHEN $7::boolean THEN $8 ELSE address END
      WHERE id = $1
      RETURNING id, track_id, frame_id, name_bn, name_en, category, phone, address,
                confidence, crop_url, panorama_url, metadata, latitude, longitude, detected_at
      `,
      [
        id,
        dto.nameBn ?? null,
        dto.nameEn ?? null,
        dto.category ?? null,
        dto.phone !== undefined,
        dto.phone ?? null,
        dto.address !== undefined,
        dto.address ?? null,
      ],
    );

    if (result.rows.length === 0) {
      throw new NotFoundException(`POI '${id}' not found.`);
    }
    return this.mapRow(result.rows[0]);
  }

  async remove(id: string): Promise<{ deleted: true; id: string }> {
    await this.db.ensureSchema();
    const result = await this.db.query<{ id: string; crop_url: string | null }>(
      `DELETE FROM pois WHERE id = $1 RETURNING id, crop_url`,
      [id],
    );
    if (result.rows.length === 0) {
      throw new NotFoundException(`POI '${id}' not found.`);
    }
    const cropUrl = result.rows[0].crop_url;
    if (cropUrl) {
      this.cropService.deleteCropFile(cropUrl);
    }
    return { deleted: true, id };
  }

  async removeAll(): Promise<{ deletedCount: number; clearedCrops: number }> {
    await this.db.ensureSchema();
    const result = await this.db.query<{ id: string }>(`DELETE FROM pois RETURNING id`);
    const clearedCrops = this.cropService.clearAllCrops();
    return { deletedCount: result.rows.length, clearedCrops };
  }

  async extractAndSave(dto: ExtractPoiDto): Promise<{ extractedCount: number; pois: PoiRecord[] }> {
    if (dto.latitude == null || dto.longitude == null || !dto.frameId) {
      throw new BadRequestException('frameId, latitude, and longitude are required.');
    }
    if (!dto.imageBase64 && !dto.imageUrlHigh && !dto.panoramaUrl) {
      throw new BadRequestException('Either imageUrlHigh/panoramaUrl or imageBase64 must be provided.');
    }

    const trackId =
      dto.trackId ||
      (dto.frameId.includes('_') ? `track${dto.frameId.split('_')[0]}` : 'track_unknown');
    const panoramaUrl = dto.panoramaUrl || dto.imageUrlHigh;
    const sourceUrl = dto.imageUrlHigh || dto.panoramaUrl;

    const slices: Array<{
      label: string;
      buffer: Buffer;
      lonDeg?: number;
      latDeg?: number;
      vfovDeg?: number;
      outW: number;
      outH: number;
    }> = [];

    const isTargetedCapture = dto.yaw !== undefined && dto.pitch !== undefined;

    if (isTargetedCapture && sourceUrl) {
      const normYaw = ((dto.yaw! % 360) + 360) % 360;
      const latDeg = dto.pitch!;
      const vfovDeg = dto.fov ?? 72;
      const targetedBuf = await this.cropService.projectRectilinearFromUrl(sourceUrl, {
        lonDeg: dto.yaw!,
        latDeg,
        vfovDeg,
        outWidth: 1288,
        outHeight: 840,
      });
      slices.push({
        label: `Targeted View (yaw ${Math.round(normYaw)}°, pitch ${Math.round(latDeg)}°)`,
        buffer: targetedBuf,
        lonDeg: dto.yaw!,
        latDeg,
        vfovDeg,
        outW: 1288,
        outH: 840,
      });
    } else if (dto.imageBase64) {
      const base64Clean = dto.imageBase64.replace(/^data:image\/\w+;base64,/, '');
      slices.push({
        label: 'Captured 360 Viewport',
        buffer: Buffer.from(base64Clean, 'base64'),
        outW: 1288,
        outH: 840,
      });
    } else if (sourceUrl) {
      const panoDirs = [
        { label: 'Right Street Facade (90°)', lonDeg: 90 },
        { label: 'Left Street Facade (270°)', lonDeg: 270 },
      ];
      for (const dir of panoDirs) {
        const buffer = await this.cropService.projectRectilinearFromUrl(sourceUrl, {
          lonDeg: dir.lonDeg,
          latDeg: -6,
          vfovDeg: 75,
          outWidth: 1288,
          outHeight: 840,
        });
        slices.push({
          label: dir.label,
          buffer,
          lonDeg: dir.lonDeg,
          latDeg: -6,
          vfovDeg: 75,
          outW: 1288,
          outH: 840,
        });
      }
    }

    const savedPois: PoiRecord[] = [];
    const seenShopNames = new Set<string>();
    let cropCounter = 0;
    let llmCalled = false;

    try {
      for (const slice of slices) {
        if (!isTargetedCapture) {
          const gate = await this.ocrGate.evaluateView(slice.buffer, {
            pitch: slice.latDeg,
            isTargetedCapture: false,
            fov: slice.vfovDeg,
          });
          if (!gate.shouldRunLlm) {
            this.logger.log(`OCR Gate skipped Ollama on ${slice.label}: ${gate.reason}`);
            continue;
          }
        }

        llmCalled = true;
        const boxes = await this.ollama.detectSignboardsNative(
          slice.buffer.toString('base64'),
          slice.outW,
          slice.outH,
          slice.label,
        );

        for (const box of boxes) {
          cropCounter += 1;
          const cropInfo =
            sourceUrl &&
            slice.lonDeg !== undefined &&
            slice.latDeg !== undefined &&
            slice.vfovDeg !== undefined
              ? await this.cropService.projectSubBoxCropFromUrl(
                  sourceUrl,
                  {
                    lonDeg: slice.lonDeg,
                    latDeg: slice.latDeg,
                    vfovDeg: slice.vfovDeg,
                    outW: slice.outW,
                    outH: slice.outH,
                  },
                  box.bbox,
                  dto.frameId,
                  cropCounter,
                )
              : await this.cropService.cropAndSaveBbox(
                  slice.buffer,
                  box.bbox,
                  dto.frameId,
                  cropCounter,
                );

          const candidate = await this.ollama.readFocusedSignboard(
            cropInfo.buffer.toString('base64'),
          );
          if (!candidate) {
            this.cropService.deleteCropFile(cropInfo.filename);
            continue;
          }

          const normBn = candidate.nameBn.toLowerCase().trim();
          const normEn = candidate.nameEn.toLowerCase().trim();
          const isDuplicateShop = Array.from(seenShopNames).some((prevKey) => {
            const [prevBn, prevEn] = prevKey.split('|');
            return (
              prevBn === normBn ||
              prevEn === normEn ||
              (normBn.length >= 5 && (prevBn.includes(normBn) || normBn.includes(prevBn))) ||
              (normEn.length >= 5 && (prevEn.includes(normEn) || normEn.includes(prevEn)))
            );
          });
          if (isDuplicateShop) {
            this.cropService.deleteCropFile(cropInfo.filename);
            continue;
          }
          seenShopNames.add(`${normBn}|${normEn}`);

          const created = await this.create({
            trackId,
            frameId: dto.frameId,
            nameBn: candidate.nameBn,
            nameEn: candidate.nameEn,
            category: candidate.category,
            phone: candidate.phone,
            address: candidate.address,
            confidence: candidate.confidence,
            cropUrl: `/api/crops/${cropInfo.filename}`,
            panoramaUrl,
            metadata: candidate.metadata,
            latitude: dto.latitude,
            longitude: dto.longitude,
          });

          savedPois.push(created);
        }
      }
    } finally {
      if (llmCalled) {
        await this.ollama.unloadModel();
      }
    }

    return {
      extractedCount: savedPois.length,
      pois: savedPois,
    };
  }
}
