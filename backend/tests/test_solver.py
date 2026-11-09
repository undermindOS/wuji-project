from copy import deepcopy
import itertools
import random
import threading
import time

from ortools.sat.python import cp_model
import pytest

from app import diagnosis
from app.diagnosis import Condition
from app.schemas import Absence, Employee, Scenario, Shift, SourceVersion, TaskSpec
from app.solver import CalculationCancelled, solve
from app.validator import evaluate


@pytest.fixture
def inputs():
    employees = [Employee(id=eid, name=eid, initials=eid, roles=['worker'], rate_per_hour_minor=rate,
        max_weekly_minutes=720, availability={'s1': 'available', 's2': 'available'})
        for eid, rate in [('anna', 30000), ('bob', 20000), ('carol', 40000)]]
    source = SourceVersion(id='source', version=1, filename='week.csv', team_name='Example', timezone='Europe/Moscow', currency='RUB',
        employees=employees, shifts=[
            Shift(id='s1', starts_at='2026-11-02T09:00:00+03:00', ends_at='2026-11-02T17:00:00+03:00',
                role='worker', employee_id='anna', pinned=False, source_row=2),
            Shift(id='s2', starts_at='2026-11-02T13:00:00+03:00', ends_at='2026-11-02T17:00:00+03:00',
                role='worker', employee_id='bob', pinned=False, source_row=3)])
    task = TaskSpec(id='task', source_version_id='source', request='Anna absent', absence=Absence(employee_id='anna', shift_ids=['s1']), rules=[])
    return source, task


def test_priorities_match_exhaustive_feasible_frontier_and_manual_cost(inputs):
    source, task = inputs
    result = solve(source, task)
    assert result.outcome == 'solutions'
    minimal, cheap = result.scenarios
    assert minimal.scenario.assignments == {'s1': 'carol', 's2': 'bob'}
    assert cheap.scenario.assignments == {'s1': 'bob', 's2': 'carol'}
    assert len(minimal.metrics.changes) == 1 and minimal.metrics.cost_minor == 400000
    assert len(cheap.metrics.changes) == 2 and cheap.metrics.cost_minor == 320000
    assert minimal.metrics.total_minutes == cheap.metrics.total_minutes == 720
    assert minimal.metrics.baseline_cost_minor == 320000
    candidates = []
    for ids in itertools.product([e.id for e in source.employees], repeat=2):
        candidate = Scenario(id='trial', source_version_id=source.id, task_spec_id=task.id, label='', description='',
            assignments=dict(zip(['s1', 's2'], ids)))
        report, metrics, _ = evaluate(source, task, candidate)
        if report.status == 'pass':
            candidates.append((len(metrics.changes), metrics.cost_minor))
    assert (len(minimal.metrics.changes), minimal.metrics.cost_minor) == min(candidates)
    assert (cheap.metrics.cost_minor, len(cheap.metrics.changes)) == min((cost, changes) for changes, cost in candidates)
    assert all(s.search_status == 'OPTIMAL' and s.validation.status == 'pass' for s in result.scenarios)
    assert all(e.task_spec_id == task.id for s in result.scenarios for e in s.evidence)


def test_pins_are_never_relaxed_and_contradiction_is_proven(inputs):
    source, task = inputs
    source = source.model_copy(update={'shifts': [source.shifts[0].model_copy(update={'pinned': True}), source.shifts[1]]})
    result = solve(source, task)
    assert result.outcome == 'infeasible' and not result.scenarios
    assert result.attempts[0].status == 'INFEASIBLE'
    assert result.issues[0].code == 'pinned_absence'
    assert terms(result.issues[0]) == {('source_pin', 's1', 'anna', None): 'solution', ('absence', 's1', 'anna', None): 'solution'}


def test_condition_pin_on_an_absent_person_is_proven_not_blamed_on_unknown_availability(inputs):
    source, task = inputs
    source = source.model_copy(update={'employees': [
        e.model_copy(update={'availability': {'s1': 'available', 's2': 'unknown'}}) if e.id == 'carol' else e
        for e in source.employees]})
    task = task.model_copy(update={'fixed_assignments': {'s1': 'anna'}})
    result = solve(source, task)
    assert result.outcome == 'infeasible' and not result.scenarios
    assert not any(i.code == 'availability_unknown' for i in result.issues)
    conflict = [i for i in result.issues if i.code == 'fixed_absence']
    assert conflict and conflict[0].shift_ids == ['s1'] and conflict[0].employee_ids == ['anna']
    assert terms(conflict[0]) == {('fixed_assignment', 's1', 'anna', None): 'solution', ('absence', 's1', 'anna', None): 'solution'}


