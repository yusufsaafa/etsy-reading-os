import type { DocumentDesignConfiguration } from "./contracts";
/** Presentation presets select retained deterministic templates; never arbitrary CSS/fonts. */
export const STUDIO_TEMPLATES = [
 {key:"classic",name:"Classic Ivory",description:"Warm editorial pages with a restrained frame.",primary:"#302B26",accent:"#285957"},
 {key:"mystic",name:"Mystic Parchment",description:"Parchment pages, celestial details and a double frame.",primary:"#3F3026",accent:"#805A42"},
 {key:"minimal",name:"Minimal",description:"Clean white pages and generous, quiet typography.",primary:"#242424",accent:"#77746D"},
 {key:"modern",name:"Modern",description:"Clear sans-serif headings and a bright accent.",primary:"#162124",accent:"#EF5D3D"},
 {key:"luxury-editorial",name:"Luxury Editorial",description:"Large titles, inset text and strong editorial rules.",primary:"#171717",accent:"#9D2F27"},
 {key:"tarot-atelier",name:"Tarot Atelier",description:"Gallery-inspired pages; cards only when approved for the reading.",primary:"#171717",accent:"#765B37"},
] as const;
export function studioPreset(key:DocumentDesignConfiguration["template"],brandName=""):DocumentDesignConfiguration {
 const preset=STUDIO_TEMPLATES.find(t=>t.key===key);if(!preset)throw new Error("Unsupported template");
 return {contractVersion:"document-design/v1",template:key,brand:{name:brandName,primaryColor:preset.primary,accentColor:preset.accent},typography:{heading:key==="modern"||key==="minimal"?"inter":"source-serif-4",body:"inter"},cover:"BRAND",display:{customerName:false,readingDate:true,sectionDividers:true,cardImagery:false,footer:true},footerText:""};
}
/** Template changes preserve deliberate owner settings; only unsupported imagery is cleared. */
export function selectStudioTemplate(configuration:DocumentDesignConfiguration,key:DocumentDesignConfiguration["template"]):DocumentDesignConfiguration {
 return {...configuration,template:key,display:{...configuration.display,cardImagery:key==="minimal"||key==="modern"?false:configuration.display.cardImagery}};
}
