import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createWaylandMessageDecoder,
  cropTransparentFrame,
  encodeFrame,
  encodeHide,
  encodeMove,
  encodeQuit,
  encodeShow,
  mapPointerButton,
  mapPointerCoordinates,
} from "../src/wayland-layer-protocol.js";

function message(body: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

function incomingPointer(kind: number, x: number, y: number, button: number): Buffer {
  const body = Buffer.alloc(14);
  body[0] = 0x82;
  body[1] = kind;
  body.writeInt32LE(x, 2);
  body.writeInt32LE(y, 6);
  body.writeUInt32LE(button, 10);
  return message(body);
}

describe("Wayland layer-shell protocol encoding", () => {
  it("encodes golden little-endian commands and BGRA frame fields", () => {
    assert.deepEqual(encodeShow(), Buffer.from([1, 0, 0, 0, 0x03]));
    assert.deepEqual(encodeHide(), Buffer.from([1, 0, 0, 0, 0x04]));
    assert.deepEqual(encodeQuit(), Buffer.from([1, 0, 0, 0, 0x05]));
    assert.deepEqual(
      encodeMove(-2, 0x12345678),
      Buffer.from([0x09, 0, 0, 0, 0x02, 0xfe, 0xff, 0xff, 0xff, 0x78, 0x56, 0x34, 0x12]),
    );

    const bitmap = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert.deepEqual(
      encodeFrame({ offsetX: -3, offsetY: 4, width: 2, height: 1, stride: 12, bitmap }),
      Buffer.concat([
        Buffer.from([0x21, 0, 0, 0, 0x01, 0xfd, 0xff, 0xff, 0xff, 0x04, 0, 0, 0, 0x02, 0, 0, 0, 0x01, 0, 0, 0, 0x0c, 0, 0, 0]),
        bitmap,
      ]),
    );
  });
});

describe("incremental Wayland helper decoding", () => {
  it("retains fragments, decodes multiple messages, and keeps a remainder", () => {
    const decoder = createWaylandMessageDecoder();
    const ready = message(Buffer.from([0x81]));
    const position = message(Buffer.from([0x83, 0xfb, 0xff, 0xff, 0xff, 0x2a, 0, 0, 0]));
    const first = decoder.push(Buffer.concat([ready, position.subarray(0, 6)]));
    assert.deepEqual(first.messages, [{ type: "ready" }]);
    assert.deepEqual(first.diagnostics, []);
    assert.equal(first.fatal, false);

    const second = decoder.push(Buffer.concat([position.subarray(6), message(Buffer.from([0x81]))]));
    assert.deepEqual(second.messages, [
      { type: "position", x: -5, y: 42 },
      { type: "ready" },
    ]);
    assert.deepEqual(second.diagnostics, []);
  });

  it("rejects malformed packets without throwing and continues with valid packets", () => {
    const decoder = createWaylandMessageDecoder();
    const malformedPointerBody = Buffer.alloc(13);
    malformedPointerBody[0] = 0x82;
    const malformedPointer = decoder.push(message(malformedPointerBody));
    assert.equal(malformedPointer.messages.length, 0);
    assert.equal(malformedPointer.diagnostics.length, 1);

    const wrongPosition = decoder.push(message(Buffer.from([0x83, 0, 0, 0, 0])));
    assert.equal(wrongPosition.messages.length, 0);
    assert.equal(wrongPosition.diagnostics.length, 1);

    const unknownTag = decoder.push(message(Buffer.from([0x7f])));
    assert.equal(unknownTag.messages.length, 0);
    assert.equal(unknownTag.diagnostics.length, 1);

    const unknownPointer = decoder.push(incomingPointer(99, 1, 2, 0x110));
    assert.equal(unknownPointer.messages.length, 0);
    assert.equal(unknownPointer.diagnostics.length, 1);

    const valid = decoder.push(incomingPointer(0, -3, 7, 0x111));
    assert.deepEqual(valid.messages, [{ type: "pointer", kind: "move", x: -3, y: 7, button: 0x111 }]);
  });

  it("reports an oversized declaration as fatal before buffering its payload", () => {
    const decoder = createWaylandMessageDecoder();
    const result = decoder.push(Buffer.from([0xff, 0xff, 0xff, 0xff]));
    assert.equal(result.fatal, true);
    assert.equal(result.diagnostics[0]?.severity, "fatal");
    assert.equal(decoder.push(message(Buffer.from([0x81]))).fatal, true);
  });

  it("buffers an incomplete packet until its final bytes arrive", () => {
    const decoder = createWaylandMessageDecoder();
    assert.deepEqual(decoder.push(incomingPointer(1, 10, 20, 0x110).subarray(0, 10)).messages, []);
    assert.deepEqual(decoder.push(incomingPointer(1, 10, 20, 0x110).subarray(10)).messages, [
      { type: "pointer", kind: "press", x: 10, y: 20, button: 0x110 },
    ]);
  });
});

describe("Wayland frame crop and pointer mapping", () => {
  it("crops alpha with clipped padding and repacks padded source rows", () => {
    const width = 12;
    const height = 10;
    const sourceStride = width * 4 + 4;
    const bitmap = Buffer.alloc(sourceStride * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        bitmap[y * sourceStride + x * 4] = y * width + x;
      }
    }
    bitmap[3 * sourceStride + 5 * 4 + 3] = 1;
    bitmap[4 * sourceStride + 6 * 4 + 3] = 2;

    const cropped = cropTransparentFrame(bitmap, { width, height });
    assert.ok(cropped);
    assert.deepEqual(cropped, {
      offsetX: 1,
      offsetY: 0,
      width: 10,
      height: 9,
      stride: 40,
      bitmap: cropped.bitmap,
    });
    assert.equal(cropped.bitmap[3 * cropped.stride + 4 * 4], 3 * width + 5);
    assert.equal(cropped.bitmap[4 * cropped.stride + 5 * 4], 4 * width + 6);
    assert.equal(cropped.bitmap.length, cropped.stride * cropped.height);
  });

  it("returns null for transparent frames, invalid sizes, and invalid inferred strides", () => {
    assert.equal(cropTransparentFrame(Buffer.alloc(4 * 3 * 2), { width: 4, height: 3 }), null);
    assert.equal(cropTransparentFrame(Buffer.alloc(10), { width: 2, height: 2 }), null);
    assert.equal(cropTransparentFrame(Buffer.alloc(17), { width: 2, height: 2 }), null);
    assert.equal(cropTransparentFrame(Buffer.alloc(8), { width: 0, height: 2 }), null);
  });

  it("maps known buttons, keeps unknown buttons non-primary, and adds crop offsets", () => {
    assert.deepEqual(mapPointerButton(0x110), { button: "left", isPrimary: true });
    assert.deepEqual(mapPointerButton(0x111), { button: "right", isPrimary: false });
    assert.deepEqual(mapPointerButton(0x112), { button: "middle", isPrimary: false });
    assert.deepEqual(mapPointerButton(0x999), { button: "left", isPrimary: false });
    assert.deepEqual(mapPointerCoordinates(3, 4, { x: 10, y: -2 }, { x: 100, y: 200 }), {
      logicalX: 13,
      logicalY: 2,
      globalX: 113,
      globalY: 202,
    });
  });
});
