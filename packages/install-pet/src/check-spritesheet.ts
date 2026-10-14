import assert from "node:assert/strict";
import { assertPetPackageFiles, getPetSpritesheetSpec, validatePetSpritesheetPath, validateSvgSpritesheet } from "./spritesheet.js";

// A package must never silently choose between two assets or load an asset
// other than the one its manifest selected.
assert.equal(validatePetSpritesheetPath("spritesheet.svg"), "spritesheet.svg");
assert.deepEqual(getPetSpritesheetSpec({ spritesheetPath: "spritesheet.svg" }), {
  spritesheetPath: "spritesheet.svg", width: 1536, height: 1872, version: 1,
});
assert.deepEqual(getPetSpritesheetSpec({ spritesheetPath: "spritesheet.svg", spriteVersionNumber: 2 }), {
  spritesheetPath: "spritesheet.svg", width: 1536, height: 2288, version: 2,
});
for (const spriteVersionNumber of [1, 3, "2", null, undefined]) {
  assert.throws(() => getPetSpritesheetSpec({ spritesheetPath: "spritesheet.svg", spriteVersionNumber }));
}
assert.throws(() => validatePetSpritesheetPath("../spritesheet.svg"));
assertPetPackageFiles(["pet.json", "spritesheet.svg"], "spritesheet.svg");
assertPetPackageFiles(["pet.json", "spritesheet.webp"], "spritesheet.webp");
for (const files of [
  ["pet.json"],
  ["pet.json", "spritesheet.svg", "spritesheet.webp"],
  ["pet.json", "spritesheet.svg", "extra.txt"],
  ["pet.json", "spritesheet.webp"],
]) assert.throws(() => assertPetPackageFiles(files, "spritesheet.svg"));

const atlas = (body: string, attrs = ""): Buffer => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1872" viewBox="0 0 1536 1872" ${attrs}>${body}</svg>`);
validateSvgSpritesheet(atlas('<g transform="translate(10 20)"><path fill="#abc" d="M0 0h10v10z"/></g>'), 1536, 1872);
// XML permits trailing closing-tag whitespace, but never whitespace after </.
validateSvgSpritesheet(atlas('<g></g \t\n>'), 1536, 1872);
for (const source of [
  atlas("").toString().replace("</svg>", "</ svg>"),
  atlas('<g></\tg>').toString(),
  atlas('<g></g\u00a0>').toString(),
]) {
  assert.throws(() => validateSvgSpritesheet(Buffer.from(source), 1536, 1872));
}
validateSvgSpritesheet(atlas('<defs><linearGradient id="paint"><stop offset="0" stop-color="red"/></linearGradient><clipPath id="clip"><rect width="10" height="10"/></clipPath></defs><rect width="10" height="10" fill="url(#paint)" clip-path="url(#clip)"/>'), 1536, 1872);

// These are active/network/raster/recursive SVGs, not static vector atlases.
for (const body of [
  '<script>alert(1)</script>',
  '<rect onload="alert(1)"/>',
  '<foreignObject/>',
  '<image href="data:image/png;base64,AAAA"/>',
  '<image href="https://example.com/image.png"/>',
  '<use href="#shape"/>',
  '<animate attributeName="x"/>',
  '<set attributeName="fill"/>',
  '<style>rect { fill: red }</style>',
  '<rect style="fill:red"/>',
  '<rect fill="url(https://example.com/a.svg#x)"/>',
  '<rect fill="url(&#35;paint)"/>',
  '<rect fill="url(#missing)"/>',
  '<clipPath id="clip"><rect clip-path="url(#clip)"/></clipPath>',
  '<linearGradient id="paint" href="https://example.com/paint.svg"/>',
  '<svg xmlns="http://example.com"/>',
  '<rect/><rect',
  '<rect></g>',
  '<rect width="1" width="2"/>',
  '<!-- broken -- comment -->',
  '<!DOCTYPE svg [<!ENTITY x "boom">]>',
  '<g>'.repeat(65) + '</g>'.repeat(65),
  '<rect/>'.repeat(20_001),
]) assert.throws(() => validateSvgSpritesheet(atlas(body), 1536, 1872), body.slice(0, 100));
for (const attrs of ['onload="run()"', 'xmlns:xlink="http://www.w3.org/1999/xlink"']) {
  assert.throws(() => validateSvgSpritesheet(atlas("", attrs), 1536, 1872));
}
for (const source of [
  atlas("").toString().replace('width="1536"', 'width="100%"'),
  atlas("").toString().replace('width="1536"', 'width="1537"'),
  atlas("").toString().replace('viewBox="0 0 1536 1872"', 'viewBox="0 0 1 1"'),
  atlas("").toString().replace('height="1872"', ''),
  atlas("").toString() + '<svg/>',
]) assert.throws(() => validateSvgSpritesheet(Buffer.from(source), 1536, 1872));
assert.throws(() => validateSvgSpritesheet(Buffer.alloc(8 * 1024 * 1024 + 1, 32), 1536, 1872));
console.log("Static SVG spritesheet contracts passed.");
