import { randomInt } from 'node:crypto';
import { shuffleDeck } from './deck.mjs';
import { settlePots } from './pots.mjs';
import { nextSeat } from './seats.mjs';

export class GameError extends Error {}
export { evaluate } from './evaluate.mjs';

const decks = new WeakMap();
const nextStreet = {preflop:'flop', flop:'turn', turn:'river'};

export function snapshotDeck(table) {
  return decks.get(table)?.slice() ?? null;
}

export function restoreDeck(table, deck) {
  if (deck) decks.set(table, deck.slice());
}

export const inHand = player => player.cards.length > 0 && !player.folded;
export const seated = player => !player.leaving && (player.stack > 0 || player.rebuyReady > 0);
export const potSize = table => table.players.reduce((sum, player) => sum + player.total, 0);
const canAct = player => inHand(player) && player.stack > 0;
const owe = (table, player) => Math.max(0, table.bet - player.street);

function pay(player, amount) {
  player.stack -= amount;
  player.street += amount;
  player.total += amount;
}

function dealStreet(table) {
  const deck = decks.get(table);
  deck.pop(); // Burn one card before each community street.
  const count = table.phase === 'preflop' ? 3 : 1;
  for (let i = 0; i < count; i++) table.board.push(deck.pop());
  table.phase = nextStreet[table.phase];
  table.bet = 0;
  table.raise = table.big;
  for (const player of table.players) {
    player.street = 0;
    player.actedAt = null;
  }
}

function finish(table, lineup) {
  table.showdown = lineup.length > 1;
  const pot = potSize(table);
  const {awards, pots} = settlePots(table, lineup, table.showdown);
  table.results = awards;
  const winners = new Set(awards.map(award => award.id));
  for (const player of table.players) {
    if (winners.has(player.id)) player.wins++;
    player.busted = player.stack === 0;
  }
  table.lastHand = {
    number:table.hand, board:table.board.slice(), pot, awards, pots,
    revealed:table.showdown ? lineup.map(({name,cards}) => ({name,cards:cards.slice()})) : []
  };
  table.actor = -1;
  table.runout = false;
  table.phase = 'result';
  decks.delete(table);
}

function advance(table, from) {
  const lineup = table.players.filter(inHand);
  if (lineup.length === 1) return finish(table, lineup);
  const able = lineup.filter(canAct);
  const needsTurn = player => {
    if (!canAct(player)) return false;
    if (able.length === 1) {
      return lineup.some(other => other !== player && other.street > player.street);
    }
    return player.actedAt === null || owe(table, player) > 0;
  };
  table.actor = nextSeat(table, from, needsTurn);
  if (table.actor !== -1) return;
  if (table.phase === 'river') return finish(table, lineup);
  if (able.length < 2) {
    table.runout = true;
    return;
  }
  dealStreet(table);
  advance(table, table.button);
}

export function reveal(table) {
  if (!table.runout) throw new GameError('Non ci sono carte da mostrare.');
  dealStreet(table);
  if (table.phase === 'river') finish(table, table.players.filter(inHand));
}

export function start(table) {
  if (!['lobby','result'].includes(table.phase)) throw new GameError('La mano è già in corso.');
  const active = table.players.filter(seated);
  if (active.length < 2) throw new GameError('Servono almeno due giocatori con fiches.');
  table.hand++;
  table.phase = 'preflop';
  table.board = [];
  table.results = [];
  table.showdown = false;
  table.runout = false;

  const deck = shuffleDeck();
  decks.set(table, deck);
  if (table.hand === 1) {
    table.button = table.players.indexOf(active[randomInt(active.length)]);
  } else {
    table.button = nextSeat(table, table.button, seated);
  }
  const smallSeat = active.length === 2 ? table.button : nextSeat(table, table.button, seated);
  const bigSeat = nextSeat(table, smallSeat, seated);
  for (const player of table.players) {
    if (player.rebuyReady) {
      player.stack = player.rebuyReady;
      player.loaded += player.rebuyReady;
      player.rebuys++;
      player.rebuyReady = null;
      player.busted = false;
    }
    Object.assign(player, {cards:[], folded:false, street:0, total:0, actedAt:null});
  }
  for (let round = 0; round < 2; round++) {
    let seat = table.button;
    for (let i = 0; i < active.length; i++) {
      seat = nextSeat(table, seat, seated);
      table.players[seat].cards.push(deck.pop());
    }
  }
  for (const [seat, blind] of [[smallSeat, table.small], [bigSeat, table.big]]) {
    const player = table.players[seat];
    pay(player, Math.min(blind, player.stack));
  }
  table.bet = table.big;
  table.raise = table.big;
  advance(table, bigSeat);
}

function validRaise(legal, target) {
  return legal.raise && Number.isSafeInteger(target) && target > legal.bet &&
    target <= legal.max && (target >= legal.min || target === legal.max);
}

export function actions(table, player) {
  if (table.players[table.actor] !== player || table.disconnect) return null;
  const liveOpponent = table.players.some(other => other !== player && canAct(other));
  const bet = liveOpponent ? table.bet : Math.max(...table.players.filter(inHand).map(other => other.street));
  const call = Math.min(player.stack, owe({bet}, player));
  const max = player.street + player.stack;
  const reopened = player.actedAt === null || bet - player.actedAt >= table.raise ||
    (player.actedAt === 0 && bet > 0);
  const legal = {bet, call, min:bet + table.raise, max, raise:liveOpponent && reopened && max > bet};
  const afterCall = potSize(table) + call;
  const preset = multiplier => {
    const target = player.street + call + multiplier * afterCall;
    return validRaise(legal, target) ? target : null;
  };
  return {...legal, pot:preset(1), doublePot:preset(2)};
}

export function act(table, player, move, target) {
  const legal = actions(table, player);
  if (!legal) throw new GameError('Aspetta il tuo turno.');
  const seat = table.actor;
  if (move === 'fold') {
    player.folded = true;
  } else if (move === 'call') {
    pay(player, legal.call);
  } else if (move === 'raise') {
    if (!validRaise(legal, target)) throw new GameError('Importo del rilancio non valido.');
    const increment = target - table.bet;
    pay(player, target - player.street);
    table.bet = target;
    if (increment >= table.raise) table.raise = increment;
  } else {
    throw new GameError('Azione non valida.');
  }
  player.actedAt = table.bet;
  advance(table, seat);
}

export function foldLeavingPlayer(table, player) {
  if (!inHand(player) || !player.stack || table.phase === 'result') return;
  const actor = table.actor;
  const seat = table.players.indexOf(player);
  player.folded = true;
  if (actor === seat) advance(table, seat);
  else advance(table, (actor - 1 + table.players.length) % table.players.length);
}
