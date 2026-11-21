import { randomInt, randomBytes, timingSafeEqual } from 'node:crypto';
import { act, actions, foldLeavingPlayer, inHand, GameError, potSize, restoreDeck, snapshotDeck } from './poker.mjs';
import { activeHand, afterPlay, disconnected, finishRoster, heartbeatTimeout, nextBlinds, readyCount, setManualPause, startHand, syncNext, tickGame, tournamentWinner } from './clock.mjs';
import { fail } from './http-error.mjs';
import { runoutOdds } from './runout-odds.mjs';
import { currentPoint } from './evaluate.mjs';

const maxAge = 24*60*60*1000;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function addPlayer(room, name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 24) {
    fail('Inserisci un nome da 1 a 24 caratteri.');
  }
  name = name.trim();
  if (room.players.some(player => !player.leaving && player.name.toLocaleLowerCase('it') === name.toLocaleLowerCase('it'))) {
    fail('Questo nome è già in uso.');
  }
  const player = {
    id:randomBytes(8).toString('hex'), token:randomBytes(32).toString('hex'),
    recoveryCode:randomBytes(18).toString('base64url'),
    name, stack:room.stack, loaded:room.stack, wins:0, rebuys:0,
    busted:false, leaving:false, rebuyRequest:null, rebuyRequestId:null, rebuyReady:null, rebuyStatus:null,
    cards:[], folded:false, street:0, total:0, actedAt:null,
  };
  room.players.push(player);
  room.host ??= player.id;
  return player;
}

function matchSecret(secret, input) {
  return timingSafeEqual(Buffer.from(secret), Buffer.from(input));
}

function auth(authorization, room) {
  const token = /^Bearer ([a-f0-9]{64})$/.exec(authorization ?? '')?.[1];
  const player = token && room.players.find(p => !p.leaving && matchSecret(p.token,token));
  if (!player) fail('Accesso al tavolo scaduto o non valido.',401);
  return player;
}

function view(room, viewer, now) {
  const clockAt = room.disconnect?.at ?? room.manualPause ?? now;
  const remaining = deadline => deadline === null ? null : Math.max(0, deadline - clockAt);
  const championship = room.mode === 'tournament' && room.phase === 'result' && readyCount(room) < 2;
  const champion = tournamentWinner(room);
  const pending = room.players.filter(player => !player.leaving && player.rebuyRequest !== null);
  return {
    code:room.code, roomName:room.name, me:viewer.id, host:room.host,
    mode:room.mode, phase:room.phase, version:room.version, hand:room.hand,
    actor:room.players[room.actor]?.id, button:room.players[room.button]?.id,
    board:room.board, small:room.small, big:room.big, level:room.level,
    pot:potSize(room), results:room.results, lastHand:room.lastHand, chipAction:room.chipAction ?? 0,
    actions:actions(room,viewer), recoveryCode:viewer.recoveryCode, runout:room.runout,
    odds:runoutOdds(room),
    ready:readyCount(room), champion:champion?.name ?? null, championId:champion?.id ?? null,
    point:viewer.folded ? null : currentPoint(viewer.cards,room.board),
    paused:room.manualPause !== null,
    disconnect:room.disconnect && {
      names:room.disconnect.players.map(id => room.players.find(player => player.id === id)?.name).filter(Boolean),
      remainingMs:Math.max(0, room.disconnect.until-now),
    },
    turnMs:remaining(room.turnEnds), nextMs:remaining(room.nextAt), revealMs:remaining(room.revealAt),
    blindMs:championship ? null : remaining(room.blindsAt),
    nextBlinds:room.mode === 'tournament' ? nextBlinds(room) : null,
    reload:{
      max:room.stack*2, request:viewer.rebuyRequest, approved:viewer.rebuyReady, status:viewer.rebuyStatus,
      eligible:room.mode === 'cash' && viewer.busted && viewer.rebuyRequest === null && viewer.rebuyReady === null,
    },
    requests:viewer.id === room.host
      ? pending.map(player => ({id:player.id,requestId:player.rebuyRequestId ?? null,name:player.name,amount:player.rebuyRequest}))
      : [],
    players:room.players.filter(player => !player.leaving || inHand(player)).map(player => ({
      id:player.id, name:player.name, stack:player.stack, street:player.street,
      folded:player.folded, inHand:inHand(player), leaving:player.leaving,
      waiting:activeHand(room) && player.cards.length === 0 && (player.stack > 0 || player.rebuyReady !== null),
      loaded:player.loaded, wins:player.wins, rebuys:player.rebuys,
      net:player.stack - player.loaded,
      busted:player.busted,
      cards:player === viewer || ((room.runout || room.showdown) && inHand(player)) ? player.cards : player.cards.map(() => null)
    }))
  };
}

