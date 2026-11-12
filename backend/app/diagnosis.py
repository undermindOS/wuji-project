"""Names the conditions behind a proven impossibility. Nothing found here is ever published.

CP-SAT assumptions only propose which conditions conflict, on a model built for that purpose: the
main model never carries them, because assumption literals can shift the deterministic choice of
assignments. Every statement a person reads is then settled by an ordinary solve on inputs with
those conditions lifted. That solve uses the main model, and a schedule found there has passed the
independent validator, so a mistake in this file can lose the explanation but cannot invent one.
"""
from datetime import datetime
from typing import NamedTuple

from ortools.sat.python import cp_model

from .schemas import ConflictCondition, Employee, SolveIssue

# Reading order. A conflict is narrowed from the end, so it is left with what a person entered
# rather than with facts about everyone else.
KINDS = ('source_pin', 'fixed_assignment', 'absence', 'coverage', 'role', 'availability', 'hours')
NO_LIMIT = 10 ** 9
NAMED_IN_FULL = 6


class Inconclusive(Exception):
    """No time left, or the searches disagree: the general answer stays."""


class Condition(NamedTuple):
    kind: str
    shift_id: str | None = None
    employee_id: str | None = None
    role: str | None = None


def reading_order(condition):
    return KINDS.index(condition.kind), condition.shift_id or '', condition.role or '', condition.employee_id or ''


def span(shift):
    return int(datetime.fromisoformat(shift.starts_at).timestamp() / 60), int(datetime.fromisoformat(shift.ends_at).timestamp() / 60)


def unknown_confirmed(source):
    """The wider problem that holds every way the unknowns can turn out."""
    if all(e.availability.get(s.id, 'unknown') != 'unknown' for e in source.employees for s in source.shifts):
        return source
    return source.model_copy(update={'employees': [e.model_copy(update={'availability': {
        s.id: 'available' if e.availability.get(s.id, 'unknown') == 'unknown' else e.availability[s.id]
        for s in source.shifts}}) for e in source.employees]})


def conflict_finder(source, task):
    """All conditions of the inputs, and a way to propose some that cannot hold together."""
    spans = {s.id: span(s) for s in source.shifts}
    origin = min(start for start, _ in spans.values())
    model = cp_model.CpModel()
    taken = {(s.id, e.id): model.new_bool_var(s.id + '/' + e.id) for s in source.shifts for e in source.employees}
    holds = {}

    def literal(*fields):
        condition = Condition(*fields)
        if condition not in holds:
            holds[condition] = model.new_bool_var(str(condition))
        return holds[condition]

    away = [(sid, spans[sid]) for sid in task.absence.shift_ids] if task.absence else []
    for s in source.shifts:
        row = [taken[s.id, e.id] for e in source.employees]
        model.add_at_most_one(row)
        model.add_bool_or([*row, literal('coverage', s.id).negated()])
        if s.pinned:
            model.add_implication(literal('source_pin', s.id, s.employee_id), taken[s.id, s.employee_id])
        if s.id in task.fixed_assignments:
            eid = task.fixed_assignments[s.id]
            model.add_implication(literal('fixed_assignment', s.id, eid), taken[s.id, eid])
        for e in source.employees:
            if s.role not in e.roles:
                model.add_implication(literal('role', None, e.id, s.role), taken[s.id, e.id].negated())
            if e.availability.get(s.id) == 'unavailable':
                model.add_implication(literal('availability', s.id, e.id), taken[s.id, e.id].negated())
        for sid, (start, end) in away:
            if spans[s.id][0] < end and start < spans[s.id][1]:
                model.add_implication(literal('absence', sid, task.absence.employee_id), taken[s.id, task.absence.employee_id].negated())
    for e in source.employees:
        model.add_no_overlap([model.new_optional_fixed_size_interval_var(spans[s.id][0] - origin, spans[s.id][1] - spans[s.id][0],
            taken[s.id, e.id], 'interval/' + s.id + '/' + e.id) for s in source.shifts])
        model.add(sum((spans[s.id][1] - spans[s.id][0]) * taken[s.id, e.id] for s in source.shifts) <= e.max_weekly_minutes
            ).only_enforce_if(literal('hours', None, e.id))

    def propose(active, run):
        ordered = sorted(active, key=reading_order)
        model.clear_assumptions()
        model.add_assumptions([holds[c] for c in ordered])
        solver, status = run(model)
        if status != 'INFEASIBLE':
            raise Inconclusive('the time limit was reached' if status == 'UNKNOWN' else 'conflict search disagreed with the main problem')
        found = set(solver.sufficient_assumptions_for_infeasibility())
        return [c for c in ordered if holds[c].index in found]

    return set(holds), propose