def test_condition_pin_contradicting_a_source_pin_is_reported_as_the_conflict_it_is(inputs):
    source, task = inputs
    source = source.model_copy(update={'shifts': [source.shifts[0].model_copy(update={'pinned': True}), source.shifts[1]]})
    task = task.model_copy(update={'absence': None, 'fixed_assignments': {'s1': 'bob'}})
    result = solve(source, task)
    assert result.outcome == 'infeasible' and not result.scenarios
    conflict = [i for i in result.issues if i.code == 'fixed_pin_conflict']
    assert conflict and conflict[0].shift_ids == ['s1'] and conflict[0].employee_ids == ['anna', 'bob']
    assert terms(conflict[0]) == {('source_pin', 's1', 'anna', None): 'solution', ('fixed_assignment', 's1', 'bob', None): 'solution'}


def with_unknown_on_another_shift(source):
    return source.model_copy(update={'employees': [
        e.model_copy(update={'availability': {'s1': 'available', 's2': 'unknown'}}) if e.id == 'carol' else e
        for e in source.employees]})


def conflict_in(result):
    named = [i for i in result.issues if i.conditions]
    assert len(named) == 1
    return named[0]


def terms(issue):
    return {(c.kind, c.shift_id, c.employee_id, c.role): c.removal_check for c in issue.conditions}


def on_separate_days(source):
    return source.model_copy(update={'shifts': [source.shifts[0], source.shifts[1].model_copy(update={
        'starts_at': '2026-11-03T09:00:00+03:00', 'ends_at': '2026-11-03T13:00:00+03:00'})]})


@pytest.mark.parametrize('pin,pin_kind', [('source', 'source_pin'), ('condition', 'fixed_assignment')])
@pytest.mark.parametrize('block,blocker,words', [
    ({'roles': ['other']}, ('role', None, 'bob', 'worker'), 'нет роли «worker» у сотрудника Bob'),
    ({'availability': {'s1': 'unavailable', 's2': 'available'}}, ('availability', 's1', 'bob', None), 'недоступность сотрудника Bob на смене s1'),
    ({'max_weekly_minutes': 60}, ('hours', None, 'bob', None), 'лимит часов сотрудника Bob: 1 ч в неделю')])
def test_pin_on_a_person_who_cannot_take_the_shift_names_both_conditions_whatever_the_unknowns_turn_out(inputs, pin, pin_kind, block, blocker, words):
    source, task = inputs
    source = with_unknown_on_another_shift(source)
    source = source.model_copy(update={'employees': [e.model_copy(update={**block, 'name': 'Bob'}) if e.id == 'bob' else e for e in source.employees]})
    if pin == 'source':
        source = source.model_copy(update={'shifts': [source.shifts[0].model_copy(update={'employee_id': 'bob', 'pinned': True}), source.shifts[1]]})
    task = task.model_copy(update={'absence': None, 'fixed_assignments': {'s1': 'bob'} if pin == 'condition' else {}})
    result = solve(source, task)
    assert result.outcome == 'infeasible' and not result.scenarios
    assert not any(i.code == 'infeasible' for i in result.issues)
    conflict = conflict_in(result)
    assert conflict.code == 'conflict' and conflict.shift_ids == ['s1'] and conflict.employee_ids == ['bob']
    assert terms(conflict) == {(pin_kind, 's1', 'bob', None): 'solution', blocker: 'solution'}
    assert words in conflict.message and 'закрепление смены s1 за сотрудником Bob' in conflict.message
    assert 'даже если вся неизвестная доступность подтвердится' in conflict.message
    assert 'без любого из этих условий решение появляется' in conflict.message


def test_shift_nobody_can_take_names_the_shift_and_what_stops_each_person(inputs):
    source, task = inputs
    source = on_separate_days(source)
    source = source.model_copy(update={'employees': [
        source.employees[0], source.employees[1].model_copy(update={'roles': ['other']}),
        source.employees[2].model_copy(update={'availability': {'s1': 'unavailable', 's2': 'available'}})]})
    result = solve(source, task)
    assert result.outcome == 'infeasible' and not result.scenarios
    conflict = conflict_in(result)
    assert conflict.shift_ids == ['s1'] and conflict.employee_ids == ['anna', 'bob', 'carol']
    assert terms(conflict) == {('coverage', 's1', None, None): 'solution', ('absence', 's1', 'anna', None): 'solution',
        ('role', None, 'bob', 'worker'): 'solution', ('availability', 's1', 'carol', None): 'solution'}
    assert 'требование закрыть смену s1' in conflict.message


def test_role_nobody_has_is_one_line_for_the_whole_team(inputs):
    source, task = inputs
    source = source.model_copy(update={'shifts': [source.shifts[0].model_copy(update={'role': 'manager'}), source.shifts[1]]})
    conflict = conflict_in(solve(source, task.model_copy(update={'absence': None})))
    assert 'нет роли «manager» у сотрудников anna, bob, carol' in conflict.message
    assert sorted(c.employee_id for c in conflict.conditions if c.kind == 'role') == ['anna', 'bob', 'carol']


