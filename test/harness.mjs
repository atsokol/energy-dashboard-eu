// Assembles the ```js cells of a Framework page into a plain ES module that runs
// under Node, so page logic can be exercised against the real CSVs without a browser.
//
// Framework resolves cells reactively, in dependency order regardless of position.
// This harness runs them linearly, so it runs every declaring cell in source order
// and every display-only cell afterwards. That holds as long as declarations appear
// in dependency order within the page — which is the readable way to write one anyway.

import {existsSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));

// Framework serves npm: imports from its own module cache, which can hold a different
// version than node_modules. Test what the browser actually loads.
function npmModule(pkg) {
  const dir = resolve(ROOT, "src/.observablehq/cache/_npm");
  const hit = existsSync(dir) && readdirSync(dir).find((d) => d.replace(/@[^@]*$/, "") === pkg);
  if (!hit) throw new Error(`npm:${pkg} is not in Framework's module cache — run \`npm run build\` first`);
  return {path: resolve(dir, hit, "_esm.js"), resolved: hit};
}

export function buildHarness(page, outFile) {
  const md = readFileSync(resolve(ROOT, "src", `${page}.md`), "utf-8");
  const blocks = [...md.matchAll(/^```js\n([\s\S]*?)^```/gm)].map((m) => m[1]);
  if (!blocks.length) throw new Error(`no js cells found in src/${page}.md`);

  const imports = new Set();
  const resolved = new Set();
  const raw = new Set();
  const decls = [];
  const exprs = [];

  for (const block of blocks) {
    const body = [];
    for (const line of block.split("\n")) {
      if (/^\s*import\s/.test(line)) {
        imports.add(
          line
            .replace(/"npm:([^"]+)"/, (_, spec) => {
              const {path, resolved: v} = npmModule(spec.replace(/@[\d^~.].*$/, ""));
              resolved.add(`npm:${spec} → ${v}`);
              return `"${path}"`;
            })
            .replace(/"\.\/components\//g, `"${resolve(ROOT, "src/components")}/`)
        );
      } else {
        body.push(line);
      }
    }
    const text = body.join("\n").trim();
    if (!text) continue;
    if (/^\s*(?:const|let|var|function|class)\s/m.test(text)) {
      decls.push(text);
      if (text.includes("FileAttachment(")) {
        for (const m of text.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) raw.add(m[1]);
      }
    } else {
      exprs.push(text);
    }
  }

  // Export every top-level binding the page declares, so tests can assert on any of them.
  const names = [...new Set(decls.flatMap((d) => [...d.matchAll(/^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1])))];

  writeFileSync(outFile, `
import * as d3 from "d3";
import * as Plot from "@observablehq/plot";
import {JSDOM} from "jsdom";
import {existsSync, readFileSync} from "node:fs";
${[...imports].join("\n")}

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", {value: dom.window.navigator, configurable: true});
for (const k of ["Event", "CustomEvent", "Node", "SVGElement", "HTMLElement"]) globalThis[k] = dom.window[k];
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

// jsdom ships no canvas backend; Plot paints continuous colour legends into one.
dom.window.HTMLCanvasElement.prototype.getContext = () => ({
  createLinearGradient: () => ({addColorStop() {}}),
  fillRect() {}, set fillStyle(v) {}, get fillStyle() { return ""; }
});
dom.window.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,";

// Framework globals, stubbed to the values a page sees on first render.
globalThis.width = Number(process.env.HARNESS_WIDTH ?? 800);
// Like Framework's html, a DOM node interpolated into the template is inserted as itself.
globalThis.html = (strings, ...values) => {
  const t = dom.window.document.createElement("template");
  const nodes = [];
  t.innerHTML = String.raw({raw: strings}, ...values.map((v) =>
    v instanceof dom.window.Node ? '<template data-slot="' + (nodes.push(v) - 1) + '"></template>' : v
  ));
  for (const slot of t.content.querySelectorAll("template[data-slot]")) slot.replaceWith(nodes[+slot.dataset.slot]);
  return t.content.firstElementChild ?? t.content;
};
const view = (input) => input.value;
const Generators = {input: (input) => input.value};
// Event targets, so a page can link one input to another.
const input = (value) => Object.assign(new dom.window.EventTarget(), {value});
const Inputs = {
  date: ({value}) => input(value),
  range: (domain, {value} = {}) => input(value),
  radio: (options, {value} = {}) => input(value),
  select: (options, {value} = {}) => input(value),
  checkbox: (options, {value} = {}) => input(value),
};
// Loader outputs are read from cache/ (their committed snapshot); static files from src/data/.
const attachmentText = (path) => {
  const name = path.replace(/^.*\\/data\\//, "");
  const cached = ${JSON.stringify(resolve(ROOT, "cache"))} + "/" + name;
  return readFileSync(existsSync(cached) ? cached : ${JSON.stringify(resolve(ROOT, "src/data"))} + "/" + name, "utf-8");
};
const FileAttachment = (path) => ({
  csv: async ({typed} = {}) => d3.csvParse(attachmentText(path), typed ? d3.autoType : undefined),
  json: async () => JSON.parse(attachmentText(path))
});

${decls.join("\n\n")}

export const cells = {${names.join(", ")}};
export const outputs = [
${exprs.map((e, i) => `  {index: ${i}, render: () => (${e})}`).join(",\n")}
];
`);

  return {declarations: decls.length, outputs: exprs.length, resolved: [...resolved], raw};
}
