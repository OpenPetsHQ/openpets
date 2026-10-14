/** Static SVG atlas contract shared by the standalone installer and desktop. */
export type PetSpritesheetPath = "spritesheet.webp" | "spritesheet.svg";

export interface PetSpritesheetSpec {
  readonly spritesheetPath: PetSpritesheetPath;
  readonly width: 1536;
  readonly height: 1872 | 2288;
  readonly version: 1 | 2;
}

export const maxSvgSpritesheetBytes = 8 * 1024 * 1024;
const maxElements = 20_000;
const maxDepth = 64;
const maxAttributeLength = 256 * 1024;
const svgNamespace = "http://www.w3.org/2000/svg";
const elements = new Set([
  "svg", "g", "defs", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "linearGradient", "radialGradient", "stop", "clipPath", "title", "desc",
]);
const attributes = new Set([
  "id", "xmlns", "version", "width", "height", "viewBox", "preserveAspectRatio",
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "fr",
  "d", "points", "transform", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width",
  "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray",
  "stroke-dashoffset", "opacity", "clip-path", "clip-rule", "clipPathUnits",
  "gradientUnits", "gradientTransform", "spreadMethod", "offset", "stop-color", "stop-opacity",
  "vector-effect", "shape-rendering", "color",
]);

export function validatePetSpritesheetPath(value: unknown): PetSpritesheetPath {
  if (value !== "spritesheet.webp" && value !== "spritesheet.svg") {
    throw new Error("Pet spritesheetPath must be spritesheet.webp or spritesheet.svg.");
  }
  return value;
}

/** Resolve canonical asset selection and intrinsic atlas bounds from pet.json. */
export function getPetSpritesheetSpec(metadata: unknown): PetSpritesheetSpec {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new Error("Pet metadata must be an object.");
  }
  const record = metadata as Record<string, unknown>;
  const spritesheetPath = validatePetSpritesheetPath(record.spritesheetPath);
  const hasVersion = Object.hasOwn(record, "spriteVersionNumber");
  if (hasVersion && record.spriteVersionNumber !== 2) {
    throw new Error("Pet spriteVersionNumber must be 2 when provided.");
  }
  return {
    spritesheetPath,
    width: 1536,
    height: hasVersion ? 2288 : 1872,
    version: hasVersion ? 2 : 1,
  };
}

export function petSpritesheetMimeType(path: string): "image/svg+xml" | "image/webp" {
  return path.endsWith(".svg") ? "image/svg+xml" : "image/webp";
}

export function assertPetPackageFiles(files: Iterable<string>, selected?: PetSpritesheetPath): void {
  const names = new Set(files);
  const sprite = selected ?? (names.has("spritesheet.svg") ? "spritesheet.svg" : "spritesheet.webp");
  if (names.size !== 2 || !names.has("pet.json") || !names.has(sprite)) {
    throw new Error("Pet package must contain pet.json and exactly one matching spritesheet.webp or spritesheet.svg.");
  }
}

/**
 * Deliberately accepts a small XML/vector profile, not arbitrary SVG. No CSS,
 * entities, namespaces other than SVG, reusable subtrees, raster, or active
 * elements are accepted. References can only target reference-free gradients
 * or clip paths, preventing recursive/expanding render graphs.
 */
