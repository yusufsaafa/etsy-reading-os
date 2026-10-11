import {beforeEach,it,expect,vi} from "vitest";
const mocks=vi.hoisted(()=>({orders:vi.fn(),detail:vi.fn(),reviews:vi.fn(),output:vi.fn(),context:vi.fn()}));
vi.mock("../src/modules/orders/service",()=>({ordersData:mocks.orders}));
vi.mock("../src/modules/orders/detail",()=>({orderDetailData:mocks.detail}));
vi.mock("../src/modules/review/service",()=>({orderReadingReviewStatuses:mocks.reviews,ReviewUnavailable:class extends Error{}}));
vi.mock("../src/modules/production/documents",()=>({readingOutputStatus:mocks.output}));
vi.mock("../src/modules/generation/context",()=>({buildGenerationContext:mocks.context}));
import {ordersWorkQueue} from "../src/modules/orders/work-queue";
import {ordersQuery} from "../src/modules/orders/query";
import {AdmissionError} from "../src/modules/generation/contracts";
import type {Database} from "../src/db/client";
const scope={userId:"u",organizationId:"o",storeId:"s"};
const db={transaction:async(fn:(tx:unknown)=>unknown)=>fn({})} as unknown as Database;
beforeEach(()=>{vi.resetAllMocks();mocks.orders.mockResolvedValue({rows:[{id:"order",status:"Generated",priority:4,count:2}],page:1,pages:1});mocks.detail.mockResolvedValue({units:[{id:"one"},{id:"two"}],reviews:[]});mocks.reviews.mockResolvedValue(new Map([["one","Ready for review"],["two","Ready for review"]]));});
it("generated output differs from persisted pending Review",async()=>{
 expect((await ordersWorkQueue(db,scope,ordersQuery())).rows[0].status).toBe("Generated");mocks.detail.mockResolvedValue({units:[{id:"one"},{id:"two"}],reviews:[{unitId:"one"}]});expect((await ordersWorkQueue(db,scope,ordersQuery())).rows[0].status).toBe("Awaiting Review");expect(mocks.output).not.toHaveBeenCalled();
});
it.each([["Waiting",false,null,"PDF Pending"],["Preparing",false,null,"PDF Pending"],["Problem",false,null,"PDF needs attention"],["Ready to deliver",true,"artifact","PDF Ready"],["Approved",true,null,"Approved"]])("projects current approved document evidence %s",async(status,deliveryReady,artifactId,label)=>{
 mocks.reviews.mockResolvedValue(new Map([["one","Approved"],["two","Approved"]]));mocks.output.mockResolvedValue({status,deliveryReady,artifactId});expect((await ordersWorkQueue(db,scope,ordersQuery())).rows[0].status).toBe(label);
});
it("historical Review or PDF cannot make current generated output approved",async()=>{mocks.reviews.mockResolvedValue(new Map());expect((await ordersWorkQueue(db,scope,ordersQuery())).rows[0]).toMatchObject({status:"Reading needs attention",priority:3});expect(mocks.output).not.toHaveBeenCalled();});
it("mixed sibling readiness requires all independent readings",async()=>{mocks.reviews.mockResolvedValue(new Map([["one","Approved"],["two","Ready for review"]]));mocks.detail.mockResolvedValue({units:[{id:"one"},{id:"two"}],reviews:[{unitId:"one"}]});expect((await ordersWorkQueue(db,scope,ordersQuery())).rows[0].status).toBe("Awaiting Review");expect(mocks.output).not.toHaveBeenCalled();});
it("preparation readiness uses admission evidence; no provider is invoked",async()=>{mocks.orders.mockResolvedValue({rows:[{id:"order",status:"Pending",priority:4}]});expect((await ordersWorkQueue(db,scope,ordersQuery())).rows[0].status).toBe("Ready for Preparation");expect(mocks.context).toHaveBeenCalledTimes(2);mocks.orders.mockResolvedValue({rows:[{id:"order",status:"Pending",priority:4}]});mocks.context.mockRejectedValue(new AdmissionError("READING_HOLD"));expect((await ordersWorkQueue(db,scope,ordersQuery())).rows[0].status).toBe("Pending");});
it.each(["Canceled","In production","Information or setup needed"])("holds and active states are never superseded by approval for %s",async(status)=>{mocks.orders.mockResolvedValue({rows:[{id:"order",status,priority:status==="Information or setup needed"?3:4}]});expect((await ordersWorkQueue(db,scope,ordersQuery())).rows[0].status).toBe(status);expect(mocks.reviews).not.toHaveBeenCalled();});
