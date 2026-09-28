// ops.js：登记、编码、解析与清空
import { encodeMessage, decodeMessage, encodeName } from "./wire.js";

function fail(state, code) {
  return {
    ...state,
    fails: state.fails + 1,
    ledger: state.ledger.concat(code)
  };
}

function isByteData(data) {
  return Array.isArray(data) &&
    data.length === 4 &&
    data.every(function (value) {
      return Number.isInteger(value) && value >= 0 && value <= 255;
    });
}

export function record(state, event) {
  if (!["an", "ns", "ar"].includes(event.section)) {
    return fail(state, "E_BAD_SECTION");
  }
  try {
    encodeName(event.name, [], 0);
  } catch (error) {
    return fail(state, error.code || "E_BAD_NAME");
  }
  if (event.type !== "A" && event.type !== "CNAME") {
    return fail(state, "E_BAD_TYPE");
  }
  if (!Number.isInteger(event.ttl) || event.ttl < 0 || event.ttl > 0xffffffff) {
    return fail(state, "E_BAD_TTL");
  }
  if (event.type === "A" && !isByteData(event.data)) {
    return fail(state, "E_BAD_DATA");
  }
  if (event.type === "CNAME") {
    try {
      encodeName(event.data, [], 0);
    } catch (error) {
      return fail(state, "E_BAD_DATA");
    }
  }

  return {
    ...state,
    plan: state.plan.concat([[event.section, event.name, event.type, event.ttl, event.data]]),
    adds: state.adds + 1
  };
}

export function build(state) {
  if (state.plan.length === 0) {
    return fail(state, "E_EMPTY");
  }

  const orderedPlan = ["an", "ns", "ar"].flatMap(function (section) {
    return state.plan.filter(function (item) {
      return item[0] === section;
    });
  });
  let encoded;
  try {
    encoded = encodeMessage(orderedPlan);
  } catch (error) {
    return fail(state, error.code || "E_BAD_DATA");
  }

  return {
    ...state,
    bytes: encoded.bytes,
    suffix: encoded.table,
    forms: encoded.forms,
    records: [],
    paths: [],
    occurrences: encoded.forms.length,
    follows: 0,
    checked: 0,
    literal: encoded.literal,
    saved: encoded.saved,
    compressed: encoded.compressed,
    builds: state.builds + 1
  };
}

export function parse(state) {
  if (state.bytes.length === 0) {
    return fail(state, "E_NO_BYTES");
  }

  let decoded;
  try {
    decoded = decodeMessage(state.bytes);
  } catch (error) {
    return fail(state, error.code || "E_TRUNCATED");
  }

  const orderedPlan = ["an", "ns", "ar"].flatMap(function (section) {
    return state.plan.filter(function (item) {
      return item[0] === section;
    });
  });

  return {
    ...state,
    records: decoded.records,
    paths: decoded.paths,
    follows: decoded.follows,
    checked: JSON.stringify(decoded.records) === JSON.stringify(orderedPlan) ? 1 : 0,
    parses: state.parses + 1
  };
}

export function clear(state) {
  return {
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
    adds: state.adds,
    builds: state.builds,
    parses: state.parses,
    clears: state.clears + 1,
    fails: state.fails,
    ledger: state.ledger
  };
}
