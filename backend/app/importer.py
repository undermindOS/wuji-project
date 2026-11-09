import csv
import io
import re
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone as dt_timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from xml.etree.ElementTree import ParseError

from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException

from .schemas import Employee, ImportIssue, NormalizedSource, OriginalFile, PreviewRow, Shift, SourceRef
from .contracts import CURRENCIES, HEADERS, LIMITS, MAX_FILE_BYTES, SHEETS, csv_bytes
from .exporter import source_tables
from .artifact_format import APPROVED_SHEETS, inspect_approved_workbook


@dataclass
class Table:
    kind: str
    original: OriginalFile
    sheet: str | None
    rows: list[tuple[int, dict[str, str]]]
    count: int


@dataclass
class ParsedImport:
    source: NormalizedSource | None
    issues: list[ImportIssue]
    row_counts: dict[str, int]
    preview_rows: list[PreviewRow]


def parse_import(files: list[tuple[OriginalFile, bytes]], team_name: str, timezone: str, currency: str):
    issues: list[ImportIssue] = []

    def issue(code, message, table=None, row=None, column=None, severity='error', original=None):
        original = table.original if table else original
        issues.append(ImportIssue(severity=severity, code=code, message=message,
            filename=original.filename if original else None, sheet=table.sheet if table else None,
            row=row, column=column))

    try:
        zone = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError):
        issue('timezone', 'Укажите существующий часовой пояс IANA, например Europe/Moscow.')
        zone = None
    if currency not in CURRENCIES:
        issue('currency', 'Поддерживаются RUB, USD, EUR, UYU, ARS, BRL, GBP; одна валюта на проект.')
    if not team_name or len(team_name) > 120 or team_name != team_name.strip():
        issue('team_name', 'Нужно название команды без крайних пробелов, до 120 символов.')
    tables: dict[str, Table] = {}
    if not files:
        issue('files_required', 'Выберите расписание и сотрудников в CSV либо один XLSX.')
    for original, raw in files:
        if len(raw) > MAX_FILE_BYTES:
            issue('file_size', 'Размер одного файла ограничен 5 МБ.', original=original)
            continue
        if original.kind == 'workbook':
            if len(files) != 1 or not original.filename.lower().endswith('.xlsx'):
                issue('file_set', 'XLSX загружается отдельно, без CSV.', original=original)
                continue
            try:
                with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                    entries = archive.infolist()
                    if len(entries) > 2000 or sum(entry.file_size for entry in entries) > 20 * 1024 * 1024:
                        raise ValueError('expanded_size')
                book = load_workbook(io.BytesIO(raw), read_only=True, data_only=False, keep_links=False)
                try:
                    unknown = set(book.sheetnames) - set(SHEETS) - {'Metadata'}
                    if unknown:
                        approved,changed=inspect_approved_workbook(book)
                        if approved:
                            unknown-=APPROVED_SHEETS
                            issue('approved_result_import','Импортируется новый исходник из результата WUJI. Прежнее утверждение и проверки не переносятся.',
                                severity='warning',original=original)
                            if changed:
                                issue('approved_result_changed','Таблицы или протокол отличаются от подготовленного файла. Проверьте изменения перед импортом.',
                                    severity='warning',original=original)
                    if unknown:
                        issue('unknown_sheets', 'Неизвестные листы: ' + ', '.join(sorted(unknown)) + '.', original=original)
                    for name, kind in SHEETS.items():
                        if name not in book.sheetnames:
                            continue
                        ws = book[name]
                        if (ws.max_column or 0) > len(HEADERS[kind]) or (ws.max_row or 0) > LIMITS[kind] + 1:
                            issue('sheet_size', f'Лист {name} превышает число столбцов шаблона или лимит строк.', original=original)
                            continue
                        values = []
                        for row_number, cells in enumerate(ws.iter_rows(), 1):
                            if row_number > LIMITS[kind] + 1:
                                issue('row_limit', f'Превышен лимит строк для {name}.', original=original)
                                break
                            row_values = []
                            for cell in cells:
                                if cell.data_type == 'f':
                                    issues.append(ImportIssue(severity='error', code='formula', message='Формулы не поддерживаются; загрузите явное значение.', filename=original.filename, sheet=name, row=row_number, column=cell.column_letter))
                                value = cell.value
                                row_values.append('' if value is None else str(value).lower() if isinstance(value, bool) else str(value))
                            values.append((row_number, row_values))
                        tables[kind] = _table(kind, original, name, values, issue)
                    if 'Metadata' in book.sheetnames:
                        rows = list(book['Metadata'].iter_rows(values_only=True))
                        if not rows or tuple(rows[0]) != ('key', 'value'):
                            issue('metadata_header', 'Лист Metadata должен начинаться со столбцов key,value.', original=original)
                        else:
                            expected = {'timezone': timezone, 'currency': currency, 'team_name': team_name}
                            seen = set()
                            for row in rows[1:]:
                                key, value = (list(row) + [None, None])[:2]
                                if key not in expected or key in seen or value != expected.get(key):
                                    issue('metadata_mismatch', 'Metadata не совпадает с подтверждаемыми названием, валютой или часовым поясом.', original=original)
                                seen.add(key)
                finally:
                    book.close()
            except (ValueError, zipfile.BadZipFile, KeyError, OSError, TypeError, ParseError, InvalidFileException, RuntimeError, EOFError):
                issue('xlsx_invalid', 'Не удалось прочитать XLSX по шаблону; проверьте формат и размер книги.', original=original)
            continue
        if original.kind not in HEADERS or not original.filename.lower().endswith('.csv'):
            issue('format', 'Для этого поля нужен CSV в UTF-8.', original=original)
            continue
        try:
            text = raw.decode('utf-8-sig')
            reader = csv.reader(io.StringIO(text, newline=''), strict=True)
            values = []
            while True:
                start_line = reader.line_num + 1
                try:
                    row = next(reader)
                except StopIteration:
                    break
                values.append((start_line, row))
                if len(values) > LIMITS[original.kind] + 1:
                    issue('row_limit', f'Превышен лимит строк: {LIMITS[original.kind]}.', original=original)
                    break
            tables[original.kind] = _table(original.kind, original, None, values, issue)
        except UnicodeDecodeError:
            issue('encoding', 'Файл должен быть в UTF-8; автоматическая смена кодировки не выполняется.', original=original)
        except csv.Error:
            issue('csv_invalid', 'Некорректные кавычки или структура CSV.', original=original)

    for required in ['schedule', 'employees']:
        if required not in tables:
            issue('missing_table', f'Не найдена обязательная таблица {required}.')
    row_counts = {kind: table.count for kind, table in tables.items()}
    preview_rows = [PreviewRow(filename=t.original.filename, sheet=t.sheet, row=row, values=values)
        for t in tables.values() for row, values in t.rows[:4]]
    employees: dict[str, Employee] = {}
    shifts: list[Shift] = []
    shift_ids: set[str] = set()

    def text_value(value, table, row, column, identifier=False):
        if not value or value != value.strip() or len(value) > (64 if identifier else 160) or any(ord(c) < 32 for c in value):
            issue('text', 'Пустое, слишком длинное значение, управляющий символ или крайние пробелы.', table, row, column)
            return None
        if identifier and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]*', value):
            issue('identifier', 'ID: латинские буквы, цифры, _, ., : и -; до 64 символов.', table, row, column)
            return None
        if not identifier and value[0] in '=+-@':
            issue('formula_text', 'Текстовое поле не должно начинаться с признака формулы (=, +, -, @).', table, row, column)
            return None
        return value

    def integer(value, table, row, column, maximum, optional=False):
        if optional and value == '':
            return None
        if not re.fullmatch(r'0|[1-9][0-9]*', value) or len(value) > 12 or int(value) > maximum:
            issue('integer', f'Нужно целое число от 0 до {maximum}' + (' или пустое значение.' if optional else '.'), table, row, column)
            return None
        return int(value)

    def date_value(value, table, row, column):
        try:
            date = datetime.fromisoformat(value)
            if date.tzinfo is None or date.utcoffset() is None:
                raise ValueError('offset required')
            if date.second or date.microsecond:
                raise ValueError('whole minutes required')
            if zone and date.utcoffset() != date.astimezone(zone).utcoffset():
                raise ValueError('timezone offset mismatch')
            return date
        except ValueError:
            issue('datetime', 'Нужно время ISO с UTC-смещением выбранного пояса и точностью до минут; неоднозначное время не угадывается.', table, row, column)
            return None

    if table := tables.get('employees'):
        for row, values in table.rows:
            count_before = len(issues)
            eid = text_value(values.get('employee_id', ''), table, row, 'employee_id', True)
            name = text_value(values.get('name', ''), table, row, 'name')
            roles_raw = values.get('roles', '').split('|')
            roles = [text_value(value, table, row, 'roles') for value in roles_raw]
            if len(roles) != len(set(roles)) or len(roles) > 20:
                issue('roles', 'Роли должны быть уникальны; максимум 20.', table, row, 'roles')
            rate = integer(values.get('rate_per_hour_minor', ''), table, row, 'rate_per_hour_minor', 1_000_000_000, True)
            maximum = integer(values.get('max_weekly_minutes', ''), table, row, 'max_weekly_minutes', 10080)
            if values.get('currency') != currency:
                issue('mixed_currency', 'Валюта сотрудника не совпадает с выбранной валютой проекта.', table, row, 'currency')
            if eid in employees:
                issue('duplicate_employee', 'Повторный ID сотрудника; строки не объединяются.', table, row, 'employee_id')
            if len(issues) == count_before and eid and name and maximum is not None:
                refs = {key: _ref(table, row, key) for key in HEADERS['employees']}
                refs['ratePerHourMinor'] = refs['rate_per_hour_minor']
                employees[eid] = Employee(id=eid, name=name, initials=''.join(part[0] for part in name.split()[:2]).upper(),
                    roles=roles, rate_per_hour_minor=rate, max_weekly_minutes=maximum, availability={}, source_refs=refs)
    if table := tables.get('schedule'):
        for row, values in table.rows:
            count_before = len(issues)
            sid = text_value(values.get('shift_id', ''), table, row, 'shift_id', True)
            eid = text_value(values.get('employee_id', ''), table, row, 'employee_id', True)
            role = text_value(values.get('role', ''), table, row, 'role')
            start = date_value(values.get('starts_at', ''), table, row, 'starts_at')
            end = date_value(values.get('ends_at', ''), table, row, 'ends_at')
            if values.get('pinned') not in ['true', 'false']:
                issue('boolean', 'Закрепление задаётся как true или false.', table, row, 'pinned')
            if eid not in employees:
                issue('unknown_employee', 'В смене указан отсутствующий ID сотрудника.', table, row, 'employee_id')
            if sid in shift_ids:
                issue('duplicate_shift', 'Повторный ID смены; строки не объединяются.', table, row, 'shift_id')
            if start and end and not 0 < (end.astimezone(dt_timezone.utc) - start.astimezone(dt_timezone.utc)).total_seconds() <= 86400:
                issue('duration', 'Смена должна длиться от 1 минуты до 24 часов.', table, row, 'ends_at')
            if len(issues) == count_before and sid and eid and role and start and end:
                shift_ids.add(sid)
                shifts.append(Shift(id=sid, employee_id=eid, role=role, starts_at=start.isoformat(timespec='seconds'),
                    ends_at=end.isoformat(timespec='seconds'), pinned=values['pinned'] == 'true', source_row=row,
                    source_refs={key: _ref(table, row, key) for key in HEADERS['schedule']}))
    if shifts and zone:
        weeks = {datetime.fromisoformat(shift.starts_at).astimezone(zone).isocalendar()[:2] for shift in shifts}
        if len(weeks) > 1:
            issue('week_range', 'В первой версии импортируется одна календарная неделя.')
    availability: dict[tuple[str, str], tuple[str, SourceRef]] = {}
    if table := tables.get('availability'):
        for row, values in table.rows:
            eid, sid, value = values.get('employee_id'), values.get('shift_id'), values.get('availability')
            if eid not in employees:
                issue('unknown_employee', 'Неизвестный ID сотрудника в доступности.', table, row, 'employee_id')
            if sid not in shift_ids:
                issue('unknown_shift', 'Неизвестный ID смены в доступности.', table, row, 'shift_id')
            if value not in ['available', 'unavailable', 'unknown']:
                issue('availability', 'Допустимы available, unavailable, unknown.', table, row, 'availability')
            if (eid, sid) in availability:
                issue('duplicate_availability', 'Повторная пара сотрудник–смена.', table, row, 'shift_id')
            elif eid in employees and sid in shift_ids and value in ['available', 'unavailable', 'unknown']:
                availability[eid, sid] = value, _ref(table, row, 'availability')
    if len(employees) * len(shifts) > LIMITS['availability']:
        issue('matrix_limit', f'Нормализованная матрица доступности превышает {LIMITS["availability"]} пар. Сократите недельный набор.')
        return ParsedImport(None, issues, row_counts, preview_rows)
    normalized_employees = []
    missing = 0
    for employee in employees.values():
        states, refs = {}, dict(employee.source_refs)
        for shift in shifts:
            entry = availability.get((employee.id, shift.id))
            states[shift.id] = entry[0] if entry else 'unknown'
            if entry:
                refs[f'availability.{shift.id}'] = entry[1]
            if not entry or entry[0] == 'unknown':
                missing += 1
        normalized_employees.append(employee.model_copy(update={'availability': states, 'source_refs': refs}))
    if missing:
        issue('unknown_availability', f'Доступность неизвестна для {missing} пар сотрудник–смена; это не разрешение на назначение.', severity='warning')
    if any(employee.rate_per_hour_minor is None for employee in employees.values()):
        issue('unknown_rate', 'Есть неизвестные ставки. Денежная оценка затронутых назначений будет недоступна.', severity='warning')
    if not shifts or not employees:
        issue('empty_data', 'Нужны непустые таблицы сотрудников и смен.')
    source = None
    if not any(item.severity == 'error' for item in issues):
        schedule_table = tables['schedule']
        source = NormalizedSource(filename=schedule_table.original.filename, team_name=team_name,
            timezone=timezone, currency=currency, employees=normalized_employees, shifts=shifts)
        for kind, rows in source_tables(source).items():
            if len(csv_bytes(rows)) > MAX_FILE_BYTES:
                issue('normalized_size', f'Таблица {kind} после нормализации превышает 5 МБ и не сможет пройти повторный импорт.', tables.get(kind))
        if any(item.severity == 'error' for item in issues):
            source = None
    return ParsedImport(source, issues, row_counts, preview_rows)


def _ref(table, row, column):
    return SourceRef(file_id=table.original.id, filename=table.original.filename, sheet=table.sheet, row=row, column=column)


def _table(kind, original, sheet, values, issue):
    table = Table(kind, original, sheet, [], max(len(values) - 1, 0))
    if not values:
        issue('empty_file', 'Файл или лист пуст.', table)
        return table
    header = values[0][1]
    if len(set(header)) != len(header):
        issue('duplicate_columns', 'Заголовки столбцов повторяются.', table, values[0][0])
        return table
    missing = set(HEADERS[kind]) - set(header)
    extra = set(header) - set(HEADERS[kind])
    if missing or extra:
        issue('columns', f'Отсутствуют столбцы: {", ".join(sorted(missing)) or "—"}; неизвестны: {", ".join(sorted(extra)) or "—"}.', table, values[0][0])
        return table
    for row, cells in values[1:]:
        if len(cells) != len(header):
            issue('row_width', 'Число ячеек не совпадает с заголовком; строка не будет молча обрезана.', table, row)
            continue
        table.rows.append((row, dict(zip(header, cells))))
    return table
