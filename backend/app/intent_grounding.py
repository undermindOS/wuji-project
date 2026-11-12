"""Resolve quotations against immutable data. The model never supplies executable IDs."""
import re
import unicodedata
from datetime import date, datetime
from zoneinfo import ZoneInfo

from .schemas import Absence, IntentProposal, IntentReviewRule

OBJECTIVE_LABELS = {'compare': 'Compare priorities', 'min_changes': 'Fewer reassignments', 'min_cost': 'Lower pay'}
WEEKDAYS = [('понедельник', 'понедельн', 'monday'), ('вторник', 'вторник', 'tuesday'),
    ('среда', 'сред', 'wednesday'), ('четверг', 'четверг', 'thursday'),
    ('пятница', 'пятниц', 'friday'), ('суббота', 'суббот', 'saturday'), ('воскресенье', 'воскресен', 'sunday')]
MONTHS = ['январ', 'феврал', 'март', 'апрел', 'мая', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр']
ENGLISH_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']


def normal(value):
    return unicodedata.normalize('NFKC', value).casefold().replace('ё', 'е')


def words(value):
    return re.findall(r'[^\W\d_]+', normal(value))


def stem(value):
    return value[:-1] if len(value) > 3 and value[-1] in 'аяуюыеиь' else value


def resolve_employee(source, quote):
    exact = [e for e in source.employees if e.id == quote.strip()]
    if exact:
        return exact[0].id
    tokens = [stem(w) for w in words(quote)]
    matches = [e for e in source.employees if tokens and all(t in [stem(w) for w in words(e.name)] for t in tokens)]
    if len(matches) != 1:
        raise ValueError('Employee “' + quote + '” ' + ('was not found.' if not matches else 'is ambiguous. Specify a full name or ID.'))
    return matches[0].id


def resolve_scope(source, quote):
    text = normal(quote)
    source_ids = {normal(s.id) for s in source.shifts}
    if any(value not in source_ids for value in re.findall(r'\bs\d+\b', text)):
        raise ValueError('The request contains an unknown shift ID.')
    literal = [s.id for s in source.shifts if re.search(r'(?<![\w])' + re.escape(normal(s.id)) + r'(?![\w])', text)]
    if literal:
        remaining = text
        for sid in literal:
            remaining = re.sub(r'(?<![\w])' + re.escape(normal(sid)) + r'(?![\w])', '', remaining)
        temporal = r'\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}|\d{1,2}\.\d{2}|завтра|сегодня|следующ|tomorrow|today|next |' + '|'.join(pattern for day in WEEKDAYS for pattern in day[1:])
        temporal += '|' + '|'.join(r'\d+\s+' + month for month in MONTHS)
        temporal += '|' + '|'.join(ENGLISH_MONTHS)
        if re.search(temporal, remaining) and not set(literal).issubset(resolve_scope(source, remaining)):
            raise ValueError('The date or time conflicts with the specified shift IDs.')
        return literal
    if re.search(r'завтра|сегодня|послезавтра|следующ|tomorrow|today|next ', text):
        raise ValueError('Specify a date in the source week or shift IDs instead of a relative date.')
    zone = ZoneInfo(source.timezone)
    local = {s.id: (datetime.fromisoformat(s.starts_at).astimezone(zone), datetime.fromisoformat(s.ends_at).astimezone(zone)) for s in source.shifts}
    days = {start.date() for start, end in local.values()}
    selected = set()
    for value in re.findall(r'(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)', text):
        try:
            selected.add(date.fromisoformat(value))
        except ValueError:
            raise ValueError('Invalid date in the request.')
    for d in days:
        numeric = re.search(r'(?<!\d)' + str(d.day) + r'\.' + str(d.month).zfill(2) + r'(?!\d)', text)
        named = re.search(r'(?<!\d)' + str(d.day) + r'\s+' + MONTHS[d.month - 1], text)
        english_month = ENGLISH_MONTHS[d.month - 1]
        english_named = re.search(r'\b' + english_month + r'\s+' + str(d.day) + r'(?:st|nd|rd|th)?\b', text)
        english_named = english_named or re.search(r'(?<!\d)' + str(d.day) + r'(?:st|nd|rd|th)?\s+' + english_month + r'\b', text)
        if numeric or named or english_named or any(re.search(r'\b' + pattern, text) for pattern in WEEKDAYS[d.weekday()][1:]):
            selected.add(d)
    years = re.findall(r'(?<!\d)(20\d{2})(?!\d)', text)
    if not selected or len(selected) != 1 or not selected.issubset(days) or (years and any(int(y) != next(iter(selected)).year for y in years)):
        raise ValueError('Could not uniquely match the date to the source week. Specify YYYY-MM-DD or shift IDs.')
    day = next(iter(selected))
    time_values = re.findall(r'(?<![\d:])(\d{1,2}):(\d{2})(?![\d:])', text)
    if re.search(r'\d{1,2}:\d{2}:\d{2}', text):
        raise ValueError('Specify a full shift without seconds, or its ID.')
    if not time_values and re.search(r'\bс\s+\d{1,2}\s+до\s+\d{1,2}\b', text):
        time_values = [(h, '00') for h in re.search(r'\bс\s+(\d{1,2})\s+до\s+(\d{1,2})\b', text).groups()]
    if not time_values and re.search(r'\bfrom\s+\d{1,2}\s+to\s+\d{1,2}\b', text):
        time_values = [(h, '00') for h in re.search(r'\bfrom\s+(\d{1,2})\s+to\s+(\d{1,2})\b', text).groups()]
    if time_values:
        if len(time_values) != 2 or any(int(h) > 23 or int(m) > 59 for h, m in time_values):
            raise ValueError('One exact interval covering a full shift is required.')
        start_time, end_time = [f'{int(h):02}:{int(m):02}' for h, m in time_values]
        matched = [sid for sid, (start, end) in local.items() if start.date() == day and
            start.strftime('%H:%M') == start_time and end.strftime('%H:%M') == end_time and start.date() == end.date()]
        if not matched:
            raise ValueError('The time does not match a full shift. Specify the shift ID; splitting intervals is not supported yet.')
        return matched
    if any(start.date() != end.date() and (start.date() == day or end.date() == day) for start, end in local.values()):
        raise ValueError('The date overlaps an overnight shift. Specify full shift IDs to avoid automatically extending the absence.')
    return [sid for sid, (start, end) in local.items() if start.date() == day]


def policy_issues(request):
    text = normal(request)
    issues = []
    if re.search(r'(игнорир|не учитыва|отмени|отключи|сними|ignore|disregard|disable|remove|cancel).{0,55}(лимит|ограничен|доступност|квалификац|роль|исходн.{0,15}закреп|limit|constraint|availability|qualification|role|source.{0,15}pin)', text):
        issues.append('Required limits, roles, availability and source pins cannot be disabled.')
    if re.search(r'ставк.{0,30}\d|\d.{0,15}(руб.{0,8}(час|ч\b)|₽.{0,8}(час|ч\b))|выручк|прибыл|окупаем|увол|найми|увелич.{0,15}лимит|rate.{0,30}\d|revenue|profit|return on investment|\b(fire|hire)\b|increase.{0,35}limit', text):
        issues.append('Changes to rates, individual limits, team membership and business forecasts are outside this draft’s supported operations.')
    return issues


def ground(source, task, request, parsed):
    absence, fixed, objective = task.absence, dict(task.fixed_assignments), task.objective
    issues = policy_issues(request) + parsed.questions + parsed.unsupported
    quotes = {'absence': [], 'fixed': [], 'objective': []}
    if len(parsed.operations) > 20 or len(issues) > 20:
        issues.append('The request is too complex for one draft.')
        operations = []
    else:
        operations = parsed.operations
    absent_people = set()
    for op in operations:
        try:
            if not op.quote.strip() or op.quote not in request:
                raise ValueError('The operation has no exact quote from the request.')
            for value in [op.employee_quote, op.scope_quote]:
                if value is not None and (not value.strip() or value not in op.quote):
                    raise ValueError('The employee and scope must be quoted from the same request clause.')
            if op.kind != 'set_objective' and op.objective is not None:
                raise ValueError('Set the objective in a separate operation.')
            if op.kind == 'set_objective':
                if op.objective is None or op.employee_quote is not None or op.scope_quote is not None:
                    raise ValueError('Invalid objective parameters.')
                markers = {'compare': r'сравн|вариант|оба|дв[аеи]|compare|both|options',
                    'min_changes': r'меньше.{0,25}(перестанов|измен)|миним.{0,25}(перестанов|измен)|fewest|changes|fewer.{0,25}reassignments|minimi[sz]e.{0,25}reassignments',
                    'min_cost': r'меньше.{0,25}(оплат|стоим|затрат|расход)|дешев|эконом|миним.{0,25}(оплат|стоим|затрат|расход)|cheapest|cost|lower.{0,25}pay|minimi[sz]e.{0,25}pay'}
                if not re.search(markers[op.objective], normal(op.quote)):
                    raise ValueError('The selected objective is not supported by the quote.')
                objective = op.objective
                quotes['objective'].append(op.quote)
            elif op.kind == 'clear_absence':
                if not re.search(r'отмен|сними|снять|вернул|снова работ|clear|cancel', normal(op.quote)):
                    raise ValueError('Clearing an absence must be explicitly requested.')
                if op.scope_quote is not None:
                    raise ValueError('To change part of an absence, specify a new complete list of shifts.')
                if op.employee_quote:
                    eid = resolve_employee(source, op.employee_quote)
                    if absence and eid != absence.employee_id:
                        raise ValueError('The cancellation refers to a different employee than the saved absence.')
                absence = None
                quotes['absence'].append(op.quote)
            else:
                if op.scope_quote is None:
                    raise ValueError('Specify a date or shift IDs.')
                # Read all qualifiers, including time, in the quoted clause.
                shift_ids = resolve_scope(source, op.quote)
                if not shift_ids:
                    raise ValueError('There are no shifts in the specified scope.')
                if op.kind == 'remove_fixed':
                    if not re.search(r'сними|снять|убери|отмен|remove|unfix', normal(op.quote)):
                        raise ValueError('Removing a pinned assignment must be explicitly requested.')
                    if any(s.pinned for s in source.shifts if s.id in shift_ids):
                        raise ValueError('A source pin can only be removed by importing a new source.')
                    if op.employee_quote:
                        eid = resolve_employee(source, op.employee_quote)
                        if any(fixed.get(sid) not in {None, eid} for sid in shift_ids):
                            raise ValueError('The specified employee does not match the additional pinned assignment.')
                    for sid in shift_ids:
                        fixed.pop(sid, None)
                    quotes['fixed'].append(op.quote)
                else:
                    if op.employee_quote is None:
                        raise ValueError('Specify an employee.')
                    eid = resolve_employee(source, op.employee_quote)
                    if op.kind == 'set_absence':
                        if not re.search(r'отсутств|не выйд|не прид|не работ|не будет|выходн|боле|забол|absent|unavailable|sick|off', normal(op.quote)):
                            raise ValueError('No explicit absence instruction was found.')
                        absent_people.add(eid)
                        if len(absent_people) > 1:
                            raise ValueError('A constraint version currently supports one employee’s absence.')
                        if absence and absence.employee_id != eid:
                            raise ValueError('Another employee’s absence is already saved. Explicitly clear it first; simultaneous absences for multiple people are not supported yet.')
                        existing = absence.shift_ids if absence and absence.employee_id == eid and quotes['absence'] else []
                        absence = Absence(employee_id=eid, shift_ids=sorted(set(existing + shift_ids)))
                        quotes['absence'].append(op.quote)
                    else:
                        if not re.search(r'закреп|назнач|остав|сохран|assign|fix|keep', normal(op.quote)):
                            raise ValueError('An assignment must be explicitly requested.')
                        fixed.update({sid: eid for sid in shift_ids})
                        quotes['fixed'].append(op.quote)
        except ValueError as error:
            issues.append(str(error))
    if not operations and not issues:
        issues.append('No new constraints were recognized. Specify an employee, date/shift ID or objective.')
    if objective == 'min_cost' and any(e.rate_per_hour_minor is None for e in source.employees):
        issues.append('Minimizing pay requires known rates for all employees.')
    employees = {e.id: e.name for e in source.employees}
    shifts = {s.id: s for s in source.shifts}
    def shift_text(sid):
        s = shifts[sid]
        return sid + ' · ' + s.starts_at[:10] + ' ' + s.starts_at[11:16] + '–' + s.ends_at[11:16]
    absence_text = (employees[absence.employee_id] + ': ' + '; '.join(shift_text(sid) for sid in absence.shift_ids)) if absence else 'No absence specified.'
    fixed_text = '; '.join(sid + ' → ' + employees[eid] for sid, eid in sorted(fixed.items())) or 'No additional pinned assignments.'
    review = [
        IntentReviewRule(id='absence', label='Absence and intervals', detail=absence_text, quotes=quotes['absence'], changed=absence != task.absence),
        IntentReviewRule(id='fixed', label='Pinned assignments', detail=fixed_text, quotes=quotes['fixed'], changed=fixed != task.fixed_assignments),
        IntentReviewRule(id='objective', label='Calculation priority', detail=OBJECTIVE_LABELS[objective], quotes=quotes['objective'], changed=objective != task.objective),
        IntentReviewRule(id='safety', label='Required constraints are preserved', detail='Roles, confirmed availability, coverage, no overlaps, source pins and individual hour limits.', quotes=[], changed=False),
    ]
    return IntentProposal(absence=absence, fixed_assignments=fixed, objective=objective, review=review, issues=list(dict.fromkeys(issues)))
