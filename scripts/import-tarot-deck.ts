/** Explicit local/operator provisioning; never imported by application routes or startup. */
import {createDatabase} from "../src/db/client";
import {loadBundledDeck,verifyBundledArtwork} from "../src/modules/media/bundled-deck";
import {platformMediaRegistry} from "../src/modules/media/platform-registry";
import {configuredPlatformAssets} from "../src/infrastructure/document-runtime";
import {resolveTarotCardAsset,readFrozenPlatformAssetBytes} from "../src/modules/media/service";
const packageValue=await loadBundledDeck(),storage=configuredPlatformAssets();
await verifyBundledArtwork(packageValue,storage);
if(process.argv.includes("--publish")){
 const url=process.env.DATABASE_URL;if(!url)throw Error("Local database configuration required.");
 // This controlled importer is local-only; production provisioning is a separate operator action.
 const host=new URL(url).hostname;if(!["localhost","127.0.0.1","[::1]"].includes(host))throw Error("Local database required.");
 const {db,client}=createDatabase(url);
 try{
  await platformMediaRegistry(db).importApprovedDeck(packageValue);
  for(const m of packageValue.version.mappings){const r=await resolveTarotCardAsset(db,{deckKey:packageValue.deck.key,deckVersion:packageValue.version.version,cardKey:m.cardKey});await readFrozenPlatformAssetBytes(db,storage,r.asset);}
  console.log("Approved deck verified: 78 cards resolved. Replay is safe; Store preferences unchanged.");
 }finally{await client.end();}
}else console.log("78 packaged images verified. No database writes. Use --publish for explicit local registry import.");
