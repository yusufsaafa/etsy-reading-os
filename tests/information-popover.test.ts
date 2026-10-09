import {it,expect} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync} from "node:fs";
import {InformationPopover,informationPosition} from "../src/components/information-popover";
it("uses an explicit named native popover invoker with light-dismiss and dialog semantics",()=>{
 const html=renderToStaticMarkup(createElement(InformationPopover,{label:"Orders definition",iconOnly:true,children:"Real persisted purchases"}));
 expect(html).toContain('type="button"');expect(html).toContain('aria-haspopup="dialog"');expect(html).toContain('aria-expanded="false"');expect(html).toContain('popover="auto"');expect(html).toContain('role="dialog"');expect(html).toContain('tabindex="-1"');expect(html).toContain('popoverTargetAction="hide"');expect(html).toContain("Real persisted purchases");expect(html).not.toContain("<details");
 const target=html.match(/popoverTarget="([^"]+)"/)![1];expect(html).toContain(`id="${target}"`);expect(html).toContain(`aria-controls="${target}"`);
});
it("uses a native modal for long reference content with an explicit close button",()=>{
 const html=renderToStaticMarkup(createElement(InformationPopover,{label:"Daily values",dialog:true,children:"All daily observations"}));
 expect(html).toContain("<dialog");expect(html).toContain('aria-label="Close Daily values"');expect(html).not.toContain(' open');expect(html).toContain("All daily observations");
});
it.each([
 [{left:100,top:20,bottom:64},{width:320,height:160},{width:1200,height:800},{left:100,top:72}],
 [{left:350,top:700,bottom:744},{width:320,height:160},{width:390,height:844},{left:58,top:532}],
 [{left:0,top:0,bottom:44},{width:336,height:600},{width:360,height:624},{left:12,top:12}],
])("keeps information within desktop and mobile viewport bounds", (trigger,panel,viewport,expected)=>{expect(informationPosition(trigger,panel,viewport)).toEqual(expected);});
it("has native Escape/outside-dismiss behavior plus focus and viewport event integration",()=>{
 const source=readFileSync("src/components/information-popover.tsx","utf8"),css=readFileSync("src/components/information-popover.module.css","utf8");
 expect(source).toContain('popover="auto"');expect(source).toContain("onToggle");expect(source).toContain("focus({preventScroll:true})");expect(source).toContain("trigger.current?.focus()");expect(source).toContain("onClose={restore}");expect(source).toContain('addEventListener("scroll",position');expect(source).toContain('removeEventListener("scroll",position');expect(source).toContain("visualViewport");expect(css).toContain("position:fixed");expect(css).toContain("100dvh - 24px");expect(css).toContain(":focus-visible");
});
