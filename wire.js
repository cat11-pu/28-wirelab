// wire.js：域名报文的标签编码与压缩指针（基线：一律给空）
export function suffixKey(labels) {
  return "";
}

export function encodeName(labels, table, base) {
  return { wire: [], table: [], ptr: -1, literal: 0, len: 0 };
}

export function decodeName(bytes, at) {
  return { labels: [], path: [], end: 0, jumps: 0 };
}

export function encodeMessage(records) {
  return { bytes: [], table: [], forms: [], literal: 0, saved: 0, compressed: 0 };
}

export function decodeMessage(bytes) {
  return { records: [], paths: [], follows: 0 };
}
