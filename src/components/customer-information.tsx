import type { Answer } from "@/modules/intake/contracts";
import styles from "./operations.module.css";
export function CustomerInformation({answers}: {answers:Answer[]}) {
  return <dl className={styles.answers}>{answers.map((answer,i) => <div className={styles.answer} key={i}><dt dir="auto">{answer.label || "Customer information"}</dt><dd dir="auto">{answer.value || "Not provided"}</dd></div>)}</dl>;
}
