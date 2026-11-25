import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

export interface FacadeSlice {
  label: string;
  buffer: Buffer;
}

export interface RectilinearOptions {
  lonDeg: number;
  latDeg: number;
  vfovDeg?: number;
  outWidth?: number;
  outHeight?: number;
}

interface CachedCompressedPanorama {
  url: string;
  compressed: Buffer;
  width: number;
  height: number;
}

export interface SavedCropResult {
  filename: string;
  buffer: Buffer;
  boxWidth: number;
}

@Injectable()
export class CropService {
  private readonly logger = new Logger(CropService.name);
  private readonly cropsDir: string;
  // Keeps only the single most recently fetched compressed JPEG (~3.5MB) in RAM
  private cachedPano: CachedCompressedPanorama | null = null;

  constructor() {
    this.cropsDir =
      process.env.CROPS_DIR || path.resolve(process.cwd(), '..', 'data', 'crops');
    fs.mkdirSync(this.cropsDir, { recursive: true });
  }

  async fetchPanoramaMeta(url: string): Promise<CachedCompressedPanorama> {
    if (this.cachedPano && this.cachedPano.url === url) {
      return this.cachedPano;
    }

    const res = await fetch(url, {
      headers: {
        Referer: 'https://streetview.bmapsbd.com/',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch panorama image (${res.status}) from ${url}`);
    }
    const compressed = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(compressed).metadata();

    this.cachedPano = {
      url,
      compressed,
      width: meta.width || 7680,
      height: meta.height || 3840,
    };
    return this.cachedPano;
  }

  /**
   * Projects a distortion-free rectilinear view directly from the full-8K
   * equirectangular ROI band (streaming libvips extract -> bilinear + shadow lift + sharpen).
   */
  async projectRectilinearFromUrl(
    url: string,
    options: RectilinearOptions,
  ): Promise<Buffer> {
    const pano = await this.fetchPanoramaMeta(url);
    return this.projectFromRoi(pano, options);
  }

  /**
   * Re-projects a Stage-1 pixel bbox_2d from a parent rectilinear view directly
   * out of the full-8K panorama at high resolution (900px wide), preserving full
   * headline, proprietor, address, and phone lines with generous padding.
   */
  async projectSubBoxCropFromUrl(
    url: string,
    parent: { lonDeg: number; latDeg: number; vfovDeg: number; outW: number; outH: number },
    bbox: [number, number, number, number],
    frameId: string,
    index: number,
  ): Promise<SavedCropResult> {
    const pano = await this.fetchPanoramaMeta(url);
    const cx1 = Math.max(0, Math.min(parent.outW - 1, bbox[0]));
    const cy1 = Math.max(0, Math.min(parent.outH - 1, bbox[1]));
    const cx2 = Math.max(0, Math.min(parent.outW, bbox[2]));
    const cy2 = Math.max(0, Math.min(parent.outH, bbox[3]));

    const boxW = Math.max(24, cx2 - cx1);
    const boxH = Math.max(18, cy2 - cy1);

    const padX = Math.max(20, Math.round(boxW * 0.14));
    const padTop = Math.max(14, Math.round(boxH * 0.22));
    const padBottom = Math.max(28, Math.round(boxH * 0.95));

    const px1 = Math.max(0, cx1 - padX);
    const py1 = Math.max(0, cy1 - padTop);
    const px2 = Math.min(parent.outW, cx2 + padX);
    const py2 = Math.min(parent.outH, cy2 + padBottom);

    const p = ((90 - Math.max(-85, Math.min(85, parent.latDeg))) * Math.PI) / 180;
    const t = (parent.lonDeg * Math.PI) / 180;
    const fx = -Math.sin(p) * Math.cos(t);
    const fy = -Math.cos(p);
    const fz = -Math.sin(p) * Math.sin(t);

    let rx = -fz;
    let rz = fx;
    const rLen = Math.hypot(rx, rz) || 1;
    rx /= rLen;
    rz /= rLen;

    const ux = -rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy;

    const tanHalfV = Math.tan(((parent.vfovDeg / 2) * Math.PI) / 180);
    const tanHalfH = tanHalfV * (parent.outW / parent.outH);

    const midX = (px1 + px2) / 2;
    const midY = (py1 + py2) / 2;
    const ndcX = ((2 * midX) / parent.outW - 1) * tanHalfH;
    const ndcY = (1 - (2 * midY) / parent.outH) * tanHalfV;

    const dx = fx + ndcX * rx + ndcY * ux;
    const dy = fy + ndcY * uy;
    const dz = fz + ndcX * rz + ndcY * uz;
    const invLen = 1 / Math.hypot(dx, dy, dz);

    const nx = dx * invLen;
    const ny = Math.max(-1, Math.min(1, dy * invLen));
    const nz = dz * invLen;

    const subLatDeg = (-Math.asin(ny) * 180) / Math.PI;
    const subLonDeg = (Math.atan2(-nz, -nx) * 180) / Math.PI;

    const spanH = Math.max(24, py2 - py1);
    const spanW = Math.max(32, px2 - px1);
    const subVfovDeg = Math.max(14, Math.min(58, (spanH / parent.outH) * parent.vfovDeg * 1.1));
    const aspect = Math.max(1.2, Math.min(3.2, spanW / spanH));
    const subW = 900;
    const subH = Math.max(280, Math.round(subW / aspect));

    const safeFrame = frameId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'frame';
    const filename = `${safeFrame}_${Date.now()}_${index}.jpg`;
    const outputPath = path.join(this.cropsDir, filename);

    const buf = await this.projectFromRoi(pano, {
      lonDeg: subLonDeg,
      latDeg: subLatDeg,
      vfovDeg: subVfovDeg,
      outWidth: subW,
      outHeight: subH,
    });
    await fs.promises.writeFile(outputPath, buf);
    return { filename, buffer: buf, boxWidth: boxW };
  }

  private async projectFromRoi(
    pano: CachedCompressedPanorama,
    options: RectilinearOptions,
  ): Promise<Buffer> {
    const outW = options.outWidth ?? 1288;
    const outH = options.outHeight ?? 840;
    const vfovDeg = Math.max(25, Math.min(105, options.vfovDeg ?? 72));

    const srcW = pano.width;
    const srcH = pano.height;

    const p = ((90 - Math.max(-85, Math.min(85, options.latDeg))) * Math.PI) / 180;
    const t = (options.lonDeg * Math.PI) / 180;

    const fx = -Math.sin(p) * Math.cos(t);
    const fy = -Math.cos(p);
    const fz = -Math.sin(p) * Math.sin(t);

    let rx = -fz;
    let rz = fx;
    const rLen = Math.hypot(rx, rz) || 1;
    rx /= rLen;
    const ry = 0;
    rz /= rLen;

    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;

    const tanHalfV = Math.tan(((vfovDeg / 2) * Math.PI) / 180);
    const aspect = outW / outH;
    const tanHalfH = tanHalfV * aspect;
    const twoPi = Math.PI * 2;

    // Sample a 17x17 grid of output rays to determine minimal 8K ROI bounds
    let minU = 1;
    let maxU = 0;
    let minV = 1;
    let maxV = 0;

    for (let gy = 0; gy <= 16; gy++) {
      const ndcY = (1 - (2 * gy) / 16) * tanHalfV;
      for (let gx = 0; gx <= 16; gx++) {
        const ndcX = ((2 * gx) / 16 - 1) * tanHalfH;
        const dx = fx + ndcX * rx + ndcY * ux;
        const dy = fy + ndcY * uy;
        const dz = fz + ndcX * rz + ndcY * uz;
        const invLen = 1 / Math.hypot(dx, dy, dz);
        const nx = dx * invLen;
        const ny = Math.max(-1, Math.min(1, dy * invLen));
        const nz = dz * invLen;

        let phi = Math.atan2(nz, nx);
        if (phi < 0) phi += twoPi;
        const u = phi / twoPi;
        const v = Math.acos(ny) / Math.PI;

        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
    }

    const srcTop = Math.max(0, Math.floor((minV - 0.015) * (srcH - 1)));
    const srcBottom = Math.min(srcH - 1, Math.ceil((maxV + 0.015) * (srcH - 1)));
    const bandH = Math.max(16, srcBottom - srcTop + 1);

    // Extract narrow horizontal crop when view doesn't wrap around u = 0/1 seam
    const wrapsSeam = maxU - minU > 0.65;
    const roiLeft = wrapsSeam ? 0 : Math.max(0, Math.floor((minU - 0.015) * (srcW - 1)));
    const roiRight = wrapsSeam
      ? srcW - 1
      : Math.min(srcW - 1, Math.ceil((maxU + 0.015) * (srcW - 1)));
    const roiW = Math.max(16, roiRight - roiLeft + 1);

    const { data: roiData, info } = await sharp(pano.compressed)
      .extract({ left: roiLeft, top: srcTop, width: roiW, height: bandH })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const actualRoiW = info.width;
    const actualRoiH = info.height;
    const channels = info.channels;

    const outBuf = Buffer.allocUnsafe(outW * outH * 3);
    const srcWMinus1 = srcW - 1;
    const srcHMinus1 = srcH - 1;

    for (let py = 0; py < outH; py++) {
      const ndcY = (1 - (2 * (py + 0.5)) / outH) * tanHalfV;
      const baseDx = fx + ndcY * ux;
      const baseDy = fy + ndcY * uy;
      const baseDz = fz + ndcY * uz;

      for (let px = 0; px < outW; px++) {
        const ndcX = ((2 * (px + 0.5)) / outW - 1) * tanHalfH;

        const dx = baseDx + ndcX * rx;
        const dy = baseDy;
        const dz = baseDz + ndcX * rz;
        const invLen = 1 / Math.hypot(dx, dy, dz);

        const nx = dx * invLen;
        const ny = Math.max(-1, Math.min(1, dy * invLen));
        const nz = dz * invLen;

        let phi = Math.atan2(nz, nx);
        if (phi < 0) phi += twoPi;

        const gx = (phi / twoPi) * srcWMinus1 - roiLeft;
        const gy = (Math.acos(ny) / Math.PI) * srcHMinus1 - srcTop;

        const x0 = Math.max(0, Math.min(actualRoiW - 1, Math.floor(gx)));
        const y0 = Math.max(0, Math.min(actualRoiH - 1, Math.floor(gy)));
        const x1 = wrapsSeam
          ? (x0 + 1) % actualRoiW
          : Math.min(actualRoiW - 1, x0 + 1);
        const y1 = Math.min(actualRoiH - 1, y0 + 1);

        const wx = Math.max(0, Math.min(1, gx - x0));
        const wy = Math.max(0, Math.min(1, gy - y0));

        const i00 = (y0 * actualRoiW + x0) * channels;
        const i10 = (y0 * actualRoiW + x1) * channels;
        const i01 = (y1 * actualRoiW + x0) * channels;
        const i11 = (y1 * actualRoiW + x1) * channels;

        const w00 = (1 - wx) * (1 - wy);
        const w10 = wx * (1 - wy);
        const w01 = (1 - wx) * wy;
        const w11 = wx * wy;

        const outIdx = (py * outW + px) * 3;
        outBuf[outIdx] = Math.round(
          roiData[i00] * w00 + roiData[i10] * w10 + roiData[i01] * w01 + roiData[i11] * w11,
        );
        outBuf[outIdx + 1] = Math.round(
          roiData[i00 + 1] * w00 +
            roiData[i10 + 1] * w10 +
            roiData[i01 + 1] * w01 +
            roiData[i11 + 1] * w11,
        );
        outBuf[outIdx + 2] = Math.round(
          roiData[i00 + 2] * w00 +
            roiData[i10 + 2] * w10 +
            roiData[i01 + 2] * w01 +
            roiData[i11 + 2] * w11,
        );
      }
    }

    return sharp(outBuf, { raw: { width: outW, height: outH, channels: 3 } })
      .gamma(1.32)
      .sharpen({ sigma: 0.7 })
      .jpeg({ quality: 92 })
      .toBuffer();
  }

  /**
   * Projects Right (90°) and Left (270°) street-facing rectilinear facades at 1280×854.
   */
  async sliceRectilinearViewsFromUrl(url: string): Promise<FacadeSlice[]> {
    const pano = await this.fetchPanoramaMeta(url);
    const directions = [
      { label: 'Right Street Facade (90°)', lonDeg: 90 },
      { label: 'Left Street Facade (270°)', lonDeg: 270 },
    ];

    const results: FacadeSlice[] = [];
    for (const dir of directions) {
      const buffer = await this.projectFromRoi(pano, {
        lonDeg: dir.lonDeg,
        latDeg: -3,
        vfovDeg: 75,
        outWidth: 1288,
        outHeight: 840,
      });
      results.push({ label: dir.label, buffer });
    }
    return results;
  }

  /**
   * Crops a pixel [x1, y1, x2, y2] region from sourceBuffer with generous context padding
   * so headlines and phone strips are preserved, upscales narrow signs for OCR/zoom,
   * and returns { filename, buffer, boxWidth }.
   */
  async cropAndSaveBbox(
    sourceBuffer: Buffer,
    bbox: [number, number, number, number] | undefined,
    frameId: string,
    index: number,
  ): Promise<SavedCropResult> {
    const safeFrame = frameId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'frame';
    const filename = `${safeFrame}_${Date.now()}_${index}.jpg`;
    const outputPath = path.join(this.cropsDir, filename);

    try {
      const meta = await sharp(sourceBuffer).metadata();
      const width = meta.width || 1280;
      const height = meta.height || 854;

      if (bbox) {
        const cx1 = Math.max(0, Math.min(width - 1, bbox[0]));
        const cy1 = Math.max(0, Math.min(height - 1, bbox[1]));
        const cx2 = Math.max(0, Math.min(width, bbox[2]));
        const cy2 = Math.max(0, Math.min(height, bbox[3]));

        const boxW = cx2 - cx1;
        const boxH = cy2 - cy1;

        if (boxW >= 20 && boxH >= 16) {
          const padX = Math.max(24, Math.round(boxW * 0.16));
          const padY = Math.max(20, Math.round(boxH * 0.2));

          const left = Math.max(0, cx1 - padX);
          const top = Math.max(0, cy1 - padY);
          const right = Math.min(width, cx2 + padX);
          const bottom = Math.min(height, cy2 + padY);

          const clampedWidth = right - left;
          const clampedHeight = bottom - top;

          if (clampedWidth >= 24 && clampedHeight >= 20) {
            let pipeline = sharp(sourceBuffer).extract({
              left,
              top,
              width: clampedWidth,
              height: clampedHeight,
            });
            if (clampedWidth < 680) {
              pipeline = pipeline.resize({ width: 760, kernel: sharp.kernel.lanczos3 });
            }
            const buf = await pipeline.sharpen({ sigma: 0.6 }).jpeg({ quality: 92 }).toBuffer();
            await fs.promises.writeFile(outputPath, buf);
            return { filename, buffer: buf, boxWidth: boxW };
          }
        }
      }

      const fallbackBuf = await sharp(sourceBuffer)
        .resize({ width: 1024, withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();
      await fs.promises.writeFile(outputPath, fallbackBuf);
      return { filename, buffer: fallbackBuf, boxWidth: width };
    } catch (error) {
      this.logger.warn(`Fallback crop save for ${filename}: ${(error as Error).message}`);
      const buf = await sharp(sourceBuffer).jpeg({ quality: 88 }).toBuffer();
      await fs.promises.writeFile(outputPath, buf);
      return { filename, buffer: buf, boxWidth: 1024 };
    }
  }

  deleteCropFile(filename: string): void {
    const clean = path.basename(filename);
    if (!clean) return;
    const fullPath = path.join(this.cropsDir, clean);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  clearAllCrops(): number {
    if (!fs.existsSync(this.cropsDir)) return 0;
    const files = fs.readdirSync(this.cropsDir);
    let count = 0;
    for (const file of files) {
      const fullPath = path.join(this.cropsDir, file);
      if (fs.statSync(fullPath).isFile()) {
        fs.unlinkSync(fullPath);
        count += 1;
      }
    }
    return count;
  }

  resolveCropPath(filename: string): string | null {
    const clean = path.basename(filename);
    if (!clean || clean !== filename) return null;
    const fullPath = path.join(this.cropsDir, clean);
    return fs.existsSync(fullPath) ? fullPath : null;
  }
}
