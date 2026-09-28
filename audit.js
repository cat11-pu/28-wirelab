// audit.js：四条不变量与账目判据（给定，不写）
import { decodeName, suffixKey } from "./wire.js";

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function suffixOk(state) {
  try {
    const bytes = state.bytes || [];
    const table = state.suffix || [];
    let prev = -1;
    for (const pair of table) {
      if (!Array.isArray(pair) || pair.length !== 2) {
        return false;
      }
      if (typeof pair[0] !== "string" || pair[0] === "") {
        return false;
      }
      if (!Number.isInteger(pair[1]) || pair[1] < 0 || pair[1] >= bytes.length) {
        return false;
      }
      if (pair[1] <= prev) {
        return false;
      }
      prev = pair[1];
      if (suffixKey(decodeName(bytes, pair[1]).labels) !== pair[0]) {
        return false;
      }
    }
    return true;
  } catch (error) {
    return false;
  }
}

export function bandOk(state) {
  try {
    const bytes = state.bytes || [];
    for (const byte of bytes) {
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
        return false;
      }
    }
    if (bytes.length === 0) {
      return true;
    }
    if (bytes.length < 12) {
      return false;
    }
    const plan = state.plan || [];
    const want = ["an", "ns", "ar"].map(function (section) {
      return plan.filter(function (rec) { return rec[0] === section; }).length;
    });
    const got = [(bytes[6] << 8) | bytes[7], (bytes[8] << 8) | bytes[9], (bytes[10] << 8) | bytes[11]];
    return same(got, want);
  } catch (error) {
    return false;
  }
}

export function flowOk(state) {
  try {
    if ((state.ledger || []).length !== state.fails) {
      return false;
    }
    if ((state.forms || []).length !== state.occurrences) {
      return false;
    }
    const paths = (state.paths || []).length;
    if (paths !== 0 && paths !== state.occurrences) {
      return false;
    }
    if (state.saved !== state.literal - (state.bytes || []).length) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

export function wireOk(state) {
  try {
    const bytes = state.bytes || [];
    if (bytes.length === 0) {
      return true;
    }
    if (state.parses === 0) {
      return true;
    }
    if (state.checked !== 1) {
      return false;
    }
    const paths = state.paths || [];
    const forms = state.forms || [];
    if (paths.length !== forms.length) {
      return false;
    }
    for (let at = 0; at < paths.length; at += 1) {
      if (paths[at][0] !== forms[at][0]) {
        return false;
      }
    }
    return true;
  } catch (error) {
    return false;
  }
}
