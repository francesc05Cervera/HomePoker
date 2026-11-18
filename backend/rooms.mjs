import { randomInt, randomBytes, timingSafeEqual } from 'node:crypto';
import { start, act, actions, inHand, GameError } from './poker.mjs';
import { fail } from './http-error.mjs';

const rooms = new Map();
const maxAge = 24*60*60*1000;
const cleanup = setInterval(() => {
  for (const [code, room] of rooms) if (Date.now()-room.touched > maxAge) rooms.delete(code);
},60_000);
cleanup.unref();

function createCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({length:6}, () => alphabet[randomInt(alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function addPlayer(room, name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 24) fail('Inserisci un nome da 1 a 24 caratteri.');
  if (room.players.some(player => player.name.toLocaleLowerCase('it') === name.trim().toLocaleLowerCase('it'))) fail('Questo nome è già in uso.');
  const player = {
    id:randomBytes(8).toString('hex'), token:randomBytes(32).toString('hex'),
    name:name.trim(), stack:room.stack, cards:[], folded:false, street:0, total:0, actedAt:null
  };
  room.players.push(player);
  room.version++;
  return player;
}

function view(room, viewer) {
  return {
    code:room.code, roomName:room.name, me:viewer.id, host:room.players[0].id,
    phase:room.phase, version:room.version, hand:room.hand, actor:room.players[room.actor]?.id,
    button:room.players[room.button]?.id, board:room.board, small:room.small, big:room.big,
    pot:room.players.reduce((total,p) => total+p.total,0), results:room.results,
    actions:actions(room,viewer), players:room.players.map(player => ({
      id:player.id, name:player.name, stack:player.stack, street:player.street,
      folded:player.folded, inHand:!!inHand(player),
      cards:player === viewer || (room.showdown && inHand(player)) ? player.cards : player.cards.map(() => null)
    }))
  };
}

function auth(authorization, room) {
  const token = /^Bearer ([a-f0-9]{64})$/.exec(authorization ?? '')?.[1];
  const player = token && room.players.find(p => timingSafeEqual(Buffer.from(p.token),Buffer.from(token)));
  if (!player) fail('Accesso al tavolo scaduto o non valido.',401);
  return player;
}


export function getRoom(code) {
  const room = rooms.get(code);
  if (!room) fail('Tavolo non trovato.',404);
  return room;
}

export function createRoom(input) {
  const {name,roomName,stack,big} = input;
  if (typeof roomName !== 'string' || !roomName.trim() || roomName.trim().length > 36) fail('Inserisci un nome per il tavolo.');
  if (!Number.isSafeInteger(big) || big < 2 || big > 10000 || big % 2 ||
      !Number.isSafeInteger(stack) || stack < 10*big || stack > 1000000) fail('Usa un grande buio pari e uno stack di almeno 10 grandi bui.');
  if (rooms.size >= 1000) fail('Server occupato.',503);
  const room = {
    code:createCode(), name:roomName.trim(), version:0, hand:0, stack, big, small:big/2,
    phase:'lobby', players:[], board:[], results:[], actor:-1, button:-1, touched:Date.now()
  };
  const player = addPlayer(room,name);
  rooms.set(room.code,room);
  return {token:player.token,state:view(room,player)};
}

export function joinRoom(room, input) {
  const {name} = input;
  if (room.phase !== 'lobby') fail('La partita è già iniziata.',409);
  if (room.players.length >= 9) fail('Il tavolo è pieno.',409);
  const player = addPlayer(room,name);
  room.touched = Date.now();
  return {token:player.token,state:view(room,player)};
}

export function readRoom(room, authorization) {
  return view(room, auth(authorization,room));
}

export function updateRoom(room, authorization, route, input) {
  const player = auth(authorization,room);
  const {version,move,target} = input;
  if (version !== room.version) fail('Il tavolo è cambiato. Riprova.',409);
  if (route === 'start' && player !== room.players[0]) fail('Solo chi ha creato il tavolo può distribuire.',403);
  try {
    if (route === 'start') start(room);
    else act(room,player,move,target);
  } catch (error) {
    if (!(error instanceof GameError)) throw error;
    fail(error.message,409);
  }
  room.version++;
  room.touched = Date.now();
  return view(room,player);
}
