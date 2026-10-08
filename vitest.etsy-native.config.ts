import base from "./vitest.native.config";
import {defineConfig} from "vitest/config";
export default defineConfig({...base,test:{...base.test,include:["tests/etsy-controlled.db.test.ts","tests/native/etsy-controlled.native.ts"]}});
