import { act, actions, inHand, reveal, seated, start } from './poker.mjs';

const turnTime = 60_000;
const pauseTime = 45_000;
const betweenHands = 5_000;
const revealTime = 3_000;
export const heartbeatTimeout = 6_000;
export const activeHand = room => room.phase !== 'lobby' && room.phase !== 'result';
export const readyCount = room => room.players.filter(seated).length;

export function finishRoster(room) {
  const removedBeforeButton = room.players.slice(0, room.button + 1).filter(player => player.leaving).length;
  room.button -= removedBeforeButton;
  room.players = room.players.filter(player => !player.leaving);
}

export function nextBlinds(room) {
  const multiplier = room.big <= Number.MAX_SAFE_INTEGER / 2 ? 2 : 1;
  return {small:room.small * multiplier, big:room.big * multiplier};
}

export function syncNext(room, now) {
  const ready = room.phase === 'result' && readyCount(room) >= 2 && room.manualPause === null;
  room.nextAt = ready ? (room.nextAt ?? now + betweenHands) : null;
}

export function afterPlay(room, now, {keepTurn = false} = {}) {
  room.revealAt = room.runout ? (room.revealAt ?? now + revealTime) : null;
  room.turnEnds = room.actor < 0 ? null : keepTurn ? room.turnEnds : now + turnTime;
  if (room.phase === 'result') {
    finishRoster(room);
    syncNext(room, now);
  }
}

export function startHand(room, now) {
  if (room.mode === 'tournament') {
    const interval = room.blindMinutes * 60_000;
    room.blindsAt ??= now + interval;
    while (room.blindsAt <= now) {
      const next = nextBlinds(room);
      Object.assign(room, next);
      room.level++;
      room.blindsAt += interval;
    }
  }
  room.nextAt = null;
  start(room);
  afterPlay(room, now);
}

function shiftDeadline(room, deadline, delay) {
  if (room[deadline] !== null) room[deadline] += delay;
}

export function setManualPause(room, enabled, now) {
  if (enabled && room.manualPause === null) room.manualPause = now;
  if (!enabled && room.manualPause !== null) {
    shiftDeadline(room, 'blindsAt', now - room.manualPause);
    room.manualPause = null;
  }
  syncNext(room, now);
}

function clearDisconnect(room, now) {
  const delay = Math.max(0, Math.min(now, room.disconnect.until) - room.disconnect.at);
  for (const deadline of ['turnEnds','revealAt','blindsAt']) shiftDeadline(room, deadline, delay);
  room.disconnect = null;
}

export function disconnected(room, now, missing, isOnline) {
  let changed = false;
  if (activeHand(room) && missing.length) {
    room.disconnect ??= {at:now, until:now+pauseTime, players:[]};
    room.disconnect.players.push(...missing);
    changed = true;
  }
  if (room.disconnect) {
    const stillMissing = room.disconnect.players.filter(id => room.players.some(
      player => player.id === id && !player.leaving && inHand(player) && !isOnline(id)
    ));
    if (!activeHand(room) || now >= room.disconnect.until || stillMissing.length === 0) {
      clearDisconnect(room, now);
      changed = true;
    } else if (stillMissing.length !== room.disconnect.players.length) {
      room.disconnect.players = stillMissing;
      changed = true;
    }
  }
  return changed;
}

export function tickGame(room, now) {
  if (room.disconnect || room.manualPause !== null) return false;
  if (room.turnEnds !== null && room.turnEnds <= now) {
    const player = room.players[room.actor];
    const legal = actions(room, player);
    act(room, player, legal.call === 0 ? 'call' : 'fold');
    afterPlay(room, now);
    return true;
  }
  if (room.revealAt !== null && room.revealAt <= now) {
    room.revealAt = null;
    reveal(room);
    afterPlay(room, now);
    return true;
  }
  if (room.nextAt !== null && room.nextAt <= now && readyCount(room) >= 2) {
    startHand(room, now);
    return true;
  }
  return false;
}

