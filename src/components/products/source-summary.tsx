"use client";
import Image from "next/image";
import {useState} from "react";
import {safeListingThumbnail} from "@/modules/etsy/listing-thumbnail";
import {etsyListingUrl} from "./setup-model";
import styles from "./setup.module.css";
export function SourceSummary({listing}:{listing:{id:string;title:string;state:string;thumbnailUrl?:string|null}}){
 const [failed,setFailed]=useState(false),image=safeListingThumbnail(listing.thumbnailUrl),url=etsyListingUrl(listing.id);
 return <div className={styles.source}><span className={styles.sourceImage}>{image&&!failed?<Image src={image} alt="" width={52} height={52} unoptimized referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:<span aria-hidden="true">▧</span>}</span><div><span className={styles.eyebrow}>Etsy listing</span><h2>{listing.title}</h2><div className={styles.sourceMeta}><span><span aria-hidden="true">{listing.state==="active"?"●":"○"}</span> {listing.state.replaceAll("_"," ").replace(/^./,s=>s.toUpperCase())} on Etsy</span>{url&&<a href={url} target="_blank" rel="noopener noreferrer">View on Etsy ↗</a>}</div></div></div>;
}
