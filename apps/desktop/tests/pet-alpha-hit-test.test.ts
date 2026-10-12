import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PET_ALPHA_HIT_THRESHOLD,
  createPetAlphaHitTester,
  isSpritePixelOpaque,
  mapClientPointToSpritePixel,
  parseCssBackgroundImageUrl,
  parseCssBackgroundSize,
  parseCssPixelLength,
  type PetAlphaHitTestDocument,
  type SpriteSheetPixels,
} from "../src/pet-alpha-hit-test.js";

// These tests protect the contract that pet windows only capture the mouse over
// opaque artwork: a broken coordinate mapping or alpha sample would either make
// the pet unclickable over visible pixels or keep transparent regions blocking
// the windows behind the pet.

const makePixels = (width: number, height: number, opaquePixels: readonly (readonly [number, number, number])[]): SpriteSheetPixels => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x, y, alpha] of opaquePixels) {
    data[(y * width + x) * 4 + 3] = alpha;
  }
  return { width, height, data };
};

describe("parseCssBackgroundImageUrl", () => {
  it("extracts the url from the quoting styles CSS serialization produces", () => {
    assert.equal(parseCssBackgroundImageUrl('url("file:///pets/a%20b/spritesheet.webp")'), "file:///pets/a%20b/spritesheet.webp");
    assert.equal(parseCssBackgroundImageUrl("url('file:///pets/a.webp')"), "file:///pets/a.webp");
    assert.equal(parseCssBackgroundImageUrl("url(file:///pets/a.webp)"), "file:///pets/a.webp");
  });

  it("rejects none and non-url values", () => {
    assert.equal(parseCssBackgroundImageUrl("none"), null);
    assert.equal(parseCssBackgroundImageUrl("linear-gradient(red, blue)"), null);
    assert.equal(parseCssBackgroundImageUrl(""), null);
  });
});

describe("parseCssPixelLength", () => {
  it("parses px lengths, including negative background offsets", () => {
    assert.equal(parseCssPixelLength("0px"), 0);
    assert.equal(parseCssPixelLength("-128.5px"), -128.5);
  });

  it("rejects percentages and keywords so callers can fail safe", () => {
    assert.equal(parseCssPixelLength("50%"), null);
    assert.equal(parseCssPixelLength("center"), null);
  });
});

describe("parseCssBackgroundSize", () => {
  it("parses the explicit two-value px size the pet stylesheet emits", () => {
    assert.deepEqual(parseCssBackgroundSize("512px 128px"), { width: 512, height: 128 });
  });

  it("rejects auto/cover/single values", () => {
    assert.equal(parseCssBackgroundSize("auto"), null);
    assert.equal(parseCssBackgroundSize("cover"), null);
    assert.equal(parseCssBackgroundSize("512px"), null);
    assert.equal(parseCssBackgroundSize("0px 128px"), null);
  });
});

describe("mapClientPointToSpritePixel", () => {
  const base = {
    rect: { left: 50, top: 50, width: 200, height: 200 },
    elementWidth: 100,
    elementHeight: 100,
    backgroundPositionX: 0,
    backgroundPositionY: 0,
    backgroundWidth: 400,
    backgroundHeight: 100,
    imageWidth: 800,
    imageHeight: 200,
    flipped: false,
  };

  it("maps through the rendered scale and the background-size scale factor", () => {
    // Point at the element center: rect 200px for a 100px element (2x display
    // scale); sheet drawn at half its natural size (400px bg for an 800px image).
    const point = mapClientPointToSpritePixel({ ...base, clientX: 150, clientY: 150 });
    assert.deepEqual(point, { x: 100, y: 100 });
  });

  it("accounts for the animated background-position frame offset", () => {
    const point = mapClientPointToSpritePixel({ ...base, clientX: 150, clientY: 150, backgroundPositionX: -100 });
    assert.deepEqual(point, { x: 300, y: 100 });
  });

  it("mirrors x when the shell flips horizontally", () => {
    const point = mapClientPointToSpritePixel({ ...base, clientX: 150, clientY: 50, flipped: true });
    assert.deepEqual(point, { x: 100, y: 0 });
  });

  it("keeps the flipped left edge inside the displayed frame", () => {
    // Regression: fractionX becomes exactly 1 at the flipped sprite's left edge,
    // which used to floor into the first pixel of the adjacent sheet frame and
    // could make a transparent edge interactive on a neighbor's alpha.
    const point = mapClientPointToSpritePixel({ ...base, clientX: 50, clientY: 50, flipped: true });
    assert.deepEqual(point, { x: 199, y: 0 });
  });

  it("lands outside the sheet over no-repeat areas beyond the image", () => {
    const point = mapClientPointToSpritePixel({ ...base, clientX: 249, clientY: 150, backgroundPositionX: -320 });
    assert.equal(point.x >= base.imageWidth, true);
  });
});

describe("isSpritePixelOpaque", () => {
  it("accepts pixels at or above the alpha threshold", () => {
    const pixels = makePixels(8, 8, [[4, 4, PET_ALPHA_HIT_THRESHOLD]]);
    assert.equal(isSpritePixelOpaque(pixels, 4, 4), true);
  });

  it("rejects faint see-through pixels below the threshold", () => {
    const pixels = makePixels(8, 8, [[4, 4, PET_ALPHA_HIT_THRESHOLD - 1]]);
    assert.equal(isSpritePixelOpaque(pixels, 4, 4), false);
  });

  it("accepts a pixel next to an opaque neighbor so antialiased outlines stay clickable", () => {
    const pixels = makePixels(8, 8, [[4, 4, 255]]);
    assert.equal(isSpritePixelOpaque(pixels, 3, 3), true);
  });

  it("rejects fully transparent and out-of-range pixels", () => {
    const pixels = makePixels(8, 8, [[4, 4, 255]]);
    assert.equal(isSpritePixelOpaque(pixels, 0, 0), false);
    assert.equal(isSpritePixelOpaque(pixels, -1, 4), false);
    assert.equal(isSpritePixelOpaque(pixels, 4, 100), false);
  });
});

