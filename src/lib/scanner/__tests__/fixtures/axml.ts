/**
 * Test-only encoder for Android binary XML (the format aapt2 emits for AndroidManifest.xml), so the
 * parser is exercised with realistic compiled manifests instead of plain text.
 */

class ByteWriter {
  private bytes: number[] = [];
  get length(): number {
    return this.bytes.length;
  }
  u8(value: number): this {
    this.bytes.push(value & 0xff);
    return this;
  }
  u16(value: number): this {
    return this.u8(value).u8(value >>> 8);
  }
  u32(value: number): this {
    return this.u16(value & 0xffff).u16(value >>> 16);
  }
  pad4(): this {
    while (this.bytes.length % 4 !== 0) this.u8(0);
    return this;
  }
  append(other: ByteWriter): this {
    this.bytes.push(...other.toArray());
    return this;
  }
  toArray(): number[] {
    return this.bytes;
  }
}

const NO_INDEX = 0xffffffff;
const TYPE_STRING = 0x03;
const TYPE_BOOLEAN = 0x12;

export interface FixtureAttribute {
  name: string;
  /** Android resource id; attributes with an id are placed first so the resource map lines up. */
  resourceId?: number;
  value: boolean | string;
}

export interface FixtureElement {
  name: string;
  attributes: FixtureAttribute[];
}

export function encodeAxml(elements: FixtureElement[], options: { obfuscateAttributeNames?: boolean } = {}): Uint8Array {
  // String pool: attributes with resource ids first (index i ↔ resourceIds[i]), then the rest.
  const withIds = new Map<string, number>();
  for (const element of elements) {
    for (const attribute of element.attributes) {
      if (attribute.resourceId !== undefined) withIds.set(attribute.name, attribute.resourceId);
    }
  }
  const strings: string[] = [...withIds.keys()].map((name) => (options.obfuscateAttributeNames ? "" : name));
  const index = new Map<string, number>([...withIds.keys()].map((name, position) => [name, position]));
  const intern = (value: string): number => {
    const existing = index.get(value);
    if (existing !== undefined) return existing;
    strings.push(value);
    index.set(value, strings.length - 1);
    return strings.length - 1;
  };
  for (const element of elements) {
    intern(element.name);
    for (const attribute of element.attributes) {
      if (attribute.resourceId === undefined) intern(attribute.name);
      if (typeof attribute.value === "string") intern(attribute.value);
    }
  }

  // String pool chunk (UTF-16).
  const data = new ByteWriter();
  const offsets: number[] = [];
  for (const value of strings) {
    offsets.push(data.length);
    data.u16(value.length);
    for (let position = 0; position < value.length; position += 1) data.u16(value.charCodeAt(position));
    data.u16(0);
  }
  data.pad4();
  const poolHeader = 28;
  const stringsStart = poolHeader + offsets.length * 4;
  const pool = new ByteWriter()
    .u16(0x0001)
    .u16(poolHeader)
    .u32(stringsStart + data.length)
    .u32(strings.length)
    .u32(0)
    .u32(0)
    .u32(stringsStart)
    .u32(0);
  for (const offset of offsets) pool.u32(offset);
  pool.append(data);

  // Resource map chunk.
  const ids = [...withIds.values()];
  const resourceMap = new ByteWriter().u16(0x0180).u16(8).u32(8 + ids.length * 4);
  for (const id of ids) resourceMap.u32(id);

  // START_ELEMENT chunks.
  const body = new ByteWriter();
  for (const element of elements) {
    const size = 16 + 20 + element.attributes.length * 20;
    body.u16(0x0102).u16(16).u32(size).u32(1).u32(NO_INDEX);
    body.u32(NO_INDEX).u32(intern(element.name)).u16(20).u16(20).u16(element.attributes.length).u16(0).u16(0).u16(0);
    for (const attribute of element.attributes) {
      const nameIndex = index.get(attribute.name) ?? intern(attribute.name);
      const isBoolean = typeof attribute.value === "boolean";
      body.u32(NO_INDEX).u32(nameIndex).u32(isBoolean ? NO_INDEX : intern(attribute.value as string));
      body.u16(8).u8(0).u8(isBoolean ? TYPE_BOOLEAN : TYPE_STRING);
      body.u32(isBoolean ? (attribute.value ? 0xffffffff : 0) : intern(attribute.value as string));
    }
  }

  const total = 8 + pool.length + resourceMap.length + body.length;
  const document = new ByteWriter().u16(0x0003).u16(8).u32(total).append(pool).append(resourceMap).append(body);
  return Uint8Array.from(document.toArray());
}

export const ATTR = {
  debuggable: 0x0101000f,
  allowBackup: 0x01010280,
  usesCleartextTraffic: 0x010104ec,
} as const;

/** A compiled AndroidManifest.xml with the given <application> flags (omitted flags are absent). */
export function compiledManifest(
  flags: { debuggable?: boolean; usesCleartextTraffic?: boolean; allowBackup?: boolean },
  options: { obfuscateAttributeNames?: boolean } = {},
): Uint8Array {
  const attributes: FixtureAttribute[] = [];
  for (const key of ["debuggable", "usesCleartextTraffic", "allowBackup"] as const) {
    const value = flags[key];
    if (value !== undefined) attributes.push({ name: key, resourceId: ATTR[key], value });
  }
  return encodeAxml(
    [
      { name: "manifest", attributes: [{ name: "package", value: "com.example.game" }] },
      { name: "application", attributes },
    ],
    options,
  );
}
