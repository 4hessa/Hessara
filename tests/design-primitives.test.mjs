import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Render the actual Radix components. A small TSX loader resolves the project's
// alias without starting Next or changing the browser's module graph.
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
const cache = new Map();
function load(relative) {
  const path = resolve(root, relative);
  if (cache.has(path)) return cache.get(path).exports;
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  const loadedModule = { exports: {} };
  cache.set(path, loadedModule);
  const localRequire = specifier => {
    if (specifier.startsWith("@/")) {
      const target = specifier.slice(2);
      return load(`${target}.${target.startsWith("components/") ? "tsx" : "ts"}`);
    }
    if (specifier.startsWith(".")) return load(resolve(dirname(path), specifier));
    return require(specifier);
  };
  new Function("require", "module", "exports", outputText)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const button = load("components/ui/button.tsx");
const input = load("components/ui/input.tsx");
const tabs = load("components/ui/tabs.tsx");
const select = load("components/ui/select.tsx");
const menu = load("components/ui/dropdown-menu.tsx");
const dialog = load("components/ui/dialog.tsx");
const tooltip = load("components/ui/tooltip.tsx");
const { DirectionProvider } = load("components/ui/direction.tsx");
const h = React.createElement;
const render = (...args) => renderToStaticMarkup(h(...args));

// Floating portals intentionally do not mount during SSR. Inspect the public
// wrapper's element props for bounds/geometry; pointer, focus trapping, Escape,
// reduced-motion appearance and collision behavior remain browser QA concerns.
function children(element) { return React.Children.toArray(element.props.children); }

test("Button preserves native form behavior, props and asChild link semantics", () => {
  const native = render(button.Button, { type: "submit", disabled: true, "aria-busy": true }, "Save");
  assert.match(native, /type="submit"/);
  assert.match(native, /disabled=""/);
  assert.match(native, /aria-busy="true"/);
  assert.doesNotMatch(native, /transition-all/);
  assert.match(native, /pointer-coarse:min-h-11/);
  const defaultType = render(button.Button, {}, "Action");
  assert.doesNotMatch(defaultType, /\stype=/, "the wrapper must not change existing implicit form submission behavior");
  const link = render(button.Button, { asChild: true, variant: "outline" }, h("a", { href: "/research" }, "Research"));
  assert.match(link, /^<a /);
  assert.match(link, /href="\/research"/);
  assert.doesNotMatch(link, /<button/);
  assert.doesNotMatch(button.buttonVariants({ size: "xs" }), /pointer-coarse:min-h-11/, "explicit compact variants retain their dimensions");
});

test("Input keeps invalid/disabled/value semantics and a visible focus contract", () => {
  const html = render(input.Input, { type: "email", "aria-invalid": true, "aria-describedby": "email-error", disabled: true, defaultValue: "user@example.test", dir: "ltr" });
  assert.match(html, /type="email"/);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /aria-describedby="email-error"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /value="user@example.test"/);
  assert.match(html, /focus-visible:ring/);
  assert.match(html, /transition-\[background-color,border-color,color,box-shadow\]/);
});

test("actual Radix Tabs inherit RTL and retain tab/tabpanel accessibility with visible panel focus", () => {
  const html = render(DirectionProvider, { dir: "rtl" }, h(tabs.Tabs, { defaultValue: "source" },
    h(tabs.TabsList, { "aria-label": "مراحل" },
      h(tabs.TabsTrigger, { value: "source" }, "المصدر"),
      h(tabs.TabsTrigger, { value: "output", disabled: true }, "الناتج")),
    h(tabs.TabsContent, { value: "source" }, "تمثيل المصدر")));
  assert.match(html, /dir="rtl"/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /role="tab" aria-selected="true"/);
  assert.match(html, /role="tabpanel"/);
  assert.match(html, /tabindex="0"[^>]*data-slot="tabs-content"/);
  assert.match(html, /focus-visible:outline-2/);
  assert.match(html, /focus-visible:outline-solid/, "focus must restore outline-style after the base outline-none utility");
  assert.match(html, /focus-visible:outline-ring/);
  assert.match(tabs.TabsTrigger({ value: "x" }).props.className, /after:-end-1/);
  assert.doesNotMatch(html, /transition-all/);
});

