import fs from "node:fs";
import { suffixKey, encodeName, decodeMessage } from "./wire.js";
import { record, build, parse, clear } from "./ops.js";
import { applyEvent } from "./app.js";
import { suffixOk, bandOk, flowOk, wireOk } from "./audit.js";

const __lines = [];
function emit(label, value) {
  __lines.push([String(label), value]);
}

const spec = JSON.parse(fs.readFileSync(process.argv[2] || "sample/wire.json", "utf8"));

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function run(events) {
  let state = copy(spec.state);
  let failed = 0;
  for (const event of events) {
    try {
      state = applyEvent(state, event);
    } catch (error) {
      failed += 1;
    }
  }
  return { state: state, failed: failed };
}

function fingerprint(state) {
  return JSON.stringify([state.plan, state.bytes, state.suffix, state.forms, state.records,
                         state.paths, state.occurrences, state.follows, state.checked,
                         state.literal, state.saved, state.compressed,
                         state.adds, state.builds, state.parses, state.clears, state.fails,
                         state.ledger]);
}

const events = spec.events || [];
const whole = run(events);
const state = whole.state;
const half = Math.ceil(events.length / 2);
const part = run(events.slice(0, half));
let tail = part.state;
let tailFailed = 0;
for (const event of events.slice(half)) {
  try {
    tail = applyEvent(tail, event);
  } catch (error) {
    tailFailed += 1;
  }
}
const replay = run(events);

emit("报文字节", state.bytes);
emit("报文字节数", state.bytes.length);
emit("后缀表", state.suffix);
emit("后缀表长", state.suffix.length);
emit("编码形态", state.forms);
emit("形态条数", state.forms.length);
emit("全字面字节数", state.literal);
emit("节省字节", state.saved);
emit("压缩名字数", state.compressed);
emit("解码记录", state.records);
emit("解码路径", state.paths);
emit("指针跳数", state.follows);
emit("往返一致", state.checked);
emit("后缀表自洽", suffixOk(state));
emit("字节自洽", bandOk(state));
emit("流水自洽", flowOk(state));
emit("解析一致", wireOk(state));
emit("计数四项", [state.adds, state.builds, state.parses, state.clears]);
emit("失败计数", state.fails);
emit("抛错事件数", whole.failed);
emit("失败账", state.ledger);

function keepsBytesOnFailure() {
  let probe = null;
  try {
    probe = record(state, { section: "zz", name: ["x"], type: "A", ttl: 0, data: [0, 0, 0, 0] });
  } catch (error) {
    return 0;
  }
  const before = JSON.stringify([state.plan, state.bytes, state.suffix, state.forms,
                                 state.records, state.paths]);
  const after = JSON.stringify([probe.plan, probe.bytes, probe.suffix, probe.forms,
                                probe.records, probe.paths]);
  if (before !== after) {
    return 0;
  }
  if (probe.fails !== state.fails + 1 || probe.ledger.length !== state.ledger.length + 1) {
    return 0;
  }
  return 1;
}

emit("失败不动字节", keepsBytesOnFailure());
emit("重放不新增", fingerprint(replay.state) === fingerprint(state) ? 0 : 1);
emit("中态不同", fingerprint(part.state) !== fingerprint(state));
emit("拆两轮一致", fingerprint(tail) === fingerprint(state) && tailFailed === whole.failed - part.failed);

// ---- 异常路径探针：真调用实现，看它报出什么码 ----
function probe(fn) {
  try {
    fn();
    return "没有报错";
  } catch (error) {
    return error && error.code ? error.code : String(error.message);
  }
}

function probeOp(fn) {
  try {
    const next = fn();
    const ledger = (next && next.ledger) || [];
    return ledger.length > 0 ? ledger[ledger.length - 1] : "没有记账";
  } catch (error) {
    return error && error.code ? error.code : String(error.message);
  }
}

const HEADER_AN1 = [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0];

emit("探针坏标签长度", probe(function () { decodeMessage(HEADER_AN1.concat([64, 0])); }));
emit("探针前向指针", probe(function () { decodeMessage(HEADER_AN1.concat([192, 13, 0])); }));
emit("探针越界指针", probe(function () { decodeMessage(HEADER_AN1.concat([192, 250])); }));
emit("探针名字超长", probe(function () {
  const labels = [];
  for (let at = 0; at < 5; at += 1) {
    labels.push("a".repeat(63));
  }
  encodeName(labels, [], 0);
}));
emit("探针半截报文", probe(function () { decodeMessage([18, 52, 129, 128, 0, 0]); }));
emit("探针段计数", probe(function () { decodeMessage([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]); }));
emit("探针长度不符", probe(function () {
  decodeMessage(HEADER_AN1.concat([1, 97, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 3, 1, 2, 3]));
}));
emit("探针尾部多余", probe(function () {
  decodeMessage(HEADER_AN1.concat([1, 97, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 4, 1, 2, 3, 4, 0]));
}));
emit("探针空计划编码", probeOp(function () { return build(copy(spec.state)); }));
emit("探针未编码就解析", probeOp(function () { return parse(copy(spec.state)); }));