function tableSettings(input, now, code) {
  const {roomName, stack, big, mode = 'tournament', blindMinutes = 15} = input;
  const small = input.small ?? Math.floor(big / 2);
  if (typeof roomName !== 'string' || !roomName.trim() || roomName.trim().length > 36) fail('Inserisci un nome per il tavolo.');
  if (!['cash','tournament'].includes(mode)) fail('Modalità di gioco non valida.');
  if (!Number.isSafeInteger(big) || big < 2 || big > 10000 || !Number.isSafeInteger(small) || small < 1 || small >= big) {
    fail('Imposta bui interi con piccolo buio minore del grande buio.');
  }
  if (!Number.isSafeInteger(stack) || stack < 10*big || stack > 1000000) fail('Lo stack deve essere almeno 10 volte il grande buio.');
  if (mode === 'tournament' && (!Number.isSafeInteger(blindMinutes) || blindMinutes < 1 || blindMinutes > 180)) {
    fail('Imposta un intervallo da 1 a 180 minuti.');
  }
  return {
    code, name:roomName.trim(), version:0, hand:0, stack, big, small, mode, blindMinutes, level:1,
    phase:'lobby', players:[], board:[], results:[], lastHand:null, actor:-1, button:-1, host:null,
    turnEnds:null, nextAt:null, revealAt:null, blindsAt:null, manualPause:null, disconnect:null,
    runout:false, showdown:false, touched:now, checkpoint:now,
  };
}

function requestRebuy(room, player, amount) {
  if (room.mode !== 'cash' || !player.busted || player.rebuyReady !== null || player.rebuyRequest !== null) {
    fail('La ricarica è disponibile in Cash Game dopo aver esaurito le fiches.',409);
  }
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > room.stack*2) {
    fail('Scegli un importo intero tra 1 e ' + room.stack*2 + ' fiches.');
  }
  player.rebuyRequest = amount;
  player.rebuyRequestId = randomBytes(8).toString('hex');
  player.rebuyStatus = 'pending';
}

function resolveRebuy(room, input, now) {
  const player = room.players.find(p => p.id === input.player && !p.leaving && p.rebuyRequest !== null);
  if (!player || typeof input.accept !== 'boolean' ||
      (typeof input.requestId === 'string' && input.requestId !== player.rebuyRequestId)) {
    fail('Richiesta di ricarica non valida.',409);
  }
  if (input.accept) {
    player.rebuyReady = player.rebuyRequest;
    player.rebuyStatus = 'approved';
  } else {
    player.rebuyStatus = 'refused';
  }
  player.rebuyRequest = null;
  player.rebuyRequestId = null;
  syncNext(room, now);
}

function leaveRoom(room, player, now) {
  const actor = room.players[room.actor]?.id;
  const hand = room.hand;
  const winner = tournamentWinner(room);
  if (winner) room.winner = winner;
  player.leaving = true;
  if (room.host === player.id) room.host = room.players.find(p => !p.leaving)?.id ?? null;
  if (activeHand(room)) {
    const phase = room.phase;
    foldLeavingPlayer(room, player);
    const keepTurn = room.players[room.actor]?.id === actor && actor !== player.id &&
      phase === room.phase && room.hand === hand;
    afterPlay(room, room.disconnect && activeHand(room) ? room.disconnect.at : now, {keepTurn});
  } else {
    finishRoster(room);
    syncNext(room, now);
  }
}

