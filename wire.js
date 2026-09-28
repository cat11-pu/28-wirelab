// wire.js：域名报文的标签编码与压缩指针

function wireError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validLabels(labels) {
  return Array.isArray(labels) &&
    labels.length > 0 &&
    labels.every(function (label) {
      return typeof label === "string" &&
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-z0-9-]+$/.test(label);
    });
}

function literalNameLength(labels) {
  return labels.reduce(function (total, label) {
    return total + label.length + 1;
  }, 1);
}

export function suffixKey(labels) {
  return labels.join(".");
}

function appendU16(bytes, value) {
  bytes.push((value >> 8) & 0xff, value & 0xff);
}

function appendU32(bytes, value) {
  bytes.push((value >>> 24) & 0xff, (value >>> 16) & 0xff,
             (value >>> 8) & 0xff, value & 0xff);
}

function readU16(bytes, at) {
  return (bytes[at] << 8) | bytes[at + 1];
}

export function encodeName(labels, table, base) {
  if (!validLabels(labels)) {
    throw wireError("E_BAD_NAME");
  }
  const literal = literalNameLength(labels);
  if (literal > 255) {
    throw wireError("E_TOO_LONG");
  }
  if (!Array.isArray(table) || !Number.isInteger(base) || base < 0) {
    throw wireError("E_BAD_NAME");
  }

  let suffixLength = 0;
  let ptr = -1;
  for (const entry of table) {
    const key = entry[0];
    const offset = entry[1];
    if (typeof key !== "string" || !Number.isInteger(offset) || offset >= base) {
      continue;
    }
    const suffix = key.split(".");
    if (suffix.length > labels.length || suffix.length <= suffixLength) {
      continue;
    }
    const start = labels.length - suffix.length;
    if (suffixKey(labels.slice(start)) === key) {
      suffixLength = suffix.length;
      ptr = offset;
    }
  }

  const cut = labels.length - suffixLength;
  const wire = [];
  for (let index = 0; index < cut; index += 1) {
    wire.push(labels[index].length);
    for (const char of labels[index]) {
      wire.push(char.charCodeAt(0));
    }
  }
  if (ptr === -1) {
    wire.push(0);
  } else {
    wire.push(0xc0 | (ptr >> 8), ptr & 0xff);
  }

  const nextTable = table.map(function (entry) {
    return [entry[0], entry[1]];
  });
  let offset = base;
  for (let index = 0; index < cut; index += 1) {
    nextTable.push([suffixKey(labels.slice(index)), offset]);
    offset += labels[index].length + 1;
  }
  nextTable.sort(function (left, right) {
    return left[1] - right[1];
  });

  return { wire: wire, table: nextTable, ptr: ptr, literal: literal, len: wire.length };
}

export function decodeName(bytes, at) {
  if (!Array.isArray(bytes) || !Number.isInteger(at) || at < 0) {
    throw wireError("E_TRUNCATED");
  }

  const labels = [];
  const path = [];
  let cursor = at;
  let end = null;
  let jumps = 0;

  while (true) {
    if (cursor < 0 || cursor >= bytes.length) {
      throw wireError("E_TRUNCATED");
    }
    path.push(cursor);

    const length = bytes[cursor];
    if (!Number.isInteger(length) || length < 0 || length > 255) {
      throw wireError("E_TRUNCATED");
    }

    if (length === 0) {
      if (end === null) {
        end = cursor + 1;
      }
      return { labels: labels, path: path, end: end, jumps: jumps };
    }

    if ((length & 0xc0) === 0xc0) {
      if (cursor + 1 >= bytes.length) {
        throw wireError("E_TRUNCATED");
      }
      const target = ((length & 0x3f) << 8) | bytes[cursor + 1];
      if (target >= bytes.length) {
        throw wireError("E_TRUNCATED");
      }
      if (target >= cursor) {
        throw wireError("E_BAD_POINTER");
      }
      jumps += 1;
      if (jumps > 16) {
        throw wireError("E_BAD_POINTER");
      }
      if (end === null) {
        end = cursor + 2;
      }
      cursor = target;
      continue;
    }

    if ((length & 0xc0) !== 0) {
      throw wireError("E_BAD_LABEL");
    }
    if (cursor + 1 + length > bytes.length) {
      throw wireError("E_TRUNCATED");
    }

    let value = "";
    for (let index = 1; index <= length; index += 1) {
      value += String.fromCharCode(bytes[cursor + index]);
    }
    labels.push(value);
    cursor += length + 1;
  }
}