// ---- 期望值（参考模型算出）----
const EXPECTED = {
  "报文字节": [
    18,
    52,
    129,
    128,
    0,
    0,
    0,
    1,
    0,
    1,
    0,
    1,
    4,
    100,
    101,
    101,
    112,
    3,
    110,
    115,
    49,
    7,
    101,
    120,
    97,
    109,
    112,
    108,
    101,
    3,
    99,
    111,
    109,
    0,
    0,
    5,
    0,
    1,
    0,
    0,
    0,
    30,
    0,
    6,
    3,
    119,
    119,
    119,
    192,
    21,
    192,
    17,
    0,
    1,
    0,
    1,
    0,
    0,
    0,
    30,
    0,
    4,
    10,
    0,
    0,
    1,
    192,
    21,
    0,
    1,
    0,
    1,
    0,
    0,
    0,
    30,
    0,
    4,
    10,
    0,
    0,
    2
  ],
  "报文字节数": 82,
  "后缀表": [
    [
      "deep.ns1.example.com",
      12
    ],
    [
      "ns1.example.com",
      17
    ],
    [
      "example.com",
      21
    ],
    [
      "com",
      29
    ],
    [
      "www.example.com",
      44
    ]
  ],
  "后缀表长": 5,
  "编码形态": [
    [
      "deep.ns1.example.com",
      4,
      -1,
      22,
      12
    ],
    [
      "www.example.com",
      1,
      21,
      6,
      44
    ],
    [
      "ns1.example.com",
      0,
      17,
      2,
      50
    ],
    [
      "example.com",
      0,
      21,
      2,
      66
    ]
  ],
  "形态条数": 4,
  "全字面字节数": 119,
  "节省字节": 37,
  "压缩名字数": 3,
  "解码记录": [
    [
      "an",
      [
        "deep",
        "ns1",
        "example",
        "com"
      ],
      "CNAME",
      30,
      [
        "www",
        "example",
        "com"
      ]
    ],
    [
      "ns",
      [
        "ns1",
        "example",
        "com"
      ],
      "A",
      30,
      [
        10,
        0,
        0,
        1
      ]
    ],
    [
      "ar",
      [
        "example",
        "com"
      ],
      "A",
      30,
      [
        10,
        0,
        0,
        2
      ]
    ]
  ],
  "解码路径": [
    [
      "deep.ns1.example.com",
      [
        12,
        17,
        21,
        29,
        33
      ]
    ],
    [
      "www.example.com",
      [
        44,
        48,
        21,
        29,
        33
      ]
    ],
    [
      "ns1.example.com",
      [
        50,
        17,
        21,
        29,
        33
      ]
    ],
    [
      "example.com",
      [
        66,
        21,
        29,
        33
      ]
    ]
  ],
  "指针跳数": 3,
  "往返一致": 1,
  "后缀表自洽": true,
  "字节自洽": true,
  "流水自洽": true,
  "解析一致": true,
  "计数四项": [
    7,
    3,
    4,
    1
  ],
  "失败计数": 2,
  "抛错事件数": 0,
  "失败账": [
    "E_BAD_NAME",
    "E_BAD_TYPE"
  ],
  "失败不动字节": 1,
  "重放不新增": 0,
  "中态不同": true,
  "拆两轮一致": true,
  "探针坏标签长度": "E_BAD_LABEL",
  "探针前向指针": "E_BAD_POINTER",
  "探针越界指针": "E_TRUNCATED",
  "探针名字超长": "E_TOO_LONG",
  "探针半截报文": "E_TRUNCATED",
  "探针段计数": "E_BAD_COUNT",
  "探针长度不符": "E_BAD_RDATA",
  "探针尾部多余": "E_TRAILING",
  "探针空计划编码": "E_EMPTY",
  "探针未编码就解析": "E_NO_BYTES"
};
function __same(got, want) {
  if (typeof got === "string") {
    try {
      const parsed = JSON.parse(got);
      if (JSON.stringify(parsed) === JSON.stringify(want)) {
        return true;
      }
    } catch (error) {
      return JSON.stringify(got) === JSON.stringify(want);
    }
  }
  return JSON.stringify(got) === JSON.stringify(want);
}
let __bad = 0;
for (const [label, want] of Object.entries(EXPECTED)) {
  const found = __lines.find(function (pair) { return pair[0] === label; });
  if (!found) {
    __bad += 1;
    console.log("缺失验收项 " + label);
    continue;
  }
  if (__same(found[1], want)) {
    console.log("一致 " + label + " = " + JSON.stringify(found[1]));
  } else {
    __bad += 1;
    console.log("不一致 " + label + " 期望 " + JSON.stringify(want) + " 实际 " + JSON.stringify(found[1]));
  }
}
console.log("验收项 " + (Object.keys(EXPECTED).length - __bad) + "/" + Object.keys(EXPECTED).length + " 通过");
process.exit(__bad === 0 ? 0 : 1);
