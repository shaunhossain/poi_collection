import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

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

export interface DetectedSignboard {
  bbox: [number, number, number, number]; // [x1, y1, x2, y2] in parent view pixels
  label?: string;
}

export interface ExtractedPoiCandidate {
  nameBn: string;
  nameEn: string;
  category: string;
  phone?: string;
  address?: string;
  confidence: number;
  bbox?: [number, number, number, number];
  metadata: PoiMetadata;
}

const POLITICAL_NOISE_PATTERN =
  /\b(political|election|party|rally|condolence|shok|mip|mp|chairman|councillor|ward\s+comm?issioner|banner|poster|flyer|graffiti|sublet|to-?let)\b|নির্বাচন|ভোট|শুভেচ্ছা|শোক|সম্মেলন|আওয়ামী|বিএনপি|জামায়াত|ছাত্রলীগ|ছাত্রদল|যুবলীগ|যুবদল|মেয়র|কাউন্সিলর|এমপি|বিক্রিত\s*ঔষধ\s*ফেরত|সাবলেট|টু-?লেট/i;

const PROMO_BANNER_PATTERN =
  /ক্যাশ\s*আউট|ক্যাম\s*জাউট|সর্বনিম্ন\s*ক্যাম|চার্জ\s*হ|চার্জ\s*মজারে|১[৪৮]\.[৫৯]০|৫০\s*%|সুবিধা\s*ডাবল|প্রিয়\s*এজেন্ট|বিকাশ|নগদ|bikash|bkash|nagad|flexiload|ফ্লেক্সিলোড|এন্ড\s*ফ্রি/i;

const GENUINE_SHOP_HINT_PATTERN =
  /টেইলার্স|কসমেটিক্স|কসমেটিক|কমেটিক|মেডিসিন|মেডিফ|ফার্মেস|ফার্নিচার|রেস্টুরেন্ট|হোটেল|একাডেমি|কোচিং|পার্লার|সেলুন|স্টোর|ট্রেডার্স|ইলেকট্রনিক্স|ব্যাংক|ক্লিনিক|হাসপাতাল|ডায়াগনস্টিক|এন্টারপ্রাইজ|store|tailor|cosmetic|medicine|pharmacy|bank|academy|fashion|parlor|restaurant|bakery|optical/i;

const BD_PHONE_REGEX = /(?:\+?88)?01[3-9]\d{2}[-\s]?\d{6}\b|\b02[-\s]?\d{7,8}\b/g;
const DUMMY_PHONES = new Set(['01712345678', '01712345679', '09876543210', '01234567890']);

const BENGALI_DIGITS: Record<string, string> = {
  '০': '0',
  '১': '1',
  '২': '2',
  '৩': '3',
  '৪': '4',
  '৫': '5',
  '৬': '6',
  '৭': '7',
  '৮': '8',
  '৯': '9',
};

