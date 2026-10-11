// Isolated React fixtures only; no database, Etsy adapter, tokens, AI or storage.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const require=createRequire(import.meta.url);
const fixtureRoot=dirname(fileURLToPath(import.meta.url)),repo=resolve(fixtureRoot,'../../..');
const vitePath=require.resolve('vite',{paths:[dirname(require.resolve('vitest/package.json'))]});
const {createServer}=await import(vitePath);
const server=await createServer({configFile:false,root:fixtureRoot,esbuild:{jsx:'automatic'},resolve:{alias:[
 {find:'next/link',replacement:resolve(fixtureRoot,'link.tsx')},{find:'next/navigation',replacement:resolve(fixtureRoot,'navigation.ts')},
 {find:'@',replacement:resolve(repo,'src')},{find:'react',replacement:resolve(repo,'node_modules/react')},{find:'react-dom',replacement:resolve(repo,'node_modules/react-dom')},
]},server:{host:'127.0.0.1',port:4180,strictPort:true,fs:{allow:[fixtureRoot,repo]}}});
await server.listen();console.log('Isolated fixtures: http://127.0.0.1:4180/?fixture=connected');
