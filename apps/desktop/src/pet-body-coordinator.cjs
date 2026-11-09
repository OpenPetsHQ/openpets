/** Sole semantic body arbiter; artwork decoding and Classic adapters remain separate. */
function createPetBodyCoordinator({ player, now, random, onResult, onVisibility, onActivityCancel, setTimeout: armTimer = setTimeout, clearTimeout: cancelTimer = clearTimeout }) {
  let snapshot = null;
  let active = null;
  let pending = null;
  let transitionTimer = null;
  let drag = null;
  let movement = null;
  let flipped = false;
  let plugin = false;
  let activity = false;
  let disposed = false;
  let playbackId = 0;
  const seenEvents = new Set();
  let lastIdleVariant = null;
  let nextIdleOpportunity = now() + 30000;
  let contextIdentity = null;
  let contextAnimation = null;

  function result(item, outcome) {
    if (!item) return;
    onResult({ epoch: item.epoch, snapshotId: item.descriptor.snapshotId, playbackId: item.id, ...(item.intentId ? { intentId: item.intentId } : {}), outcome });
  }

  function cancelActive() {
    cancelTimer(transitionTimer);
    transitionTimer = null;
    pending = null;
    if (!active) return;
    const old = active;
    active = null;
    player.stop();
    result(old, 'cancelled');
  }

  function choose(variants, avoid) {
    if (!variants?.length) return null;
    const eligible = variants.length > 1 ? variants.filter((variant) => variant.animation !== avoid) : variants;
    const total = eligible.reduce((sum, variant) => sum + (variant.weight ?? 1), 0);
    let point = random() * total;
    for (const variant of eligible) {
      point -= variant.weight ?? 1;
      if (point < 0) return variant.animation;
    }
    return eligible[eligible.length - 1].animation;
  }

  function contextTarget() {
    const metadata = snapshot.motion.metadata;
    const context = snapshot.input.context;
    const variants = context === 'idle' ? metadata.bindings.idle : metadata.bindings.contexts?.[context] ?? metadata.bindings.idle;
    if (!contextAnimation) {
      contextAnimation = context === 'idle' ? variants[0].animation : choose(variants);
    }
    return { kind: 'context', key: context, animation: contextAnimation, descriptor: snapshot.motion, epoch: snapshot.input.epoch };
  }

  function desired() {
    if (!snapshot?.motion || snapshot.input.suspended || plugin && !drag || activity && !drag) return null;
    const descriptor = snapshot.motion;
    if (drag) {
      const direction = flipped ? (drag === 'left' ? 'right' : 'left') : drag;
      return { kind: 'drag', key: drag, animation: descriptor.metadata.bindings.movement[direction], descriptor, epoch: snapshot.input.epoch };
    }
    if (active?.kind === 'event' && active.descriptor.snapshotId === descriptor.snapshotId) return active;
    if (movement) {
      const direction = flipped ? (movement === 'left' ? 'right' : 'left') : movement;
      return { kind: 'movement', key: movement, animation: descriptor.metadata.bindings.movement[direction], descriptor, epoch: snapshot.input.epoch };
    }
    return contextTarget();
  }

  function same(a, b) {
    return a && b && a.kind === b.kind && a.key === b.key && a.animation === b.animation && a.descriptor.snapshotId === b.descriptor.snapshotId && a.epoch === b.epoch;
  }

  function playPhase(item, phase) {
    if (active !== item || disposed) return;
    const animation = item.descriptor.metadata.animations[item.animation];
    const clipId = phase === 'intro' ? animation.intro : phase === 'outro' ? animation.outro : animation.play === 'loop' ? animation.loop : animation.clip;
    if (!clipId) {
      phaseEnded(item, phase);
      return;
    }
    item.phase = phase;
    void player.play(item.descriptor, clipId, {
      onStarted() {
        if (active !== item || item.started) return;
        item.started = true;
        result(item, 'started');
      },
      onEnd() { phaseEnded(item, phase); },
      onFailed() {
        if (active !== item) return;
        active = null;
        pending = null;
        result(item, 'failed');
        if (item.kind === 'event') reconcile(true);
      },
    });
  }

  function start(target, immediate = false) {
    cancelActive();
    if (!target || disposed) return;
    const animation = target.descriptor.metadata.animations[target.animation];
    if (!animation) return;
    const item = { ...target, id: ++playbackId, started: false, phase: null };
    active = item;
    playPhase(item, immediate ? 'body' : 'intro');
  }

  function phaseEnded(item, phase) {
    if (active !== item || disposed) return;
    const animation = item.descriptor.metadata.animations[item.animation];
    if (phase === 'intro') {
      playPhase(item, 'body');
      return;
    }
    if (phase === 'outro') {
      if (item.kind === 'event') result(item, 'completed');
      if (animation.play === 'once' && item.kind === 'context' && item.key === 'idle' && contextIdentity?.context === 'idle') {
        contextAnimation = null;
      }
      active = null;
      const target = pending ?? desired();
      pending = null;
      start(target);
      return;
    }
    if (pending) {
      const outro = animation.outro;
      const duration = outro ? item.descriptor.verifiedClips[outro].durationMs / (item.descriptor.metadata.clips[outro].playbackRate ?? 1) : Infinity;
      if (outro && now() + duration <= pending.deadline) playPhase(item, 'outro');
      else start(pending);
      return;
    }
    if (animation.play === 'once') {
      if (animation.outro) {
        playPhase(item, 'outro');
      } else {
        if (item.kind === 'event') result(item, 'completed');
        if (item.kind === 'context' && item.key === 'idle' && contextIdentity?.context === 'idle') {
          contextAnimation = null;
        }
        active = null;
        start(desired());
      }
      return;
    }
    if (item.kind === 'context' && item.key === 'idle' && now() >= nextIdleOpportunity) {
      nextIdleOpportunity = now() + 30000;
      const variants = item.descriptor.metadata.bindings.idle;
      if (variants.length > 1 && random() < 0.25) {
        const choice = choose(variants, lastIdleVariant ?? item.animation);
        lastIdleVariant = choice;
        contextAnimation = choice;
        start({ ...item, animation: choice });
        return;
      }
    }
    playPhase(item, 'body');
  }

  function reconcile(immediate = false) {
    if (disposed) return;
    const blocked = !snapshot?.motion || snapshot.input.suspended || (plugin || activity) && !drag;
    onVisibility?.({ drag: Boolean(drag), plugin, activity, motion: Boolean(snapshot?.motion), suspended: Boolean(snapshot?.input.suspended) });
    if (snapshot?.motion && snapshot.input.paused && !snapshot.input.suspended && active && active.descriptor.snapshotId === snapshot.motion.snapshotId) {
      pending = null;
      cancelTimer(transitionTimer);
      transitionTimer = null;
      player.setPaused(true);
      return;
    }
    if (blocked) {
      cancelActive();
      return;
    }
    player.setPaused(snapshot.input.paused);
    const target = desired();
    if (same(active, target)) {
      pending = null;
      cancelTimer(transitionTimer);
      transitionTimer = null;
      return;
    }
    if (target?.kind === 'drag') {
      start(target, true);
      return;
    }
    if (!immediate && active && player.remaining() <= 150) {
      if (pending) {
        pending = { ...target, deadline: pending.deadline };
        return;
      }
      pending = { ...target, deadline: now() + 150 };
      cancelTimer(transitionTimer);
      transitionTimer = armTimer(() => {
        if (pending) start(pending);
      }, 150);
      return;
    }
    start(target, immediate);
  }

  function update(next) {
    if (disposed || !next?.input) return;
    if (snapshot && snapshot.input.epoch === next.input.epoch && next.input.revision <= snapshot.input.revision) return;
    const replaced = snapshot?.motion?.snapshotId !== next.motion?.snapshotId || snapshot?.input.epoch !== next.input.epoch;
    if (contextIdentity?.epoch !== next.input.epoch || contextIdentity?.snapshotId !== next.motion?.snapshotId || contextIdentity?.context !== next.input.context) {
      contextIdentity = { epoch: next.input.epoch, snapshotId: next.motion?.snapshotId, context: next.input.context };
      contextAnimation = null;
    }
    if (snapshot?.input.epoch !== next.input.epoch) {
      seenEvents.clear();
      lastIdleVariant = null;
      nextIdleOpportunity = now() + 30000;
    }
    snapshot = next;
    if (!next.motion) {
      cancelActive();
      player.clear();
      onVisibility?.({ drag: Boolean(drag), plugin, activity, motion: false, suspended: next.input.suspended });
      return;
    }
    const event = next.input.event;
    if (event && !seenEvents.has(event.id)) {
      seenEvents.add(event.id);
      if (seenEvents.size > 1024) seenEvents.delete(seenEvents.values().next().value);
      const variants = next.motion.metadata.bindings.events?.[event.reaction];
      if (!next.input.paused && !next.input.suspended && !drag && !plugin && !(active?.kind === 'event' && active.key === event.reaction) && variants?.length) {
        if (activity) {
          activity = false;
          onActivityCancel?.();
        }
        start({ kind: 'event', key: event.reaction, intentId: event.id, animation: choose(variants), descriptor: next.motion, epoch: next.input.epoch });
      } else {
        result({ id: ++playbackId, epoch: next.input.epoch, descriptor: next.motion, intentId: event.id }, 'cancelled');
      }
    }
    reconcile(replaced);
  }

  function setDragDirection(value) {
    const next = value === 'run-left' ? 'left' : value === 'run-right' ? 'right' : null;
    if (next === drag) return;
    drag = next;
    reconcile(true);
  }
  function setMotionState(value) {
    const next = value === 'run-left' ? 'left' : value === 'run-right' ? 'right' : null;
    if (next === movement) return;
    movement = next;
    reconcile(true);
  }
  function setFlipped(value) {
    const next = Boolean(value);
    if (next === flipped) return;
    flipped = next;
    reconcile(true);
  }
  function setPlugin(value) { plugin = Boolean(value); reconcile(true); }
  function setActivity(value) {
    if (value && (drag || plugin || active?.kind === 'event' || snapshot?.input.paused || snapshot?.input.suspended)) return false;
    activity = Boolean(value);
    reconcile(true);
    return true;
  }
  function refresh() { player.mount(); reconcile(); }
  function dispose() { if (disposed) return; cancelActive(); disposed = true; player.dispose(); }
  function hitTest(x, y) {
    if ((plugin || activity) && !drag) return null;
    return player.hitTest(x, y);
  }
  return { update, setDragDirection, setMotionState, setFlipped, setPlugin, setActivity, refresh, dispose, hitTest };
}
module.exports = { createPetBodyCoordinator };