test("actual Radix Select honors provider RTL and keeps the combobox trigger semantics", () => {
  const html = render(DirectionProvider, { dir: "rtl" }, h(select.Select, { defaultValue: "ar" },
    h(select.SelectTrigger, { "aria-label": "اللغة" }, h(select.SelectValue, {}, "العربية"))));
  assert.match(html, /role="combobox"/);
  assert.match(html, /dir="rtl"/);
  assert.match(html, /aria-label="اللغة"/);
  assert.match(html, /aria-expanded="false"/);
  const item = select.SelectItem({ value: "ar", children: "العربية" });
  assert.match(item.props.className, /pe-8 ps-2/);
  assert.match(children(item)[0].props.className, /end-2/);
});

test("dropdown/submenu wrappers keep Radix origin variables and logical RTL affordances", () => {
  const content = menu.DropdownMenuContent({});
  const floating = children(content)[0];
  assert.match(floating.props.className, /origin-\(--radix-dropdown-menu-content-transform-origin\)/);
  assert.match(floating.props.className, /max-w-\(--radix-dropdown-menu-content-available-width\)/);
  const sub = menu.DropdownMenuSubTrigger({ children: "More" });
  const arrow = children(sub).at(-1);
  assert.match(arrow.props.className, /ms-auto/);
  assert.match(arrow.props.className, /rtl:rotate-180/);
  assert.equal(arrow.props["aria-hidden"], "true");
  const checked = menu.DropdownMenuCheckboxItem({ children: "Enabled", checked: true });
  assert.equal(checked.props.checked, true);
  assert.match(children(checked)[0].props.className, /start-2/);
});

test("Dialog keeps close labels localizable, reserves a logical dismiss target and bounds long content", () => {
  const portal = dialog.DialogContent({ children: "Body", closeLabel: "إغلاق" });
  const content = children(portal)[1];
  assert.match(content.props.className, /max-h-\[calc\(100dvh_-_2rem\)\]/);
  assert.match(content.props.className, /overflow-y-auto overscroll-contain/);
  const dismiss = children(content).at(-1);
  assert.match(dismiss.props.className, /end-3/);
  assert.match(dismiss.props.className, /size-11/);
  assert.equal(children(dismiss).at(-1).props.children, "إغلاق");
  assert.equal("closeLabel" in content.props, false, "the wrapper-only label must not leak to the DOM");
  const header = render(dialog.DialogHeader, {}, "العنوان");
  assert.match(header, /text-start/);
  assert.doesNotMatch(header, /text-left/);
  const footer = render(dialog.Dialog, {}, h(dialog.DialogFooter, { showCloseButton: true, closeLabel: "Dismiss" }));
  assert.match(footer, /type="button"/);
  assert.match(footer, />Dismiss<\/button>/);
});

test("Tooltip supports deliberate first hover and bounded origin-aware content", () => {
  const provider = tooltip.TooltipProvider({});
  assert.equal(provider.props.delayDuration, 350);
  assert.equal(provider.props.skipDelayDuration, 200);
  assert.equal(tooltip.TooltipProvider({ delayDuration: 0 }).props.delayDuration, 0);
  const content = children(tooltip.TooltipContent({ children: "Long explanation" }))[0];
  assert.equal(content.props.sideOffset, 6);
  assert.match(content.props.className, /--radix-tooltip-content-available-width/);
  assert.match(content.props.className, /overflow-wrap:anywhere/);
  assert.match(content.props.className, /origin-\(--radix-tooltip-content-transform-origin\)/);
  assert.match(content.props.className, /motion-reduce:animate-none/);
});