export function encodeMessage(records) {
  if (!Array.isArray(records)) {
    throw wireError("E_BAD_DATA");
  }

  const sections = ["an", "ns", "ar"];
  const counts = { an: 0, ns: 0, ar: 0 };
  for (const item of records) {
    if (!sections.includes(item[0])) {
      throw wireError("E_BAD_SECTION");
    }
    counts[item[0]] += 1;
  }

  const bytes = [0x12, 0x34, 0x81, 0x80, 0, 0];
  appendU16(bytes, counts.an);
  appendU16(bytes, counts.ns);
  appendU16(bytes, counts.ar);

  let table = [];
  const forms = [];
  let literal = 12;
  let compressed = 0;

  function addForm(name, result, base) {
    let literalCount = name.length;
    if (result.ptr !== -1) {
      const target = result.table.find(function (entry) {
        return entry[1] === result.ptr;
      });
      if (target) {
        literalCount = name.length - target[0].split(".").length;
      }
    }
    forms.push([suffixKey(name), literalCount, result.ptr, result.len, base]);
  }

  const ordered = sections.flatMap(function (section) {
    return records.filter(function (item) {
      return item[0] === section;
    });
  });

  for (const [section, name, typeName, ttl, data] of ordered) {
    if (!Number.isInteger(ttl) || ttl < 0 || ttl > 0xffffffff) {
      throw wireError("E_BAD_TTL");
    }

    const ownerBase = bytes.length;
    const owner = encodeName(name, table, ownerBase);
    bytes.push(...owner.wire);
    table = owner.table;
    addForm(name, owner, ownerBase);
    literal += owner.literal;
    if (owner.ptr !== -1) {
      compressed += 1;
    }

    let typeCode;
    if (typeName === "A") {
      typeCode = 1;
    } else if (typeName === "CNAME") {
      typeCode = 5;
    } else {
      throw wireError("E_BAD_TYPE");
    }
    appendU16(bytes, typeCode);
    appendU16(bytes, 1);
    appendU32(bytes, ttl);
    literal += 10;

    if (typeCode === 1) {
      if (!Array.isArray(data) || data.length !== 4 ||
          !data.every(function (value) {
            return Number.isInteger(value) && value >= 0 && value <= 255;
          })) {
        throw wireError("E_BAD_DATA");
      }
      appendU16(bytes, 4);
      bytes.push(...data);
      literal += 4;
    } else {
      const targetBase = bytes.length + 2;
      const target = encodeName(data, table, targetBase);
      appendU16(bytes, target.len);
      bytes.push(...target.wire);
      table = target.table;
      addForm(data, target, targetBase);
      literal += target.literal;
      if (target.ptr !== -1) {
        compressed += 1;
      }
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
  if (!Array.isArray(bytes) || bytes.length < 12) {
    throw wireError("E_TRUNCATED");
  }
  if (readU16(bytes, 4) !== 0) {
    throw wireError("E_BAD_COUNT");
  }

  const sectionCounts = [
    ["an", readU16(bytes, 6)],
    ["ns", readU16(bytes, 8)],
    ["ar", readU16(bytes, 10)]
  ];
  const records = [];
  const paths = [];
  let follows = 0;
  let cursor = 12;

  function addPath(name) {
    paths.push([suffixKey(name.labels), name.path]);
    follows += name.jumps;
  }

  for (const [section, count] of sectionCounts) {
    for (let index = 0; index < count; index += 1) {
      const owner = decodeName(bytes, cursor);
      addPath(owner);
      cursor = owner.end;

      if (cursor + 10 > bytes.length) {
        throw wireError("E_TRUNCATED");
      }
      const typeCode = readU16(bytes, cursor);
      const ttl = (bytes[cursor + 4] * 0x1000000) +
                  (bytes[cursor + 5] << 16) +
                  (bytes[cursor + 6] << 8) +
                  bytes[cursor + 7];
      const rdataLength = readU16(bytes, cursor + 8);
      const rdataStart = cursor + 10;
      cursor = rdataStart;

      if (rdataStart + rdataLength > bytes.length) {
        throw wireError("E_TRUNCATED");
      }

      let typeName;
      let data;
      if (typeCode === 1) {
        if (rdataLength !== 4) {
          throw wireError("E_BAD_RDATA");
        }
        typeName = "A";
        data = bytes.slice(rdataStart, rdataStart + 4);
      } else if (typeCode === 5) {
        const target = decodeName(bytes, rdataStart);
        if (target.end !== rdataStart + rdataLength) {
          throw wireError("E_BAD_RDATA");
        }
        addPath(target);
        typeName = "CNAME";
        data = target.labels;
      } else {
        throw wireError("E_BAD_TYPE");
      }

      records.push([section, owner.labels, typeName, ttl, data]);
      cursor = rdataStart + rdataLength;
    }
  }

  if (cursor !== bytes.length) {
    throw wireError("E_TRAILING");
  }
  return { records: records, paths: paths, follows: follows };
}
