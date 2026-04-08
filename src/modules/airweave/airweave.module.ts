import { Module } from '@nestjs/common';
import { AirweaveController } from './api/controllers/airweave.controller';
import { AirweaveService } from './application/services/airweave.service';
import { airweaveSdkProvider } from './infrastructure/airweave-sdk.provider';

@Module({
  controllers: [AirweaveController],
  providers: [AirweaveService, airweaveSdkProvider],
  exports: [AirweaveService],
})
export class AirweaveModule {}
