import { Worker } from 'node:worker_threads';
import { inHand } from './poker.mjs';

const cache = new Map();
const pending = new Set();
let worker;

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./odds-worker.mjs',import.meta.url));
  worker.on('message',({key,odds,error}) => {
    pending.delete(key);
    if (error) console.error('Calcolo probabilità all-in:',error);
    cache.set(key,odds ?? null);
    if (cache.size > 256) cache.delete(cache.keys().next().value);
  });
  worker.on('error',error => console.error('Worker probabilità all-in:',error.message));
  worker.on('exit',() => {
    pending.clear();
    worker = null;
  });
  worker.unref();
  return worker;
}

export function runoutOdds(room) {
  if (!room.runout) return null;
  const players = room.players.filter(inHand).map(({id,cards}) => ({id,cards}));
  const key = JSON.stringify([room.board,players]);
  if (cache.has(key)) return cache.get(key);
  if (pending.has(key) || pending.size >= 12) return null;
  try {
    pending.add(key);
    getWorker().postMessage({key,board:room.board,players});
  } catch (error) {
    pending.delete(key);
    console.error('Avvio calcolo probabilità all-in:',error.message);
  }
  return null;
}