@pytest.mark.parametrize('second', ['source', 'condition'])
def test_two_pins_on_overlapping_shifts_of_one_person(inputs, second):
    source, task = inputs
    shifts = [source.shifts[0].model_copy(update={'employee_id': 'bob', 'pinned': True}),
        source.shifts[1].model_copy(update={'employee_id': 'bob', 'pinned': second == 'source'})]
    source = source.model_copy(update={'shifts': shifts})
    result = solve(source, task.model_copy(update={'absence': None, 'fixed_assignments': {'s2': 'bob'} if second == 'condition' else {}}))
    assert result.outcome == 'infeasible' and not result.scenarios
    conflict = conflict_in(result)
    assert conflict.code == 'conflict' and conflict.shift_ids == ['s1', 's2'] and conflict.employee_ids == ['bob']
    assert terms(conflict) == {('source_pin', 's1', 'bob', None): 'solution',
        ('source_pin' if second == 'source' else 'fixed_assignment', 's2', 'bob', None): 'solution'}
    assert 'Пересекаются: s1 и s2' in conflict.message


def test_two_pins_over_the_hour_limit_name_the_limit_and_both_shifts(inputs):
    source, task = inputs
    source = on_separate_days(source)
    source = source.model_copy(update={
        'shifts': [s.model_copy(update={'employee_id': 'bob', 'pinned': True}) for s in source.shifts],
        'employees': [e.model_copy(update={'max_weekly_minutes': 600}) if e.id == 'bob' else e for e in source.employees]})
    conflict = conflict_in(solve(source, task.model_copy(update={'absence': None})))
    assert conflict.shift_ids == ['s1', 's2'] and conflict.employee_ids == ['bob']
    assert terms(conflict) == {('source_pin', 's1', 'bob', None): 'solution', ('source_pin', 's2', 'bob', None): 'solution',
        ('hours', None, 'bob', None): 'solution'}
    assert 'Пересекаются' not in conflict.message and 'лимит часов сотрудника bob: 10 ч в неделю' in conflict.message


def test_more_overlapping_shifts_than_people_is_named_without_any_condition_to_blame(inputs):
    source, task = inputs
    source = source.model_copy(update={'employees': source.employees[:1], 'shifts': [s.model_copy(update={'employee_id': 'anna'}) for s in source.shifts]})
    conflict = conflict_in(solve(source, task.model_copy(update={'absence': None})))
    assert terms(conflict) == {('coverage', 's1', None, None): 'solution', ('coverage', 's2', None, None): 'solution'}
    assert 'Пересекаются: s1 и s2' in conflict.message


def test_condition_that_is_not_enough_on_its_own_is_said_to_be_not_enough(inputs):
    source, task = inputs
    source = source.model_copy(update={
        'shifts': [source.shifts[0].model_copy(update={'employee_id': 'bob', 'pinned': True}), source.shifts[1]],
        'employees': [e.model_copy(update={'roles': ['other'] if e.id == 'bob' else e.roles,
            'availability': {'s1': 'unavailable', 's2': 'available'} if e.id == 'carol' else e.availability}) for e in source.employees]})
    result = solve(source, task)
    conflict = conflict_in(result)
    assert terms(conflict) == {('source_pin', 's1', 'bob', None): 'no_solution', ('role', None, 'bob', 'worker'): 'solution'}
    assert 'без условия 2 решение появляется' in conflict.message
    assert 'без условия 1 решения всё равно нет' in conflict.message


def test_independent_conflicts_are_each_named_and_checked_with_the_other_one_lifted(inputs):
    source, task = inputs
    source = on_separate_days(source)
    source = source.model_copy(update={
        'shifts': [source.shifts[0].model_copy(update={'pinned': True}), source.shifts[1].model_copy(update={'pinned': True})],
        'employees': [e.model_copy(update={'availability': {'s1': 'available', 's2': 'unavailable'}}) if e.id == 'bob' else e for e in source.employees]})
    result = solve(source, task)
    assert result.outcome == 'infeasible' and len(result.issues) == 2
    absence, availability = result.issues
    assert absence.code == 'pinned_absence' and absence.message.startswith('Конфликт 1 из 2.')
    assert availability.code == 'conflict' and availability.message.startswith('Конфликт 2 из 2.')
    assert terms(absence) == {('source_pin', 's1', 'anna', None): 'solution', ('absence', 's1', 'anna', None): 'solution'}
    assert terms(availability) == {('source_pin', 's2', 'bob', None): 'solution', ('availability', 's2', 'bob', None): 'solution'}
    assert 'при снятых остальных конфликтах' in absence.message


