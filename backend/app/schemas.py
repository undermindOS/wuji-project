from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra='forbid', frozen=True)


class SourceRef(ApiModel):
    file_id: str
    filename: str
    sheet: str | None = None
    row: int
    column: str


class Employee(ApiModel):
    id: str
    name: str
    initials: str
    roles: list[str]
    rate_per_hour_minor: int | None
    max_weekly_minutes: int
    availability: dict[str, Literal['available', 'unavailable', 'unknown']]
    source_refs: dict[str, SourceRef] = Field(default_factory=dict)


class Shift(ApiModel):
    id: str
    starts_at: str
    ends_at: str
    role: str
    employee_id: str
    pinned: bool
    source_row: int
    source_refs: dict[str, SourceRef] = Field(default_factory=dict)


class OriginalFile(ApiModel):
    id: str
    filename: str
    kind: str
    sha256: str
    size: int


class NormalizedSource(ApiModel):
    filename: str
    team_name: str
    timezone: str
    currency: str
    employees: list[Employee]
    shifts: list[Shift]


class SourceVersion(NormalizedSource):
    id: str
    version: int
    project_id: str | None = None
    content_hash: str | None = None
    created_at: datetime | None = None
    original_files: list[OriginalFile] = Field(default_factory=list)


class Absence(ApiModel):
    employee_id: str
    shift_ids: list[str]


class Rule(ApiModel):
    id: str
    label: str
    detail: str


class IntentOrigin(ApiModel):
    draft_id: str
    provider: Literal['openai']
    model: str
    prompt_version: str
    confirmed_at: datetime
    provider_mode: Literal['live', 'test'] = 'live'


class TaskSpec(ApiModel):
    id: str
    source_version_id: str
    request: str
    absence: Absence | None
    rules: list[Rule]
    version: int = 1
    created_at: datetime | None = None
    fixed_assignments: dict[str, str] = Field(default_factory=dict)
    objective: Literal['compare', 'min_changes', 'min_cost'] = 'compare'
    parent_task_id: str | None = None
    interpretation: IntentOrigin | None = None


class Scenario(ApiModel):
    id: str
    source_version_id: str
    task_spec_id: str
    label: str
    description: str
    assignments: dict[str, str]


class ProjectCreate(ApiModel):
    name: str = Field(min_length=1, max_length=120)

    @field_validator('name')
    @classmethod
    def clean_name(cls, value):
        if value != value.strip() or any(ord(c) < 32 for c in value):
            raise ValueError('The name must not contain leading/trailing spaces or control characters.')
        return value


class ProjectSummary(ApiModel):
    id: str
    name: str
    head_source_id: str | None
    head_task_id: str | None
    source_count: int
    created_at: datetime
    updated_at: datetime


class SourceSummary(ApiModel):
    id: str
    version: int
    filename: str
    content_hash: str
    employee_count: int
    shift_count: int
    created_at: datetime


class WorkspaceSnapshot(ApiModel):
    project: ProjectSummary
    source: SourceVersion
    task: TaskSpec
    tasks: list[TaskSpec]
    versions: list[SourceSummary]
    baseline: Scenario


class ImportIssue(ApiModel):
    severity: Literal['error', 'warning']
    code: str
    message: str
    filename: str | None = None
    sheet: str | None = None
    row: int | None = None
    column: str | None = None


class PreviewRow(ApiModel):
    filename: str
    sheet: str | None = None
    row: int
    values: dict[str, str]


class ImportPreview(ApiModel):
    id: str
    project_id: str
    expected_source_version_id: str | None
    can_confirm: bool
    issues: list[ImportIssue]
    row_counts: dict[str, int]
    preview_rows: list[PreviewRow]
    preview: NormalizedSource | None
    files: list[OriginalFile]


class ConfirmImport(ApiModel):
    expected_source_version_id: str | None


class ImportConfirmation(ApiModel):
    project_id: str
    source_id: str
    version: int


class SaveTask(ApiModel):
    expected_source_version_id: str
    expected_task_id: str
    request: str = Field(min_length=1, max_length=8000)
    absence: Absence | None = None
    fixed_assignments: dict[str, str] = Field(default_factory=dict)
    objective: Literal['compare', 'min_changes', 'min_cost'] = 'compare'


class ApiError(ApiModel):
    code: str
    message: str
    issues: list[ImportIssue] = Field(default_factory=list)


class Health(ApiModel):
    status: Literal['ok']
    storage: Literal['postgresql']


