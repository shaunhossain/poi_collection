import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CropService } from './crop.service';
import { CreatePoiDto, ExtractPoiDto, PoisService, UpdatePoiDto } from './pois.service';

@Controller('api')
export class PoisController {
  constructor(
    private readonly poisService: PoisService,
    private readonly cropService: CropService,
  ) {}

  @Get('pois')
  async getPois() {
    return this.poisService.findAll();
  }

  @Post('pois')
  async createPoi(@Body() dto: CreatePoiDto) {
    return this.poisService.create(dto);
  }

  @Post('pois/extract')
  async extractPois(@Body() dto: ExtractPoiDto) {
    return this.poisService.extractAndSave(dto);
  }

  @Patch('pois/:id')
  async updatePoi(@Param('id') id: string, @Body() dto: UpdatePoiDto) {
    return this.poisService.update(id, dto);
  }

  @Delete('pois')
  async deleteAllPois() {
    return this.poisService.removeAll();
  }

  @Delete('pois/:id')
  async deletePoi(@Param('id') id: string) {
    return this.poisService.remove(id);
  }

  @Get('crops/:filename')
  getCrop(@Param('filename') filename: string, @Res() res: Response) {
    const filePath = this.cropService.resolveCropPath(filename);
    if (!filePath) {
      throw new NotFoundException(`Crop image '${filename}' not found.`);
    }
    return res.sendFile(filePath);
  }
}
