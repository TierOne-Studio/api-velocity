import { Module, forwardRef } from '@nestjs/common';
import { AdminModule } from '../admin';
// forwardRef: AirweaveService injects PROJECTS_REPOSITORY for delete-time
// reference checks (Step 5 of the airweave-collections-crud feature).
// ProjectsModule already imports AirweaveModule (AirweaveCollectionProvider),
// hence the cycle. NestJS resolves it via forwardRef on both sides.
import { ProjectsModule } from '../projects/projects.module';
import { AirweaveController } from './api/controllers/airweave.controller';
import { AirweaveOwnershipGuard } from './api/guards/airweave-ownership.guard';
import { AirweaveAuthorizationService } from './application/services/airweave-authorization.service';
import { AirweaveService } from './application/services/airweave.service';
import { airweaveSdkProvider } from './infrastructure/airweave-sdk.provider';

@Module({
  imports: [AdminModule, forwardRef(() => ProjectsModule)],
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
