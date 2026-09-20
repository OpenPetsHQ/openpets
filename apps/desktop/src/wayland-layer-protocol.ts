/**
 * Electron-free wire protocol and pixel helpers for the native Wayland
 * layer-shell helper.
 *
 * The native helper's protocol is deliberately small: every message has a
 * four-byte little-endian body length, followed by a one-byte tag and the
 * tag-specific body. The tag values stay private here so callers use the
 * specific command encoders and discriminated decoded-message API instead of
 * constructing arbitrary wire messages.
 */

const TAG_FRAME = 0x01;
const TAG_MOVE = 0x02;
const TAG_SHOW = 0x03;
const TAG_HIDE = 0x04;
const TAG_QUIT = 0x05;
const TAG_READY = 0x81;
const TAG_POINTER = 0x82;
const TAG_POSITION = 0x83;

const PT_MOVE = 0;
const PT_PRESS = 1;
const PT_RELEASE = 2;
const PT_ENTER = 3;
const PT_LEAVE = 4;

const MAX_MESSAGE_BODY = 64 * 1024 * 1024;
const FRAME_HEADER_SIZE = 20;
const POINTER_BODY_SIZE = 14;
const POSITION_BODY_SIZE = 9;

export interface WaylandFrame {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
  readonly stride: number;
  readonly bitmap: Buffer;
}

export interface WaylandImageSize {
  readonly width: number;
  readonly height: number;
}

export interface CroppedWaylandFrame {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
  readonly stride: number;
  readonly bitmap: Buffer;
}

export type WaylandPointerKind = "move" | "press" | "release" | "enter" | "leave";

export type WaylandIncomingMessage =
  | { readonly type: "ready" }
  | {
      readonly type: "pointer";
      readonly kind: WaylandPointerKind;
      readonly x: number;
      readonly y: number;
      readonly button: number;
    }
  | { readonly type: "position"; readonly x: number; readonly y: number };

export interface WaylandProtocolDiagnostic {
  readonly severity: "diagnostic" | "fatal";
  readonly message: string;
}

export interface WaylandDecodeResult {
  readonly messages: readonly WaylandIncomingMessage[];
  readonly diagnostics: readonly WaylandProtocolDiagnostic[];
  readonly fatal: boolean;
}

export interface WaylandMessageDecoder {
  push(chunk: Buffer): WaylandDecodeResult;
  reset(): void;
}

export interface WaylandPointerButtonMapping {
  readonly button: "left" | "middle" | "right";
  /** Only the known left button may initiate or finish a primary drag. */
  readonly isPrimary: boolean;
}

export interface WaylandPointerCoordinates {
  readonly logicalX: number;
  readonly logicalY: number;
  readonly globalX: number;
  readonly globalY: number;
}

function encodeLengthPrefixed(tag: number, payload: Buffer): Buffer {
  const bodyLength = 1 + payload.length;
  if (bodyLength > MAX_MESSAGE_BODY) {
    throw new RangeError("Wayland message exceeds the 64 MiB helper limit");
  }

  const message = Buffer.allocUnsafe(4 + bodyLength);
  message.writeUInt32LE(bodyLength, 0);
  message[4] = tag;
  payload.copy(message, 5);
  return message;
}

function assertSignedInt32(value: number, name: string): void {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new RangeError(`${name} must be a signed 32-bit integer`);
  }
}

function assertUnsignedInt32(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`${name} must be an unsigned 32-bit integer`);
  }
}

