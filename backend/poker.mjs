import { randomInt } from 'node:crypto';
import { shuffleDeck } from './deck.mjs';
import { settlePots } from './pots.mjs';
import { nextSeat } from './seats.mjs';

export class GameError extends Error {}
export { evaluate } from './evaluate.mjs';

const decks = new WeakMap();
const nextStreet = {preflop:'flop', flop:'turn', turn:'river'};

export const inHand = player => player.cards.length && !player.folded;
const canAct = player => inHand(player) && player.stack > 0;
const owe = (table, player) => Math.max(0, table.bet - player.street);
const canRaise = (table, player) =>
  table.players.some(other => other !== player && canAct(other)) &&
  (player.actedAt === null || table.bet - player.actedAt >= table.raise);

function pay(player, amount) {
  player.stack -= amount;
  player.street += amount;
  player.total += amount;
}

function dealBoard(table, count) {
  const deck = decks.get(table);
  deck.pop(); // Burn one card before each community street.
  for (let i = 0; i < count; i++) table.board.push(deck.pop());
}

function finish(table, lineup) {
  table.showdown = lineup.length > 1;
  table.results = settlePots(table, lineup, table.showdown);
  table.actor = -1;
  table.phase = 'result';
  decks.delete(table);
}
function advance(table, from) {
  const lineup = table.players.filter(inHand);
  if (lineup.length === 1) return finish(table,lineup);
  const able = lineup.filter(canAct);
  const needsTurn = player => {
    if (!canAct(player)) return false;
    if (able.length === 1) {
      return lineup.some(other => other !== player && other.street > player.street);
    }
    return player.actedAt === null || owe(table,player) > 0;
  };
  table.actor = nextSeat(table, from, needsTurn);
  if (table.actor !== -1) return;
  if (table.phase === 'river') return finish(table,lineup);
  dealBoard(table, table.phase === 'preflop' ? 3 : 1);
  table.phase = nextStreet[table.phase];
  table.bet = 0;
  table.raise = table.big;
  for (const player of table.players) {
    player.street = 0;
    player.actedAt = null;
  }
  advance(table,table.button);
}

export function start(table) {
  if (!['lobby','result'].includes(table.phase)) throw new GameError('La mano è già in corso.');
  const seated = player => player.stack > 0;
  const count = table.players.filter(seated).length;
  if (count < 2) throw new GameError('Servono almeno due giocatori con fiches.');
  table.hand++;
  table.phase = 'preflop';
  table.board = [];
  const deck = shuffleDeck();
  decks.set(table, deck);
  table.results = [];
  table.showdown = false;
  if (table.button === -1) {
    const activeSeats = table.players.map((player, index) => seated(player) ? index : -1).filter(index => index !== -1);
    table.button = activeSeats[randomInt(count)];
  } else {
    table.button = nextSeat(table, table.button, seated);
  }
  const smallSeat = count === 2 ? table.button : nextSeat(table,table.button,seated);
  const bigSeat = nextSeat(table,smallSeat,seated);
  for (const player of table.players) {
    Object.assign(player,{cards:[], folded:false, street:0, total:0, actedAt:null});
  }
  for (let round = 0; round < 2; round++) {
    let seat = table.button;
    for (let i = 0; i < count; i++) {
      seat = nextSeat(table,seat,seated);
      table.players[seat].cards.push(deck.pop());
    }
  }
  for (const [seat,blind] of [[smallSeat,table.small],[bigSeat,table.big]]) {
    const player = table.players[seat];
    pay(player,Math.min(blind,player.stack));
  }
  table.bet = table.big;
  table.raise = table.big;
  advance(table,bigSeat);
}

export function actions(table, player) {
  if (table.players[table.actor] !== player) return null;
  const liveOpponent = table.players.some(other => other !== player && canAct(other));
  const bet = liveOpponent ? table.bet : Math.max(...table.players.filter(inHand).map(other => other.street));
  return {
    call:Math.min(player.stack, Math.max(0,bet-player.street)),
    min:bet + table.raise,
    max:player.street + player.stack,
    raise:canRaise(table,player) && player.street + player.stack > bet
  };
}

export function act(table, player, move, target) {
  const legal = actions(table,player);
  if (!legal) throw new GameError('Aspetta il tuo turno.');
  const seat = table.actor;
  if (move === 'fold') {
    player.folded = true;
  } else if (move === 'call') {
    pay(player,legal.call);
  } else if (move === 'raise') {
    if (!legal.raise || !Number.isSafeInteger(target) || target <= table.bet || target > legal.max ||
        (target < legal.min && target !== legal.max)) throw new GameError('Importo del rilancio non valido.');
    const increment = target - table.bet;
    pay(player,target-player.street);
    table.bet = target;
    if (increment >= table.raise) table.raise = increment;
  } else {
    throw new GameError('Azione non valida.');
  }
  player.actedAt = table.bet;
  advance(table,seat);
}

