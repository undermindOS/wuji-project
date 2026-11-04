import csv
import io

HEADERS = {
    'schedule': ['shift_id', 'starts_at', 'ends_at', 'role', 'employee_id', 'pinned'],
    'employees': ['employee_id', 'name', 'roles', 'rate_per_hour_minor', 'max_weekly_minutes', 'currency'],
    'availability': ['employee_id', 'shift_id', 'availability'],
}
SHEETS = {'Schedule': 'schedule', 'Employees': 'employees', 'Availability': 'availability'}
LIMITS = {'schedule': 5000, 'employees': 500, 'availability': 50000}
CURRENCIES = {'RUB', 'USD', 'EUR', 'UYU', 'ARS', 'BRL', 'GBP'}
MAX_FILE_BYTES = 5 * 1024 * 1024


def csv_bytes(rows):
    output = io.StringIO(newline='')
    csv.writer(output, lineterminator='\n').writerows(rows)
    return output.getvalue().encode('utf-8')
