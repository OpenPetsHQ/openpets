import { useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { resolveReactionSpriteState } from "@open-pets/pet-format/animation";
import type { SceneInstanceView, SceneSettings } from "../protocol.js";
import {
  getDragUpdate,
  getSpriteSize,
  getSpriteStateFrame,
  type Point,
} from "./companion-core.js";
import {
  createScene,
  reconcileScene,
  sceneCommand,
  sceneFrame,
  stepScene,
  type SceneCommand,
} from "./scene-core.js";
import "./stage.css";

export interface SceneStageProps {
  instances: readonly SceneInstanceView<string>[];
  settings: SceneSettings;
  selectedInstanceId: string | null;
  playbackEnabled: boolean;
  canInteract: () => boolean;
  onSelect: (instanceId: string) => void;
}

type Gesture = {
  kind: "pet" | "aim";
  element: HTMLElement;
  pointerId: number;
  start: Point;
  origin: Point;
  crossedThreshold: boolean;
  petId?: string;
};
type CachedImage = {
  image: HTMLImageElement;
  status: "loading" | "ready" | "error";
};

export function SceneStage(props: SceneStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const ballRef = useRef<HTMLDivElement>(null);
  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  const images = useRef(new Map<string, CachedImage>());
  const model = useRef(createScene([], { width: 0, height: 0 }, Math.random));
  const gesture = useRef<Gesture | null>(null);
  const current = useRef(props);
  current.current = props;
  const [aiming, setAiming] = useState(false);
  const aimingRef = useRef(false);
  const [hasArea, setHasArea] = useState(false);
  const [imageVersion, setImageVersion] = useState(0);
  const runtime = useRef<{
    redraw: () => void;
    sync: () => void;
    cancel: () => void;
  } | null>(null);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let frameId = 0;
    let lastTime: number | null = null;
    let disposed = false;
    let area = false;
    const command = (value: SceneCommand) => {
      model.current = sceneCommand(model.current, value, Math.random);
    };
    const endAim = () => {
      aimingRef.current = false;
      if (!disposed) setAiming(false);
    };
    const cancel = () => {
      const held = gesture.current;
      gesture.current = null;
      if (held?.kind === "pet" && held.petId && held.crossedThreshold) {
        command({ type: "dragCancel", id: held.petId });
      }
      if (held?.element.hasPointerCapture(held.pointerId))
        held.element.releasePointerCapture(held.pointerId);
      command({ type: "cancelBall" });
      endAim();
    };
    const draw = () => {
      const frame = sceneFrame(model.current);
      const instances = new Map(
        current.current.instances.map((instance) => [instance.id, instance]),
      );
      for (const pet of frame.pets) {
        const instance = instances.get(pet.id);
        const canvas = canvases.current.get(pet.id);
        if (!instance || !canvas) continue;
        canvas.style.transform = `translate(${pet.position.x}px, ${pet.position.y}px)`;
        const context = canvas.getContext("2d");
        if (!context) continue;
        const { layout, uri } = instance.appearance.sprite;
        const size = getSpriteSize(layout, current.current.settings.size);
        context.clearRect(0, 0, canvas.width, canvas.height);
        const cached = images.current.get(uri);
        if (cached?.status !== "ready") continue;
        const state =
          pet.animation === "reaction"
            ? resolveReactionSpriteState("success", undefined)
            : pet.animation === "walk"
              ? pet.facing === "left"
                ? "running-left"
                : "running-right"
              : "idle";
        const sprite = getSpriteStateFrame(
          layout,
          state,
          pet.animationElapsedMs,
        );
        context.drawImage(
          cached.image,
          sprite.column * layout.frameWidth,
          sprite.row * layout.frameHeight,
          layout.frameWidth,
          layout.frameHeight,
          0,
          0,
          size.width,
          size.height,
        );
      }
      if (ballRef.current) {
        const ball = frame.ball;
        ballRef.current.style.display = ball ? "block" : "none";
        if (ball) {
          ballRef.current.style.width = `${ball.radius * 2}px`;
          ballRef.current.style.height = `${ball.radius * 2}px`;
          ballRef.current.style.transform = `translate(${ball.center.x - ball.radius}px, ${ball.center.y - ball.radius}px)`;
        }
      }
    };
    const tick = (now: number) => {
      frameId = 0;
      if (
        disposed ||
        document.hidden ||
        !current.current.playbackEnabled ||
        !area
      )
        return;
      if (lastTime !== null)
        model.current = stepScene(
          model.current,
          now - lastTime,
          current.current.settings,
          Math.random,
        );
      lastTime = now;
      draw();
      frameId = requestAnimationFrame(tick);
    };
    const schedule = () => {
      if (
        !frameId &&
        !document.hidden &&
        current.current.playbackEnabled &&
        area
      ) {
        lastTime = null;
        frameId = requestAnimationFrame(tick);
      }
    };
    const sync = () => {
      const { instances, settings, playbackEnabled } = current.current;
      const bounds = { width: stage.clientWidth, height: stage.clientHeight };
      area = bounds.width > 0 && bounds.height > 0;
      setHasArea(area);
      const held = gesture.current;
      if (
        held?.petId &&
        !instances.some((instance) => instance.id === held.petId)
      ) {
        cancel();
      }
      model.current = reconcileScene(
        model.current,
        instances.map((instance) => ({
          id: instance.id,
          spriteSize: getSpriteSize(
            instance.appearance.sprite.layout,
            settings.size,
          ),
        })),
        bounds,
        Math.random,
      );
      const used = new Set(
        instances.map((instance) => instance.appearance.sprite.uri),
      );
      for (const [uri, cached] of images.current) {
        if (!used.has(uri)) {
          cached.image.onload = null;
          cached.image.onerror = null;
          images.current.delete(uri);
        }
      }
      for (const uri of used) {
        if (images.current.has(uri)) continue;
        const image = new Image();
        const cached: CachedImage = { image, status: "loading" };
        images.current.set(uri, cached);
        image.onload = () => {
          cached.status = "ready";
          setImageVersion((value) => value + 1);
          draw();
        };
        image.onerror = () => {
          cached.status = "error";
          console.error("[OpenPets stage] Could not load a companion sprite.");
          setImageVersion((value) => value + 1);
          draw();
        };
        image.src = uri;
      }
      if (!playbackEnabled || document.hidden || !area) {
        cancel();
        if (frameId) cancelAnimationFrame(frameId);
        frameId = 0;
        lastTime = null;
      }
      if (settings.paused && aimingRef.current) cancel();
      draw();
      schedule();
    };
    const visibility = () => sync();
    const blur = () => {
      cancel();
      draw();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && aimingRef.current) {
        cancel();
        draw();
      }
    };
    const observer = new ResizeObserver(sync);
    observer.observe(stage);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", keydown);
    runtime.current = { redraw: draw, sync, cancel };
    sync();
    return () => {
      disposed = true;
      cancel();
      if (frameId) cancelAnimationFrame(frameId);
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", keydown);
      for (const cached of images.current.values()) {
        cached.image.onload = null;
        cached.image.onerror = null;
      }
      images.current.clear();
      runtime.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    runtime.current?.sync();
  }, [props.instances, props.settings, props.playbackEnabled]);

  const ready = props.playbackEnabled && !document.hidden && hasArea;
  const canThrow =
    ready && !props.settings.paused && props.instances.length > 0;
  const command = (value: SceneCommand) => {
    model.current = sceneCommand(model.current, value, Math.random);
    runtime.current?.redraw();
  };
  const capture = (event: PointerEvent<HTMLElement>, next: Gesture) => {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch (reason) {
      console.warn("[OpenPets stage] Pointer capture failed.", reason);
      return false;
    }
    gesture.current = next;
    event.preventDefault();
    return true;
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const held = gesture.current;
    if (
      !held ||
      held.pointerId !== event.pointerId ||
      held.kind !== "pet" ||
      !held.petId
    )
      return;
    const instance = current.current.instances.find(
      (item) => item.id === held.petId,
    );
    if (!instance) return;
    const update = getDragUpdate(
      held,
      { x: event.clientX, y: event.clientY },
      model.current.bounds,
      getSpriteSize(
        instance.appearance.sprite.layout,
        current.current.settings.size,
      ),
    );
    if (update.crossedThreshold && !held.crossedThreshold)
      command({ type: "dragStart", id: held.petId });
    held.crossedThreshold = update.crossedThreshold;
    if (held.crossedThreshold)
      command({ type: "dragMove", id: held.petId, position: update.position });
  };
  const release = (event: PointerEvent<HTMLElement>, cancelled = false) => {
    const held = gesture.current;
    if (!held || held.pointerId !== event.pointerId) return;
    if (!cancelled) move(event);
    gesture.current = null;
    if (held.element.hasPointerCapture(held.pointerId))
      held.element.releasePointerCapture(held.pointerId);
    if (held.kind === "pet" && held.petId) {
      if (held.crossedThreshold)
        command({ type: cancelled ? "dragCancel" : "dragEnd", id: held.petId });
      else if (!cancelled) command({ type: "click", id: held.petId });
    } else {
      if (!cancelled && canThrow) {
        const rect = stageRef.current?.getBoundingClientRect();
        if (rect)
          command({
            type: "throwBall",
            start: { x: held.start.x - rect.left, y: held.start.y - rect.top },
            velocity: {
              x: (event.clientX - held.start.x) * 3,
              y: (event.clientY - held.start.y) * 3,
            },
          });
      }
      aimingRef.current = false;
      setAiming(false);
    }
  };
  const failed = props.instances.some(
    (item) =>
      images.current.get(item.appearance.sprite.uri)?.status === "error",
  );
  const loading = props.instances.some((item) => {
    const status = images.current.get(item.appearance.sprite.uri)?.status;
    return !status || status === "loading";
  });
  void imageVersion;

  return (
    <div className="scene-stage-shell">
      <div
        className={`companion-stage ${props.settings.backdrop === "dots" ? "stage-dots" : ""} ${aiming ? "stage-aiming" : ""}`}
        ref={stageRef}
        aria-label="Companion space"
        onPointerDown={(event) => {
          if (
            !aimingRef.current ||
            !canThrow ||
            event.target !== event.currentTarget ||
            !event.isPrimary ||
            event.button !== 0 ||
            gesture.current
          )
            return;
          capture(event, {
            kind: "aim",
            element: event.currentTarget,
            pointerId: event.pointerId,
            start: { x: event.clientX, y: event.clientY },
            origin: { x: 0, y: 0 },
            crossedThreshold: false,
          });
        }}
        onPointerUp={(event) => release(event)}
        onPointerCancel={(event) => release(event, true)}
        onLostPointerCapture={(event) => release(event, true)}
      >
        {props.instances.map((instance, index) => {
          const size = getSpriteSize(
            instance.appearance.sprite.layout,
            props.settings.size,
          );
          return (
            <canvas
              key={instance.id}
              ref={(element) => {
                if (element) canvases.current.set(instance.id, element);
                else canvases.current.delete(instance.id);
              }}
              className="stage-canvas"
              style={{
                zIndex:
                  instance.id === props.selectedInstanceId
                    ? props.instances.length
                    : index,
              }}
              width={size.width}
              height={size.height}
              title={instance.name}
              aria-label={`${instance.name}. Click to interact or drag to move.`}
              onPointerDown={(event) => {
                if (
                  !ready ||
                  !current.current.canInteract() ||
                  !event.isPrimary ||
                  event.button !== 0 ||
                  gesture.current
                )
                  return;
                event.stopPropagation();
                const pet = sceneFrame(model.current).pets.find(
                  (item) => item.id === instance.id,
                );
                if (!pet) return;
                props.onSelect(instance.id);
                capture(event, {
                  kind: "pet",
                  petId: instance.id,
                  element: event.currentTarget,
                  pointerId: event.pointerId,
                  start: { x: event.clientX, y: event.clientY },
                  origin: pet.position,
                  crossedThreshold: false,
                });
              }}
              onPointerMove={move}
              onPointerUp={(event) => {
                event.stopPropagation();
                release(event);
              }}
              onPointerCancel={(event) => {
                event.stopPropagation();
                release(event, true);
              }}
              onLostPointerCapture={(event) => {
                event.stopPropagation();
                release(event, true);
              }}
            />
          );
        })}
        <div ref={ballRef} className="stage-ball" />
        {failed && (
          <p className="stage-message error-text" role="status">
            Could not load a companion sprite.
          </p>
        )}
        {!failed && loading && (
          <p className="stage-message muted" role="status">
            Loading companions…
          </p>
        )}
        {!props.playbackEnabled && (
          <div className="stage-inactive">
            Your companions are on the other surface.
          </div>
        )}
      </div>
      <div className="stage-actions">
        <button
          className="button"
          disabled={!canThrow}
          onClick={() => {
            const { width, height } = model.current.bounds;
            command({
              type: "throwBall",
              start: { x: width * 0.25, y: height * 0.4 },
              velocity: { x: Math.min(380, width * 1.5), y: -240 },
            });
          }}
        >
          Throw ball
        </button>
        <button
          className="button"
          disabled={!canThrow}
          aria-pressed={aiming}
          onClick={() => {
            if (aimingRef.current) runtime.current?.cancel();
            else {
              aimingRef.current = true;
              setAiming(true);
            }
          }}
        >
          {aiming ? "Cancel aim" : "Aim throw"}
        </button>
        {aiming && (
          <span className="stage-hint">Drag on the background to throw.</span>
        )}
      </div>
    </div>
  );
}
