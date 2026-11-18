/**
 * Minimal, defensive parser for Android binary XML (AXML) — the compiled form of
 * AndroidManifest.xml inside an APK. Pure (DataView + TextDecoder), so it runs in the browser and
 * in Vitest.
 *
 * It reads the string pool, the resource-id map and START_ELEMENT chunks, and returns each
 * element's attributes with their *typed* values. Checking typed values (not just "does the word
 * `debuggable` appear somewhere") avoids false positives: the attribute name is in the string pool
 * even when its value is `false`.
 *
 * Format reference: frameworks/base/libs/androidfw/include/androidfw/ResourceTypes.h
 */

const RES_XML_TYPE = 0x0003;
const RES_STRING_POOL_TYPE = 0x0001;
const RES_XML_RESOURCE_MAP_TYPE = 0x0180;
const RES_XML_START_ELEMENT_TYPE = 0x0102;
const UTF8_FLAG = 0x100;
const NO_INDEX = 0xffffffff;

/** Res_value data types we care about. */
export const AXML_TYPE_STRING = 0x03;
export const AXML_TYPE_INT_BOOLEAN = 0x12;

const MAX_STRINGS = 50_000;
const MAX_ELEMENTS = 20_000;

export interface AxmlAttribute {
  /** Attribute name from the string pool (may be empty or obfuscated). */
  name: string;
  /** Android resource id of the attribute (e.g. 0x0101000f for debuggable), 0 if unknown. */
  resourceId: number;
  dataType: number;
  data: number;
  /** Raw string value, when the attribute was stored as a string. */
  rawValue: string | null;
}

export interface AxmlElement {
  name: string;
  attributes: AxmlAttribute[];
}

export interface AxmlDocument {
  strings: string[];
  elements: AxmlElement[];
}

/** android:* attribute resource ids (stable across Android versions). */
export const ANDROID_ATTR = {
  debuggable: 0x0101000f,
  allowBackup: 0x01010280,
  usesCleartextTraffic: 0x010104ec,
} as const;

export function isBinaryXml(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[0] === 0x03 && bytes[1] === 0x00 && bytes[2] === 0x08 && bytes[3] === 0x00;
}

function readStringPool(view: DataView, bytes: Uint8Array, start: number, headerSize: number, chunkSize: number): string[] {
  const stringCount = Math.min(view.getUint32(start + 8, true), MAX_STRINGS);
  const flags = view.getUint32(start + 16, true);
  const stringsStart = view.getUint32(start + 20, true);
  const utf8 = (flags & UTF8_FLAG) !== 0;
  const chunkEnd = start + chunkSize;
  const offsetsBase = start + headerSize;
  const dataBase = start + stringsStart;
  const utf8Decoder = new TextDecoder("utf-8", { fatal: false });
  const utf16Decoder = new TextDecoder("utf-16le", { fatal: false });
  const strings: string[] = [];

  for (let index = 0; index < stringCount; index += 1) {
    const offsetPosition = offsetsBase + index * 4;
    if (offsetPosition + 4 > chunkEnd) break;
    let position = dataBase + view.getUint32(offsetPosition, true);
    if (position >= chunkEnd) {
      strings.push("");
      continue;
    }
    if (utf8) {
      // utf16 length (1–2 bytes), then utf8 byte length (1–2 bytes), then bytes.
      position += (bytes[position] ?? 0) & 0x80 ? 2 : 1;
      let length = bytes[position] ?? 0;
      if (length & 0x80) {
        length = ((length & 0x7f) << 8) | (bytes[position + 1] ?? 0);
        position += 2;
      } else {
        position += 1;
      }
      const end = Math.min(position + length, chunkEnd);
      strings.push(utf8Decoder.decode(bytes.subarray(position, end)));
    } else {
      if (position + 2 > chunkEnd) break;
      let length = view.getUint16(position, true);
      if (length & 0x8000) {
        if (position + 4 > chunkEnd) break;
        length = ((length & 0x7fff) << 16) | view.getUint16(position + 2, true);
        position += 4;
      } else {
        position += 2;
      }
      const end = Math.min(position + length * 2, chunkEnd);
      strings.push(utf16Decoder.decode(bytes.subarray(position, end)));
    }
  }
  return strings;
}

/** Returns null when the bytes are not a well-formed binary XML document. Never throws. */
export function parseBinaryXml(bytes: Uint8Array): AxmlDocument | null {
  if (!isBinaryXml(bytes)) return null;
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint16(0, true) !== RES_XML_TYPE) return null;
    let offset = view.getUint16(2, true);
    let strings: string[] = [];
    let resourceIds: number[] = [];
    const elements: AxmlElement[] = [];

    while (offset + 8 <= bytes.length && elements.length < MAX_ELEMENTS) {
      const type = view.getUint16(offset, true);
      const headerSize = view.getUint16(offset + 2, true);
      const size = view.getUint32(offset + 4, true);
      if (size < 8 || headerSize < 8 || offset + size > bytes.length) break;

      if (type === RES_STRING_POOL_TYPE && headerSize >= 28) {
        strings = readStringPool(view, bytes, offset, headerSize, size);
      } else if (type === RES_XML_RESOURCE_MAP_TYPE) {
        const count = Math.floor((size - headerSize) / 4);
        resourceIds = Array.from({ length: count }, (_, index) => view.getUint32(offset + headerSize + index * 4, true));
      } else if (type === RES_XML_START_ELEMENT_TYPE) {
        // ResXMLTree_attrExt follows the 16-byte node header.
        const ext = offset + headerSize;
        if (ext + 20 > offset + size) break;
        const elementName = view.getUint32(ext + 4, true);
        const attributeStart = view.getUint16(ext + 8, true);
        const attributeSize = view.getUint16(ext + 10, true);
        const attributeCount = view.getUint16(ext + 12, true);
        const attributes: AxmlAttribute[] = [];
        if (attributeSize >= 20) {
          for (let index = 0; index < attributeCount; index += 1) {
            const at = ext + attributeStart + index * attributeSize;
            if (at + 20 > offset + size) break;
            const nameIndex = view.getUint32(at + 4, true);
            const rawIndex = view.getUint32(at + 8, true);
            attributes.push({
              name: strings[nameIndex] ?? "",
              resourceId: resourceIds[nameIndex] ?? 0,
              dataType: view.getUint8(at + 15),
              data: view.getUint32(at + 16, true),
              rawValue: rawIndex === NO_INDEX ? null : (strings[rawIndex] ?? null),
            });
          }
        }
        elements.push({ name: strings[elementName] ?? "", attributes });
      }
      offset += size;
    }
    return { strings, elements };
  } catch {
    return null;
  }
}

/** Finds an attribute by Android resource id first (robust to obfuscated names), then by name. */
export function findAttribute(element: AxmlElement, name: keyof typeof ANDROID_ATTR): AxmlAttribute | undefined {
  const id = ANDROID_ATTR[name];
  return element.attributes.find((attribute) => attribute.resourceId === id) ?? element.attributes.find((attribute) => attribute.name === name);
}

/** true / false for boolean attributes (typed or string), null when absent or not a boolean. */
export function booleanValue(attribute: AxmlAttribute | undefined): boolean | null {
  if (!attribute) return null;
  if (attribute.dataType === AXML_TYPE_INT_BOOLEAN) return attribute.data !== 0;
  const raw = (attribute.rawValue ?? "").trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}
