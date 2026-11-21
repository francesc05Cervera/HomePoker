import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentPoint } from '../evaluate.mjs';

test('Il punto usa solo le carte disponibili a ciascuna strada', () => {
  const hole = ['As','Ad'];
  const board = ['Ac','Kh','7d','Ks','Ah'];
  assert.equal(currentPoint([],[]),null);
  assert.equal(currentPoint(['2s','As'],[]),'Carta alta');
  assert.equal(currentPoint(hole,[]),'Coppia');
  assert.equal(currentPoint(hole,board.slice(0,3)),'Tris');
  assert.equal(currentPoint(hole,board.slice(0,4)),'Full');
  assert.equal(currentPoint(hole,board),'Poker');
});
