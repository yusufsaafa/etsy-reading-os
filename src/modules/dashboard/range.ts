export type DashboardRange = 7 | 30 | 90;
export function dashboardRange(value: unknown): DashboardRange {
  return value === "7" || value === 7 ? 7 : value === "90" || value === 90 ? 90 : 30;
}
export function dashboardWindow(value: unknown, cutoff: Date) {
  const days = dashboardRange(value);
  const start = new Date(cutoff);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { days, start: start.toISOString(), cutoff: cutoff.toISOString() };
}