def test_pins_that_conflict_in_pairs_say_no_single_removal_is_enough(inputs):
    source, task = inputs
    third = source.shifts[0].model_copy(update={'id': 's3', 'source_row': 4})
    source = source.model_copy(update={
        'shifts': [s.model_copy(update={'employee_id': 'bob', 'pinned': True}) for s in [source.shifts[0], source.shifts[1], third]],
        'employees': [e.model_copy(update={'availability': {**e.availability, 's3': 'available'}}) for e in source.employees]})
    conflict = conflict_in(solve(source, task.model_copy(update={'absence': None})))
    assert set(terms(conflict).values()) == {'no_solution'} and len(conflict.conditions) == 2
    assert 'Без всех этих условий вместе решение появляется.' in conflict.message


def test_removal_that_needs_an_unknown_confirmed_says_so(inputs):
    source, task = inputs
    source = source.model_copy(update={
        'shifts': [source.shifts[0].model_copy(update={'employee_id': 'bob', 'pinned': True}), source.shifts[1]],
        'employees': [e.model_copy(update={'roles': ['other'], 'availability': {'s1': 'unknown', 's2': 'available'}}) if e.id == 'bob' else e
            for e in source.employees]})
    conflict = conflict_in(solve(source, task.model_copy(update={'absence': None})))
    assert terms(conflict) == {('source_pin', 's1', 'bob', None): 'solution', ('role', None, 'bob', 'worker'): 'solution_if_confirmed'}
    assert 'только если подтвердится неизвестная доступность' in conflict.message


def test_shift_nobody_can_take_is_proven_and_the_proof_stays_in_the_journal(inputs):
    source, task = inputs
    source = with_unknown_on_another_shift(source)
    source = source.model_copy(update={'shifts': [source.shifts[0].model_copy(update={'role': 'manager'}), source.shifts[1]]})
    journal = []
    result = solve(source, task.model_copy(update={'absence': None}), event=lambda code, message: journal.append(message))
    assert result.outcome == 'infeasible' and not result.scenarios
    assert len(result.attempts) == 1 and result.attempts[0].status == 'INFEASIBLE'
    assert any('неизвестная доступность' in message for message in journal)


def test_pin_on_a_person_with_unknown_availability_still_asks_to_clarify(inputs):
    source, task = inputs
    source = source.model_copy(update={'employees': [
        e.model_copy(update={'availability': {'s1': 'unknown', 's2': 'available'}}) if e.id == 'bob' else e
        for e in source.employees]})
    result = solve(source, task.model_copy(update={'absence': None, 'fixed_assignments': {'s1': 'bob'}}))
    assert result.outcome == 'needs_clarification' and not result.scenarios
    assert any(i.code == 'availability_unknown' for i in result.issues)


def test_answer_agrees_with_exhaustive_search_over_every_way_the_unknowns_turn_out(inputs):
    base, task = inputs
    rng = random.Random(0)
    people = [e.id for e in base.employees]

    def exists(source, conditions):
        ids = [s.id for s in source.shifts]
        return any(evaluate(source, conditions, Scenario(id='trial', source_version_id=source.id, task_spec_id=conditions.id, label='', description='',
            assignments=dict(zip(ids, combo))))[0].status == 'pass' for combo in itertools.product(people, repeat=len(ids)))

    seen = set()
    for _ in range(300):
        employees = [e.model_copy(update={'roles': rng.choice([['worker'], ['worker'], ['other']]), 'max_weekly_minutes': rng.choice([240, 480, 720]),
            'availability': {sid: rng.choice(['available', 'available', 'unavailable', 'unknown', 'unknown']) for sid in ['s1', 's2']}}) for e in base.employees]
        shifts = [s.model_copy(update={'employee_id': rng.choice(people), 'pinned': rng.random() < .25}) for s in base.shifts]
        source = base.model_copy(update={'employees': employees, 'shifts': shifts})
        conditions = task.model_copy(update={'absence': task.absence if rng.random() < .5 else None,
            'fixed_assignments': {'s1': rng.choice(people)} if rng.random() < .4 else {}})
        wider = source.model_copy(update={'employees': [e.model_copy(update={'availability': {sid: 'available' if state == 'unknown' else state
            for sid, state in e.availability.items()}}) for e in employees]})
        expected = 'solutions' if exists(source, conditions) else 'needs_clarification' if exists(wider, conditions) else 'infeasible'
        assert solve(source, conditions).outcome == expected
        seen.add(expected)
    assert seen == {'solutions', 'needs_clarification', 'infeasible'}


