import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import sharp from 'sharp';

export interface OcrGateResult {
  shouldRunLlm: boolean;
  reason: string;
}

@Injectable()
export class OcrGateService {
  private readonly logger = new Logger(OcrGateService.name);

  /**
   * Lightweight CPU check (<0.4s, ~30MB RAM, zero GPU/Ollama usage) to skip
   * empty sky, asphalt, blank walls, or extreme up/down angles before waking Ollama.
   */
  async evaluateView(
    imageBuffer: Buffer,
    options?: { pitch?: number; isTargetedCapture?: boolean; fov?: number },
  ): Promise<OcrGateResult> {
    if (options?.pitch !== undefined && (options.pitch < -42 || options.pitch > 50)) {
      return { shouldRunLlm: false, reason: `extreme pitch (${Math.round(options.pitch)}°)` };
    }

    try {
      const meta = await sharp(imageBuffer).metadata();
      const width = meta.width || 1024;
      const height = meta.height || 682;

      // Focus middle facade band (y: 12%..88%) to ignore overhead power lines and road asphalt
      const top = Math.round(height * 0.12);
      const cropHeight = Math.max(64, Math.round(height * 0.76));
      const bandBuf = await sharp(imageBuffer)
        .extract({ left: 0, top, width, height: cropHeight })
        .grayscale()
        .normalize()
        .png()
        .toBuffer();

      const tsv = await this.runTesseractTsv(bandBuf);
      const strongWords = tsv
        .split('\n')
        .slice(1)
        .map((line) => line.split('\t'))
        .filter((cols) => {
          if (cols.length < 12) return false;
          const conf = Number(cols[10]);
          const word = (cols[11] || '').trim();
          return conf >= 58 && word.length >= 3 && /[\p{L}]{2,}/u.test(word);
        });

      if (strongWords.length >= 1) {
        return {
          shouldRunLlm: true,
          reason: `tesseract found ${strongWords.length} strong word(s)`,
        };
      }

      // Check local signage edge density in case 3D stylized letters aren't segmented by Tesseract
      const { data: rawGray, info } = await sharp(bandBuf)
        .raw()
        .toBuffer({ resolveWithObject: true });

      let highContrastEdges = 0;
      let sampleCount = 0;
      for (let y = 2; y < info.height - 2; y += 3) {
        for (let x = 2; x < info.width - 2; x += 3) {
          const idx = y * info.width + x;
          const gx = Math.abs(rawGray[idx + 1] - rawGray[idx - 1]);
          const gy = Math.abs(rawGray[idx + info.width] - rawGray[idx - info.width]);
          if (gx > 55 || gy > 55) highContrastEdges++;
          sampleCount++;
        }
      }

      const edgeRatio = sampleCount > 0 ? highContrastEdges / sampleCount : 0;
      if (options?.isTargetedCapture && edgeRatio >= 0.045) {
        return {
          shouldRunLlm: true,
          reason: `targeted capture edge density ${(edgeRatio * 100).toFixed(1)}%`,
        };
      }

      return {
        shouldRunLlm: false,
        reason: `no strong text and low facade density (${(edgeRatio * 100).toFixed(1)}%)`,
      };
    } catch (error) {
      this.logger.warn(`OcrGateService bypassed (${(error as Error).message})`);
      return { shouldRunLlm: true, reason: 'gate error fallback' };
    }
  }

  private runTesseractTsv(inputBuffer: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('tesseract', ['stdin', 'stdout', '-l', 'ben+eng', '--psm', '11', 'tsv']);
      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill('SIGKILL');
          reject(new Error('Tesseract timed out after 6s'));
        }
      }, 6000);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });

      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`tesseract exited ${code}: ${stderr.slice(0, 160)}`));
        }
      });

      child.stdin.write(inputBuffer);
      child.stdin.end();
    });
  }
}
