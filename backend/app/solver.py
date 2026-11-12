"""Bounded CP-SAT schedule repair. Only explicit, saved conditions are used."""
import time
from datetime import datetime
from uuid import uuid4

from ortools.sat.python import cp_model

from .diagnosis import Inconclusive, explain, unknown_confirmed
from .schemas import CalculatedScenario, Scenario, SearchAttempt, SolveIssue, SolveResult
from .validator import evaluate
from .engine_info import ENGINE_VERSION


class CalculationCancelled(Exception):
    pass


def input_problem(source, task):
    ids, employees = {s.id for s in source.shifts}, {e.id for e in source.employees}
    if not ids or not employees or len(ids) != len(source.shifts) or len(employees) != len(source.employees):
        return 'Empty or duplicate IDs in the inputs.'
    if task.source_version_id != source.id or any(s.employee_id not in employees for s in source.shifts):
        return 'Input versions or references do not match.'
    if len(ids) * len(employees) > 50_000:
        return 'The employee–shift matrix exceeds 50,000 cells.'
    if task.absence and (task.absence.employee_id not in employees or not task.absence.shift_ids
        or len(set(task.absence.shift_ids)) != len(task.absence.shift_ids)
        or any(sid not in ids for sid in task.absence.shift_ids)):
        return 'Invalid reference in the absence constraint.'
    if any(sid not in ids or eid not in employees for sid, eid in task.fixed_assignments.items()):
        return 'Invalid reference in the pinned assignments.'
    for s in source.shifts:
        try:
            a, b = datetime.fromisoformat(s.starts_at), datetime.fromisoformat(s.ends_at)
            duration = b.timestamp() - a.timestamp()
            if a.utcoffset() is None or b.utcoffset() is None or duration <= 0 or duration > 86400 or a.second or a.microsecond or b.second or b.microsecond:
                return 'Shift start and end must define an exact minute interval with a time zone.'
        except (ValueError, OverflowError):
            return 'Invalid shift time.'
    if any(e.max_weekly_minutes < 0 or e.max_weekly_minutes > 10080 or
        (e.rate_per_hour_minor is not None and not 0 <= e.rate_per_hour_minor <= 1_000_000_000) for e in source.employees):
        return 'Time limits or rates are outside the supported range.'
    return None