export function validateSvgSpritesheet(bytes: Uint8Array, width: number, height: number): void {
  if (bytes.byteLength === 0 || bytes.byteLength > maxSvgSpritesheetBytes) {
    throw new Error("SVG spritesheet is empty or exceeds 8 MiB.");
  }
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(source)) {
    throw new Error("Invalid SVG characters.");
  }

  // Comments and the optional XML declaration have no rendering semantics.
  const xml = source.replace(
    /^\s*<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']UTF-8["'])?\s*\?>/iu,
    "",
  );
  const stack: string[] = [];
  const ids = new Map<string, string>();
  const references: { id: string; attribute: string }[] = [];
  let position = 0;
  let count = 0;
  let rootClosed = false;
  while (position < xml.length) {
    const next = xml.indexOf("<", position);
    const text = xml.slice(position, next < 0 ? xml.length : next);
    if (text.includes("&")) {
      throw new Error("SVG entities are not allowed.");
    }
    const parentElement = stack.at(-1);
    if (text.trim() && parentElement !== "title" && parentElement !== "desc") {
      throw new Error("SVG text artwork is not allowed.");
    }
    if (next < 0) {
      break;
    }

    if (xml.startsWith("<!--", next)) {
      const commentEnd = xml.indexOf("-->", next + 4);
      if (commentEnd < 0 || xml.slice(next + 4, commentEnd).includes("--")) {
        throw new Error("Invalid SVG comment.");
      }
      position = commentEnd + 3;
      continue;
    }

    const end = xml.indexOf(">", next);
    if (end < 0) {
      throw new Error("Unclosed SVG tag.");
    }
    const tag = xml.slice(next + 1, end);
    if (/[&!?]/u.test(tag)) {
      throw new Error("SVG entities, declarations, and processing instructions are not allowed.");
    }
    position = end + 1;

    if (tag.startsWith("/")) {
      const closingTag = /^\/([A-Za-z]+)[\t\n\r ]*$/u.exec(tag);
      if (!closingTag) {
        throw new Error("Invalid SVG closing tag.");
      }
      const name = closingTag[1];
      if (!stack.length || name !== stack.pop()) {
        throw new Error("Mismatched SVG closing tag.");
      }
      if (!stack.length) {
        rootClosed = true;
      }
      continue;
    }

    const match = /^([A-Za-z]+)([\s\S]*?)(\/?)$/u.exec(tag);
    if (!match) {
      throw new Error("Invalid SVG tag.");
    }
    const [, name, rawAttributes, selfClosing] = match;
    if (!name || !elements.has(name) || rootClosed || (count > 0 && name === "svg")) {
      throw new Error("Unsupported SVG element.");
    }
    if (count === 0 && name !== "svg") {
      throw new Error("SVG root is required.");
    }
    count += 1;
    if (count > maxElements || stack.length >= maxDepth) {
      throw new Error("SVG complexity limit exceeded.");
    }

    const attrs = parseAttributes(rawAttributes ?? "");
    if (name === "svg") {
      const viewBox = attrs.get("viewBox")?.trim().split(/[\s,]+/u).map(Number).join(" ");
      if (
        attrs.get("xmlns") !== svgNamespace
        || parseDimension(attrs.get("width")) !== width
        || parseDimension(attrs.get("height")) !== height
        || viewBox !== `0 0 ${width} ${height}`
      ) {
        throw new Error(`SVG spritesheet requires width="${width}", height="${height}" and viewBox="0 0 ${width} ${height}".`);
      }
    } else if (attrs.has("xmlns") || attrs.has("viewBox")) {
      throw new Error("Nested SVG namespaces and viewports are not allowed.");
    }
    const id = attrs.get("id");
    if (id) {
      if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(id) || ids.has(id)) {
        throw new Error("Invalid or duplicate SVG id.");
      }
      ids.set(id, name);
    }

    for (const [attribute, value] of attrs) {
      if (!attributes.has(attribute) || value.length > maxAttributeLength || /[<>\\]/u.test(value)) {
        throw new Error("Unsupported SVG attribute.");
      }
      if (attribute === "xmlns") {
        continue;
      }

      // A strict URL grammar prevents escapes, CSS tricks, and external fetches.
      if (/url\s*\(/iu.test(value)) {
        const reference = /^url\(#([A-Za-z_][A-Za-z0-9_.-]*)\)$/u.exec(value);
        const referenceId = reference?.[1];
        const isReferenceAttribute = ["fill", "stroke", "clip-path"].includes(attribute);
        const isInsideDefinition = stack.some((ancestor) => (
          ["defs", "clipPath", "linearGradient", "radialGradient"].includes(ancestor)
        ));
        const isDefinition = ["clipPath", "linearGradient", "radialGradient"].includes(name);
        if (!referenceId || !isReferenceAttribute || isInsideDefinition || isDefinition) {
          throw new Error("SVG references must be local and non-recursive.");
        }
        references.push({ id: referenceId, attribute });
      } else {
        const supportsFunctionalValue = [
          "transform", "gradientTransform", "fill", "stroke", "stop-color", "color",
        ].includes(attribute);
        if (/[():;@]/u.test(value) && !supportsFunctionalValue) {
          throw new Error("Unsupported SVG attribute value.");
        }
      }
    }

    if (!selfClosing) {
      stack.push(name);
    } else if (name === "svg") {
      rootClosed = true;
    }
  }

  if (!count || stack.length || !rootClosed) {
    throw new Error("SVG document is incomplete.");
  }
  for (const reference of references) {
    const target = ids.get(reference.id);
    const allowedTargets = reference.attribute === "clip-path"
      ? ["clipPath"]
      : ["linearGradient", "radialGradient"];
    if (!target || !allowedTargets.includes(target)) {
      throw new Error("SVG reference target is invalid.");
    }
  }
}

function parseAttributes(source: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const pattern = /\s+([A-Za-z][A-Za-z0-9-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/gyu;
  let position = 0;
  while (source.slice(position).trim()) {
    pattern.lastIndex = position;
    const match = pattern.exec(source);
    if (!match || !match[1] || attrs.has(match[1])) {
      throw new Error("Malformed or duplicate SVG attribute.");
    }
    attrs.set(match[1], match[2] ?? match[3] ?? "");
    position = pattern.lastIndex;
  }
  return attrs;
}

function parseDimension(value: string | undefined): number {
  if (!value || !/^\d+(?:\.\d+)?(?:px)?$/u.test(value)) {
    return Number.NaN;
  }
  return Number(value.replace(/px$/u, ""));
}
