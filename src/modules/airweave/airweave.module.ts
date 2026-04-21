import { Module } from '@nestjs/common';
import { AdminModule } from '../admin';
import { AirweaveController } from './api/controllers/airweave.controller';
import { AirweaveService } from './application/services/airweave.service';
import { airweaveSdkProvider } from './infrastructure/airweave-sdk.provider';

@Module({
  imports: [AdminModule],
  controllers: [AirweaveController],
  providers: [AirweaveService, airweaveSdkProvider],
  exports: [AirweaveService],
})
export class AirweaveModule {}
