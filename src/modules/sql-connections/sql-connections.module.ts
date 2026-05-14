import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/infrastructure/database/database.module';
import { SqlConnectionsController } from './api/controllers/sql-connections.controller';
import { SqlConnectionsService } from './application/services/sql-connections.service';
import { SqlConnectionTester } from './application/services/sql-connection-tester';
import { SqlConnectionsMigrationService } from './sql-connections.migration';
import { SqlConnectionsDatabaseRepository } from './infrastructure/persistence/repositories/sql-connections.database-repository';
import { SQL_CONNECTIONS_REPOSITORY } from './domain/sql-connection.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [SqlConnectionsController],
  providers: [
    SqlConnectionsService,
    SqlConnectionTester,
    SqlConnectionsMigrationService,
    {
      provide: SQL_CONNECTIONS_REPOSITORY,
      useClass: SqlConnectionsDatabaseRepository,
    },
  ],
  exports: [SqlConnectionsService, SqlConnectionsMigrationService],
})
export class SqlConnectionsModule {}
