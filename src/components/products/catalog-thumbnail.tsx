"use client";
import {useState} from "react";
import {Icon} from "../icon";
import styles from "./catalog-list.module.css";
export function CatalogThumbnail({src}:{src:string|null}) {
 const [failedSrc,setFailedSrc]=useState<string|null>(null);
 return <span className={styles.thumbnail}>{src&&src!==failedSrc?<img src={src} alt="" width={48} height={48} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailedSrc(src)}/>:<Icon name="image" width={22} height={22}/>}</span>;
}
