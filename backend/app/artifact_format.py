"""Recognize WUJI's declared workbook format; embedded approval never grants approval on import."""
import hashlib
import json

from .contracts import csv_bytes

APPROVED_SHEETS={'Approval','Audit','Changes','Conditions','Metrics','Validation'}
DOCUMENTS={'approval.json','conditions.json','input-source.json','metrics.json','validation.json','evidence.json','metadata.json','manifest.json'}


def inspect_approved_workbook(book):
    if not APPROVED_SHEETS.issubset(book.sheetnames):
        return False,False
    try:
        rows=book['Audit'].iter_rows(values_only=True)
        if tuple(next(rows))!=('document','part','json_text'):
            return False,False
        chunks={}
        for index,row in enumerate(rows):
            if index>=20000 or len(row)!=3:
                return False,False
            name,part,value=row
            if name not in DOCUMENTS or type(part) is not int or part<1 or not isinstance(value,str):
                return False,False
            chunks.setdefault(name,[]).append((part,value))
        if set(chunks)!=DOCUMENTS:
            return False,False
        documents={}
        for name,parts in chunks.items():
            ordered=sorted(parts)
            if [n for n,_ in ordered]!=list(range(1,len(ordered)+1)):
                return False,False
            documents[name]=json.loads(''.join(value for _,value in ordered))
        manifest,approval=documents['manifest.json'],documents['approval.json']
        if manifest.get('exporterVersion')!='approved-schedule/1' or approval.get('exporterVersion')!=manifest['exporterVersion'] or approval.get('approvalId')!=manifest.get('approvalId'):
            return False,False
        files={name:(json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2)+'\n').encode()
            for name,value in documents.items() if name!='manifest.json'}
        for sheet,filename in [('Schedule','schedule.csv'),('Employees','employees.csv'),('Availability','availability.csv'),('Changes','changes.csv')]:
            files[filename]=csv_bytes(list(book[sheet].iter_rows(values_only=True)))
        hashes=manifest.get('files')
        if not isinstance(hashes,dict) or set(hashes)!=set(files):
            return False,False
        changed=any(hashlib.sha256(value).hexdigest()!=hashes[name] for name,value in files.items())
        return True,changed
    except (ValueError,TypeError,KeyError,StopIteration):
        return False,False
