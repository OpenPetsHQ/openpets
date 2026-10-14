import assert from "node:assert/strict";
import sharp from "sharp";
import { validateCodexPetMetadata, validateCodexPetSpritesheet, getCodexPetSpriteLayout } from "../src/codex-pets-core.js";

// SVG chooses a format, not another animation model: row/frame geometry and
// transparency must survive validation and ordinary image rasterization.
for (const version of [1, 2]) {
  const metadata = validateCodexPetMetadata({
    id: "vector-pet",
    displayName: "Vector Pet",
    description: "A static vector atlas",
    spritesheetPath: "spritesheet.svg",
    ...(version === 2 ? { spriteVersionNumber: 2 } : {}),
  }, "vector-pet");
  const layout = getCodexPetSpriteLayout(metadata);
  const width = layout.columns * layout.frameWidth;
  const height = layout.rows * layout.frameHeight;
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="192" y="208" width="10" height="10" fill="red"/></svg>`);
  await validateCodexPetSpritesheet(svg, metadata);
  const image = await sharp(svg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(image.info.width, width);
  assert.equal(image.info.height, height);
  assert.equal(image.data[3], 0, "unpainted atlas pixels remain transparent");
  assert.equal(image.data[((209 * width + 193) * 4) + 3], 255, "vector artwork remains opaque in its selected frame");
  await assert.rejects(() => validateCodexPetSpritesheet(Buffer.from(svg.toString().replace(`height="${height}"`, 'height="1"')), metadata));
  await assert.rejects(() => validateCodexPetSpritesheet(Buffer.from(svg.toString().replace("<rect", '<image href="https://example.com/x.png"/><rect')), metadata));
}
console.log("V1/V2 static SVG atlas validation and alpha rasterization passed.");
