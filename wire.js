// wire.js：域名报文的标签编码与压缩指针

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

const LABEL = /^[a-z0-9-]{1,63}$/;
const MAX_JUMPS = 16;
const SECTION_ORDER = ["an", "ns", "ar"];
const TYPE_CODE = { A: 1, CNAME: 5 };

export function suffixKey(labels) {
  return labels.join(".");
}

function checkLabels(labels) {
  if (!Array.isArray(labels) || labels.length === 0) {
    throw fail("E_BAD_NAME");
  }
  for (const label of labels) {
    if (typeof label !== "string" || !LABEL.test(label)) {
      throw fail("E_BAD_NAME");
    }
  }
}

function literalLength(labels) {
  let total = 1;
  for (const label of labels) {
    total += label.length + 1;
  }
  return total;
}

export function encodeName(labels, table, base) {
  checkLabels(labels);
  if (literalLength(labels) > 255) {
    throw fail("E_TOO_LONG");
  }
  const known = table || [];
  let literal = labels.length;
  let pointer = -1;
  for (let at = 0; at < labels.length; at += 1) {
    const key = suffixKey(labels.slice(at));
    const hit = known.find(function (pair) { return pair[0] === key; });
    if (hit) {
      literal = at;
      pointer = hit[1];
      break;
    }
  }
  const wire = [];
  const added = [];
  let offset = base;
  for (let at = 0; at < literal; at += 1) {
    const key = suffixKey(labels.slice(at));
    const seen = known.some(function (pair) { return pair[0] === key; }) ||
                 added.some(function (pair) { return pair[0] === key; });
    if (!seen) {
      added.push([key, offset]);
    }
    wire.push(labels[at].length);
    for (let pos = 0; pos < labels[at].length; pos += 1) {
      wire.push(labels[at].charCodeAt(pos));
    }
    offset += labels[at].length + 1;
  }
  if (pointer !== -1) {
    wire.push(0xC0 | (pointer >> 8), pointer & 0xFF);
  } else {
    wire.push(0);
  }
  const nextTable = known.concat(added).sort(function (a, b) { return a[1] - b[1]; });
  return { wire: wire, table: nextTable, ptr: pointer, literal: literal, len: wire.length };
}

export function decodeName(bytes, at) {
  const labels = [];
  const path = [];
  let jumps = 0;
  let offset = at;
  let end = -1;
  for (;;) {
    if (offset >= bytes.length) {
      throw fail("E_TRUNCATED");
    }
    const length = bytes[offset];
    if (length === 0) {
      path.push(offset);
      if (end === -1) {
        end = offset + 1;
      }
      break;
    }
    const tag = length & 0xC0;
    if (tag === 0xC0) {
      if (offset + 1 >= bytes.length) {
        throw fail("E_TRUNCATED");
      }
      const target = ((length & 0x3F) << 8) | bytes[offset + 1];
      if (target >= bytes.length) {
        throw fail("E_TRUNCATED");
      }
      if (target >= offset) {
        throw fail("E_BAD_POINTER");
      }
      jumps += 1;
      if (jumps > MAX_JUMPS) {
        throw fail("E_BAD_POINTER");
      }
      path.push(offset);
      if (end === -1) {
        end = offset + 2;
      }
      offset = target;
      continue;
    }
    if (tag !== 0) {
      throw fail("E_BAD_LABEL");
    }
    if (offset + 1 + length > bytes.length) {
      throw fail("E_TRUNCATED");
    }
    path.push(offset);
    let label = "";
    for (let pos = 0; pos < length; pos += 1) {
      label += String.fromCharCode(bytes[offset + 1 + pos]);
    }
    labels.push(label);
    offset += 1 + length;
  }
  return { labels: labels, path: path, end: end, jumps: jumps };
}

