// The dashboard's date: a valid YYYY-MM-DD from the URL, otherwise today in India time.
// "Today" used to be the UTC date, which is still yesterday between midnight and 5:30am IST.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function todayInIndia(now = new Date()): string {
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function resolveDashboardDate(input: string | undefined, now = new Date()): string {
  if (input && DATE_PATTERN.test(input)) {
    const parsed = new Date(`${input}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === input) {
      return input;
    }
  }
  return todayInIndia(now);
}