@Injectable()
export class OllamaService {
  private readonly logger = new Logger(OllamaService.name);
  private readonly baseUrl =
    process.env.OLLAMA_BASE_URL || 'http://host.docker.internal:11434';
  private readonly model = process.env.OLLAMA_MODEL || 'qwen3-vl:8b-instruct';
  private readonly geminiApiKey = (process.env.GEMINI_API_KEY || '').trim();
  private readonly geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  private async callGemini(
    prompt: string,
    imageBase64: string,
    opts: { forceJson?: boolean; maxTokens: number },
  ): Promise<string | null> {
    if (!this.geminiApiKey) return null;
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${encodeURIComponent(this.geminiApiKey)}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: opts.maxTokens,
            ...(opts.forceJson ? { responseMimeType: 'application/json' } : {}),
          },
        }),
      });
      if (!res.ok) {
        this.logger.warn(`Gemini free tier returned ${res.status}; falling back to Ollama (${this.model}).`);
        return null;
      }
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return text || null;
    } catch (error) {
      this.logger.warn(`Gemini request failed (${(error as Error).message}); falling back to Ollama.`);
      return null;
    }
  }

  private async callVlm(
    prompt: string,
    imageBase64: string,
    opts: { numCtx: number; numPredict: number; repeatPenalty?: number; forceJson?: boolean },
  ): Promise<{ content: string; usedNormalizedCoords: boolean }> {
    if (this.geminiApiKey) {
      const geminiOut = await this.callGemini(prompt, imageBase64, {
        forceJson: opts.forceJson,
        maxTokens: opts.numPredict,
      });
      if (geminiOut) {
        return { content: geminiOut, usedNormalizedCoords: true };
      }
    }

    let response: Response;
    try {
      const body: Record<string, unknown> = {
        model: this.model,
        stream: false,
        keep_alive: '90s',
        messages: [
          {
            role: 'user',
            content: prompt,
            images: [imageBase64],
          },
        ],
        options: {
          temperature: 0,
          seed: 42,
          num_ctx: opts.numCtx,
          num_predict: opts.numPredict,
          repeat_penalty: opts.repeatPenalty ?? 1.05,
        },
      };
      if (opts.forceJson) {
        body.format = 'json';
      }

      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(40000),
        body: JSON.stringify(body),
      });
    } catch (error) {
      const err = error as Error;
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        this.logger.warn(`Ollama request timed out after 40s; skipping.`);
        return { content: '', usedNormalizedCoords: this.usesNormalizedBbox() };
      }
      this.logger.error(`Ollama connection failed: ${err.message}`);
      throw new ServiceUnavailableException(
        `Local Ollama is unreachable at ${this.baseUrl}. Start Ollama on your Mac and ensure '${this.model}' is pulled (ollama pull ${this.model}).`,
      );
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      this.logger.error(`Ollama returned ${response.status}: ${errText}`);
      throw new ServiceUnavailableException(
        `Ollama error (${response.status}) for model '${this.model}'. Ensure you ran: ollama pull ${this.model}`,
      );
    }

    const payload = (await response.json()) as {
      message?: { content?: string };
    };
    return {
      content: payload?.message?.content || '',
      usedNormalizedCoords: this.usesNormalizedBbox(),
    };
  }

  private usesNormalizedBbox(): boolean {
    return /qwen3-vl/i.test(this.model);
  }

  /**
   * Stage 1: Locate all shopfront and business signboards using the model's
   * native grounding format without constrained-JSON grammar distortion.
   */
  async detectSignboardsNative(
    imageBase64: string,
    viewWidth: number,
    viewHeight: number,
    sideLabel?: string,
  ): Promise<DetectedSignboard[]> {
    const coordSpec = this.usesNormalizedBbox() || Boolean(this.geminiApiKey)
      ? `normalized 0..1000 bbox_2d [x1, y1, x2, y2]`
      : `pixel bbox_2d [x1, y1, x2, y2] within ${viewWidth}x${viewHeight}`;

    const prompt = `Locate all permanent shopfront, pharmacy, clinic, tailor, bank, coaching, or business signboards in this image${sideLabel ? ` (${sideLabel})` : ''} (including shaded signboards under awnings). Ignore red/white bKash or Nagad promo banners and small paper sublet/to-let flyers. Return a JSON list with ${coordSpec} and text_content for each signboard.`;

    const { content: raw, usedNormalizedCoords } = await this.callVlm(prompt, imageBase64, {
      numCtx: 2048,
      numPredict: 512,
      repeatPenalty: 1.08,
      forceJson: false,
    });
    this.logger.log(`Stage 1 grounding (${sideLabel || 'view'}): ${raw.slice(0, 600)}`);

    const items = this.extractObjectsFromMixedText(raw);
    const results: DetectedSignboard[] = [];

    for (const item of items) {
      const bbox = this.parseBboxToPixels(
        item.bbox_2d ?? item.box_2d ?? item.bbox,
        viewWidth,
        viewHeight,
        usedNormalizedCoords,
      );
      if (!bbox) continue;

      const w = bbox[2] - bbox[0];
      const h = bbox[3] - bbox[1];
      if (w < 24 || h < 16 || (w > viewWidth * 0.85 && h > viewHeight * 0.75)) continue;

      const label = this.cleanString(item.text_content ?? item.label ?? item.name ?? item.name_bn);
      if (label && this.isBannerNoise(label)) {
        this.logger.debug(`Skipped Stage 1 promo/clutter box: ${label}`);
        continue;
      }

      const area = w * h;
      const overlapsExisting = results.some((existing) => {
        const eb = existing.bbox;
        const ix1 = Math.max(bbox[0], eb[0]);
        const iy1 = Math.max(bbox[1], eb[1]);
        const ix2 = Math.min(bbox[2], eb[2]);
        const iy2 = Math.min(bbox[3], eb[3]);
        if (ix2 <= ix1 || iy2 <= iy1) return false;
        const interArea = (ix2 - ix1) * (iy2 - iy1);
        const existingArea = (eb[2] - eb[0]) * (eb[3] - eb[1]);
        return interArea / Math.min(area, existingArea) >= 0.4;
      });
      if (overlapsExisting) continue;

      results.push({ bbox, label });
      if (results.length >= 4) break;
    }

    return results;
  }

  /**
   * Stage 2: Focused Bengali & English OCR transcription on a tight 8K-projected
   * signboard crop (~900px wide).
   */
  async readFocusedSignboard(cropBase64: string): Promise<ExtractedPoiCandidate | null> {
    const prompt = `Read this close-up Bangladeshi shop signboard crop carefully.
Rules:
- If this crop shows ONLY a mobile banking/telecom promo banner (bKash/বিকাশ, Nagad/নগদ), paper to-let/sublet flyer, political poster, sky, wires, or has NO readable shop/business name, return {"has_signboard":false}.
- Otherwise transcribe ONLY text genuinely readable on this shop sign. Always fill name_en with the printed English name or accurate English transliteration of name_bn. Leave proprietor, address, or phones as null or [] if too blurry (NEVER invent fake cities or dummy phone numbers).

Return ONLY valid JSON:
{"has_signboard":true,"name_bn":"exact Bengali business name","name_en":"English name or transliteration","category":"one of Tailor & Fashion, Coaching & Education, Beauty & Parlor, Pharmacy & Healthcare, Grocery & Superstore, Restaurant & Cafe, Bank & Finance, Commercial Building","proprietor":null,"address":null,"phones":[],"raw_text":"verbatim lines","confidence":0.9}`;

    const { content: raw } = await this.callVlm(prompt, cropBase64, {
      numCtx: 1536,
      numPredict: 360,
      repeatPenalty: 1.04,
      forceJson: true,
    });
    this.logger.log(`Stage 2 focused OCR: ${raw.slice(0, 450)}`);

    const trimmed = raw.trim();
    const normalizedRaw =
      trimmed.startsWith('{') && !trimmed.endsWith('}') ? `${trimmed}}` : raw;
    const items = this.extractObjectsFromMixedText(normalizedRaw);
    const item = items[0];
    if (!item || item.has_signboard === false || item.is_temporary_banner === true) {
      return null;
    }

    const nameBn = this.cleanString(item.name_bn ?? item.nameBn) || '';
    const nameEn = this.cleanString(item.name_en ?? item.nameEn) || nameBn;
    if (!nameBn && !nameEn) return null;

    const rawText = this.cleanString(item.raw_text ?? item.rawText);
    const combined = `${nameBn} ${nameEn} ${rawText || ''}`;
    if (this.isBannerNoise(combined)) {
      this.logger.debug(`Filtered promo/banner after Stage 2 read: ${nameBn}`);
      return null;
    }

    if (/^(প্রোঃ|প্রো:|ডো|pro|proprietor)\b/i.test(nameBn) && !GENUINE_SHOP_HINT_PATTERN.test(combined)) {
      return null;
    }

    const phones = this.extractValidBdPhones(
      [...(Array.isArray(item.phones) ? item.phones.map(String) : []), rawText || ''].join(' '),
    );
    const proprietor = this.cleanString(item.proprietor);
    const address = this.cleanAddress(this.cleanString(item.address));

    const metadata: PoiMetadata = {
      ...(phones.length > 0 ? { phones } : {}),
      ...(proprietor ? { proprietor } : {}),
      ...(rawText ? { rawText } : {}),
    };

    return {
      nameBn: nameBn || nameEn,
      nameEn: nameEn || nameBn,
      category: this.cleanString(item.category) || 'Commercial Building',
      phone: phones[0],
      address,
      confidence: Math.max(0.1, Math.min(1, Number(item.confidence) || 0.9)),
      metadata,
    };
  }

  private isBannerNoise(text: string): boolean {
    if (POLITICAL_NOISE_PATTERN.test(text)) return true;
    if (PROMO_BANNER_PATTERN.test(text) && !GENUINE_SHOP_HINT_PATTERN.test(text)) {
      return true;
    }
    const stripped = text.trim();
    if (/^(বিকাশ|বিকাশ\s*করুন|নগদ|bikash|bkash|nagad)$/i.test(stripped)) {
      return true;
    }
    return false;
  }

  private cleanAddress(addr: string | undefined): string | undefined {
    if (!addr) return undefined;
    if (/কলকাতা|পশ্চিমবঙ্গ|ভারত|kolkata|west bengal|india|শ্রীমঙ্গল/i.test(addr)) {
      return undefined;
    }
    return addr;
  }

  private toAsciiDigits(input: string): string {
    return input.replace(/[০-৯]/g, (ch) => BENGALI_DIGITS[ch] ?? ch);
  }

  private extractValidBdPhones(text: string): string[] {
    const asciiText = this.toAsciiDigits(text);
    const matches = asciiText.match(BD_PHONE_REGEX) || [];
    const seen = new Set<string>();
    const valid: string[] = [];
    for (const m of matches) {
      const digits = m.replace(/[^\d]/g, '');
      const normalized = digits.startsWith('880') ? digits.slice(2) : digits;
      if (DUMMY_PHONES.has(normalized)) continue;
      if (!seen.has(normalized)) {
        seen.add(normalized);
        valid.push(m.trim());
      }
    }
    return valid;
  }

  private extractObjectsFromMixedText(raw: string): Array<Record<string, unknown>> {
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    try {
      const parsed = JSON.parse(cleaned) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'));
      }
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        if (Array.isArray(obj.pois)) return obj.pois as Array<Record<string, unknown>>;
        if (Array.isArray(obj.signboards)) return obj.signboards as Array<Record<string, unknown>>;
        return [obj];
      }
    } catch {
      // Recover balanced JSON objects inside truncated or prose-wrapped output
    }

    const objs: Array<Record<string, unknown>> = [];
    let depth = 0;
    let objStart = -1;
    let inString = false;
    let escape = false;

    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === '\\') {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        if (depth === 0) objStart = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && objStart !== -1) {
          const slice = cleaned.slice(objStart, i + 1);
          try {
            const parsedObj = JSON.parse(slice) as Record<string, unknown>;
            if (!Array.isArray(parsedObj.pois) && !Array.isArray(parsedObj.signboards)) {
              objs.push(parsedObj);
            }
          } catch {
            // Skip malformed object
          }
          objStart = -1;
        }
      }
    }
    return objs;
  }

  private parseBboxToPixels(
    rawBbox: unknown,
    viewWidth: number,
    viewHeight: number,
    normalized0to1000: boolean,
  ): [number, number, number, number] | undefined {
    let parts: unknown[] | null = null;
    if (Array.isArray(rawBbox)) {
      if (rawBbox.length === 1 && typeof rawBbox[0] === 'string') {
        parts = rawBbox[0].split(',').map((s) => s.trim());
      } else if (rawBbox.length >= 4) {
        parts = rawBbox;
      }
    } else if (typeof rawBbox === 'string') {
      parts = rawBbox.split(',').map((s) => s.trim());
    }

    if (!parts || parts.length < 4) return undefined;
    const v0 = Number(parts[0]) || 0;
    const v1 = Number(parts[1]) || 0;
    const v2 = Number(parts[2]) || 0;
    const v3 = Number(parts[3]) || 0;

    let x1: number;
    let y1: number;
    let x2: number;
    let y2: number;

    if (normalized0to1000) {
      x1 = Math.max(0, Math.round((v0 / 1000) * viewWidth));
      y1 = Math.max(0, Math.round((v1 / 1000) * viewHeight));
      x2 = Math.min(viewWidth, Math.round((v2 / 1000) * viewWidth));
      y2 = Math.min(viewHeight, Math.round((v3 / 1000) * viewHeight));
    } else {
      x1 = Math.max(0, Math.round(v0));
      y1 = Math.max(0, Math.round(v1));
      x2 = Math.min(viewWidth, Math.round(v2));
      y2 = Math.min(viewHeight, Math.round(v3));
    }

    if (x2 > x1 + 15 && y2 > y1 + 12) {
      return [x1, y1, x2, y2];
    }
    return undefined;
  }

  private cleanString(val: unknown): string | undefined {
    if (val === null || val === undefined) return undefined;
    const s = String(val).trim();
    if (!s || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') {
      return undefined;
    }
    return s;
  }

  async unloadModel(): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          keep_alive: 0,
          messages: [],
        }),
      });
      if (res.ok) {
        this.logger.log(`Unloaded Ollama model '${this.model}' from memory.`);
      }
    } catch (error) {
      this.logger.warn(`Failed to unload Ollama model: ${(error as Error).message}`);
    }
  }
}
