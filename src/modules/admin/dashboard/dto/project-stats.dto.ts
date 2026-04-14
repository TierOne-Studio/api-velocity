export interface StatusCount {
  status: string;
  count: number;
}

export interface PhaseCount {
  phase: string;
  count: number;
}

export interface TypeCount {
  type: string;
  count: number;
}

export interface ProjectStatsDto {
  totalProjects: number;
  byStatus: StatusCount[];
  byPhase: PhaseCount[];
  totalDataSources: number;
  dataSourcesByType: TypeCount[];
  dataSourcesByStatus: StatusCount[];
  totalEntityCount: number;
}
