export const informationIssues = ["missing_input", "unusable_input", "quantity_context"];
export function readingStatus(issues: string[]) {
  if (issues.includes("canceled")) return "Canceled";
  if (issues.includes("unpaid")) return "Awaiting payment";
  if (issues.includes("refund_review")) return "Review refund";
  if (issues.includes("source_changed")) return "Purchase details changed";
  if (issues.includes("not_digital")) return "Review product";
  if (issues.includes("unmapped_listing")) return "Product setup required";
  if (issues.includes("mapping_paused")) return "Product paused";
  if (issues.some(i => informationIssues.includes(i))) return "Customer information needed";
  return issues.length ? "Review required" : "Ready";
}
export function orderStatus(readings: { issues: string[] }[]) {
  const issues = [...new Set(readings.flatMap(r => r.issues))];
  return readingStatus(issues);
}
export function displayDate(date: Date) { return new Intl.DateTimeFormat("en", {day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(date); }
