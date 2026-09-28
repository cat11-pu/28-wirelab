// ops.js：登记、编码、解析与清空
import { encodeMessage, decodeMessage } from "./wire.js";

const SECTIONS = ["an", "ns", "ar"];
const LABEL = /^[a-z0-9-]{1,63}$/;

function fail(state, code) {
  return Object.assign({}, state, {
    fails: state.fails + 1,
    ledger: state.ledger.concat([code])
  });
}

function validLabels(labels) {
  return Array.isArray(labels) && labels.length > 0 &&
    labels.every(function (label) {
      return typeof label === "string" && LABEL.test(label);
    });
}

function validAddress(data) {
  return Array.isArray(data) && data.length === 4 &&
    data.every(function (byte) {
      return Number.isInteger(byte) && byte >= 0 && byte <= 255;
    });
}

export function record(state, event) {
  if (SECTIONS.indexOf(event.section) === -1) {
    return fail(state, "E_BAD_SECTION");
  }
  if (event.type !== "A" && event.type !== "CNAME") {
    return fail(state, "E_BAD_TYPE");
  }
  if (!Number.isInteger(event.ttl) || event.ttl < 0 || event.ttl > 0xFFFFFFFF) {
    return fail(state, "E_BAD_TTL");
  }
  if (!validLabels(event.name)) {
    return fail(state, "E_BAD_NAME");
  }
  if (event.type === "A" ? !validAddress(event.data) : !validLabels(event.data)) {
    return fail(state, "E_BAD_DATA");
  }
  const entry = [event.section, event.name.slice(), event.type, event.ttl, event.data.slice()];
  return Object.assign({}, state, {
    plan: state.plan.concat([entry]),
    adds: state.adds + 1
  });
}

export function build(state) {
  if (!state.plan || state.plan.length === 0) {
    return fail(state, "E_EMPTY");
  }
  let result;
  try {
    result = encodeMessage(state.plan);
  } catch (error) {
    return fail(state, error && error.code ? error.code : "E_BUILD");
  }
  return Object.assign({}, state, {
    bytes: result.bytes,
    suffix: result.table,
    forms: result.forms,
    records: [],
    paths: [],
    occurrences: result.forms.length,
    follows: 0,
    checked: 0,
    literal: result.literal,
    saved: result.saved,
    compressed: result.compressed,
    builds: state.builds + 1
  });
}

export function parse(state) {
  if (!state.bytes || state.bytes.length === 0) {
    return fail(state, "E_NO_BYTES");
  }
  let result;
  try {
    result = decodeMessage(state.bytes);
  } catch (error) {
    return fail(state, error && error.code ? error.code : "E_PARSE");
  }
  const bySection = function (list) {
    return list
      .map(function (rec, at) { return [rec, at]; })
      .sort(function (a, b) {
        return SECTIONS.indexOf(a[0][0]) - SECTIONS.indexOf(b[0][0]) || a[1] - b[1];
      })
      .map(function (pair) { return pair[0]; });
  };
  const same = JSON.stringify(bySection(result.records)) === JSON.stringify(bySection(state.plan));
  return Object.assign({}, state, {
    records: result.records,
    paths: result.paths,
    follows: result.follows,
    checked: same ? 1 : 0,
    parses: state.parses + 1
  });
}

export function clear(state) {
  return Object.assign({}, state, {
    plan: [],
    bytes: [],
    suffix: [],
    forms: [],
    records: [],
    paths: [],
    occurrences: 0,
    follows: 0,
    checked: 0,
    literal: 0,
    saved: 0,
    compressed: 0,
    clears: state.clears + 1
  });
}
