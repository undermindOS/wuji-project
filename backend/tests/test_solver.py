from copy import deepcopy
import itertools
import random
import threading

import pytest

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


def test_condition_pin_contradicting_a_source_pin_is_reported_as_the_conflict_it_is(inputs):
    source, task = inputs
    source = source.model_copy(update={'shifts': [source.shifts[0].model_copy(update={'pinned': True}), source.shifts[1]]})
    task = task.model_copy(update={'absence': None, 'fixed_assignments': {'s1': 'bob'}})
    result = solve(source, task)
    assert result.outcome == 'infeasible' and not result.scenarios
    conflict = [i for i in result.issues if i.code == 'fixed_pin_conflict']
    assert conflict and conflict[0].shift_ids == ['s1'] and conflict[0].employee_ids == ['anna', 'bob']


def with_unknown_on_another_shift(source):
    return source.model_copy(update={'employees': [
        e.model_copy(update={'availability': {'s1': 'available', 's2': 'unknown'}}) if e.id == 'carol' else e
        for e in source.employees]})


@pytest.mark.parametrize('pin', ['source', 'condition'])
@pytest.mark.parametrize('block', [{'roles': ['other']}, {'availability': {'s1': 'unavailable', 's2': 'available'}}, {'max_weekly_minutes': 60}])
def test_pin_on_a_person_who_cannot_take_the_shift_is_proven_whatever_the_unknowns_turn_out(inputs, pin, block):
    source, task = inputs
    source = with_unknown_on_another_shift(source)
    source = source.model_copy(update={'employees': [e.model_copy(update=block) if e.id == 'bob' else e for e in source.employees]})
    if pin == 'source':
        source = source.model_copy(update={'shifts': [source.shifts[0].model_copy(update={'employee_id': 'bob', 'pinned': True}), source.shifts[1]]})
    task = task.model_copy(update={'absence': None, 'fixed_assignments': {'s1': 'bob'} if pin == 'condition' else {}})
    result = solve(source, task)
    assert result.outcome == 'infeasible' and not result.scenarios
    assert [i.code for i in result.issues] == ['infeasible']


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