SearchStatus = Literal['OPTIMAL', 'FEASIBLE', 'INFEASIBLE', 'MODEL_INVALID', 'UNKNOWN']
RunStatus = Literal['queued', 'running', 'completed', 'needs_clarification', 'failed', 'cancelled']


class ValidationCheck(ApiModel):
    id: str
    label: str
    status: Literal['pass', 'fail', 'unknown']
    detail: str
    shift_ids: list[str]


class ValidationReport(ApiModel):
    status: Literal['pass', 'fail', 'unknown']
    validator_version: str
    checks: list[ValidationCheck]


class AssignmentChange(ApiModel):
    id: str
    shift_id: str
    before_employee_id: str
    after_employee_id: str
    source_row: int


class ScenarioMetrics(ApiModel):
    changes: list[AssignmentChange]
    affected_employee_ids: list[str]
    covered_shifts: int
    total_shifts: int
    total_minutes: int
    minutes_by_employee: dict[str, int]
    cost_minor: int | None
    baseline_cost_minor: int | None
    cost_delta_minor: int | None
    unknown_rate_employee_ids: list[str]


class ChangeEvidence(ApiModel):
    shift_id: str
    before_employee_id: str
    after_employee_id: str
    duration_minutes: int
    before_cost_minor: int | None
    after_cost_minor: int | None
    cost_delta_minor: int | None
    source_refs: list[SourceRef]
    rule_ids: list[str]
    check_ids: list[str]
    task_spec_id: str


class SearchAttempt(ApiModel):
    priority: Literal['min_changes', 'min_cost']
    phase: Literal['primary', 'tiebreak']
    status: SearchStatus
    objective_value: int | None
    elapsed_ms: int


class CalculatedScenario(ApiModel):
    scenario: Scenario
    priority: Literal['min_changes', 'min_cost']
    search_status: SearchStatus
    validation: ValidationReport
    metrics: ScenarioMetrics
    evidence: list[ChangeEvidence]


class ConflictCondition(ApiModel):
    kind: Literal['source_pin', 'fixed_assignment', 'absence', 'coverage', 'role', 'availability', 'hours']
    shift_id: str | None = None
    employee_id: str | None = None
    role: str | None = None
    removal_check: Literal['solution', 'solution_if_confirmed', 'no_solution']


class SolveIssue(ApiModel):
    code: str
    message: str
    shift_ids: list[str] = Field(default_factory=list)
    employee_ids: list[str] = Field(default_factory=list)
    source_refs: list[SourceRef] = Field(default_factory=list)
    conditions: list[ConflictCondition] = Field(default_factory=list)


class SolveResult(ApiModel):
    outcome: Literal['solutions', 'infeasible', 'needs_clarification', 'limit', 'invalid']
    scenarios: list[CalculatedScenario]
    attempts: list[SearchAttempt]
    issues: list[SolveIssue]
    elapsed_ms: int


class StartRun(ApiModel):
    source_version_id: str
    task_spec_id: str
    request_key: str = Field(pattern=r'^[0-9a-fA-F-]{36}$')
    max_time_seconds: int = Field(default=10, ge=1, le=30)


class RunEvent(ApiModel):
    at: datetime
    code: str
    message: str


class RunSummary(ApiModel):
    id: str
    project_id: str
    source_version_id: str
    task_spec_id: str
    source_hash: str
    engine_version: str
    status: RunStatus
    is_current: bool
    max_time_seconds: int
    cancel_requested: bool
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    heartbeat_at: datetime | None


class RunDetail(RunSummary):
    result: SolveResult | None
    events: list[RunEvent]


class FixAssignments(StartRun):
    scenario_id: str
    shift_ids: list[str] = Field(min_length=1, max_length=5000)


class FixedRun(ApiModel):
    task: TaskSpec
    run: RunDetail


class QuotedOperation(ApiModel):
    kind: Literal['set_absence', 'clear_absence', 'fix_assignment', 'remove_fixed', 'set_objective']
    quote: str
    employee_quote: str | None
    scope_quote: str | None
    objective: Literal['compare', 'min_changes', 'min_cost'] | None


class QuotedIntent(ApiModel):
    operations: list[QuotedOperation]
    questions: list[str]
    unsupported: list[str]


class IntentReviewRule(ApiModel):
    id: str
    label: str
    detail: str
    quotes: list[str]
    changed: bool