def pin_on_a_person_without_the_role(source, task):
    source = source.model_copy(update={
        'shifts': [source.shifts[0].model_copy(update={'employee_id': 'bob', 'pinned': True}), source.shifts[1]],
        'employees': [e.model_copy(update={'roles': ['other']}) if e.id == 'bob' else e for e in source.employees]})
    return source, task.model_copy(update={'absence': None})


def test_no_time_left_for_diagnosis_keeps_the_general_answer_and_the_journal_says_why(inputs, monkeypatch):
    source, task = pin_on_a_person_without_the_role(*inputs)
    real, shift = time.monotonic, [0]
    monkeypatch.setattr('app.solver.time.monotonic', lambda: real() + shift[0])

    def after_the_main_search(solver):
        if solver is None:
            shift[0] = 3600

    journal = []
    result = solve(source, task, max_seconds=1, on_solver=after_the_main_search, event=lambda code, message: journal.append((code, message)))
    assert result.outcome == 'infeasible' and [i.code for i in result.issues] == ['infeasible']
    assert 'Минимальный набор причин не определялся.' in result.issues[0].message and not result.issues[0].conditions
    assert any(code == 'diagnosis' and 'лимит' in message for code, message in journal)


def test_no_search_starts_once_the_budget_is_spent(inputs, monkeypatch):
    source, task = pin_on_a_person_without_the_role(*inputs)
    clock, started = [0.0], []
    monkeypatch.setattr('app.solver.time.monotonic', lambda: clock[0])

    def every_search_takes_a_second(solver):
        if solver is not None:
            started.append(clock[0])
            clock[0] += 1

    result = solve(source, task, max_seconds=3, on_solver=every_search_takes_a_second)
    assert result.outcome == 'infeasible' and [i.code for i in result.issues] == ['infeasible']
    assert len(started) == 3 and max(started) < 3


def test_assumptions_and_light_settings_stay_outside_the_main_search(inputs, monkeypatch):
    source, task = pin_on_a_person_without_the_role(*inputs)
    searches = []
    real = cp_model.CpSolver.solve

    def recorded(solver, model, *args, **kwargs):
        searches.append((model.has_objective(), len(model.Proto().assumptions), solver.parameters.cp_model_probing_level))
        return real(solver, model, *args, **kwargs)

    monkeypatch.setattr(cp_model.CpSolver, 'solve', recorded)
    assert conflict_in(solve(source, task))
    default = cp_model.CpSolver().parameters.cp_model_probing_level
    assert searches[0] == (True, 0, default) and all(assumptions == 0 for objective, assumptions, _ in searches if objective)
    assert any(assumptions for _, assumptions, _ in searches) and all(level == 0 for objective, _, level in searches if not objective)


def test_named_direct_conflict_survives_when_the_diagnosis_has_no_time(inputs, monkeypatch):
    source, task = inputs
    source = source.model_copy(update={'shifts': [source.shifts[0].model_copy(update={'pinned': True}), source.shifts[1]]})
    real, shift = time.monotonic, [0]
    monkeypatch.setattr('app.solver.time.monotonic', lambda: real() + shift[0])
    result = solve(source, task, max_seconds=1, on_solver=lambda solver: shift.__setitem__(0, 3600 if solver is None else 0))
    assert result.outcome == 'infeasible' and [i.code for i in result.issues] == ['pinned_absence']
    assert not result.issues[0].conditions


def test_proposal_that_is_not_a_real_conflict_never_reaches_the_person(inputs, monkeypatch):
    source, task = pin_on_a_person_without_the_role(*inputs)
    real = diagnosis.conflict_finder

    def misleading(*args):
        conditions, propose = real(*args)
        return conditions, lambda active, run: [Condition('role', None, 'bob', 'worker'), Condition('hours', None, 'anna')]

    monkeypatch.setattr(diagnosis, 'conflict_finder', misleading)
    journal = []
    result = solve(source, task, event=lambda code, message: journal.append((code, message)))
    assert result.outcome == 'infeasible' and [i.code for i in result.issues] == ['infeasible']
    assert any(code == 'diagnosis' and 'не подтвердила' in message for code, message in journal)


def test_conflict_is_narrowed_down_to_what_a_person_entered(inputs, monkeypatch):
    source, task = inputs
    source = source.model_copy(update={
        'shifts': [source.shifts[0].model_copy(update={'employee_id': 'bob', 'pinned': True}), source.shifts[1]],
        'employees': [e.model_copy(update={'roles': ['other'] if e.id == 'bob' else e.roles,
            'availability': {'s1': 'unavailable', 's2': 'available'} if e.id == 'carol' else e.availability}) for e in source.employees]})
    pin, role = Condition('source_pin', 's1', 'bob'), Condition('role', None, 'bob', 'worker')
    nobody_else = [Condition('coverage', 's1'), Condition('absence', 's1', 'anna'), Condition('availability', 's1', 'carol')]
    real = diagnosis.conflict_finder

    def both_conflicts_at_once(*args):
        conditions, propose = real(*args)
        return conditions, lambda active, run: [pin, role, *nobody_else]

    monkeypatch.setattr(diagnosis, 'conflict_finder', both_conflicts_at_once)
    conflict = conflict_in(solve(source, task))
    assert set(terms(conflict)) == {tuple(pin), tuple(role)}