export async function openRooms(store, clock = Date.now) {
  const rooms = new Map();
  const presence = new Map();
  let queue = Promise.resolve();
  const locked = task => {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };
  function attach(snapshot) {
    const room = snapshot.room;
    restoreDeck(room,snapshot.deck);
    rooms.set(room.code,room);
    return room;
  }
  const online = (id, now) => now - (presence.get(id)?.seen ?? -Infinity) < heartbeatTimeout;
  function heartbeat(id, now) {
    presence.set(id,{seen:now,reported:false});
  }
  function copy(room) {
    const draft = structuredClone(room);
    restoreDeck(draft,snapshotDeck(room));
    return draft;
  }
  async function commit(room, old, now, activity) {
    if (activity) room.touched = now;
    room.checkpoint = now;
    room.version = (old?.version ?? 0)+1;
    if (!await store.put(room,snapshotDeck(room),old?.version ?? null)) {
      const latest = await store.get(room.code);
      if (latest) attach(latest);
      else rooms.delete(room.code);
      fail('Il tavolo è cambiato. Riprova.',409);
    }
    rooms.set(room.code,room);
    runoutOdds(room);
  }
  for (const snapshot of await store.all()) {
    const room = attach(snapshot);
    const now = clock();
    if (now-room.touched >= maxAge) {
      await store.remove(room.code,room.version);
      rooms.delete(room.code);
      continue;
    }
    // Pause existing deadlines over process downtime and give seated users time to reconnect.
    if (room.manualPause === null && (activeHand(room) || room.nextAt !== null)) {
      const draft = copy(room);
      const downtime = Math.max(0, now-room.checkpoint);
      for (const key of ['turnEnds','blindsAt','revealAt','nextAt']) {
        if (draft[key] !== null) draft[key] += downtime;
      }
      if (draft.disconnect) {
        draft.disconnect.at += downtime;
        draft.disconnect.until += downtime;
        for (const id of draft.disconnect.players) presence.set(id,{seen:-Infinity,reported:true});
      }
      await commit(draft,room,now,false);
    }
  }
  function get(code) {
    const room = rooms.get(code);
    if (!room) fail('Tavolo non trovato.',404);
    return room;
  }
  function findMissing(room, now, except) {
    if (!activeHand(room)) return [];
    return room.players.filter(player => {
      const status = presence.get(player.id);
      return player.id !== except && !player.leaving && inHand(player) &&
        !online(player.id,now) && !status?.reported && !room.disconnect?.players.includes(player.id);
    }).map(player => player.id);
  }
  async function advance(room, now, except) {
    const missing = findMissing(room,now,except);
    const due = [room.turnEnds,room.revealAt,room.nextAt].some(time => time !== null && time <= now);
    if (!room.disconnect && missing.length === 0 && !due) return room;
    const draft = copy(room);
    const connectionChanged = disconnected(draft,now,missing,id => online(id,now));
    const played = tickGame(draft,now);
    if (!connectionChanged && !played) return room;
    await commit(draft,room,now,played);
    for (const id of missing) presence.set(id,{seen:presence.get(id)?.seen ?? -Infinity,reported:true});
    return draft;
  }
  function run(task) {
    return locked(async () => {
      const now = clock();
      try {
        return await task(now);
      } catch (error) {
        if (error instanceof GameError) fail(error.message,409);
        throw error;
      }
    });
  }
  function sessionResponse(room, player, now) {
    return {token:player.token,state:view(room,player,now)};
  }
  return {
    create(input) {
      return run(async now => {
        if (rooms.size >= 1000) fail('Server occupato.',503);
        let code;
        do {
          code = Array.from({length:6}, () => alphabet[randomInt(alphabet.length)]).join('');
        } while (rooms.has(code));
        const room = tableSettings(input,now,code);
        const player = addPlayer(room,input.name);
        await commit(room,null,now,true);
        heartbeat(player.id,now);
        return sessionResponse(room,player,now);
      });
    },
    join(code, input) {
      return run(async now => {
        const old = await advance(get(code),now);
        if (old.phase !== 'lobby' && old.mode !== 'cash') fail('Il torneo è già iniziato.',409);
        if (old.players.length >= 9) fail('Il tavolo è pieno.',409);
        const room = copy(old);
        const player = addPlayer(room,input.name);
        syncNext(room,now);
        await commit(room,old,now,true);
        heartbeat(player.id,now);
        return sessionResponse(room,player,now);
      });
    },
    recover(code, input) {
      return run(async now => {
        const old = get(code);
        const secret = input.recoveryCode;
        if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{24}$/.test(secret)) fail('Codice personale non valido.',401);
        const room = copy(old);
        const player = room.players.find(p => !p.leaving && matchSecret(p.recoveryCode,secret));
        if (!player) fail('Codice personale non valido.',401);
        player.token = randomBytes(32).toString('hex');
        heartbeat(player.id,now);
        disconnected(room,now,[],id => online(id,now));
        await commit(room,old,now,true);
        return sessionResponse(room,player,now);
      });
    },
    read(code, authorization) {
      return run(async now => {
        const room = get(code);
        const player = auth(authorization,room);
        heartbeat(player.id,now);
        const current = await advance(room,now,player.id);
        return view(current,auth(authorization,current),now);
      });
    },
    update(code, authorization, route, input) {
      return run(async now => {
        const existing = get(code);
        const caller = auth(authorization,existing);
        heartbeat(caller.id,now);
        const old = await advance(existing,now,caller.id);
        const room = copy(old);
        const player = auth(authorization,room);
        const requestSpecific = route === 'rebuy-decision' && typeof input.requestId === 'string';
        if (route !== 'rebuy' && route !== 'leave' && !requestSpecific && input.version !== room.version) fail('Il tavolo è cambiato. Riprova.',409);
        if (['start','pause','rebuy-decision'].includes(route) && room.host !== player.id) {
          fail('Operazione riservata all’admin del tavolo.',403);
        }
        switch (route) {
          case 'start':
            if (room.phase !== 'lobby') fail('Le mani successive partono automaticamente.',409);
            if (readyCount(room) < 2) fail('Servono almeno due giocatori con fiches.',409);
            startHand(room,now);
            break;
          case 'action':
            act(room,player,input.move,input.target);
            afterPlay(room,now);
            break;
          case 'pause':
            if (room.phase !== 'result' || typeof input.paused !== 'boolean') {
              fail('La pausa manuale è disponibile tra due mani.',409);
            }
            setManualPause(room,input.paused,now);
            break;
          case 'rebuy':
            requestRebuy(room,player,input.amount);
            break;
          case 'rebuy-decision':
            resolveRebuy(room,input,now);
            break;
          case 'leave':
            leaveRoom(room,player,now);
            disconnected(room,now,[],id => online(id,now));
            break;
          default:
            fail('Operazione non disponibile.',405);
        }
        await commit(room,old,now,true);
        if (route === 'leave') {
          presence.delete(player.id);
          return {left:true};
        }
        return view(room,player,now);
      });
    },
    tick() {
      return run(async now => {
        for (const room of rooms.values()) {
          if (now-room.touched >= maxAge || room.players.length === 0) {
            if (await store.remove(room.code,room.version)) {
              rooms.delete(room.code);
              for (const player of room.players) presence.delete(player.id);
            } else {
              const latest = await store.get(room.code);
              if (latest) attach(latest);
              else rooms.delete(room.code);
            }
            continue;
          }
          try {
            await advance(room,now);
          } catch (error) {
            if (error.status !== 409) throw error;
          }
        }
      });
    },
  };
}

