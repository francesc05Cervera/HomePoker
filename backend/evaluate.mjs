import { ranks as rankOrder } from './deck.mjs';

export function compare(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function five(cards) {
  const ranks = cards.map(card => rankOrder.indexOf(card[0]) + 2).sort((a,b) => b-a);
  const groups = [...new Set(ranks)].map(rank => [ranks.filter(value => value === rank).length, rank])
    .sort((a,b) => b[0]-a[0] || b[1]-a[1]);
  const flush = cards.every(card => card[1] === cards[0][1]);
  const straight = groups.length === 5 && (ranks[0]-ranks[4] === 4 ? ranks[0] : ranks.join() === '14,5,4,3,2' ? 5 : 0);
  if (straight && flush) return [8, straight];
  if (groups[0][0] === 4) return [7, groups[0][1], groups[1][1]];
  if (groups[0][0] === 3 && groups[1][0] === 2) return [6, groups[0][1], groups[1][1]];
  if (flush) return [5, ...ranks];
  if (straight) return [4, straight];
  const category = groups[0][0] === 3 ? 3 : groups[1][0] === 2 ? 2 : groups[0][0] === 2 ? 1 : 0;
  return [category, ...groups.map(group => group[1])];
}

export const handNames = ['Carta alta','Coppia','Doppia coppia','Tris','Scala','Colore','Full','Poker','Scala colore'];
export function evaluate(cards) {
  let best = [];
  for (let a = 0; a < cards.length; a++) {
    for (let b = a+1; b < cards.length; b++) {
      const score = five(cards.filter((_,i) => i !== a && i !== b));
      if (compare(score,best) > 0) best = score;
    }
  }
  return best;
}


