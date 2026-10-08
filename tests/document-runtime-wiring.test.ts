import {it,expect,vi,beforeEach,afterEach} from "vitest";
const mocks=vi.hoisted(()=>({document:vi.fn(),documentCycle:vi.fn(),tick:vi.fn(),run:vi.fn()}));
vi.mock("../src/infrastructure/ai/runtime",()=>({generationRuntime:()=>({})}));
vi.mock("../src/modules/production/scheduler",()=>({ProductionScheduler:{forInternalWorker:()=>({})}}));
vi.mock("../src/modules/production/execution",()=>({ProductionExecutor:{forInternalWorker:()=>({})},runProductionCycle:vi.fn()}));
vi.mock("../src/modules/production/recovery",()=>({ProductionRecovery:{forInternalWorker:()=>({reconcileProductionWork:vi.fn()})}}));
vi.mock("../src/modules/production/tick",()=>({ProductionTick:{forInternalWorker:mocks.tick}}));
vi.mock("../src/modules/production/documents",()=>({DocumentProductionWorker:{forInternalWorker:mocks.document}}));
import {productionRuntime} from "../src/modules/production/runtime";
import {LocalArtifactStorage} from "../src/infrastructure/local-artifact-storage";
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("DOCUMENT_STORAGE_DRIVER","");mocks.document.mockReturnValue({runCycle:mocks.documentCycle});mocks.tick.mockReturnValue({runProductionTick:mocks.run});});
afterEach(()=>vi.unstubAllEnvs());
it("default storage ports wire into the existing explicit worker without executing work on construction",()=>{
 vi.stubEnv("NODE_ENV","development");vi.stubEnv("DOCUMENT_STORAGE_DRIVER","local");vi.stubEnv("DOCUMENT_ARTIFACT_ROOT","/private/tmp/unused-reading-ports");
 const runtime=productionRuntime({} as never);expect(mocks.document).toHaveBeenCalledOnce();expect(mocks.document.mock.calls[0][1].artifacts).toBeInstanceOf(LocalArtifactStorage);expect(mocks.documentCycle).not.toHaveBeenCalled();expect(mocks.run).not.toHaveBeenCalled();expect(runtime.runProductionTick).toBeTypeOf("function");
});
it("unconfigured storage does not create a fake adapter or dispatch document work",()=>{productionRuntime({} as never);expect(mocks.document).not.toHaveBeenCalled();expect(mocks.tick.mock.calls[0][4]).toBeUndefined();});
it("explicit trusted durable ports remain the integration boundary for deployment",()=>{
 vi.stubEnv("NODE_ENV","production");const ports={assets:{read:vi.fn()},artifacts:{putImmutable:vi.fn(),read:vi.fn()}};productionRuntime({} as never,ports);expect(mocks.document).toHaveBeenCalledWith({},ports);expect(mocks.documentCycle).not.toHaveBeenCalled();
});