def solve(source, task, max_seconds=10, cancelled=lambda: False, on_solver=lambda solver: None, event=lambda code, message: None, probe=False):
    """With probe, only asks whether a validated schedule exists for exactly these inputs: the same
    model and the same validator, no objective, no question about unknowns, no explanation."""
    started = time.monotonic()
    deadline = started + max_seconds
    attempts, scenarios, issues = [], [], []

    def finish(outcome):
        return SolveResult(outcome=outcome, scenarios=scenarios, attempts=attempts, issues=issues,
            elapsed_ms=round((time.monotonic() - started) * 1000))

    def checkpoint():
        if cancelled():
            raise CalculationCancelled()

    problem = None if probe else input_problem(source, task)
    if problem:
        issues.append(SolveIssue(code='invalid_input', message=problem))
        return finish('invalid')
    checkpoint()
    durations = {s.id: int((datetime.fromisoformat(s.ends_at).timestamp() - datetime.fromisoformat(s.starts_at).timestamp()) / 60) for s in source.shifts}
    starts = {s.id: int(datetime.fromisoformat(s.starts_at).timestamp() / 60) for s in source.shifts}
    origin = min(starts.values())
    absence_ranges = [(starts[sid], starts[sid] + durations[sid]) for sid in task.absence.shift_ids] if task.absence else []
    def absent_for(eid, sid):
        return bool(task.absence and task.absence.employee_id == eid and
            any(starts[sid] < end and start < starts[sid] + durations[sid] for start, end in absence_ranges))
    model = cp_model.CpModel()
    choices, unknown = {}, []
    intervals = {e.id: [] for e in source.employees}
    employee_minutes = {e.id: [] for e in source.employees}
    cost_terms = []
    costs_known = all(e.rate_per_hour_minor is not None for e in source.employees)
    original_employee = {s.id: s.employee_id for s in source.shifts}
    for s in source.shifts:
        checkpoint()
        variables = []
        for e in source.employees:
            absent = absent_for(e.id, s.id)
            if (s.role not in e.roles or absent or (s.pinned and e.id != s.employee_id)
                or (s.id in task.fixed_assignments and task.fixed_assignments[s.id] != e.id)):
                continue
            availability = e.availability.get(s.id, 'unknown')
            if availability == 'unknown':
                if durations[s.id] <= e.max_weekly_minutes:
                    unknown.append((s, e))
                continue
            if availability != 'available':
                continue
            v = model.new_bool_var(s.id + '/' + e.id)
            choices[s.id, e.id] = v
            variables.append(v)
            intervals[e.id].append(model.new_optional_fixed_size_interval_var(starts[s.id] - origin, durations[s.id], v, 'interval/' + s.id + '/' + e.id))
            employee_minutes[e.id].append(durations[s.id] * v)
            if costs_known:
                cost_terms.append(((durations[s.id] * e.rate_per_hour_minor + 30) // 60) * v)
        model.add_exactly_one(variables)
        if s.pinned:
            original = choices.get((s.id, s.employee_id))
            model.add_linear_constraint(original if original is not None else 0, 1, 1)
        if s.id in task.fixed_assignments:
            fixed = choices.get((s.id, task.fixed_assignments[s.id]))
            model.add_linear_constraint(fixed if fixed is not None else 0, 1, 1)
    for e in source.employees:
        model.add_linear_constraint(sum(employee_minutes[e.id]), 0, e.max_weekly_minutes)
        if len(intervals[e.id]) > 1:
            model.add_no_overlap(intervals[e.id])
    change_expr = sum(v for (sid, eid), v in choices.items() if original_employee[sid] != eid)
    cost_expr = sum(cost_terms)
    if not costs_known:
        issues.append(SolveIssue(code='cost_priority_unavailable', message='The cost objective is disabled: all employee rates are required. Hours and reassignments are still calculated.'))
    direct_conflict = False
    for s in source.shifts:
        # Contradictions that can be named exactly. This list is about wording, not soundness: any
        # other impossibility is settled by no_clarification_can_help below.
        fixed = task.fixed_assignments.get(s.id)
        if s.pinned and absent_for(s.employee_id, s.id):
            direct_conflict = True
            issues.append(SolveIssue(code='pinned_absence', message='A shift is pinned to an absent employee. Both required constraints are preserved.',
                shift_ids=[s.id], employee_ids=[s.employee_id], source_refs=list(s.source_refs.values())))
        if fixed is not None and absent_for(fixed, s.id):
            direct_conflict = True
            issues.append(SolveIssue(code='fixed_absence', message='A pin in the constraints assigns a shift to an absent employee. Both required constraints are preserved.',
                shift_ids=[s.id], employee_ids=[fixed], source_refs=list(s.source_refs.values())))
        if fixed is not None and s.pinned and fixed != s.employee_id:
            direct_conflict = True
            issues.append(SolveIssue(code='fixed_pin_conflict', message='A pin in the constraints names a different employee than the source pin. Both required constraints are preserved.',
                shift_ids=[s.id], employee_ids=sorted({s.employee_id, fixed}), source_refs=list(s.source_refs.values())))

    def run(current_model, seconds, light=probe):
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = max(0, seconds)
        solver.parameters.num_search_workers = 1
        solver.parameters.random_seed = 0
        if light:
            # A question beside the main search: half the cost at 50×100, and the same model.
            solver.parameters.cp_model_probing_level = 0
        on_solver(solver)
        checkpoint()
        try:
            status = solver.solve(current_model)
        finally:
            on_solver(None)
        checkpoint()
        return solver, solver.status_name(status)

    def search(current_model, priority, phase, expr, seconds):
        checkpoint()
        if not probe:
            current_model.minimize(expr)
        solver, name = run(current_model, seconds)
        assignments = None
        if name in {'OPTIMAL', 'FEASIBLE'}:
            assignments = {sid: eid for (sid, eid), var in choices.items() if solver.value(var)}
        attempts.append(SearchAttempt(priority=priority, phase=phase, status=name,
            objective_value=solver.value(expr) if assignments is not None else None,
            elapsed_ms=round(solver.wall_time * 1000)))
        event('search', priority + ' / ' + phase + ': ' + name)
        return name, assignments, solver.value(expr) if assignments is not None else None

    def probed(inputs, conditions):
        return solve(inputs, conditions, max_seconds=max(0, deadline - time.monotonic()), cancelled=cancelled, on_solver=on_solver, probe=True)

    def no_clarification_can_help():
        # Taking every unknown as available gives a wider problem that contains every way the unknowns
        # can turn out, so only its INFEASIBLE proves that asking cannot help. Running out of time here
        # proves nothing and keeps the question. Nothing found by this search is ever published.
        outcome = probed(unknown_confirmed(source), task.model_copy(update={'objective': 'min_changes'})).outcome
        event('search', 'Assuming all unknown availability is confirmed: '
            + {'infeasible': 'there is still no solution.', 'solutions': 'a solution becomes feasible.'}.get(outcome, 'the search was inconclusive.'))
        return outcome == 'infeasible'

    def within_budget(step):
        def guarded(*inputs):
            # At zero time CP-SAT still answers what presolve alone can settle.
            if time.monotonic() >= deadline:
                raise Inconclusive('the time limit was reached')
            return step(*inputs)
        return guarded

    def conflicts():
        try:
            return explain(source, task, within_budget(probed),
                within_budget(lambda current: run(current, deadline - time.monotonic(), light=True)), bool(unknown), event)
        except Inconclusive as reason:
            event('diagnosis', 'Conflict diagnosis stopped: ' + str(reason) + '. A general response was returned.')
            return []

    if task.objective == 'min_cost' and not costs_known:
        issues.append(SolveIssue(code='cost_required', message='The selected minimum-pay objective requires rates for all employees.'))
        return finish('needs_clarification')
    priorities = (['min_changes', 'min_cost'] if costs_known else ['min_changes']) if task.objective == 'compare' else [task.objective]
    for index, priority in enumerate(priorities):
        checkpoint()
        if index and time.monotonic() >= deadline:
            issues.append(SolveIssue(code='secondary_limit', message='The total time limit was reached before the second objective.'))
            break
        current = model.clone()
        primary, secondary = (change_expr, cost_expr) if priority == 'min_changes' else (cost_expr, change_expr)
        remaining = max(0, deadline - time.monotonic())
        # Reserve time for the other priority and deterministic secondary minimization.
        seconds = remaining / ((len(priorities) - index) * (2 if costs_known and not probe else 1))
        status, assignments, value = search(current, priority, 'primary', primary, seconds)
        if status == 'INFEASIBLE':
            if probe:
                return finish('infeasible')
            if unknown and not direct_conflict and not no_clarification_can_help():
                issues.append(SolveIssue(code='availability_unknown', message='No solution exists with confirmed availability. Clarify unknown availability; infeasibility is not asserted for those unknown values.',
                    shift_ids=sorted({s.id for s, e in unknown}), employee_ids=sorted({e.id for s, e in unknown}),
                    source_refs=[ref for s, e in unknown for ref in [e.source_refs.get('availability.' + s.id)] if ref is not None][:100]))
                return finish('needs_clarification')
            named = conflicts()
            if named:
                issues[:] = [i for i in issues if i.code not in {'pinned_absence', 'fixed_absence', 'fixed_pin_conflict'}] + named
            elif not direct_conflict:
                issues.append(SolveIssue(code='infeasible', message='Infeasibility proven with all required input constraints preserved'
                    + (', even if all unknown availability is confirmed' if unknown else '') + '. A minimal set of causes was not identified.'))
            return finish('infeasible')
        if status == 'MODEL_INVALID':
            issues.append(SolveIssue(code='model_invalid', message='CP-SAT rejected the data model. No option is returned.'))
            return finish('invalid')
        if assignments is None:
            continue
        if costs_known and not probe and status == 'OPTIMAL' and time.monotonic() < deadline:
            current.add_linear_constraint(primary, value, value)
            _, tied, _ = search(current, priority, 'tiebreak', secondary,
                max(0, deadline - time.monotonic()) / (len(priorities) - index))
            if tied is not None:
                assignments = tied
        scenario = Scenario(id=str(uuid4()), source_version_id=source.id, task_spec_id=task.id,
            label='Fewer reassignments' if priority == 'min_changes' else 'Lower pay',
            description='Priority: minimize changed assignments.' if priority == 'min_changes' else 'Priority: minimize pay at known rates.',
            assignments=assignments)
        validation, metrics, evidence = evaluate(source, task, scenario)
        if validation.status != 'pass':
            issues.append(SolveIssue(code='validation_failed', message='Independent validation rejected the result. No option is returned.'))
            scenarios.clear()
            return finish('invalid')
        if any(item.scenario.assignments == assignments for item in scenarios):
            event('duplicate', 'Both objectives produced identical assignments; the duplicate option is hidden.')
            continue
        scenarios.append(CalculatedScenario(scenario=scenario, priority=priority, search_status=status,
            validation=validation, metrics=metrics, evidence=evidence))
        event('validated', 'Independent validation: 7/7; option ' + scenario.label + '.')
    if not scenarios:
        issues.append(SolveIssue(code='search_limit', message='Search time limit reached without a result. Infeasibility was not proven.'))
    return finish('solutions' if scenarios else 'limit')
