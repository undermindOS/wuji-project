import { createExample } from '../data/examples.ts';
import type { ExampleId, WorkspaceExample } from '../model/types.ts';
import { httpWorkspaceClient } from './HttpWorkspaceClient.ts';
import type { ProjectClient } from './HttpWorkspaceClient.ts';

export interface WorkspaceClient extends ProjectClient {
  loadExample(id: ExampleId, signal?: AbortSignal): Promise<WorkspaceExample>;
}

// Prepared examples only. A future HTTP implementation can use the same UI contract.
export const demoWorkspaceClient: Pick<WorkspaceClient, 'loadExample'> = {
  async loadExample(id, signal) {
    signal?.throwIfAborted();
    const example = createExample(id);
    signal?.throwIfAborted();
    return example;
  },
};

export const workspaceClient = {
  loadExample: demoWorkspaceClient.loadExample,
  listProjects: httpWorkspaceClient.listProjects.bind(httpWorkspaceClient),
  createProject: httpWorkspaceClient.createProject.bind(httpWorkspaceClient),
  getWorkspace: httpWorkspaceClient.getWorkspace.bind(httpWorkspaceClient),
  previewImport: httpWorkspaceClient.previewImport.bind(httpWorkspaceClient),
  confirmImport: httpWorkspaceClient.confirmImport.bind(httpWorkspaceClient),
  saveTask: httpWorkspaceClient.saveTask.bind(httpWorkspaceClient),
  listRuns: httpWorkspaceClient.listRuns.bind(httpWorkspaceClient),
  getRun: httpWorkspaceClient.getRun.bind(httpWorkspaceClient),
  startRun: httpWorkspaceClient.startRun.bind(httpWorkspaceClient),
  cancelRun: httpWorkspaceClient.cancelRun.bind(httpWorkspaceClient),
  fixAssignments: httpWorkspaceClient.fixAssignments.bind(httpWorkspaceClient),
  getAiConfiguration: httpWorkspaceClient.getAiConfiguration.bind(httpWorkspaceClient),
  listIntents: httpWorkspaceClient.listIntents.bind(httpWorkspaceClient),
  getIntent: httpWorkspaceClient.getIntent.bind(httpWorkspaceClient),
  startIntent: httpWorkspaceClient.startIntent.bind(httpWorkspaceClient),
  cancelIntent: httpWorkspaceClient.cancelIntent.bind(httpWorkspaceClient),
  confirmIntent: httpWorkspaceClient.confirmIntent.bind(httpWorkspaceClient),
  getScenarioReview: httpWorkspaceClient.getScenarioReview.bind(httpWorkspaceClient),
  createRevision: httpWorkspaceClient.createRevision.bind(httpWorkspaceClient),
  validateRevision: httpWorkspaceClient.validateRevision.bind(httpWorkspaceClient),
  listApprovals: httpWorkspaceClient.listApprovals.bind(httpWorkspaceClient),
  approveScenario: httpWorkspaceClient.approveScenario.bind(httpWorkspaceClient),
  prepareApprovedExport: httpWorkspaceClient.prepareApprovedExport.bind(httpWorkspaceClient),
  downloadApprovedExport: httpWorkspaceClient.downloadApprovedExport.bind(httpWorkspaceClient),
  downloadTemplate: httpWorkspaceClient.downloadTemplate.bind(httpWorkspaceClient),
} satisfies WorkspaceClient;
