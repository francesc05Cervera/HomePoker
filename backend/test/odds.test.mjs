import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateOdds } from '../odds-worker.mjs';

test('Il turn usa tutte le carte rimanenti e separa vittorie e pareggi', () => {
  const board = ['As','Ks','Qs','Js'];
  const nuts = calculateOdds(board,[
    {id:'a',cards:['Ts','2h']},
    {id:'b',cards:['Ad','Ah']},
  ]);
  assert.deepEqual(nuts,{estimated:false,players:[{id:'a',win:1,tie:0},{id:'b',win:0,tie:0}]});
  const shared = calculateOdds(board,[
    {id:'a',cards:['2h','3d']},
    {id:'b',cards:['4h','5d']},
  ]);
  assert.ok(shared.players[0].tie > 0);
  assert.equal(shared.players[0].tie,shared.players[1].tie);
  assert.ok(Math.abs(shared.players[0].win + shared.players[1].win + shared.players[0].tie - 1)<1e-12);
});

test('Il preflop calcola una stima con esiti completi', () => {
  const result = calculateOdds([],[
    {id:'a',cards:['As','Ah']},
    {id:'b',cards:['7d','2c']},
  ]);
  assert.equal(result.estimated,true);
  assert.ok(result.players[0].win > .7);
  assert.ok(Math.abs(result.players[0].win + result.players[1].win + result.players[0].tie - 1)<1e-12);
});
