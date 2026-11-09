import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpWorkspaceClient,WorkspaceApiError } from '../src/features/workspace/api/HttpWorkspaceClient.ts';
import type { ExportReceipt } from '../src/features/workspace/model/types.ts';

const receipt={id:'export',projectId:'project',approvalId:'approval',format:'csv',size:4,sha256:'0'.repeat(64)} as ExportReceipt;

test('an HTML hosting fallback cannot be downloaded as an approved schedule',async()=>{
  const client=new HttpWorkspaceClient((async()=>new Response('<html>fallback</html>',{headers:{'Content-Type':'text/html'}})) as typeof fetch);
  await assert.rejects(client.downloadApprovedExport(receipt),(error:unknown)=>error instanceof WorkspaceApiError&&error.code==='export_type');
});
test('download keeps a backend integrity conflict visible to the user',async()=>{
  const client=new HttpWorkspaceClient((async()=>new Response(JSON.stringify({code:'original_integrity',message:'Файл изменён'}),{
    status:409,headers:{'Content-Type':'application/json'}})) as typeof fetch);
  await assert.rejects(client.downloadApprovedExport(receipt),(error:unknown)=>error instanceof WorkspaceApiError&&error.code==='original_integrity'&&error.status===409);
});
test('download rejects a file whose bytes differ from the immutable receipt',async()=>{
  const client=new HttpWorkspaceClient((async()=>new Response(new Uint8Array([80,75,3,4]),{headers:{'Content-Type':'application/zip'}})) as typeof fetch);
  await assert.rejects(client.downloadApprovedExport(receipt),(error:unknown)=>error instanceof WorkspaceApiError&&error.code==='export_integrity');
});
test('a valid download verifies size and SHA before handing its bytes to the browser',async()=>{
  const bytes=new Uint8Array([80,75,3,4]);
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  let path='';
  const client=new HttpWorkspaceClient((async(input)=>{path=String(input);return new Response(bytes,{headers:{'Content-Type':'application/zip'}});}) as typeof fetch);
  const blob=await client.downloadApprovedExport({...receipt,sha256:sha});
  assert.equal(blob.size,4);
  assert.equal(path,'/api/v1/projects/project/exports/export/download');
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),bytes);
});
test('an HTML hosting fallback is reported as an unavailable service, not saved as a template',async()=>{
  const client=new HttpWorkspaceClient((async()=>new Response('<html>fallback</html>',{headers:{'Content-Type':'text/html; charset=utf-8'}})) as typeof fetch);
  await assert.rejects(client.downloadTemplate('csv'),(error:unknown)=>error instanceof WorkspaceApiError&&error.code==='unavailable'&&error.message==='Сервис хранения недоступен. Демонстрация доступна отдельно.');
});
test('a template download asks for the chosen format and returns its bytes',async()=>{
  const bytes=new Uint8Array([80,75,3,4]);
  const paths:string[]=[];
  const client=new HttpWorkspaceClient((async(input)=>{const path=String(input);paths.push(path);
    const type=path.endsWith('xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/zip';
    return new Response(bytes,{headers:{'Content-Type':type}});}) as typeof fetch);
  const zip=await client.downloadTemplate('csv');
  const workbook=await client.downloadTemplate('xlsx');
  assert.deepEqual(paths,['/api/v1/templates?format=csv','/api/v1/templates?format=xlsx']);
  assert.equal(zip.type,'application/zip');
  assert.equal(workbook.type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.deepEqual(new Uint8Array(await zip.arrayBuffer()),bytes);
});
test('a template of another type than requested is not handed to the browser',async()=>{
  const client=new HttpWorkspaceClient((async()=>new Response(new Uint8Array([80,75,3,4]),{headers:{'Content-Type':'application/zip'}})) as typeof fetch);
  await assert.rejects(client.downloadTemplate('xlsx'),(error:unknown)=>error instanceof WorkspaceApiError&&error.code==='unavailable'&&error.status===200);
});
test('a backend error during a template download keeps its message',async()=>{
  const client=new HttpWorkspaceClient((async()=>new Response(JSON.stringify({code:'validation',message:'Неизвестный формат'}),{
    status:422,headers:{'Content-Type':'application/json'}})) as typeof fetch);
  await assert.rejects(client.downloadTemplate('csv'),(error:unknown)=>error instanceof WorkspaceApiError&&error.code==='validation'&&error.status===422&&error.message==='Неизвестный формат');
});
test('a network failure during a template download asks to reconnect',async()=>{
  const client=new HttpWorkspaceClient((async()=>{throw new TypeError('fetch failed');}) as typeof fetch);
  await assert.rejects(client.downloadTemplate('csv'),(error:unknown)=>error instanceof WorkspaceApiError&&error.status===0&&error.code==='unavailable'&&error.message==='Сервис хранения недоступен. Повторите подключение.');
});
