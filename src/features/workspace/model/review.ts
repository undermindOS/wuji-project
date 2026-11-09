import type { ApprovalDetail, ReviewCandidate, ScenarioReview, WorkspaceSnapshot } from './types.ts';

export const assignmentsEqual = (a:Record<string,string>,b:Record<string,string>) =>
  Object.keys(a).length===Object.keys(b).length && Object.entries(a).every(([id,value])=>b[id]===value);

export function reviewBelongsTo(review:ScenarioReview,snapshot:WorkspaceSnapshot,runId:string) {
  return review.projectId===snapshot.project.id && review.sourceVersionId===snapshot.source.id
    && review.taskSpecId===snapshot.task.id && review.runId===runId;
}

export function canApproveCandidate(candidate:ReviewCandidate|null,review:ScenarioReview|null,snapshot:WorkspaceSnapshot,dirty:boolean) {
  return !!candidate && !!review && reviewBelongsTo(review,snapshot,candidate.runId) && review.isCurrent
    && candidate.scenario.sourceVersionId===snapshot.source.id && candidate.scenario.taskSpecId===snapshot.task.id
    && review.candidates.some(item=>item.id===candidate.id&&item.candidateHash===candidate.candidateHash)
    && snapshot.source.id===snapshot.project.headSourceId && snapshot.task.id===snapshot.project.headTaskId
    && !dirty && candidate.validation?.status==='pass' && !!candidate.metrics;
}

export function approvalForCandidate(approvals:ApprovalDetail[],candidate:ReviewCandidate|null) {
  return candidate ? approvals.find(item=>item.candidateHash===candidate.candidateHash && item.runId===candidate.runId
    && item.scenarioId===candidate.id && item.isCurrent && item.isSelected)??null : null;
}
