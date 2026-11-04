"""Resolve quotations against immutable data. The model never supplies executable IDs."""
import re
import unicodedata
from datetime import date, datetime
from zoneinfo import ZoneInfo

from .schemas import Absence, IntentProposal, IntentReviewRule

OBJECTIVE_LABELS = {'compare': 'Сравнить приоритеты', 'min_changes': 'Меньше перестановок', 'min_cost': 'Меньше оплаты'}
WEEKDAYS = [('понедельник', 'понедельн', 'monday'), ('вторник', 'вторник', 'tuesday'),
    ('среда', 'сред', 'wednesday'), ('четверг', 'четверг', 'thursday'),
    ('пятница', 'пятниц', 'friday'), ('суббота', 'суббот', 'saturday'), ('воскресенье', 'воскресен', 'sunday')]
MONTHS = ['январ', 'феврал', 'март', 'апрел', 'мая', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр']


def normal(value):
    return unicodedata.normalize('NFKC', value).casefold().replace('ё', 'е')


def words(value):
    return re.findall(r'[^\W\d_]+', normal(value))


def stem(value):
    return value[:-1] if len(value) > 3 and value[-1] in 'аяуюыеиь' else value


def resolve_employee(source, quote):
    exact = [e for e in source.employees if normal(e.id) == normal(quote.strip())]
    if exact:
        return exact[0].id
    tokens = [stem(w) for w in words(quote)]
    matches = [e for e in source.employees if tokens and all(t in [stem(w) for w in words(e.name)] for t in tokens)]
    if len(matches) != 1:
        raise ValueError('Сотрудник «' + quote + '» ' + ('не найден.' if not matches else 'неоднозначен. Укажите полное имя или ID.'))
    return matches[0].id


def resolve_scope(source, quote):
    text = normal(quote)
    source_ids = {normal(s.id) for s in source.shifts}
    if any(value not in source_ids for value in re.findall(r'\bs\d+\b', text)):
        raise ValueError('В запросе указан неизвестный ID смены.')
    literal = [s.id for s in source.shifts if re.search(r'(?<![\w])' + re.escape(normal(s.id)) + r'(?![\w])', text)]
    if literal:
        remaining = text
        for sid in literal:
            remaining = re.sub(r'(?<![\w])' + re.escape(normal(sid)) + r'(?![\w])', '', remaining)
        temporal = r'\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}|\d{1,2}\.\d{2}|завтра|сегодня|следующ|' + '|'.join(day[1] for day in WEEKDAYS)
        temporal += '|' + '|'.join(r'\d+\s+' + month for month in MONTHS)
        if re.search(temporal, remaining) and not set(literal).issubset(resolve_scope(source, remaining)):
            raise ValueError('Дата или время противоречат указанным ID смен.')
        return literal
    if re.search(r'завтра|сегодня|послезавтра|следующ|tomorrow|today|next ', text):
        raise ValueError('Укажите дату исходной недели или ID смен вместо относительной даты.')
    zone = ZoneInfo(source.timezone)
    local = {s.id: (datetime.fromisoformat(s.starts_at).astimezone(zone), datetime.fromisoformat(s.ends_at).astimezone(zone)) for s in source.shifts}
    days = {start.date() for start, end in local.values()}
    selected = set()
    for value in re.findall(r'(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)', text):
        try:
            selected.add(date.fromisoformat(value))
        except ValueError:
            raise ValueError('Некорректная дата в запросе.')
    for d in days:
        numeric = re.search(r'(?<!\d)' + str(d.day) + r'\.' + str(d.month).zfill(2) + r'(?!\d)', text)
        named = re.search(r'(?<!\d)' + str(d.day) + r'\s+' + MONTHS[d.month - 1], text)
        if numeric or named or any(re.search(r'\b' + pattern, text) for pattern in WEEKDAYS[d.weekday()][1:]):
            selected.add(d)
    years = re.findall(r'(?<!\d)(20\d{2})(?!\d)', text)
    if not selected or len(selected) != 1 or not selected.issubset(days) or (years and any(int(y) != next(iter(selected)).year for y in years)):
        raise ValueError('Не удалось однозначно сопоставить дату с исходной неделей. Укажите YYYY-MM-DD или ID смен.')
    day = next(iter(selected))
    time_values = re.findall(r'(?<![\d:])(\d{1,2}):(\d{2})(?![\d:])', text)
    if re.search(r'\d{1,2}:\d{2}:\d{2}', text):
        raise ValueError('Укажите целую смену без секунд или её ID.')
    if not time_values and re.search(r'\bс\s+\d{1,2}\s+до\s+\d{1,2}\b', text):
        time_values = [(h, '00') for h in re.search(r'\bс\s+(\d{1,2})\s+до\s+(\d{1,2})\b', text).groups()]
    if time_values:
        if len(time_values) != 2 or any(int(h) > 23 or int(m) > 59 for h, m in time_values):
            raise ValueError('Нужен один точный интервал целой смены.')
        start_time, end_time = [f'{int(h):02}:{int(m):02}' for h, m in time_values]
        matched = [sid for sid, (start, end) in local.items() if start.date() == day and
            start.strftime('%H:%M') == start_time and end.strftime('%H:%M') == end_time and start.date() == end.date()]
        if not matched:
            raise ValueError('Время не совпадает с целой сменой. Укажите ID смены; разделение интервалов пока не поддержано.')
        return matched
    if any(start.date() != end.date() and (start.date() == day or end.date() == day) for start, end in local.values()):
        raise ValueError('Дата пересекает ночную смену. Уточните ID целых смен, чтобы не расширить отсутствие автоматически.')
    return [sid for sid, (start, end) in local.items() if start.date() == day]


def policy_issues(request):
    text = normal(request)
    issues = []
    if re.search(r'(игнорир|не учитыва|отмени|отключи|сними).{0,55}(лимит|ограничен|доступност|квалификац|роль|исходн.{0,15}закреп)', text):
        issues.append('Обязательные лимиты, роли, доступность и закрепления исходника не отключаются.')
    if re.search(r'ставк.{0,30}\d|\d.{0,15}(руб.{0,8}(час|ч\b)|₽.{0,8}(час|ч\b))|выручк|прибыл|окупаем|увол|найми|увелич.{0,15}лимит', text):
        issues.append('Изменение ставок, личных лимитов, состава команды и прогноз бизнеса не входят в операции этого черновика.')
    return issues


def ground(source, task, request, parsed):
    absence, fixed, objective = task.absence, dict(task.fixed_assignments), task.objective
    issues = policy_issues(request) + parsed.questions + parsed.unsupported
    quotes = {'absence': [], 'fixed': [], 'objective': []}
    if len(parsed.operations) > 20 or len(issues) > 20:
        issues.append('Запрос слишком сложен для одного черновика.')
        operations = []
    else:
        operations = parsed.operations
    absent_people = set()
    for op in operations:
        try:
            if not op.quote.strip() or op.quote not in request:
                raise ValueError('Для операции нет точной цитаты из запроса.')
            for value in [op.employee_quote, op.scope_quote]:
                if value is not None and (not value.strip() or value not in op.quote):
                    raise ValueError('Сотрудник и область действия должны быть процитированы из той же части запроса.')
            if op.kind != 'set_objective' and op.objective is not None:
                raise ValueError('Приоритет передаётся отдельной операцией.')
            if op.kind == 'set_objective':
                if op.objective is None or op.employee_quote is not None or op.scope_quote is not None:
                    raise ValueError('Некорректные параметры приоритета.')
                markers = {'compare': r'сравн|вариант|оба|дв[аеи]|compare|both',
                    'min_changes': r'меньше.{0,25}(перестанов|измен)|миним.{0,25}(перестанов|измен)|fewest|changes',
                    'min_cost': r'меньше.{0,25}(оплат|стоим|затрат|расход)|дешев|эконом|миним.{0,25}(оплат|стоим|затрат|расход)|cheapest|cost'}
                if not re.search(markers[op.objective], normal(op.quote)):
                    raise ValueError('Выбранный приоритет не подтверждён цитатой.')
                objective = op.objective
                quotes['objective'].append(op.quote)
            elif op.kind == 'clear_absence':
                if not re.search(r'отмен|сними|снять|вернул|снова работ|clear|cancel', normal(op.quote)):
                    raise ValueError('Отмена отсутствия должна быть явно указана.')
                if op.scope_quote is not None:
                    raise ValueError('Для изменения части отсутствия задайте новый полный список смен.')
                if op.employee_quote:
                    eid = resolve_employee(source, op.employee_quote)
                    if absence and eid != absence.employee_id:
                        raise ValueError('Отмена относится к другому сотруднику, чем сохранённое отсутствие.')
                absence = None
                quotes['absence'].append(op.quote)
            else:
                if op.scope_quote is None:
                    raise ValueError('Укажите дату или ID смен.')
                # Read all qualifiers, including time, in the quoted clause.
                shift_ids = resolve_scope(source, op.quote)
                if not shift_ids:
                    raise ValueError('В указанной области нет смен.')
                if op.kind == 'remove_fixed':
                    if not re.search(r'сними|снять|убери|отмен|remove|unfix', normal(op.quote)):
                        raise ValueError('Снятие закрепления должно быть явно указано.')
                    if any(s.pinned for s in source.shifts if s.id in shift_ids):
                        raise ValueError('Закрепление исходника снимается только через новую загрузку исходника.')
                    if op.employee_quote:
                        eid = resolve_employee(source, op.employee_quote)
                        if any(fixed.get(sid) not in {None, eid} for sid in shift_ids):
                            raise ValueError('Указанный сотрудник не совпадает с дополнительным закреплением.')
                    for sid in shift_ids:
                        fixed.pop(sid, None)
                    quotes['fixed'].append(op.quote)
                else:
                    if op.employee_quote is None:
                        raise ValueError('Укажите сотрудника.')
                    eid = resolve_employee(source, op.employee_quote)
                    if op.kind == 'set_absence':
                        if not re.search(r'отсутств|не выйд|не прид|не работ|не будет|выходн|боле|забол|absent|unavailable|sick|off', normal(op.quote)):
                            raise ValueError('Не найдено явное указание отсутствия.')
                        absent_people.add(eid)
                        if len(absent_people) > 1:
                            raise ValueError('Одна версия условий пока поддерживает отсутствие одного сотрудника.')
                        if absence and absence.employee_id != eid:
                            raise ValueError('Уже сохранено отсутствие другого сотрудника. Сначала явно отмените его; одновременные отсутствия нескольких людей пока не поддержаны.')
                        existing = absence.shift_ids if absence and absence.employee_id == eid and quotes['absence'] else []
                        absence = Absence(employee_id=eid, shift_ids=sorted(set(existing + shift_ids)))
                        quotes['absence'].append(op.quote)
                    else:
                        if not re.search(r'закреп|назнач|остав|сохран|assign|fix|keep', normal(op.quote)):
                            raise ValueError('Назначение должно быть явно запрошено.')
                        fixed.update({sid: eid for sid in shift_ids})
                        quotes['fixed'].append(op.quote)
        except ValueError as error:
            issues.append(str(error))
    if not operations and not issues:
        issues.append('Новых условий не распознано. Укажите сотрудника, дату/ID смены или приоритет.')
    if objective == 'min_cost' and any(e.rate_per_hour_minor is None for e in source.employees):
        issues.append('Для приоритета минимальной оплаты нужны известные ставки всех сотрудников.')
    employees = {e.id: e.name for e in source.employees}
    shifts = {s.id: s for s in source.shifts}
    def shift_text(sid):
        s = shifts[sid]
        return sid + ' · ' + s.starts_at[:10] + ' ' + s.starts_at[11:16] + '–' + s.ends_at[11:16]
    absence_text = (employees[absence.employee_id] + ': ' + '; '.join(shift_text(sid) for sid in absence.shift_ids)) if absence else 'Отсутствие не задано.'
    fixed_text = '; '.join(sid + ' → ' + employees[eid] for sid, eid in sorted(fixed.items())) or 'Дополнительных закреплений нет.'
    review = [
        IntentReviewRule(id='absence', label='Отсутствие и интервалы', detail=absence_text, quotes=quotes['absence'], changed=absence != task.absence),
        IntentReviewRule(id='fixed', label='Закреплённые назначения', detail=fixed_text, quotes=quotes['fixed'], changed=fixed != task.fixed_assignments),
        IntentReviewRule(id='objective', label='Приоритет расчёта', detail=OBJECTIVE_LABELS[objective], quotes=quotes['objective'], changed=objective != task.objective),
        IntentReviewRule(id='safety', label='Обязательные условия сохраняются', detail='Роли, подтверждённая доступность, покрытие, отсутствие пересечений, закрепления исходника и личные лимиты часов.', quotes=[], changed=False),
    ]
    return IntentProposal(absence=absence, fixed_assignments=fixed, objective=objective, review=review, issues=list(dict.fromkeys(issues)))