/** Encode a FRAME command with the Rust helper's exact field order. */
export function encodeFrame(frame: WaylandFrame): Buffer {
  assertSignedInt32(frame.offsetX, "offsetX");
  assertSignedInt32(frame.offsetY, "offsetY");
  assertUnsignedInt32(frame.width, "width");
  assertUnsignedInt32(frame.height, "height");
  assertUnsignedInt32(frame.stride, "stride");

  const expectedBytes = frame.stride * frame.height;
  if (!Number.isSafeInteger(expectedBytes) || frame.bitmap.length !== expectedBytes) {
    throw new RangeError("frame bitmap length must equal stride * height");
  }
  const bodyLength = 1 + FRAME_HEADER_SIZE + frame.bitmap.length;
  if (bodyLength > MAX_MESSAGE_BODY) {
    throw new RangeError("Wayland frame exceeds the 64 MiB helper limit");
  }

  const payload = Buffer.allocUnsafe(FRAME_HEADER_SIZE + frame.bitmap.length);
  payload.writeInt32LE(frame.offsetX, 0);
  payload.writeInt32LE(frame.offsetY, 4);
  payload.writeUInt32LE(frame.width, 8);
  payload.writeUInt32LE(frame.height, 12);
  payload.writeUInt32LE(frame.stride, 16);
  frame.bitmap.copy(payload, FRAME_HEADER_SIZE);
  return encodeLengthPrefixed(TAG_FRAME, payload);
}

/** Encode a MOVE command containing signed global logical coordinates. */
export function encodeMove(x: number, y: number): Buffer {
  assertSignedInt32(x, "x");
  assertSignedInt32(y, "y");
  const payload = Buffer.allocUnsafe(8);
  payload.writeInt32LE(x, 0);
  payload.writeInt32LE(y, 4);
  return encodeLengthPrefixed(TAG_MOVE, payload);
}

/** Encode a SHOW command. */
export function encodeShow(): Buffer {
  return encodeLengthPrefixed(TAG_SHOW, Buffer.alloc(0));
}

/** Encode a HIDE command. */
export function encodeHide(): Buffer {
  return encodeLengthPrefixed(TAG_HIDE, Buffer.alloc(0));
}

/** Encode a QUIT command. */
export function encodeQuit(): Buffer {
  return encodeLengthPrefixed(TAG_QUIT, Buffer.alloc(0));
}

/**
 * Remove transparent canvas margins while preserving the frame's logical
 * origin. NativeImage bitmaps may have padded source rows; the helper always
 * receives tightly packed rows after this operation.
 */
