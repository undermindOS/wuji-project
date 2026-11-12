import { useEffect, useRef, useState } from 'react';
import type { ApprovalDetail, ExportReceipt, ReviewCandidate, RunDetail, ScenarioReview, WorkspaceSnapshot } from '../model/types.ts';
import { approvalForCandidate, assignmentsEqual, reviewBelongsTo } from '../model/review.ts';
import { workspaceClient } from './WorkspaceClient.ts';

type Action='save'|'validate'|'approve'|'export'|'download';
export function useScenarioReview(snapshot:WorkspaceSnapshot|null,run:RunDetail|null,baseId:string|null) {
  const scope=snapshot ? [snapshot.project.id,snapshot.source.id,snapshot.task.id,run?.id??''].join('/') : '';
  const [loaded,setLoaded]=useState<{scope:string;review:ScenarioReview|null;approvals:ApprovalDetail[]}|null>(null);
  const [selection,setSelection]=useState<{scope:string;id:string}|null>(null);
  const [draft,setDraft]=useState<{scope:string;id:string;assignments:Record<string,string>}|null>(null);
  const [busy,setBusy]=useState<Action|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [refresh,setRefresh]=useState(0);
  const generation=useRef(0);
  const action=useRef<AbortController|null>(null);
  const inFlight=useRef(false);
  const keys=useRef<Partial<Record<Action,{fingerprint:string;key:string}>>>({});
  const review=loaded?.scope===scope?loaded.review:null;
  const approvals=loaded?.scope===scope?loaded.approvals:[];
  const restored=review?.candidates.find(c=>c.baseScenarioId===baseId&&approvals.some(a=>a.isCurrent&&a.isSelected&&a.runId===run?.id&&a.scenarioId===c.id));
  const selected=selection?.scope===scope ? review?.candidates.find(c=>c.id===selection.id&&c.baseScenarioId===baseId):restored;
  const candidate=selected??review?.candidates.find(c=>c.id===baseId)??null;
  const assignments=draft?.scope===scope&&draft.id===candidate?.id?draft.assignments:candidate?.scenario.assignments??{};
  const editorDirty=!!candidate&&!assignmentsEqual(assignments,candidate.scenario.assignments);

  useEffect(()=>{
    const controller=new AbortController();
    const ticket=++generation.current;
    action.current?.abort();inFlight.current=false;setBusy(null);setError(null);setLoading(!!snapshot);
    if (!snapshot) { setLoaded(null);return ()=>controller.abort(); }
    void Promise.all([
      run ? workspaceClient.getScenarioReview(snapshot.project.id,run.id,controller.signal):Promise.resolve(null),
      workspaceClient.listApprovals(snapshot.project.id,controller.signal),
    ]).then(([next,history])=>{
      if (controller.signal.aborted||generation.current!==ticket) return;
      if (next&&run&&!reviewBelongsTo(next,snapshot,run.id)) return;
      setLoaded({scope,review:next,approvals:history});
    }).catch(value=>{if(!controller.signal.aborted&&generation.current===ticket)setError(value instanceof Error?value.message:'Could not load revisions and approvals.');})
      .finally(()=>{if(generation.current===ticket)setLoading(false);});
    return ()=>{generation.current++;controller.abort();action.current?.abort();};
  },[scope,run?.status,refresh]);

  function requestKey(kind:Action,fingerprint:string) {
    if(keys.current[kind]?.fingerprint!==fingerprint) keys.current[kind]={fingerprint,key:crypto.randomUUID()};
    return keys.current[kind]!.key;
  }
  async function perform<T>(kind:Action,operation:(signal:AbortSignal)=>Promise<T>,accept:(value:T)=>void) {
    if(inFlight.current)return;
    const ticket=generation.current;
    const controller=new AbortController();action.current=controller;inFlight.current=true;setBusy(kind);setError(null);
    try {
      const result=await operation(controller.signal);
      if(!controller.signal.aborted&&generation.current===ticket) {delete keys.current[kind];accept(result);}
    } catch(value) {
      if(!controller.signal.aborted&&generation.current===ticket)setError(value instanceof Error?value.message:'The operation did not complete. Try again.');
    } finally {if(generation.current===ticket){inFlight.current=false;setBusy(null);}}
  }
  const adopt=(next:ReviewCandidate)=>{
    setSelection({scope,id:next.id});setDraft(null);
    setLoaded(previous=>previous?.scope===scope&&previous.review?{...previous,review:{...previous.review,
      candidates:[...previous.review.candidates.filter(c=>c.id!==next.id),next]}}:previous);
    setRefresh(v=>v+1);
  };
  const save=()=>snapshot&&run&&candidate&&perform('save',signal=>workspaceClient.createRevision(snapshot.project.id,run.id,{
    sourceVersionId:snapshot.source.id,taskSpecId:snapshot.task.id,baseScenarioId:candidate.baseScenarioId,
    parentRevisionId:candidate.revisionId,assignments,
    requestKey:requestKey('save',scope+'/'+candidate.id+'/'+JSON.stringify(Object.entries(assignments).sort())),
  },signal),adopt);
  const validate=()=>snapshot&&candidate?.revisionId&&perform('validate',signal=>workspaceClient.validateRevision(snapshot.project.id,candidate.revisionId!,signal),adopt);
  const approve=(unknownCost:boolean)=>snapshot&&run&&candidate&&perform('approve',signal=>workspaceClient.approveScenario(snapshot.project.id,{
    sourceVersionId:snapshot.source.id,taskSpecId:snapshot.task.id,runId:run.id,scenarioId:candidate.id,revisionId:candidate.revisionId,
    candidateHash:candidate.candidateHash,acknowledged:true,acknowledgedUnknownCost:unknownCost,
    requestKey:requestKey('approve',scope+'/'+candidate.candidateHash+'/'+unknownCost),
  },signal),()=>setRefresh(v=>v+1));
  const prepare=(approval:ApprovalDetail,format:'csv'|'xlsx')=>snapshot&&perform('export',
    signal=>workspaceClient.prepareApprovedExport(snapshot.project.id,approval.id,{format,candidateHash:approval.candidateHash},signal),
    ()=>setRefresh(v=>v+1));
  const download=(receipt:ExportReceipt)=>perform('download',signal=>workspaceClient.downloadApprovedExport(receipt,signal),blob=>{
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=url;link.download=receipt.filename;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  return {scope,review,approvals,candidate,assignments,editorDirty,busy,loading,error,
    currentApproval:approvalForCandidate(approvals,candidate),save,validate,approve,prepare,download,
    setAssignment:(id:string,value:string)=>candidate&&setDraft({scope,id:candidate.id,assignments:{...assignments,[id]:value}}),
    resetDraft:()=>setDraft(null),
    select:(id:string|null)=>{setSelection({scope,id:id??baseId??''});setDraft(null);setError(null);},
    refresh:()=>setRefresh(v=>v+1)};
}
