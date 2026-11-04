"""Independent evaluation of a concrete schedule; no OR-Tools/model imports."""
from datetime import datetime, timezone

from .schemas import (
    AssignmentChange, ChangeEvidence, Scenario, ScenarioMetrics, SourceVersion, TaskSpec,
    ValidationCheck, ValidationReport,
)

VALIDATOR_VERSION = 'schedule-validator/1'


def minutes(shift):
    start = datetime.fromisoformat(shift.starts_at).astimezone(timezone.utc)
    end = datetime.fromisoformat(shift.ends_at).astimezone(timezone.utc)
    return int((end - start).total_seconds()) // 60


def cost(shift, employee):
    if employee is None or employee.rate_per_hour_minor is None:
        return None
    return (minutes(shift) * employee.rate_per_hour_minor + 30) // 60


def evaluate(source: SourceVersion, task: TaskSpec, scenario: Scenario):
    employees = {e.id: e for e in source.employees}
    shifts = {s.id: s for s in source.shifts}
    checks = []

    def check(id, label, failed, detail, unknown=()):
        checks.append(ValidationCheck(id=id, label=label, status='fail' if failed else 'unknown' if unknown else 'pass',
            detail=detail, shift_ids=sorted(set([*failed, *unknown]))))

    bad_refs = [sid for sid, eid in scenario.assignments.items() if sid not in shifts or eid not in employees]
    bad_refs += [s.id for s in source.shifts if s.employee_id not in employees]
    if (task.source_version_id != source.id or scenario.source_version_id != source.id or scenario.task_spec_id != task.id
        or len(shifts) != len(source.shifts) or len(employees) != len(source.employees)):
        bad_refs.append('version-or-id')
    if task.absence and (task.absence.employee_id not in employees or not task.absence.shift_ids
        or len(set(task.absence.shift_ids)) != len(task.absence.shift_ids)
        or any(sid not in shifts for sid in task.absence.shift_ids)):
        bad_refs.append('absence-reference')
    if any(sid not in shifts or eid not in employees for sid, eid in task.fixed_assignments.items()):
        bad_refs.append('fixed-reference')
    check('references', 'Версии и записи', bad_refs, 'Проверены версии исходника, условий и все ID.')
    uncovered = [s.id for s in source.shifts if scenario.assignments.get(s.id) not in employees]
    check('coverage', 'Покрытие смен', uncovered, 'Каждая исходная смена должна иметь одно назначение.')
    unavailable, unknown, wrong_roles, changed_pins = [], [], [], []
    totals = {eid: 0 for eid in employees}
    assigned = {eid: [] for eid in employees}
    changes, evidence, unknown_rates = [], [], set()
    total_cost, baseline_cost, cost_known, baseline_known = 0, 0, True, True
    absence_intervals = [(datetime.fromisoformat(shifts[sid].starts_at).timestamp(),
        datetime.fromisoformat(shifts[sid].ends_at).timestamp()) for sid in task.absence.shift_ids if sid in shifts] if task.absence else []
    for s in source.shifts:
        eid = scenario.assignments.get(s.id)
        e, before = employees.get(eid), employees.get(s.employee_id)
        old_cost = cost(s, before)
        if old_cost is None:
            baseline_known = False
        else:
            baseline_cost += old_cost
        if s.pinned and eid != s.employee_id:
            changed_pins.append(s.id)
        if s.id in task.fixed_assignments and eid != task.fixed_assignments[s.id]:
            changed_pins.append(s.id)
        if not e:
            cost_known = False
            continue
        available = e.availability.get(s.id, 'unknown')
        if task.absence and task.absence.employee_id == eid and any(
            datetime.fromisoformat(s.starts_at).timestamp() < end and start < datetime.fromisoformat(s.ends_at).timestamp()
            for start, end in absence_intervals):
            available = 'unavailable'
        if available == 'unknown':
            unknown.append(s.id)
        elif available != 'available':
            unavailable.append(s.id)
        if s.role not in e.roles:
            wrong_roles.append(s.id)
        totals[eid] += minutes(s)
        assigned[eid].append(s)
        new_cost = cost(s, e)
        if new_cost is None:
            cost_known = False
            unknown_rates.add(eid)
        else:
            total_cost += new_cost
        if eid != s.employee_id:
            changes.append(AssignmentChange(id=scenario.id + ':' + s.id, shift_id=s.id,
                before_employee_id=s.employee_id, after_employee_id=eid, source_row=s.source_row))
            refs = [s.source_refs.get('employee_id'), s.source_refs.get('role'),
                e.source_refs.get('availability.' + s.id), e.source_refs.get('roles'),
                e.source_refs.get('max_weekly_minutes'), e.source_refs.get('ratePerHourMinor'),
                before.source_refs.get('ratePerHourMinor') if before else None]
            evidence.append(ChangeEvidence(shift_id=s.id, before_employee_id=s.employee_id, after_employee_id=eid,
                duration_minutes=minutes(s), before_cost_minor=old_cost, after_cost_minor=new_cost,
                cost_delta_minor=new_cost - old_cost if new_cost is not None and old_cost is not None else None,
                source_refs=[r for r in refs if r is not None], rule_ids=[r.id for r in task.rules],
                check_ids=['references','coverage','availability','roles','pinned','hours','overlap'], task_spec_id=task.id))
    check('availability', 'Доступность', unavailable, 'Неизвестная доступность не считается разрешением.', unknown)
    check('roles', 'Роли сотрудников', wrong_roles, 'Роль назначенного сотрудника должна подходить для смены.')
    check('pinned', 'Закреплённые смены', changed_pins, 'Исходные закреплённые назначения сохраняются.')
    over = [s.id for eid, items in assigned.items() if totals[eid] > employees[eid].max_weekly_minutes for s in items]
    check('hours', 'Лимиты часов', over, 'Недельные минуты независимо суммированы по каждому сотруднику.')
    overlaps = set()
    for items in assigned.values():
        ordered = sorted(items, key=lambda s: datetime.fromisoformat(s.starts_at).timestamp())
        active = []
        for s in ordered:
            start = datetime.fromisoformat(s.starts_at).timestamp()
            active = [other for other in active if datetime.fromisoformat(other.ends_at).timestamp() > start]
            if active:
                overlaps.add(s.id)
                overlaps.update(other.id for other in active)
            active.append(s)
    check('overlap', 'Пересечения', overlaps, 'Проверены фактические интервалы UTC; соприкасающиеся смены разрешены.')
    status = 'fail' if any(c.status == 'fail' for c in checks) else 'unknown' if unknown else 'pass'
    metrics = ScenarioMetrics(changes=changes, affected_employee_ids=sorted({eid for c in changes for eid in (c.before_employee_id, c.after_employee_id)}),
        covered_shifts=len(source.shifts) - len(uncovered), total_shifts=len(source.shifts),
        total_minutes=sum(totals.values()), minutes_by_employee=totals,
        cost_minor=total_cost if cost_known else None, baseline_cost_minor=baseline_cost if baseline_known else None,
        cost_delta_minor=total_cost - baseline_cost if cost_known and baseline_known else None,
        unknown_rate_employee_ids=sorted(unknown_rates))
    return ValidationReport(status=status, validator_version=VALIDATOR_VERSION, checks=checks), metrics, evidence
