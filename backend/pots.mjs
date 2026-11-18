import { compare, evaluate, handNames } from './evaluate.mjs';
import { nextSeat } from './seats.mjs';

export function settlePots(table, lineup, showdown) {
  const scores = new Map(lineup.map(player => [player, showdown ? evaluate([...player.cards,...table.board]) : []]));
  const levels = [...new Set(table.players.map(p => p.total))].filter(Boolean).sort((a,b) => a-b);
  const winnings = new Map();
  const pots = [];
  let previous = 0;
  for (const level of levels) {
    const contributors = table.players.filter(player => player.total >= level);
    const amount = (level-previous) * contributors.length;
    previous = level;
    if (contributors.length === 1) {
      contributors[0].stack += amount;
      continue;
    }
    const eligible = lineup.filter(player => player.total >= level);
    const contenders = eligible.length ? eligible : lineup;
    const best = contenders.reduce((highest, player) => compare(scores.get(player), highest) > 0 ? scores.get(player) : highest, []);
    const winners = contenders.filter(p => compare(scores.get(p),best) === 0);
    const ordered = [];
    let seat = table.button;
    for (let i = 0; i < winners.length; i++) {
      seat = nextSeat(table, seat, p => winners.includes(p));
      ordered.push(table.players[seat]);
    }
    const shares = [];
    for (const [i, player] of ordered.entries()) {
      const share = Math.floor(amount / winners.length) + Number(i < amount % winners.length);
      player.stack += share;
      shares.push({id:player.id, name:player.name, amount:share});
      winnings.set(player, (winnings.get(player) ?? 0) + share);
    }
    pots.push({amount, shares});
  }
  const awards = [...winnings].map(([player, amount]) => ({
    id:player.id, name:player.name, amount, hand:showdown ? handNames[scores.get(player)[0]] : 'Ultimo in gioco'
  }));
  return {awards, pots};
}