export function encodeMessage(records) {
  const sorted = records
    .map(function (rec, at) { return [rec, at]; })
    .sort(function (a, b) {
      return SECTION_ORDER.indexOf(a[0][0]) - SECTION_ORDER.indexOf(b[0][0]) || a[1] - b[1];
    })
    .map(function (pair) { return pair[0]; });
  const counts = [0, 0, 0];
  for (const rec of records) {
    counts[SECTION_ORDER.indexOf(rec[0])] += 1;
  }
  const bytes = [0x12, 0x34, 0x81, 0x80, 0, 0];
  for (const count of counts) {
    bytes.push((count >> 8) & 0xFF, count & 0xFF);
  }
  let table = [];
  const forms = [];
  let literal = 12;
  let compressed = 0;
  const putName = function (labels) {
    const base = bytes.length;
    const result = encodeName(labels, table, base);
    table = result.table;
    forms.push([suffixKey(labels), result.literal, result.ptr, result.len, base]);
    if (result.ptr !== -1) {
      compressed += 1;
    }
    literal += literalLength(labels);
    for (const byte of result.wire) {
      bytes.push(byte);
    }
  };
  for (const rec of sorted) {
    const code = TYPE_CODE[rec[2]];
    if (!code) {
      throw fail("E_BAD_TYPE");
    }
    putName(rec[1]);
    const ttl = rec[3] >>> 0;
    bytes.push(0, code, 0, 1,
               (ttl >>> 24) & 0xFF, (ttl >>> 16) & 0xFF, (ttl >>> 8) & 0xFF, ttl & 0xFF);
    literal += 10;
    if (code === 1) {
      bytes.push(0, 4, rec[4][0], rec[4][1], rec[4][2], rec[4][3]);
      literal += 4;
    } else {
      const mark = bytes.length;
      bytes.push(0, 0);
      putName(rec[4]);
      const span = bytes.length - mark - 2;
      bytes[mark] = (span >> 8) & 0xFF;
      bytes[mark + 1] = span & 0xFF;
    }
  }
  return {
    bytes: bytes,
    table: table,
    forms: forms,
    literal: literal,
    saved: literal - bytes.length,
    compressed: compressed
  };
}

export function decodeMessage(bytes) {
  if (bytes.length < 12) {
    throw fail("E_TRUNCATED");
  }
  const qd = (bytes[4] << 8) | bytes[5];
  if (qd !== 0) {
    throw fail("E_BAD_COUNT");
  }
  const counts = [
    (bytes[6] << 8) | bytes[7],
    (bytes[8] << 8) | bytes[9],
    (bytes[10] << 8) | bytes[11]
  ];
  const records = [];
  const paths = [];
  let follows = 0;
  let at = 12;
  for (let section = 0; section < 3; section += 1) {
    for (let index = 0; index < counts[section]; index += 1) {
      const name = decodeName(bytes, at);
      at = name.end;
      follows += name.jumps;
      paths.push([suffixKey(name.labels), name.path]);
      if (at + 10 > bytes.length) {
        throw fail("E_TRUNCATED");
      }
      const type = (bytes[at] << 8) | bytes[at + 1];
      const ttl = ((bytes[at + 4] << 24) | (bytes[at + 5] << 16) |
                   (bytes[at + 6] << 8) | bytes[at + 7]) >>> 0;
      const rdlen = (bytes[at + 8] << 8) | bytes[at + 9];
      at += 10;
      if (type !== 1 && type !== 5) {
        throw fail("E_BAD_TYPE");
      }
      if (at + rdlen > bytes.length) {
        throw fail("E_TRUNCATED");
      }
      let data;
      if (type === 1) {
        if (rdlen !== 4) {
          throw fail("E_BAD_RDATA");
        }
        data = bytes.slice(at, at + 4);
      } else {
        const target = decodeName(bytes, at);
        if (target.end - at !== rdlen) {
          throw fail("E_BAD_RDATA");
        }
        follows += target.jumps;
        paths.push([suffixKey(target.labels), target.path]);
        data = target.labels;
      }
      at += rdlen;
      records.push([SECTION_ORDER[section], name.labels, type === 1 ? "A" : "CNAME", ttl, data]);
    }
  }
  if (at !== bytes.length) {
    throw fail("E_TRAILING");
  }
  return { records: records, paths: paths, follows: follows };
}