def without(source, task, lifted):
    """The same inputs with these conditions lifted; each lift is an edit a person could make."""
    def shifts_of(kind):
        return {c.shift_id for c in lifted if c.kind == kind}

    unpinned, released, present, uncovered = shifts_of('source_pin'), shifts_of('fixed_assignment'), shifts_of('absence'), shifts_of('coverage')
    unlimited = {c.employee_id for c in lifted if c.kind == 'hours'}
    gained, allowed = {}, {}
    for c in lifted:
        if c.kind == 'role':
            gained.setdefault(c.employee_id, []).append(c.role)
        elif c.kind == 'availability':
            allowed.setdefault(c.employee_id, {})[c.shift_id] = 'available'
    fixed = {sid: eid for sid, eid in task.fixed_assignments.items() if sid not in released}
    absent = [sid for sid in task.absence.shift_ids if sid not in present] if task.absence else []
    # A shift that needs no one can only leave the inputs if no remaining condition points at it.
    named = {s.id for s in source.shifts if s.pinned and s.id not in unpinned} | set(fixed) | set(absent)
    stand_ins = [Employee(id='\0' + s.id, name='', initials='', roles=[s.role], rate_per_hour_minor=None, max_weekly_minutes=NO_LIMIT,
        availability={s.id: 'available'}) for s in source.shifts if s.id in uncovered and s.id in named]
    return source.model_copy(update={
        'shifts': [s.model_copy(update={'pinned': s.pinned and s.id not in unpinned}) for s in source.shifts if s.id not in uncovered or s.id in named],
        'employees': [*(e.model_copy(update={'roles': [*e.roles, *gained.get(e.id, [])], 'availability': {**e.availability, **allowed.get(e.id, {})},
            'max_weekly_minutes': NO_LIMIT if e.id in unlimited else e.max_weekly_minutes}) for e in source.employees), *stand_ins]
    }), task.model_copy(update={'fixed_assignments': fixed, 'objective': 'min_changes',
        'absence': task.absence.model_copy(update={'shift_ids': absent}) if absent else None})


def listed(items):
    return ', '.join([*items[:NAMED_IN_FULL], *([f'{len(items) - NAMED_IN_FULL} more'] if len(items) > NAMED_IN_FULL else [])])


def people(names):
    return ('employee ' if len(names) == 1 else 'employees ') + listed(names)


def duration(minutes):
    hours, rest = divmod(minutes, 60)
    return ' '.join(([f'{hours} h'] if hours or not rest else []) + ([f'{rest} min'] if rest else []))


def clause(group, source):
    first, name = group[0], {e.id: e.name for e in source.employees}
    limits = {e.id: e.max_weekly_minutes for e in source.employees}
    names = [name[c.employee_id] for c in group if c.employee_id]
    return {
        'source_pin': lambda: f'source pin assigning shift {first.shift_id} to employee {names[0]}',
        'fixed_assignment': lambda: f'constraint pin assigning shift {first.shift_id} to employee {names[0]}',
        'absence': lambda: f'employee {names[0]} absent during shift {first.shift_id}',
        'coverage': lambda: ('requirement to cover shift ' if len(group) == 1 else 'requirement to cover shifts ') + listed([c.shift_id for c in group]),
        'role': lambda: f'missing role “{first.role}” for {people(names)}',
        'availability': lambda: f'unavailability of {people(names)} during shift {first.shift_id}',
        'hours': lambda: f'hour limit for {people(names)}: {duration(limits[first.employee_id])} per week',
    }[first.kind]()


def grouped(conflict, checks, source):
    limits = {e.id: e.max_weekly_minutes for e in source.employees}
    groups = {}
    for c in conflict:
        same = {'role': (c.kind, c.role), 'availability': (c.kind, c.shift_id), 'coverage': (c.kind,), 'hours': (c.kind, limits.get(c.employee_id))}.get(c.kind, c)
        groups.setdefault((same, checks[c]), []).append(c)
    return list(groups.values())


def overlaps(conflict, source):
    named = {c.shift_id for c in conflict}
    spans = [(s.id, *span(s)) for s in source.shifts if s.id in named]
    return [f'{a} and {b}' for i, (a, start, end) in enumerate(spans) for b, other_start, other_end in spans[i + 1:] if start < other_end and other_start < end]


def verdict(groups, checks, others, together):
    scope = ' with the other conflicts removed' if others else ''
    if all(checks[group[0]] == 'solution' for group in groups):
        return f'Verified{scope}: removing any one of these constraints makes a solution feasible.'
    outcomes = {'solution': 'a solution becomes feasible', 'solution_if_confirmed': 'a solution becomes feasible only if unknown availability is confirmed',
        'no_solution': 'there is still no solution'}
    parts = []
    for outcome, words in outcomes.items():
        points = [number for number, group in enumerate(groups, 1) if checks[group[0]] == outcome]
        if len(points) == 1 and len(groups[points[0] - 1]) == 1:
            parts.append(f'without constraint {points[0]}, {words}')
        elif points:
            parts.append(f'without any one of constraints {", ".join(map(str, points))}, {words}')
    tail = ''
    if all(checks[group[0]] == 'no_solution' for group in groups):
        tail = f' With all these constraints removed together{scope}, {outcomes[together]}.'
    return f'Verified{scope}: ' + '; '.join(parts) + '.' + tail


