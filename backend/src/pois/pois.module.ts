import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { CropService } from './crop.service';
import { OcrGateService } from './ocr-gate.service';
import { PoisController } from './pois.controller';
import { PoisService } from './pois.service';

@Module({
  imports: [LlmModule],
  controllers: [PoisController],
  providers: [PoisService, CropService, OcrGateService],
})
export class PoisModule {}
