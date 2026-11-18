import { randomInt } from 'node:crypto';

export const ranks = '23456789TJQKA';
const suits = 'shdc';

export function fullDeck() {
  return [...suits].flatMap(suit => [...ranks].map(rank => rank + suit));
}

export function shuffleDeck() {
  const cards = fullDeck();
  // Fisher–Yates: every remaining position has the same chance on each draw.
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}


