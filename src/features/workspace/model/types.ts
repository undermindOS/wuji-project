export type ExampleId = 'absence' | 'missing-rate' | 'unknown-availability' | 'conflict' | 'unchanged';
export type PaneId = 'source' | 'task' | 'scenario';
export type CheckStatus = 'pass' | 'unknown' | 'fail';

import type { components } from '../api/schema.d.ts';

export type ApiSchemas = components['schemas'];
export type Employee = ApiSchemas['Employee'];
export type Shift = ApiSchemas['Shift'];
export type SourceVersion = ApiSchemas['SourceVersion'];
export type TaskSpec = ApiSchemas['TaskSpec'];
export type Scenario = ApiSchemas['Scenario'];
export type WorkspaceSnapshot = ApiSchemas['WorkspaceSnapshot'];
export type ProjectSummary = ApiSchemas['ProjectSummary'];
export type ImportPreview = ApiSchemas['ImportPreview'];
export type ImportIssue = ApiSchemas['ImportIssue'];
export type Absence = ApiSchemas['Absence'];
export type RunDetail = ApiSchemas['RunDetail'];
export type RunSummary = ApiSchemas['RunSummary'];
export type CalculatedScenario = ApiSchemas['CalculatedScenario'];
export type IntentDraft = ApiSchemas['IntentDraft'];
export type AiConfiguration = ApiSchemas['AiConfiguration'];
export type ReviewCandidate = ApiSchemas['ReviewCandidate'];
export type ScenarioReview = ApiSchemas['ScenarioReview'];
export type ApprovalDetail = ApiSchemas['ApprovalDetail'];
export type ExportReceipt = ApiSchemas['ExportReceipt'];
export type ScenarioEvaluation = Pick<CalculatedScenario,'scenario'|'validation'|'metrics'|'evidence'> & {searchStatus?:CalculatedScenario['searchStatus']};

export interface WorkspaceData {
  id: string;
  label: string;
  source: SourceVersion;
  task: TaskSpec;
  scenarios: Scenario[];
  conflict: { shiftId: string; title: string; detail: string } | null;
}

export interface WorkspaceExample extends WorkspaceData { id: ExampleId }

export interface Change {
  id: string;
  shiftId: string;
  beforeEmployeeId: string;
  afterEmployeeId: string;
  sourceRow: number;
}

export interface DemoCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  shiftIds: string[];
}

export interface ScenarioMetrics {
  changes: Change[];
  affectedEmployeeIds: string[];
  coveredShifts: number;
  totalShifts: number;
  totalMinutes: number;
  costMinor: number | null;
  baselineCostMinor: number | null;
  costDeltaMinor: number | null;
  unknownRateEmployeeIds: string[];
}
