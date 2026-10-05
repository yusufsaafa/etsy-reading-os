export const informationIssues = ["missing_input", "unusable_input", "quantity_context"];
export function readingStatus(issues: string[], productionStatus?:string) {
  if (issues.includes("canceled")) return "Canceled";
  if (issues.includes("unpaid")) return "Awaiting payment";
  if (issues.includes("refund_review")) return "Review refund";
  if (issues.includes("source_changed")) return "Purchase details changed";
  if (issues.includes("not_digital")) return "Review product";
  if (issues.includes("unmapped_listing")) return "Product setup required";
  if (issues.includes("mapping_paused")) return "Product paused";
  if (issues.some(i => informationIssues.includes(i))) return "Customer information needed";
  if(issues.length)return "Review required";
  return productionStatus==="PROCESSING"?"Preparing":productionStatus==="SUCCEEDED"?"Ready for review":productionStatus==="FAILED"?"Problem":productionStatus==="STALE"?"Review updated information":"Ready";
}
export function orderStatus(readings: { issues: string[]; productionStatus?:string }[]) {
  const issues = [...new Set(readings.flatMap(r => r.issues))];
  return readingStatus(issues,readings.some(r=>r.productionStatus==="STALE")?"STALE":readings.some(r=>r.productionStatus==="FAILED")?"FAILED":readings.some(r=>r.productionStatus==="PROCESSING")?"PROCESSING":readings.length&&readings.every(r=>r.productionStatus==="SUCCEEDED")?"SUCCEEDED":undefined);
}
export function displayDate(date: Date) { return new Intl.DateTimeFormat("en", {day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(date); }
