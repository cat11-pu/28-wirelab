import assert from "node:assert";
import { suffixKey, encodeName, decodeName } from "../wire.js";
import { record, build, parse } from "../ops.js";
import { render } from "../app.js";

const base = {
  plan: [], bytes: [], suffix: [], forms: [], records: [], paths: [],
  occurrences: 0, follows: 0, checked: 0, literal: 0, saved: 0, compressed: 0,
  adds: 0, builds: 0, parses: 0, clears: 0, fails: 0, ledger: []
};
const add = { kind: "add", section: "an", name: ["a"], type: "A", ttl: 5, data: [1, 2, 3, 4] };
const spec = { state: base, events: [add, { kind: "build" }] };

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log("ok " + name);
  } catch (error) {
    failed += 1;
    console.log("FAIL " + name + " :: " + error.message);
  }
}

check("suffixKey 用点连", () => {
  assert.strictEqual(suffixKey(["a", "b", "c"]), "a.b.c");
});

check("encodeName 字面写一个名字", () => {
  assert.deepStrictEqual(encodeName(["a"], [], 0).wire, [1, 97, 0]);
});

check("decodeName 把字面名字读回来", () => {
  const named = decodeName([1, 97, 0], 0);
  assert.deepStrictEqual(named.labels, ["a"]);
  assert.strictEqual(named.end, 3);
});

check("record 记一条", () => {
  const next = record(base, add);
  assert.strictEqual(next.plan.length, 1);
  assert.strictEqual(next.adds, 1);
});

check("build 一条记录后报文非空", () => {
  const next = parse(build(record(base, add)));
  assert.strictEqual(next.bytes.length, 29);
});

check("parse 后记录对得上", () => {
  const next = parse(build(record(base, add)));
  assert.strictEqual(next.checked, 1);
  assert.deepStrictEqual(next.records[0], ["an", ["a"], "A", 5, [1, 2, 3, 4]]);
});

check("render 数事件", () => {
  assert.strictEqual(render(spec).count_events, 2);
});

console.log("7 cases, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