// ─── tester factory wiring ───────────────────────────────────────────────────
// These protect the DOM wiring the helpers alone cannot: sprite selection
// (plugin override vs hidden base), the padding ring outside the artwork box,
// and fail-open behavior while pixels load or fail to load.

type FakeSpriteElement = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly style: {
    readonly backgroundImage: string;
    readonly backgroundPositionX: string;
    readonly backgroundPositionY: string;
    readonly backgroundSize: string;
  };
};

const makeFakeDocument = (
  sprites: Record<string, FakeSpriteElement | null>,
  dataset: Record<string, string> = {},
): PetAlphaHitTestDocument => {
  const elements = new WeakMap<object, FakeSpriteElement>();
  return {
    querySelector: (selector: string) => {
      const sprite = sprites[selector];
      if (!sprite) return null;
      const element = {
        getBoundingClientRect: () => ({
          left: sprite.left,
          top: sprite.top,
          right: sprite.left + sprite.width,
          bottom: sprite.top + sprite.height,
          width: sprite.width,
          height: sprite.height,
        }),
        offsetWidth: sprite.width,
        offsetHeight: sprite.height,
      };
      elements.set(element, sprite);
      return element;
    },
    defaultView: {
      getComputedStyle: (element) => {
        const sprite = elements.get(element);
        if (!sprite) throw new Error("unknown element");
        return sprite.style;
      },
    },
    documentElement: { dataset },
    createElement: () => {
      throw new Error("canvas is not needed for hit-tester tests");
    },
  };
};

const spriteStyle = {
  backgroundImage: 'url("file:///pets/sheet.png")',
  backgroundPositionX: "0px",
  backgroundPositionY: "0px",
  backgroundSize: "10px 10px",
};

const makeSprite = (left: number, top: number, size = 10, imageUrl = "file:///pets/sheet.png"): FakeSpriteElement => ({
  left,
  top,
  width: size,
  height: size,
  style: { ...spriteStyle, backgroundImage: `url("${imageUrl}")` },
});

const settleAsync = () => new Promise((resolve) => setImmediate(resolve));

describe("createPetAlphaHitTester", () => {
  it("reports transparent artwork as non-interactive and opaque artwork as interactive", async () => {
    const tester = createPetAlphaHitTester({
      document: makeFakeDocument({ ".pet-shell .sprite": makeSprite(0, 0) }),
      loadSpritePixels: async () => makePixels(10, 10, [[5, 5, 255]]),
    });
    assert.equal(tester.isOpaqueAt(5, 5), true); // first call warms the cache, fails open
    await settleAsync();
    assert.equal(tester.isOpaqueAt(5, 5), true);
    assert.equal(tester.isOpaqueAt(1, 1), false);
  });

  it("treats the hitbox padding ring outside the artwork box as transparent", async () => {
    const tester = createPetAlphaHitTester({
      document: makeFakeDocument({ ".pet-shell .sprite": makeSprite(28, 28) }),
      loadSpritePixels: async () => makePixels(10, 10, [[2, 2, 255]]),
    });
    tester.isOpaqueAt(30, 30); // warm the pixel cache
    await settleAsync();
    assert.equal(tester.isOpaqueAt(0, 0), false);
    assert.equal(tester.isOpaqueAt(30, 30), true);
  });

  it("samples the plugin override instead of the hidden base sprite", async () => {
    const tester = createPetAlphaHitTester({
      document: makeFakeDocument({
        ".pet-shell .plugin-sprite-override": makeSprite(0, 0, 10, "file:///pets/override.png"),
        ".pet-shell .sprite": makeSprite(0, 0, 10, "file:///pets/base.png"),
      }),
      loadSpritePixels: async (url) => url.includes("override")
        ? makePixels(10, 10, [])
        : makePixels(10, 10, [[5, 5, 255]]),
    });
    tester.isOpaqueAt(5, 5); // warm the pixel cache
    await settleAsync();
    // The base sprite is opaque at this point; the override's empty sheet
    // proves the override won selection.
    assert.equal(tester.isOpaqueAt(5, 5), false);
  });

  it("fails open while pixels load and after a load failure", async () => {
    let release: (pixels: SpriteSheetPixels) => void = () => undefined;
    const pendingTester = createPetAlphaHitTester({
      document: makeFakeDocument({ ".pet-shell .sprite": makeSprite(0, 0) }),
      loadSpritePixels: async () => new Promise<SpriteSheetPixels>((resolve) => { release = resolve; }),
    });
    assert.equal(pendingTester.isOpaqueAt(1, 1), true);

    const failingTester = createPetAlphaHitTester({
      document: makeFakeDocument({ ".pet-shell .sprite": makeSprite(0, 0) }),
      loadSpritePixels: async () => { throw new Error("sprite bytes unavailable"); },
    });
    assert.equal(failingTester.isOpaqueAt(1, 1), true);
    await settleAsync();
    assert.equal(failingTester.isOpaqueAt(1, 1), true);

    release(makePixels(10, 10, []));
    await settleAsync();
    assert.equal(pendingTester.isOpaqueAt(1, 1), false);
  });

  it("fails open when no sprite element exists", () => {
    const tester = createPetAlphaHitTester({
      document: makeFakeDocument({}),
      loadSpritePixels: async () => makePixels(10, 10, []),
    });
    assert.equal(tester.isOpaqueAt(5, 5), true);
  });
});
