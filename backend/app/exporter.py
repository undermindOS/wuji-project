import io
import json
import zipfile
from datetime import datetime

from openpyxl import Workbook

from .contracts import HEADERS, csv_bytes
from .schemas import NormalizedSource, SourceVersion


def source_tables(source: NormalizedSource, sparse=False):
    return {
        'schedule': [HEADERS['schedule'], *[[s.id, s.starts_at, s.ends_at, s.role, s.employee_id, str(s.pinned).lower()] for s in source.shifts]],
        'employees': [HEADERS['employees'], *[[e.id, e.name, '|'.join(e.roles), e.rate_per_hour_minor, e.max_weekly_minutes, source.currency] for e in source.employees]],
        'availability': [HEADERS['availability'], *[[e.id, s.id, e.availability.get(s.id, 'unknown')] for e in source.employees for s in source.shifts if not sparse or s.id in e.availability]],
    }


def stable_zip(entries: dict[str, bytes]):
    result = io.BytesIO()
    with zipfile.ZipFile(result, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in entries.items():
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, content)
    return result.getvalue()


def export_source(source: SourceVersion, format: str):
    tables = source_tables(source)
    metadata = {'timezone': source.timezone, 'currency': source.currency, 'team_name': source.team_name,
        'source_id': source.id, 'version': source.version, 'content_hash': source.content_hash}
    if format == 'csv':
        entries = {}
        for kind, rows in tables.items():
            entries[f'{kind}.csv'] = csv_bytes(rows)
        entries['metadata.json'] = (json.dumps(metadata, ensure_ascii=False, indent=2) + '\n').encode()
        return stable_zip(entries), 'application/zip', f'wuji-source-v{source.version}.zip'
    book = Workbook()
    book.remove(book.active)
    book.properties.created = datetime(2000, 1, 1)
    book.properties.modified = datetime(2000, 1, 1)
    for name, kind in [('Schedule', 'schedule'), ('Employees', 'employees'), ('Availability', 'availability')]:
        sheet = book.create_sheet(name)
        for row in tables[kind]:
            sheet.append(row)
        for row in sheet:
            for cell in row:
                if isinstance(cell.value, str):
                    cell.data_type = 's'
        sheet.freeze_panes = 'A2'
        sheet.auto_filter.ref = sheet.dimensions
    sheet = book.create_sheet('Metadata')
    sheet.append(['key', 'value'])
    for key in ['timezone', 'currency', 'team_name']:
        sheet.append([key, metadata[key]])
    for row in sheet:
        for cell in row:
            if isinstance(cell.value, str):
                cell.data_type = 's'
    output = io.BytesIO()
    book.save(output)
    book.close()
    with zipfile.ZipFile(io.BytesIO(output.getvalue())) as archive:
        content = stable_zip({name: archive.read(name) for name in archive.namelist()})
    return content, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', f'wuji-source-v{source.version}.xlsx'
