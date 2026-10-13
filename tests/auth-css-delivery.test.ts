import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
const target=process.env.AUTH_CSS_CHECK_URL;
it.runIf(!!target)("sign-in HTML references generated CSS matching the actual outlined anchor",async()=>{
 const base=new URL(target!);expect(["localhost","127.0.0.1"]).toContain(base.hostname);
 const component=readFileSync("src/components/authentication/secondary-action.tsx","utf8");
 expect(component).toContain('import styles from "./authentication.module.css"');expect(component).toContain('className={styles.outlinedAction}');
 const source=readFileSync("src/components/authentication/authentication.module.css","utf8");expect(source).toMatch(/\.outlinedAction\s*\{[^}]*display:flex/);
 const response=await fetch(new URL("/sign-in",base));expect(response.status).toBe(200);const html=await response.text();
 const anchors=[...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)].filter(match=>match[1].includes('href="/sign-up"'));
 expect(anchors).toHaveLength(1);expect(anchors[0][2]).toBe("Create account");const className=anchors[0][1].match(/class="([^"]+)"/)?.[1];expect(className).toContain("outlinedAction");
 const sheets=[...html.matchAll(/<link\b[^>]*>/g)].filter(match=>match[0].includes('rel="stylesheet"')).map(match=>match[0]);expect(sheets.length).toBeGreaterThan(0);
 let found=false;
 for(const tag of sheets){
  expect(tag).not.toMatch(/\bdisabled(?:\s|=|>)/);const href=tag.match(/href="([^"]+)"/)?.[1];expect(href).toBeTruthy();
  const url=new URL(href!,base);expect(url.origin).toBe(base.origin);const result=await fetch(url);expect(result.status).toBe(200);expect(result.headers.get("content-type")).toContain("text/css");
  const css=(await result.text()).replace(/\/\*[\s\S]*?\*\//g,"");const selector="."+className;const start=css.indexOf(selector+" {");if(start<0)continue;
  const before=css.slice(0,start);expect((before.match(/\{/g)||[]).length-(before.match(/\}/g)||[]).length).toBe(0);
  const rule=css.slice(start,css.indexOf("}",start));for(const declaration of ["display: flex","width: 100%","min-height: 46px","margin-top: 16px","border: 1px solid #cbd5e1"]){expect(rule).toContain(declaration);}
  expect(css).toContain(selector+":visited");expect(css).toContain("text-decoration: none");found=true;
 }
 expect(found).toBe(true);
});
