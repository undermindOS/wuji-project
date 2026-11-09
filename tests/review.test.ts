import test from 'node:test';
import assert from 'node:assert/strict';
import { assignmentsEqual,approvalForCandidate,canApproveCandidate,reviewBelongsTo } from '../src/features/workspace/model/review.ts';
import type { ApprovalDetail,ReviewCandidate,ScenarioReview,WorkspaceSnapshot } from '../src/features/workspace/model/types.ts';

const snapshot={project:{id:'project',headSourceId:'source',headTaskId:'task'},source:{id:'source'},task:{id:'task'}} as WorkspaceSnapshot;
const candidate={id:'scenario',runId:'run',candidateHash:'a'.repeat(64),scenario:{sourceVersionId:'source',taskSpecId:'task'},
  validation:{status:'pass'},metrics:{costMinor:100}} as ReviewCandidate;
const review={projectId:'project',sourceVersionId:'source',taskSpecId:'task',runId:'run',isCurrent:true,candidates:[candidate]} as ScenarioReview;

test('approval requires a concrete checked version from the exact current inputs',()=>{
  assert.equal(canApproveCandidate(candidate,review,snapshot,false),true);
  assert.equal(canApproveCandidate({...candidate,validation:null},review,snapshot,false),false);
  assert.equal(canApproveCandidate({...candidate,validation:{...candidate.validation!,status:'unknown'}},review,snapshot,false),false);
  assert.equal(canApproveCandidate({...candidate,validation:{...candidate.validation!,status:'fail'}},review,snapshot,false),false);
  assert.equal(canApproveCandidate(candidate,review,snapshot,true),false);
});

test('late versions and mismatched candidate hashes cannot become approvable',()=>{
  assert.equal(canApproveCandidate(candidate,{...review,isCurrent:false},snapshot,false),false);
  assert.equal(canApproveCandidate({...candidate,candidateHash:'b'.repeat(64)},review,snapshot,false),false);
  assert.equal(canApproveCandidate(candidate,review,{...snapshot,project:{...snapshot.project,headTaskId:'new'}},false),false);
  assert.equal(canApproveCandidate({...candidate,scenario:{...candidate.scenario,taskSpecId:'old'}},review,snapshot,false),false);
  assert.equal(reviewBelongsTo({...review,projectId:'other'},snapshot,'run'),false);
});

test('editing any assignment invalidates the unchanged-version state independently of key order',()=>{
  assert.equal(assignmentsEqual({s1:'anna',s2:'bob'},{s2:'bob',s1:'anna'}),true);
  assert.equal(assignmentsEqual({s1:'anna',s2:'bob'},{s1:'anna',s2:'carol'}),false);
  assert.equal(assignmentsEqual({s1:'anna'},{s1:'anna',s2:'bob'}),false);
});

test('historical approvals cannot label a different scenario as the current selection',()=>{
  const approved={id:'approval',candidateHash:candidate.candidateHash,runId:'run',scenarioId:'scenario',isCurrent:true,isSelected:true} as ApprovalDetail;
  assert.equal(approvalForCandidate([approved],candidate)?.id,'approval');
  assert.equal(approvalForCandidate([{...approved,isSelected:false}],candidate),null);
  assert.equal(approvalForCandidate([{...approved,isCurrent:false}],candidate),null);
  assert.equal(approvalForCandidate([{...approved,scenarioId:'other'}],candidate),null);
});
