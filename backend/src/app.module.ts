import { Module } from '@nestjs/common';
import { DatabaseModule } from './db/database.module';
import { LlmModule } from './llm/llm.module';
import { PoisModule } from './pois/pois.module';

@Module({
  imports: [DatabaseModule, LlmModule, PoisModule],
})
export class AppModule {}
