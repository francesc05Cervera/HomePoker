import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openRooms } from '../rooms.mjs';
import { openStore } from '../store.mjs';

const hostName = 'Anna';
const headers = session => 'Bearer ' + session.token;
const who = (s,id) => s.players.find(player => player.id === id);

async function setup(mode='cash', path=':memory:') {
  let now = 100_000;
  process.env.HOLDEM_DB_PATH = path;
  let store = await openStore();
  let rooms = await openRooms(store,() => now);
  const a = await rooms.create({name:hostName,roomName:'Serata',stack:100,small:3,big:10,mode,blindMinutes:1});
  const code = a.state.code;
  const b = await rooms.join(code,{name:'Bruno'});
  const read = session => rooms.read(code,headers(session));
  const update = async (session,route,body={}) => {
    const {version} = await read(session);
    return rooms.update(code,headers(session),route,{version,...body});
  };
  const actor = s => [a,b].find(session => session.state.me === s.actor);
  return {
    a,b,code,actor,read,update,get store(){return store;},
    step:ms => {now+=ms;},
    tick:()=>rooms.tick(),
    join:name=>rooms.join(code,{name}),
    recover:key=>rooms.recover(code,{recoveryCode:key}),
    reopen:async()=>{await store.close(); store = await openStore(); rooms = await openRooms(store,() => now);},
  };
}

test('Cash: all-in scandito, ricarica autorizzata e giocatore attivo dalla mano dopo', async () => {
  const t = await setup();
  let state = await t.update(t.a,'start');
  assert.equal(state.small,3);
  assert.equal(state.big,10);
  assert.equal(state.turnMs,60000);
  assert.equal(state.nextBlinds,null);
  let busted;
  for (let attempt=0;attempt<9 && !busted;attempt++) {
    const actor = t.actor(state);
    const own = await t.read(actor);
    assert.equal(own.actions.pot,30);
    assert.equal(own.actions.doublePot,50);
    assert.ok(own.players.find(p=>p.id!==own.me).cards.every(card=>card===null));
    await t.update(actor,'action',{move:'raise',target:own.actions.max});
    state = await t.read(t.a);
    state = await t.update(t.actor(state),'action',{move:'call'});
    assert.equal(state.runout,true);
    assert.equal(state.board.length,0);
    t.step(2999);
    assert.equal((await t.read(t.a)).board.length,0);
    await t.read(t.b);
    t.step(1);
    await t.tick();
    state = await t.read(t.a);
    assert.equal(state.board.length,3);
    assert.equal(state.results.length,0);
    t.step(3000);
    await t.read(t.b);
    state = await t.read(t.a);
    assert.equal(state.board.length,4);
    t.step(3000);
    await t.read(t.b);
    state = await t.read(t.a);
    assert.equal(state.board.length,5);
    assert.equal(state.phase,'result');
    for (const award of state.results) assert.ok(who(state,award.id).wins >= 1);
    busted = [t.a,t.b].find(session => who(state,session.state.me).busted);
    if (!busted) {
      t.step(4999);
      assert.equal((await t.read(t.a)).phase,'result');
      await t.read(t.b);
      t.step(1);
      state = await t.read(t.a);
      assert.equal(state.phase,'preflop');
    }
  }
  assert.ok(busted,'expected a player with zero chips');
  assert.equal(who(state,busted.state.me).rebuys,0);
  const guest = await t.join('Carla');
  t.step(5000);
  await t.read(t.a);
  await t.read(t.b);
  state = await t.read(guest);
  assert.equal(state.phase,'preflop');
  const visitor = await t.join('Dario');
  assert.equal(who(visitor.state,visitor.state.me).waiting,true);
  assert.equal(who(visitor.state,visitor.state.me).cards.length,0);
  await assert.rejects(t.update(busted,'rebuy',{amount:201}),{status:400});
  state = await t.update(busted,'rebuy',{amount:137});
  assert.equal(state.reload.request,137);
  await assert.rejects(t.update(guest,'rebuy-decision',{player:busted.state.me,accept:true}),{status:403});
  state = await t.update(t.a,'rebuy-decision',{player:busted.state.me,accept:false});
  assert.equal((await t.read(busted)).reload.status,'refused');
  await t.update(busted,'rebuy',{amount:199});
  state = await t.update(t.a,'rebuy-decision',{player:busted.state.me,accept:true});
  assert.equal(who(state,busted.state.me).cards.length,0);
  assert.equal((await t.read(busted)).reload.approved,199);
  assert.equal(who(state,busted.state.me).rebuys,0);
  const sessions = [t.a,t.b,guest,visitor];
  const currentActor = sessions.find(s=>s.state.me===state.actor);
  state = await t.update(currentActor,'action',{move:'fold'});
  assert.equal(state.phase,'result');
  await t.update(t.a,'pause',{paused:true});
  t.step(5100);
  for (const s of sessions) await t.read(s);
  assert.equal((await t.read(t.a)).phase,'result');
  await t.update(t.a,'pause',{paused:false});
  t.step(5000);
  state = await t.read(t.a);
  assert.equal(state.phase,'preflop');
  assert.equal(who(state,busted.state.me).rebuys,1);
  assert.equal(who(state,busted.state.me).loaded,299);
  assert.equal(who(state,busted.state.me).cards.length,2);
  assert.ok(state.lastHand.pots.length);
});

