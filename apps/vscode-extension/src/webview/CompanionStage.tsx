import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { PointerEvent } from "react";
import type { SpriteAsset, CompanionSize } from "../protocol.js";
import {
  clampSpritePosition,
  getCompanionFrame,
  getSpriteSize,
  getDragUpdate,
  type Point,
} from "./companion-core.js";
import "./stage.css";

interface CapturedPointer {
  element: HTMLCanvasElement;
  id: number;
  start: Point;
  origin: Point;
  crossedThreshold: boolean;
}

interface LoadedSprite {
  uri: string;
  image?: HTMLImageElement;
  error?: string;
}

export interface CompanionStageProps {
  sprite: SpriteAsset;
  size: CompanionSize;
  enabled: boolean;
  petName: string;
  outfitName?: string;
  initialPosition?: Point;
  onPositionChange?: (point: Point) => void;
  onShowSidebar?: () => void;
}

export function CompanionStage({
  sprite,
  size,
  enabled,
  petName,
  outfitName,
  initialPosition,
  onPositionChange,
  onShowSidebar,
}: CompanionStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [position, setPosition] = useState<Point>(
    initialPosition ?? { x: 0, y: 0 },
  );
  const positionRef = useRef(position);
  const positionedRef = useRef(initialPosition !== undefined);
  const boundsRef = useRef({ width: 0, height: 0 });
  const pointerRef = useRef<CapturedPointer | null>(null);
  const playbackRef = useRef({ at: performance.now(), clicked: false });
  const callbackRef = useRef(onPositionChange);
  const [visible, setVisible] = useState(!document.hidden);
  const [loaded, setLoaded] = useState<LoadedSprite>({ uri: sprite.uri });
  const { width, height } = getSpriteSize(sprite.layout, size);
  const image = loaded.uri === sprite.uri ? loaded.image : undefined;

  useLayoutEffect(() => {
    callbackRef.current = onPositionChange;
  }, [onPositionChange]);

  const place = useCallback((point: Point, notify = false) => {
    if (point.x === positionRef.current.x && point.y === positionRef.current.y)
      return;
    positionRef.current = point;
    setPosition(point);
    if (notify) callbackRef.current?.(point);
  }, []);

  const releasePointer = useCallback(() => {
    const pointer = pointerRef.current;
    pointerRef.current = null;
    if (pointer?.element.hasPointerCapture(pointer.id)) {
      pointer.element.releasePointerCapture(pointer.id);
    }
  }, []);

  const stopTransient = useCallback(() => {
    releasePointer();
    playbackRef.current = { at: performance.now(), clicked: false };
  }, [releasePointer]);

  useLayoutEffect(() => {
    stopTransient();
    return stopTransient;
  }, [enabled, sprite.uri, stopTransient]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const content = contentRef.current;
    if (!stage || !content) return;
    let active = true;
    const measure = () => {
      if (!active || stage.clientWidth === 0 || stage.clientHeight === 0)
        return;
      const footer = Math.max(
        0,
        content.getBoundingClientRect().height - height,
      );
      const bounds = {
        width: stage.clientWidth,
        height: Math.max(0, stage.clientHeight - footer),
      };
      boundsRef.current = bounds;
      const point = positionedRef.current
        ? positionRef.current
        : { x: (bounds.width - width) / 2, y: bounds.height - height };
      positionedRef.current = true;
      place(clampSpritePosition(point, bounds, { width, height }), true);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    observer.observe(content);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [enabled, width, height, petName, outfitName, place]);

  useEffect(() => {
    const changeVisibility = () => {
      if (document.hidden) stopTransient();
      setVisible(!document.hidden);
    };
    window.addEventListener("blur", stopTransient);
    document.addEventListener("visibilitychange", changeVisibility);
    return () => {
      window.removeEventListener("blur", stopTransient);
      document.removeEventListener("visibilitychange", changeVisibility);
      stopTransient();
    };
  }, [stopTransient]);

  useEffect(() => {
    let active = true;
    const next = new Image();
    next.onload = () => {
      if (active) setLoaded({ uri: sprite.uri, image: next });
    };
    next.onerror = () => {
      if (active) {
        console.error("[OpenPets stage] Sprite could not be loaded.");
        setLoaded({
          uri: sprite.uri,
          error: "Could not load the companion sprite.",
        });
      }
    };
    next.src = sprite.uri;
    return () => {
      active = false;
      next.onload = null;
      next.onerror = null;
    };
  }, [sprite.uri]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, width, height);
    if (!enabled || !visible || !image) return;
    let active = true;
    let frameId = 0;
    const draw = (now: number) => {
      if (!active || document.hidden) return;
      const playback = playbackRef.current;
      const frame = getCompanionFrame(
        sprite.layout,
        now - playback.at,
        playback.clicked,
      );
      context.clearRect(0, 0, width, height);
      context.drawImage(
        image,
        frame.column * sprite.layout.frameWidth,
        frame.row * sprite.layout.frameHeight,
        sprite.layout.frameWidth,
        sprite.layout.frameHeight,
        0,
        0,
        width,
        height,
      );
      frameId = requestAnimationFrame(draw);
    };
    frameId = requestAnimationFrame(draw);
    return () => {
      active = false;
      cancelAnimationFrame(frameId);
    };
  }, [enabled, visible, image, sprite.layout, width, height]);

  const updatePointer = (event: PointerEvent<HTMLCanvasElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return null;
    const current = { x: event.clientX, y: event.clientY };
    const update = getDragUpdate(pointer, current, boundsRef.current, {
      width,
      height,
    });
    pointer.crossedThreshold = update.crossedThreshold;
    if (pointer.crossedThreshold) place(update.position, true);
    return pointer;
  };

  const cancelPointer = (event: PointerEvent<HTMLCanvasElement>) => {
    if (pointerRef.current?.id === event.pointerId) stopTransient();
  };

  return (
    <div
      ref={stageRef}
      className="companion-stage"
      aria-label="Companion space"
    >
      <div
        ref={contentRef}
        className="stage-companion"
        style={{
          width,
          transform: `translate(${position.x}px, ${position.y}px)`,
        }}
        hidden={!enabled}
      >
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="stage-canvas"
          aria-label={`${petName}. Click to interact or drag to move.`}
          onPointerDown={(event) => {
            if (
              !enabled ||
              !visible ||
              document.hidden ||
              !image ||
              !event.isPrimary ||
              event.button !== 0 ||
              pointerRef.current
            )
              return;
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch (reason) {
              console.warn("[OpenPets stage] Pointer capture failed.", reason);
              return;
            }
            pointerRef.current = {
              element: event.currentTarget,
              id: event.pointerId,
              start: { x: event.clientX, y: event.clientY },
              origin: positionRef.current,
              crossedThreshold: false,
            };
            event.preventDefault();
          }}
          onPointerMove={updatePointer}
          onPointerUp={(event) => {
            const pointer = updatePointer(event);
            if (!pointer) return;
            releasePointer();
            if (!pointer.crossedThreshold) {
              playbackRef.current = { at: performance.now(), clicked: true };
            }
          }}
          onPointerCancel={cancelPointer}
          onLostPointerCapture={cancelPointer}
        />
        <div className="stage-caption">
          <strong>{petName}</strong>
          <span>{outfitName ?? "Base appearance"}</span>
        </div>
      </div>
      {enabled && !image && (
        <p
          className={
            loaded.uri === sprite.uri && loaded.error
              ? "stage-message error-text"
              : "stage-message muted"
          }
          role="status"
        >
          {loaded.uri === sprite.uri && loaded.error
            ? loaded.error
            : "Loading companion…"}
        </p>
      )}
      {!enabled && (
        <div className="stage-inactive">
          <p>Your companion is on the other surface.</p>
          {onShowSidebar && (
            <button className="button" onClick={onShowSidebar}>
              Bring to sidebar
            </button>
          )}
        </div>
      )}
    </div>
  );
}