class IntentProposal(ApiModel):
    absence: Absence | None
    fixed_assignments: dict[str, str]
    objective: Literal['compare', 'min_changes', 'min_cost']
    review: list[IntentReviewRule]
    issues: list[str]


class AnalysisPrice(ApiModel):
    currency: Literal['USD']
    input_micro_usd_per_million: int
    cached_micro_usd_per_million: int
    output_micro_usd_per_million: int
    source_url: str
    checked_at: str


class AnalysisUsage(ApiModel):
    input_tokens: int
    cached_input_tokens: int
    output_tokens: int
    total_tokens: int
    estimated_cost_micro_usd: int
    price: AnalysisPrice


class AiConfiguration(ApiModel):
    provider: Literal['openai']
    provider_mode: Literal['live', 'test']
    configured: bool
    model: str
    prompt_version: str
    max_cost_micro_usd: int
    max_output_tokens: int
    max_employees: int
    max_shifts: int
    timeout_seconds: int
    price: AnalysisPrice | None
    reason: str | None


class StartIntent(ApiModel):
    source_version_id: str
    task_spec_id: str
    request: str = Field(min_length=1, max_length=8000)
    request_key: str = Field(pattern=r'^[0-9a-fA-F-]{36}$')
    consent: bool
    max_cost_micro_usd: int = Field(default=50000, ge=1, le=100000)


class IntentDraft(ApiModel):
    id: str
    project_id: str
    source_version_id: str
    task_spec_id: str
    source_hash: str
    request: str
    request_hash: str
    provider: Literal['openai']
    provider_mode: Literal['live', 'test']
    model: str
    response_model: str | None
    response_id: str | None
    prompt_version: str
    status: Literal['queued', 'running', 'ready', 'needs_clarification', 'failed', 'cancelled', 'confirmed']
    is_current: bool
    can_confirm: bool
    max_cost_micro_usd: int
    estimated_max_cost_micro_usd: int
    proposal: IntentProposal | None
    usage: AnalysisUsage | None
    cancel_requested: bool
    confirmed_task_id: str | None
    events: list[RunEvent]
    created_at: datetime
    finished_at: datetime | None


class ConfirmIntent(ApiModel):
    expected_source_version_id: str
    expected_task_id: str
    request_hash: str
    acknowledged_rule_ids: list[str]


class ReviewCandidate(ApiModel):
    id: str
    run_id: str
    base_scenario_id: str
    revision_id: str | None
    revision_version: int | None
    parent_revision_id: str | None
    origin: Literal['solver', 'manual']
    scenario: Scenario
    candidate_hash: str
    validation: ValidationReport | None
    metrics: ScenarioMetrics | None
    evidence: list[ChangeEvidence]
    search_status: SearchStatus | None
    created_at: datetime
    validated_at: datetime | None


class ScenarioReview(ApiModel):
    project_id: str
    source_version_id: str
    task_spec_id: str
    run_id: str
    is_current: bool
    candidates: list[ReviewCandidate]


class CreateRevision(ApiModel):
    source_version_id: str
    task_spec_id: str
    base_scenario_id: str
    parent_revision_id: str | None = None
    assignments: dict[str, str] = Field(min_length=1, max_length=5000)
    request_key: str = Field(pattern=r'^[0-9a-fA-F-]{36}$')


class ApproveScenario(ApiModel):
    source_version_id: str
    task_spec_id: str
    run_id: str
    scenario_id: str
    revision_id: str | None = None
    candidate_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    acknowledged: bool
    acknowledged_unknown_cost: bool = False
    request_key: str = Field(pattern=r'^[0-9a-fA-F-]{36}$')


class ExportReceipt(ApiModel):
    id: str
    project_id: str
    approval_id: str
    format: Literal['csv', 'xlsx']
    exporter_version: str
    sha256: str
    size: int
    filename: str
    created_at: datetime


class ApprovalDetail(ApiModel):
    id: str
    project_id: str
    source_version_id: str
    task_spec_id: str
    run_id: str
    scenario_id: str
    revision_id: str | None
    source_version: int
    task_version: int
    source_hash: str
    candidate_hash: str
    scenario_label: str
    origin: Literal['solver', 'manual']
    actor: Literal['local_user']
    approved_at: datetime
    validator_version: str
    has_unknown_cost: bool
    is_current: bool
    is_selected: bool
    exports: list[ExportReceipt]


class PrepareApprovedExport(ApiModel):
    format: Literal['csv', 'xlsx']
    candidate_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