test('Torneo: timeout fold/check, bui dalla mano successiva e uscita definitiva', async () => {
  const t = await setup('tournament');
  let state = await t.update(t.a,'start');
  await assert.rejects(t.join('Carla'),{status:409});
  const first = t.actor(state);
  assert.ok((await t.read(first)).actions.call > 0);
  for (let i=0;i<12;i++) {
    t.step(5000);
    await t.read(t.a);
    state = await t.read(t.b);
  }
  assert.equal(state.phase,'result');
  assert.equal(who(state,first.state.me).folded,true);
  assert.equal(state.small,3);
  assert.equal(state.big,10);
  assert.equal(state.blindMs,0);
  assert.equal(state.nextMs,5000);
  t.step(4999);
  assert.equal((await t.read(t.a)).phase,'result');
  await t.read(t.b);
  t.step(1);
  state = await t.read(t.a);
  assert.equal(state.phase,'preflop');
  assert.equal(state.level,2);
  assert.equal(state.small,6);
  assert.equal(state.big,20);
  assert.deepEqual(state.nextBlinds,{small:12,big:40});
  state = await t.update(t.actor(state),'action',{move:'call'});
  const second = t.actor(state);
  assert.equal((await t.read(second)).actions.call,0);
  for (let i=0;i<12;i++) {
    t.step(5000);
    await t.read(t.a);
    state = await t.read(t.b);
  }
  assert.equal(state.phase,'flop');
  assert.equal(who(state,second.state.me).folded,false);
  const last = t.a.state.me === state.actor ? t.b : t.a;
  await assert.rejects(t.update(last,'rebuy',{amount:100}),{status:409});
  await t.update(last,'leave');
  await assert.rejects(t.read(last),{status:401});
  await assert.rejects(t.recover(last.state.recoveryCode),{status:401});
  const remaining = last===t.a ? t.b : t.a;
  state = await t.read(remaining);
  assert.equal(state.champion,who(state,remaining.state.me).name);
  assert.equal(state.players.length,1);
});

test('Riconnessione in entrambe le modalità e ripristino persistente di carte e mazzo', async () => {
  for (const mode of ['cash','tournament']) {
    const t = await setup(mode);
    const before = await t.update(t.a,'start');
    await t.read(t.b);
    t.step(3000);
    await t.read(t.a);
    t.step(3000);
    let state = await t.read(t.a);
    assert.equal(state.actions,null);
    assert.deepEqual(state.disconnect.names,['Bruno']);
    assert.equal(state.turnMs,54000);
    t.step(4000);
    const second = await t.recover(t.b.state.recoveryCode);
    await assert.rejects(t.read(t.b),{status:401});
    assert.equal(second.state.hand,before.hand);
    assert.equal(second.state.disconnect,null);
    assert.equal(second.state.turnMs,54000);
    assert.equal(who(second.state,t.b.state.me).rebuys,0);
  }
  const folder = await mkdtemp(join(tmpdir(),'homepoker-test-'));
  const t = await setup('tournament',join(folder,'rooms.sqlite'));
  const before = await t.update(t.a,'start');
  const privateA = who(before,t.a.state.me).cards;
  const privateB = who(await t.read(t.b),t.b.state.me).cards;
  const beforeDeck = (await t.store.get(t.code)).deck;
  t.step(50_000);
  await t.reopen();
  let recovered = await t.read(t.a);
  assert.deepEqual(who(recovered,t.a.state.me).cards,privateA);
  assert.deepEqual(recovered.disconnect.names,['Bruno']);
  recovered = await t.read(t.b);
  assert.deepEqual(who(recovered,t.b.state.me).cards,privateB);
  assert.equal(recovered.turnMs,before.turnMs);
  assert.deepEqual((await t.store.get(t.code)).deck,beforeDeck);
  await t.store.close();
  await rm(folder,{recursive:true,force:true});
});