export function cropTransparentFrame(bitmap: Buffer, size: WaylandImageSize): CroppedWaylandFrame | null {
  if (!Buffer.isBuffer(bitmap)) return null;
  if (!Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width <= 0 || size.height <= 0) {
    return null;
  }

  const sourceStride = bitmap.length / size.height;
  if (!Number.isInteger(sourceStride) || sourceStride < size.width * 4) return null;

  let left = size.width;
  let top = size.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < size.height; y += 1) {
    const row = y * sourceStride;
    for (let x = 0; x < size.width; x += 1) {
      if (bitmap[row + x * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return null;

  left = Math.max(0, left - 4);
  top = Math.max(0, top - 4);
  right = Math.min(size.width - 1, right + 4);
  bottom = Math.min(size.height - 1, bottom + 4);

  const width = right - left + 1;
  const height = bottom - top + 1;
  const stride = width * 4;
  const cropped = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const sourceStart = (top + y) * sourceStride + left * 4;
    bitmap.copy(cropped, y * stride, sourceStart, sourceStart + stride);
  }

  return { offsetX: left, offsetY: top, width, height, stride, bitmap: cropped };
}

/** Map evdev button codes to Electron names without treating unknown buttons as primary drag input. */
export function mapPointerButton(button: number): WaylandPointerButtonMapping {
  if (button === 0x110) return { button: "left", isPrimary: true };
  if (button === 0x111) return { button: "right", isPrimary: false };
  if (button === 0x112) return { button: "middle", isPrimary: false };
  return { button: "left", isPrimary: false };
}

/** Convert cropped-surface coordinates to renderer-local and global coordinates. */
export function mapPointerCoordinates(
  x: number,
  y: number,
  frameOffset: { readonly x: number; readonly y: number },
  surfacePosition: { readonly x: number; readonly y: number },
): WaylandPointerCoordinates {
  const logicalX = x + frameOffset.x;
  const logicalY = y + frameOffset.y;
  return {
    logicalX,
    logicalY,
    globalX: surfacePosition.x + logicalX,
    globalY: surfacePosition.y + logicalY,
  };
}

function pointerKind(kind: number): WaylandPointerKind | null {
  if (kind === PT_MOVE) return "move";
  if (kind === PT_PRESS) return "press";
  if (kind === PT_RELEASE) return "release";
  if (kind === PT_ENTER) return "enter";
  if (kind === PT_LEAVE) return "leave";
  return null;
}

function diagnostic(message: string): WaylandProtocolDiagnostic {
  return { severity: "diagnostic", message };
}

function fatalDiagnostic(message: string): WaylandProtocolDiagnostic {
  return { severity: "fatal", message };
}

/**
 * Create an incremental decoder for helper → client messages. Malformed
 * complete messages are consumed and reported so one bad packet cannot make a
 * socket callback throw or trap the decoder in an endless retry. Incomplete
 * packets retain their remainder; an oversized declaration is fatal before
 * any payload buffering occurs.
 */
export function createWaylandMessageDecoder(): WaylandMessageDecoder {
  let remainder = Buffer.alloc(0) as Buffer<ArrayBufferLike>;
  let fatal = false;

  function oversizedDeclaration(chunk: Buffer): boolean {
    if (remainder.length >= 4) return remainder.readUInt32LE(0) > MAX_MESSAGE_BODY;
    if (remainder.length + chunk.length < 4) return false;

    const header = Buffer.allocUnsafe(4);
    remainder.copy(header, 0);
    chunk.copy(header, remainder.length, 0, 4 - remainder.length);
    return header.readUInt32LE(0) > MAX_MESSAGE_BODY;
  }

  function push(chunk: Buffer): WaylandDecodeResult {
    if (fatal) {
      return { messages: [], diagnostics: [], fatal: true };
    }
    if (!Buffer.isBuffer(chunk) || chunk.length === 0) {
      return { messages: [], diagnostics: [], fatal: false };
    }

    if (oversizedDeclaration(chunk)) {
      fatal = true;
      return {
        messages: [],
        diagnostics: [fatalDiagnostic("declared Wayland message exceeds the 64 MiB helper limit")],
        fatal: true,
      };
    }

    remainder = remainder.length === 0 ? chunk : Buffer.concat([remainder, chunk]);
    const messages: WaylandIncomingMessage[] = [];
    const diagnostics: WaylandProtocolDiagnostic[] = [];

    while (remainder.length >= 4) {
      const bodyLength = remainder.readUInt32LE(0);
      if (bodyLength > MAX_MESSAGE_BODY) {
        fatal = true;
        diagnostics.push(fatalDiagnostic("declared Wayland message exceeds the 64 MiB helper limit"));
        return { messages, diagnostics, fatal: true };
      }
      if (remainder.length < 4 + bodyLength) break;

      const body = remainder.subarray(4, 4 + bodyLength);
      remainder = remainder.subarray(4 + bodyLength);
      if (bodyLength === 0) {
        diagnostics.push(diagnostic("Wayland message has a zero-length body"));
        continue;
      }

      const tag = body[0];
      if (tag === TAG_READY) {
        if (bodyLength !== 1) diagnostics.push(diagnostic("READY message has an invalid body size"));
        else messages.push({ type: "ready" });
        continue;
      }
      if (tag === TAG_POINTER) {
        if (bodyLength !== POINTER_BODY_SIZE) {
          diagnostics.push(diagnostic("POINTER message has an invalid body size"));
          continue;
        }
        const kind = pointerKind(body[1]);
        if (!kind) {
          diagnostics.push(diagnostic(`POINTER message has an unknown pointer kind ${body[1]}`));
          continue;
        }
        messages.push({ type: "pointer", kind, x: body.readInt32LE(2), y: body.readInt32LE(6), button: body.readUInt32LE(10) });
        continue;
      }
      if (tag === TAG_POSITION) {
        if (bodyLength !== POSITION_BODY_SIZE) {
          diagnostics.push(diagnostic("POSITION message has an invalid body size"));
          continue;
        }
        messages.push({ type: "position", x: body.readInt32LE(1), y: body.readInt32LE(5) });
        continue;
      }

      diagnostics.push(diagnostic(`unknown Wayland helper message tag 0x${tag.toString(16).padStart(2, "0")}`));
    }

    return { messages, diagnostics, fatal: false };
  }

  function reset(): void {
    remainder = Buffer.alloc(0);
    fatal = false;
  }

  return { push, reset };
}
