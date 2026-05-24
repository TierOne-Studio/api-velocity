import { Module } from '@nestjs/common';
import { AdminModule } from '../admin';
import { AirweaveController } from './api/controllers/airweave.controller';
import { AirweaveOwnershipGuard } from './api/guards/airweave-ownership.guard';
import { AirweaveAuthorizationService } from './application/services/airweave-authorization.service';
import { AirweaveService } from './application/services/airweave.service';
import { airweaveSdkProvider } from './infrastructure/airweave-sdk.provider';

@Module({
  imports: [AdminModule],
  controllers: [AirweaveController],
  providers: [
    AirweaveService,
    AirweaveAuthorizationService,
    AirweaveOwnershipGuard,
    airweaveSdkProvider,
  ],
  // Export the authorization service so source-connection endpoints (Step 7)
  // can call `assertOwnership(...)` inline. Export the SDK service for
  // existing consumers (projects module).
  exports: [AirweaveService, AirweaveAuthorizationService],
})
export class AirweaveModule {}
