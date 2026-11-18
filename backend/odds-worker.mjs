import { randomInt } from 'node:crypto';
import { parentPort } from 'node:worker_threads';
import { fullDeck } from './deck.mjs';
import { compare, evaluate } from './evaluate.mjs';

const preflopSamples = 2000;

export function calculateOdds(board, players) {
  // Only exposed cards are excluded. The real deck and muck are never inputs.
  const shown = new Set([...board,...players.flatMap(player => player.cards)]);
  const unseen = fullDeck().filter(card => !shown.has(card));
  const missing = 5 - board.length;
  const wins = players.map(() => 0);
  const ties = players.map(() => 0);
  let trials = 0;

  function score(completion) {
    const community = [...board,...completion];
    let best = [];
    let winners = [];
    for (let i = 0; i < players.length; i++) {
      const rank = evaluate([...players[i].cards,...community]);
      const order = compare(rank,best);
      if (order > 0) {
        best = rank;
        winners = [i];
      } else if (order === 0) {
        winners.push(i);
      }
    }
    const counts = winners.length === 1 ? wins : ties;
    for (const winner of winners) counts[winner]++;
    trials++;
  }

  if (missing > 2) {
    for (let sample = 0; sample < preflopSamples; sample++) {
      for (let i = 0; i < missing; i++) {
        const j = randomInt(i,unseen.length);
        [unseen[i],unseen[j]] = [unseen[j],unseen[i]];
      }
      score(unseen.slice(0,missing));
    }
  } else if (missing === 2) {
    for (let i = 0; i < unseen.length; i++) {
      for (let j = i+1; j < unseen.length; j++) score([unseen[i],unseen[j]]);
    }
  } else if (missing === 1) {
    for (const card of unseen) score([card]);
  } else {
    score([]);
  }

  return {
    estimated:missing > 2,
    players:players.map(({id},i) => ({id,win:wins[i]/trials,tie:ties[i]/trials})),
  };
}

parentPort?.on('message',({key,board,players}) => {
  try {
    parentPort.postMessage({key,odds:calculateOdds(board,players)});
  } catch (error) {
    parentPort.postMessage({key,error:error.message});
  }
});