def test_diagnosis_leaves_the_search_record_and_keeps_to_the_journal(inputs):
    source, task = pin_on_a_person_without_the_role(*inputs)
    journal = []
    result = solve(source, task, event=lambda code, message: journal.append((code, message)))
    assert len(result.attempts) == 1 and result.attempts[0].status == 'INFEASIBLE'
    assert sum(code == 'diagnosis' for code, _ in journal) == 1


def test_cancel_reaches_the_diagnosis(inputs):
    source, task = pin_on_a_person_without_the_role(*inputs)
    solvers = []
    with pytest.raises(CalculationCancelled):
        solve(source, task, cancelled=lambda: len(solvers) > 2, on_solver=solvers.append)
    assert len(solvers) > 2


def every_condition(source, task):
    roles = {s.role for s in source.shifts}
    return {*(('coverage', s.id, None, None) for s in source.shifts),
        *(('source_pin', s.id, s.employee_id, None) for s in source.shifts if s.pinned),
        *(('fixed_assignment', sid, eid, None) for sid, eid in task.fixed_assignments.items()),
        *(('absence', sid, task.absence.employee_id, None) for sid in (task.absence.shift_ids if task.absence else [])),
        *(('role', None, e.id, role) for e in source.employees for role in roles - set(e.roles)),
        *(('availability', sid, e.id, None) for e in source.employees for sid, state in e.availability.items() if state == 'unavailable'),
        *(('hours', None, e.id, None) for e in source.employees)}


def with_lifted(source, task, lifted):
    away = [sid for sid in task.absence.shift_ids if ('absence', sid, task.absence.employee_id, None) not in lifted] if task.absence else []
    return source.model_copy(update={
        'shifts': [s.model_copy(update={'pinned': s.pinned and ('source_pin', s.id, s.employee_id, None) not in lifted}) for s in source.shifts],
        'employees': [e.model_copy(update={
            'roles': [*e.roles, *(role for kind, _, eid, role in lifted if kind == 'role' and eid == e.id)],
            'max_weekly_minutes': 10 ** 6 if ('hours', None, e.id, None) in lifted else e.max_weekly_minutes,
            'availability': {sid: 'available' if ('availability', sid, e.id, None) in lifted else state for sid, state in e.availability.items()}})
            for e in source.employees]}), task.model_copy(update={
        'absence': task.absence.model_copy(update={'shift_ids': away}) if away else None,
        'fixed_assignments': {sid: eid for sid, eid in task.fixed_assignments.items() if ('fixed_assignment', sid, eid, None) not in lifted}})


def complete_schedule_exists(source, task, lifted=frozenset(), unknown_as_available=False):
    """Every assignment, judged only by the validator; nothing from CP-SAT or the diagnosis."""
    source, task = with_lifted(source, task, lifted)
    if unknown_as_available:
        source = source.model_copy(update={'employees': [e.model_copy(update={'availability': {
            sid: 'available' if state == 'unknown' else state for sid, state in e.availability.items()}}) for e in source.employees]})
    optional = {sid for kind, sid, _, _ in lifted if kind == 'coverage'}
    ids, people = [s.id for s in source.shifts], [e.id for e in source.employees]
    for combo in itertools.product(*([*people, None] if sid in optional else people for sid in ids)):
        report, _, _ = evaluate(source, task, Scenario(id='trial', source_version_id=source.id, task_spec_id=task.id, label='', description='',
            assignments={sid: eid for sid, eid in zip(ids, combo) if eid is not None}))
        if all(c.status == 'pass' or c.id == 'coverage' and set(c.shift_ids) <= optional for c in report.checks):
            return True
    return False


def random_instance(rng, base, task):
    shifts = [*base.shifts, base.shifts[1].model_copy(update={'id': 's3', 'source_row': 4,
        'starts_at': '2026-11-03T09:00:00+03:00', 'ends_at': '2026-11-03T13:00:00+03:00'})]
    ids, team = [s.id for s in shifts], base.employees[:rng.choice([2, 3, 3])]
    people = [e.id for e in team]
    employees = [e.model_copy(update={'roles': rng.choice([['worker'], ['worker'], ['other'], ['worker', 'other']]),
        'max_weekly_minutes': rng.choice([240, 480, 720, 960]),
        'availability': {sid: rng.choice(['available', 'available', 'available', 'unavailable', 'unknown']) for sid in ids}}) for e in team]
    shifts = [s.model_copy(update={'employee_id': rng.choice(people), 'pinned': rng.random() < .3, 'role': rng.choice(['worker', 'worker', 'other'])}) for s in shifts]
    away = rng.sample(ids, rng.randint(1, 2))
    return base.model_copy(update={'employees': employees, 'shifts': shifts}), task.model_copy(update={
        'absence': Absence(employee_id=rng.choice(people), shift_ids=away) if rng.random() < .5 else None,
        'fixed_assignments': {sid: rng.choice(people) for sid in rng.sample(ids, rng.choice([0, 0, 1, 2]))}})


