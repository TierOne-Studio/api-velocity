import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToMany,
  JoinTable,
} from 'typeorm';
import { PermissionTypeOrmEntity } from './permission.typeorm-entity';

@Entity('roles')
export class RoleTypeOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 50 })
  name: string;

  @Column({ name: 'display_name', length: 100 })
  displayName: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ length: 20, default: 'gray' })
  color: string;

  @Column({ name: 'is_default', default: false })
  isDefault: boolean;

  @Column({ name: 'organization_id', type: 'text', nullable: true })
  organizationId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  /* istanbul ignore next */
  @ManyToMany(
    /* istanbul ignore next */
    () => PermissionTypeOrmEntity,
    { eager: false },
  )
  @JoinTable({
    name: 'role_permissions',
    joinColumn: { name: 'role_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' },
  })
  permissions: PermissionTypeOrmEntity[];
}
