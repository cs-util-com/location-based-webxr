/**
 * A `.glb` taken apart into the loose files an exporter writes for a
 * `.gltf`: the JSON text, one or more `.bin` buffers (or `data:` URIs) and
 * picture files, so the repack's tests start from the same models the
 * optimizer's do. Also a lenient `.glb` reader for the tests that check a
 * repack kept every buffer view (`readGlb` refuses an unknown extension
 * by design). Test support only.
 */
import type { GlbParts, GltfObject } from "../../asset-shelf/glb-file.js";

type Placement = "file" | "data";

export interface SplitOptions {
  /** The `.gltf`'s path in the bundle. */
  readonly gltfPath?: string;
  /** Which buffer each view goes to (all to buffer 0 when left out); the
   *  buffer count is the largest index plus one. */
  readonly viewBuffer?: readonly number[];
  /** Per buffer: a `.bin` file (the default) or a `data:` URI. */
  readonly buffers?: readonly Placement[];
  /** Per image: a picture file, a `data:` URI or left in its buffer view
   *  (the default). The view stays in its buffer either way. */
  readonly images?: readonly (Placement | "view")[];
  /** Per buffer: its file name next to the `.gltf` (`partN.bin` when
   *  left out). */
  readonly bufferNames?: readonly string[];
  /** Each buffer's and image's URI as written, from its file path
   *  (`encodeURI` when left out). */
  readonly uriOf?: (path: string) => string;
}

const pad4 = (n: number) => (n + 3) & ~3;

const dataUri = (bytes: Uint8Array, mime: string) =>
  `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;

/** `parts` as the files of a `.gltf`, keyed by path. `parts` is not
 *  changed. */
export function splitGlb(
  parts: GlbParts,
  options: SplitOptions = {},
): Map<string, Uint8Array> {
  const json = structuredClone(parts.json);
  const gltfPath = options.gltfPath ?? "model/model.gltf";
  const dir = gltfPath.slice(0, gltfPath.lastIndexOf("/") + 1);
  const uriOf = options.uriOf ?? ((path: string) => encodeURI(path));
  const files = new Map<string, Uint8Array>();
  const assign = parts.views.map((_, i) => options.viewBuffer?.[i] ?? 0);
  const count = Math.max(1, ...assign.map((b) => b + 1));
  const lengths = new Array<number>(count).fill(0);
  const views = (json["bufferViews"] ?? []) as GltfObject[];
  assign.forEach((b, i) => {
    views[i]!["buffer"] = b;
    views[i]!["byteOffset"] = lengths[b]!;
    lengths[b] = pad4(lengths[b]! + parts.views[i]!.length);
  });
  const datas = lengths.map((n) => new Uint8Array(n));
  assign.forEach((b, i) =>
    datas[b]!.set(parts.views[i]!, views[i]!["byteOffset"] as number),
  );
  json["buffers"] = datas.map((data, b) => {
    const name = options.bufferNames?.[b] ?? `part${String(b)}.bin`;
    if ((options.buffers?.[b] ?? "file") === "data") {
      return {
        byteLength: data.length,
        uri: dataUri(data, "application/octet-stream"),
      };
    }
    files.set(dir + name, data);
    return { byteLength: data.length, uri: uriOf(name) };
  });
  ((json["images"] ?? []) as GltfObject[]).forEach((image, i) => {
    const placement = options.images?.[i] ?? "view";
    if (placement === "view") return;
    const bytes = parts.views[image["bufferView"] as number]!;
    const mime = String(image["mimeType"]);
    delete image["bufferView"];
    delete image["mimeType"];
    if (placement === "data") {
      image["uri"] = dataUri(bytes, mime);
    } else {
      const name = `textures/picture ${String(i)}.${mime === "image/png" ? "png" : "jpg"}`;
      files.set(dir + name, bytes);
      image["uri"] = uriOf(name);
    }
  });
  files.set(gltfPath, new TextEncoder().encode(JSON.stringify(json, null, 2)));
  return files;
}

/** A `.glb`'s JSON and each buffer view's bytes, read without any of
 *  `readGlb`'s refusals (for a test's own output only). */
export function looseGlbParts(bytes: Uint8Array): GlbParts {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)),
  ) as GltfObject;
  const at = 20 + jsonLength;
  const bin =
    at + 8 <= bytes.length
      ? bytes.subarray(at + 8, at + 8 + view.getUint32(at, true))
      : new Uint8Array(0);
  const views = ((json["bufferViews"] ?? []) as GltfObject[]).map((v) => {
    const offset = (v["byteOffset"] as number | undefined) ?? 0;
    return bin.subarray(offset, offset + (v["byteLength"] as number));
  });
  return { json, views };
}