def reconcile_named_conflicts_with_exhaustive_search(source, task, result):
    """Each statement in the report, decided again from the inputs alone."""
    everything = every_condition(source, task)
    conflicts = [{(c.kind, c.shift_id, c.employee_id, c.role) for c in i.conditions} for i in result.issues if i.conditions]
    assert conflicts and not any(i.code == 'infeasible' for i in result.issues)
    named = set().union(*conflicts)
    assert named <= everything and sum(map(len, conflicts)) == len(named)
    assert complete_schedule_exists(source, task, named, True)
    for issue, conflict in zip([i for i in result.issues if i.conditions], conflicts):
        assert not complete_schedule_exists(source, task, everything - conflict, True)
        for condition in issue.conditions:
            term = (condition.kind, condition.shift_id, condition.employee_id, condition.role)
            assert complete_schedule_exists(source, task, everything - (conflict - {term}), True), 'a condition the conflict does not need'
            lifted = (named - conflict) | {term}
            expected = 'solution' if complete_schedule_exists(source, task, lifted) else \
                'solution_if_confirmed' if complete_schedule_exists(source, task, lifted, True) else 'no_solution'
            assert condition.removal_check == expected
            assert condition.employee_id is None or condition.employee_id in issue.employee_ids
            assert condition.shift_id is None or condition.shift_id in issue.shift_ids
        if all(c.removal_check == 'no_solution' for c in issue.conditions):
            words = 'решение появляется' if complete_schedule_exists(source, task, named) else 'только если подтвердится'
            assert words in issue.message.rsplit('вместе', 1)[1]


def test_named_conflicts_agree_with_exhaustive_search_over_random_conditions(inputs):
    base, task = inputs
    rng = random.Random(1)
    seen, verdicts = set(), set()
    for _ in range(250):
        source, conditions = random_instance(rng, base, task)
        result = solve(source, conditions)
        expected = 'solutions' if complete_schedule_exists(source, conditions) else \
            'needs_clarification' if complete_schedule_exists(source, conditions, unknown_as_available=True) else 'infeasible'
        assert result.outcome == expected
        seen.add(expected)
        if expected == 'infeasible':
            reconcile_named_conflicts_with_exhaustive_search(source, conditions, result)
            verdicts |= {c.removal_check for i in result.issues for c in i.conditions}
    assert seen == {'solutions', 'needs_clarification', 'infeasible'}
    assert verdicts == {'solution', 'solution_if_confirmed', 'no_solution'}


def test_cancel_reaches_the_proof_over_unknown_availability(inputs):
    source, task = inputs
    source = with_unknown_on_another_shift(source)
    source = source.model_copy(update={'employees': [e.model_copy(update={'roles': ['other']}) if e.id == 'bob' else e for e in source.employees]})
    solvers = []
    with pytest.raises(CalculationCancelled):
        solve(source, task.model_copy(update={'absence': None, 'fixed_assignments': {'s1': 'bob'}}),
            cancelled=lambda: len(solvers) > 2, on_solver=solvers.append)


def test_unknown_availability_requires_clarification_and_is_not_authorization(inputs):
    source, task = inputs
    source = source.model_copy(update={'employees': [e.model_copy(update={'availability': {'s1': 'unknown', 's2': 'available'}}) for e in source.employees]})
    result = solve(source, task)
    assert result.outcome == 'needs_clarification'
    assert not result.scenarios and any(i.code == 'availability_unknown' for i in result.issues)


def test_missing_rate_keeps_hours_but_suppresses_money_and_cost_priority(inputs):
    source, task = inputs
    source = source.model_copy(update={'employees': [e.model_copy(update={'rate_per_hour_minor': None}) if e.id == 'carol' else e for e in source.employees]})
    result = solve(source, task)
    assert len(result.scenarios) == 1
    metrics = result.scenarios[0].metrics
    assert metrics.cost_minor is None and metrics.cost_delta_minor is None
    assert metrics.total_minutes == 720 and metrics.unknown_rate_employee_ids == ['carol']
    assert all(a.priority == 'min_changes' for a in result.attempts)