def code_of(conflict):
    kinds = sorted(c.kind for c in conflict)
    if kinds == ['absence', 'source_pin']:
        return 'pinned_absence'
    if kinds == ['absence', 'fixed_assignment']:
        return 'fixed_absence'
    if kinds == ['fixed_assignment', 'source_pin'] and conflict[0].shift_id == conflict[1].shift_id:
        return 'fixed_pin_conflict'
    return 'conflict'


def references(condition, source):
    shift = next((s for s in source.shifts if s.id == condition.shift_id), None)
    employee = next((e for e in source.employees if e.id == condition.employee_id), None)
    cells = {'source_pin': (shift, ['employee_id', 'pinned']), 'coverage': (shift, ['shift_id']), 'role': (employee, ['roles']),
        'availability': (employee, ['availability.' + str(condition.shift_id)]), 'hours': (employee, ['max_weekly_minutes'])}
    holder, keys = cells.get(condition.kind, (None, []))
    return [holder.source_refs[key] for key in keys if holder and key in holder.source_refs]


def report(conflict, checks, position, total, together, source, unknown):
    groups = grouped(conflict, checks, source)
    crossing = overlaps(conflict, source)
    lines = [(f'Conflict {position} of {total}. ' if total > 1 else '') + 'These constraints cannot be satisfied together:',
        ';\n'.join(f'{number}) {clause(group, source)}' for number, group in enumerate(groups, 1)) + '.',
        *(['There is no solution even if all unknown availability is confirmed.'] if unknown else []),
        *(['Overlapping shifts: ' + listed(crossing) + '.'] if crossing else []),
        verdict(groups, checks, total > 1, together)]
    return SolveIssue(code=code_of(conflict), message='\n'.join(lines),
        shift_ids=sorted({c.shift_id for c in conflict if c.shift_id}), employee_ids=sorted({c.employee_id for c in conflict if c.employee_id}),
        source_refs=[ref for c in conflict for ref in references(c, source)][:100],
        conditions=[ConflictCondition(kind=c.kind, shift_id=c.shift_id, employee_id=c.employee_id, role=c.role, removal_check=checks[c]) for c in conflict])


def explain(source, task, exists, run, unknown, event):
    """The conflicts behind a proven impossibility as issues; Inconclusive if they cannot all be proven."""
    wide = unknown_confirmed(source)
    everything, propose = conflict_finder(wide, task)

    def settled(result):
        if result.outcome not in {'solutions', 'infeasible'}:
            raise Inconclusive('the time limit was reached' if result.outcome == 'limit' else 'validation did not confirm the result')
        return result.scenarios[0].scenario.assignments if result.scenarios else None

    def schedule_without(inputs, lifted, close_to=None, free=()):
        """A validated schedule once these conditions are lifted, or None when none exists."""
        relaxed, conditions = without(inputs, task, lifted)
        if not relaxed.shifts:
            return {}
        if close_to is not None:
            # Keeping the shifts outside the conflict is a stricter task, so a schedule found here
            # counts and costs next to nothing. Failing proves nothing: the full search follows.
            staff = {e.id for e in relaxed.employees}
            kept = {s.id: close_to[s.id] for s in relaxed.shifts if s.id not in free and close_to.get(s.id) in staff}
            nearby = exists(relaxed, conditions.model_copy(update={'fixed_assignments': {**kept, **conditions.fixed_assignments}}))
            if nearby.scenarios:
                return nearby.scenarios[0].scenario.assignments
        return settled(exists(relaxed, conditions))

    def narrowed(core):
        if schedule_without(wide, everything.difference(core)) is not None:
            raise Inconclusive('validation did not confirm the proposed conflict')
        kept = list(core)
        for condition in sorted(core, key=reading_order, reverse=True):
            rest = [c for c in kept if c != condition]
            if schedule_without(wide, everything.difference(rest)) is None:
                kept = rest
        return sorted(kept, key=reading_order)

    def after_removal(lifted, close_to=None, free=()):
        found = schedule_without(source, lifted, close_to, free)
        if found is not None:
            return 'solution', found
        found = schedule_without(wide, lifted, close_to, free) if wide is not source else None
        return 'no_solution' if found is None else 'solution_if_confirmed', found

    conflicts, lifted, together = [], set(), 'no_solution'
    while together == 'no_solution':
        conflicts.append(narrowed(propose(everything - lifted, run)))
        lifted |= set(conflicts[-1])
        together, reference = after_removal(lifted)
    issues = []
    for position, conflict in enumerate(conflicts, 1):
        free = {c.shift_id for c in conflict}
        checks = {c: after_removal((lifted - set(conflict)) | {c}, reference, free)[0] for c in conflict}
        issues.append(report(conflict, checks, position, len(conflicts), together, source, unknown))
    event('diagnosis', f'Conflict diagnosis: {len(conflicts)} conflicts; removal tested for {len(lifted)} constraints.')
    return issues