def test_duplicate_variants_are_hidden_and_zero_rate_is_known(inputs):
    source, task = inputs
    source = source.model_copy(update={'employees': [e.model_copy(update={'rate_per_hour_minor': 0}) if e.id == 'carol' else e for e in source.employees]})
    result = solve(source, task)
    assert len(result.scenarios) == 1
    assert result.scenarios[0].metrics.cost_minor == 80000
    assert not result.scenarios[0].metrics.unknown_rate_employee_ids


def test_no_change_is_a_real_zero_change_solution(inputs):
    source, task = inputs
    result = solve(source, task.model_copy(update={'absence': None}))
    assert result.scenarios[0].metrics.changes == []


@pytest.mark.parametrize('priority', ['min_changes','min_cost'])
def test_saved_priority_is_used_without_silently_changing_the_goal(inputs, priority):
    source, task = inputs
    result=solve(source,task.model_copy(update={'objective':priority}))
    assert result.scenarios and all(s.priority==priority for s in result.scenarios)
    assert all(a.priority==priority for a in result.attempts)


def test_unknown_rates_require_clarification_for_explicit_cost_goal(inputs):
    source,task=inputs
    source=source.model_copy(update={'employees':[e.model_copy(update={'rate_per_hour_minor':None}) for e in source.employees]})
    result=solve(source,task.model_copy(update={'objective':'min_cost'}))
    assert result.outcome=='needs_clarification' and not result.scenarios and not result.attempts


def test_timeout_is_unknown_and_never_infeasible(inputs):
    result = solve(*inputs, max_seconds=0)
    assert result.outcome == 'limit' and result.attempts[0].status == 'UNKNOWN'
    assert not result.scenarios


def test_cancel_stops_search_instead_of_publishing_result(inputs):
    with pytest.raises(CalculationCancelled):
        solve(*inputs, cancelled=lambda: True)


def test_fixed_assignments_are_constraints_of_a_new_solve(inputs):
    source, task = inputs
    result = solve(source, task.model_copy(update={'fixed_assignments': {'s1': 'bob'}}))
    assert len(result.scenarios) == 1
    assert result.scenarios[0].scenario.assignments == {'s1': 'bob', 's2': 'carol'}


@pytest.mark.parametrize('kind,failed', [('pin','pinned'), ('hours','hours'), ('role','roles'),
    ('overlap','overlap'), ('unknown','availability'), ('reference','references'), ('coverage','coverage'), ('fixed','pinned')])
def test_validator_independently_rejects_tampered_assignments(inputs, kind, failed):
    source, task = inputs
    assignments = {'s1': 'carol', 's2': 'bob'}
    if kind == 'pin':
        source = source.model_copy(update={'shifts': [source.shifts[0].model_copy(update={'pinned': True}), source.shifts[1]]})
    elif kind == 'hours':
        source = source.model_copy(update={'employees': [e.model_copy(update={'max_weekly_minutes': 1}) for e in source.employees]})
    elif kind == 'role':
        source = source.model_copy(update={'employees': [e.model_copy(update={'roles': []}) for e in source.employees]})
    elif kind == 'overlap':
        assignments['s2'] = 'carol'
    elif kind == 'unknown':
        source = source.model_copy(update={'employees': [e.model_copy(update={'availability': {}}) for e in source.employees]})
    elif kind == 'reference':
        assignments['outside'] = 'bob'
    elif kind == 'coverage':
        del assignments['s1']
    elif kind == 'fixed':
        task = task.model_copy(update={'fixed_assignments': {'s1': 'bob'}})
    scenario = Scenario(id='tampered', source_version_id=source.id, task_spec_id=task.id, label='', description='', assignments=assignments)
    report, _, _ = evaluate(source, task, scenario)
    assert report.status != 'pass'
    assert next(c for c in report.checks if c.id == failed).status != 'pass'


def test_utc_duration_half_up_money_and_adjacent_intervals(inputs):
    source, task = inputs
    shift = source.shifts[0].model_copy(update={'starts_at': '2026-11-01T01:30:00-04:00', 'ends_at': '2026-11-01T02:30:00-05:00'})
    source = source.model_copy(update={'shifts': [shift],
        'employees': [source.employees[0].model_copy(update={'rate_per_hour_minor': 1})]})
    task = task.model_copy(update={'absence': None})
    result = solve(source, task)
    assert result.scenarios[0].metrics.total_minutes == 120
    assert result.scenarios[0].metrics.cost_minor == 2
    minute = shift.model_copy(update={'ends_at': '2026-11-01T01:31:00-04:00'})
    source = source.model_copy(update={'shifts': [minute], 'employees': [source.employees[0].model_copy(update={'rate_per_hour_minor': 30})]})
    assert solve(source, task).scenarios[0].metrics.cost_minor == 1
