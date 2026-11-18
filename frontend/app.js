const apiOrigin = document.querySelector('meta[name=api-origin]').content;
const el = id => document.getElementById(id);
const numeral = new Intl.NumberFormat('it-IT');
const number = value => numeral.format(value);
const phases = {lobby:'Lobby', preflop:'Preflop', flop:'Flop', turn:'Turn', river:'River', result:'Risultato'};
const suits = {s:'♠', h:'♥', d:'♦', c:'♣'};
const suitNames = {s:'picche', h:'cuori', d:'quadri', c:'fiori'};
const fullTable = [[50,90],[77,82],[88,59],[88,35],[65,11],[35,11],[12,35],[12,59],[23,82]];
const urlCode = new URLSearchParams(location.search).get('join')?.toUpperCase();
const sessionKey = 'holdem-session';
let session = savedSession();
let state;
let clockState;
let busy = false;
let polling = false;

function savedSession() {
  try {
    const tab = JSON.parse(sessionStorage.getItem(sessionKey));
    const device = JSON.parse(localStorage.getItem(sessionKey));
    const credentials = [tab,device].find(entry => entry?.token && (!urlCode || entry.code === urlCode));
    return credentials ?? null;
  } catch {
    return null;
  }
}

function sessionFor(value) {
  session = value;
  for (const storageName of ['sessionStorage','localStorage']) {
    try {
      const storage = window[storageName];
      if (value) storage.setItem(sessionKey,JSON.stringify(value));
      else storage.removeItem(sessionKey);
    } catch {}
  }
}

async function request(path, {body,token} = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  let response;
  try {
    response = await fetch(apiOrigin + '/api/rooms' + path, {
      headers, method:body ? 'POST' : 'GET', body:body ? JSON.stringify(body) : undefined,
      signal:AbortSignal.timeout(7000),
    });
  } catch {
    throw new Error('Connessione al tavolo non riuscita. Riprova tra poco.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error ?? 'Il server non è disponibile.'), {status:response.status});
  return data;
}

function showError(message) {
  el('error').textContent = message;
  el('error').hidden = !message;
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== null && text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function card(value) {
  if (value === undefined) {
    const slot = node('span','·','card slot');
    slot.setAttribute('aria-hidden','true');
    return slot;
  }
  if (value === null) {
    const back = node('span','◆','card back');
    back.setAttribute('aria-label','Carta coperta');
    return back;
  }
  const rank = value[0] === 'T' ? '10' : value[0];
  const suit = value[1];
  const element = node('span',rank + suits[suit],'card' + ('hd'.includes(suit) ? ' red' : ''));
  element.setAttribute('aria-label',rank + ' di ' + suitNames[suit]);
  return element;
}

function cardRow(cards) {
  const row = node('div',null,'cards');
  row.append(...cards.map(card));
  return row;
}

function seatNodes(current) {
  const own = current.players.findIndex(player => player.id === current.me);
  const ordered = own < 0 ? current.players : [...current.players.slice(own), ...current.players.slice(0,own)];
  return ordered.map((player,index) => {
    const ownSeat = player.id === current.me;
    const seat = node('article',null,'seat');
    seat.classList.toggle('mine',ownSeat);
    seat.classList.toggle('acting',current.actor === player.id);
    seat.classList.toggle('folded',player.folded);
    const angle = index * 2 * Math.PI / ordered.length;
    const [left,top] = ordered.length === 9
      ? fullTable[index] : [50 + 38 * Math.sin(angle),50 + 40 * Math.cos(angle)];
    seat.style.left = left + '%';
    seat.style.top = top + '%';
    const status = player.leaving ? 'In uscita' : player.waiting ? 'Prossima mano' :
      player.busted ? (current.mode === 'cash' ? 'Senza fiches' : 'Eliminato') :
      player.folded ? 'Fold' : player.stack === 0 && player.inHand ? 'All-in' : '';
    seat.append(node('h3',player.name + (ownSeat ? ' · Tu' : '')),node('p',number(player.stack) + ' fiches'));
    if (player.street) seat.append(node('p',number(player.street) + ' puntate'));
    if (status) seat.append(node('p',status));
    if (player.id === current.button) {
      const dealer = node('span','D','dealer');
      dealer.setAttribute('aria-label','Dealer');
      seat.append(dealer);
    }
    const stats = node('dl',null,'seat-stats');
    for (const [label,value] of [['Vinte',player.wins],['Ricariche',player.rebuys]]) {
      const item = node('div');
      const term = node('dt',label);
      if (label === 'Vinte') term.title = 'Mani vinte';
      item.append(term,node('dd',number(value)));
      stats.append(item);
    }
    seat.append(stats);
    if (player.cards.length) seat.append(cardRow(player.cards));
    return seat;
  });
}

function renderPanels(current) {
  const reload = current.reload;
  const showReload = reload.eligible || reload.request !== null || reload.approved !== null;
  el('reloadPanel').hidden = !showReload;
  el('reloadForm').hidden = !reload.eligible;
  const amount = el('reloadAmount');
  amount.max = reload.max;
  if (!amount.value) amount.value = Math.floor(reload.max/2);
  el('reloadStatus').textContent = reload.approved !== null
    ? number(reload.approved) + ' fiches approvate per la prossima mano.'
    : reload.request !== null ? 'Richiesta di ' + number(reload.request) + ' fiches in attesa dell’admin.'
    : (reload.status === 'refused' ? 'Richiesta rifiutata. ' : '') + 'Puoi chiedere fino a ' + number(reload.max) + ' fiches.';

  el('adminPanel').hidden = !current.requests.length;
  el('requests').replaceChildren(...current.requests.map(entry => {
    const row = node('div',null,'row');
    const buttons = node('div',null,'row-actions');
    for (const accept of [true,false]) {
      const button = node('button',accept ? 'Accetta' : 'Rifiuta',accept ? 'primary' : '');
      button.onclick = () => send('rebuy-decision',{player:entry.id,accept});
      buttons.append(button);
    }
    row.append(node('span',entry.name + ' · ' + number(entry.amount) + ' fiches'),buttons);
    return row;
  }));
  el('handPanel').hidden = !current.lastHand;
  if (current.lastHand) {
    const {number:hand, board, pots, revealed} = current.lastHand;
    el('lastHand').replaceChildren(
      node('p','Mano ' + hand),
      cardRow(board),
      ...pots.map((pot,index) => node('p',(index === 0 ? 'Piatto principale' : 'Piatto laterale ' + index) +
        ' · ' + number(pot.amount) + ' fiches · ' + pot.shares.map(award => award.name + ' ' + number(award.amount)).join(', '))),
      ...revealed.map(entry => {
        const row = node('div',null,'row');
        row.append(node('span',entry.name),cardRow(entry.cards));
        return row;
      }),
    );
  }
  el('recoveryCode').textContent = current.recoveryCode;
}

function updateClocks() {
  if (!clockState) return;
  const elapsed = performance.now()-clockState.at;
  const {disconnect, paused, nextMs, turnMs, blindMs, revealMs, nextBlinds} = clockState.snapshot;
  const seconds = (value, frozen=false) => Math.max(0,Math.ceil((value-(frozen ? 0 : elapsed))/1000));
  let label = '';
  if (disconnect) label = 'Riconnessione · ' + seconds(disconnect.remainingMs) + ' s';
  else if (paused) label = 'Avvio automatico in pausa';
  else if (turnMs !== null) label = 'Tempo per agire · ' + seconds(turnMs) + ' s';
  else if (revealMs !== null) label = 'Prossime carte · ' + seconds(revealMs) + ' s';
  else if (nextMs !== null) label = 'Prossima mano · ' + seconds(nextMs) + ' s';
  el('timer').hidden = !label;
  el('timer').textContent = label;
  el('nextBlinds').hidden = blindMs === null;
  if (blindMs !== null && nextBlinds) {
    const t = seconds(blindMs,!!disconnect || paused);
    const clock = Math.floor(t/60) + ':' + String(t%60).padStart(2,'0');
    el('nextBlinds').textContent = 'Prossimi bui ' + number(nextBlinds.small) + '/' + number(nextBlinds.big) +
      (t ? ' · ' + clock : ' · dalla prossima mano');
  }
}

function render(current) {
  if (!session || current.code !== session.code || state?.version > current.version) return;
  clockState = {snapshot:current,at:performance.now()};
  updateClocks();
  if (state?.version === current.version) return;
  const previousActor = state?.actor;
  const previousHand = state?.hand;
  const previousPhase = state?.phase;
  const oldMin = state?.actions?.min;
  state = current;
  const {players,actor,me,host,phase,hand,actions} = current;
  el('home').hidden = true;
  el('game').hidden = false;
  el('exit').hidden = false;
  el('roomName').textContent = current.roomName;
  el('stage').textContent = (current.mode === 'cash' ? 'Cash Game' : 'Torneo') + ' · ' +
    (phase === 'lobby' ? 'Lobby' : 'Mano ' + hand + ' · ' + phases[phase]);
  el('code').textContent = current.code;
  el('blinds').textContent = (current.mode === 'tournament' ? 'Livello ' + current.level + ' · ' : '') +
    'Bui ' + number(current.small) + ' / ' + number(current.big);
  el('pot').textContent = 'Piatto ' + number(current.pot);
  el('board').replaceChildren(...Array.from({length:5},(_,i) => card(current.board[i])));
  let status = phase === 'lobby' ? players.length + ' / 9 giocatori' : 'Mano conclusa';
  if (actor) status = actor === me ? 'Tocca a te' : 'Turno di ' + players.find(player => player.id === actor)?.name;
  if (current.runout) status = 'All-in';
  if (current.disconnect) status = 'In attesa di ' + current.disconnect.names.join(', ');
  if (phase === 'result' && current.ready < 2 && current.mode === 'cash') status = 'In attesa di giocatori con fiches';
  if (current.champion) status = current.champion + ' vince il torneo';
  el('turn').textContent = status;
  el('seats').replaceChildren(...seatNodes(current));
  el('result').hidden = !current.results.length;
  el('result').replaceChildren(...current.results.map(result => node('p',result.name + ' vince ' + number(result.amount) + ' fiches · ' + result.hand)));
  el('start').hidden = me !== host || phase !== 'lobby';
  el('start').disabled = current.ready < 2;
  el('pause').hidden = me !== host || phase !== 'result' || !!current.champion;
  el('pause').textContent = current.paused ? 'Riprendi avvio automatico' : 'Pausa tra le mani';
  renderPanels(current);
  el('moves').hidden = !actions;
  if (!actions) return;
  el('call').textContent = actions.call ? 'Chiama ' + number(actions.call) : 'Check';
  el('raise').hidden = !actions.raise;
  for (const [id,label,value] of [['potBet','Piatto',actions.pot],['doubleBet','2× piatto',actions.doublePot]]) {
    const button = el(id);
    button.hidden = value === null;
    if (value !== null) button.textContent = label + ' · ' + number(value);
  }
  const input = el('target');
  const min = Math.min(actions.min,actions.max);
  input.min = min;
  input.max = actions.max;
  if (previousActor !== actor || previousHand !== hand || previousPhase !== phase || oldMin !== actions.min ||
      !input.value || input.valueAsNumber < min || input.valueAsNumber > actions.max) input.value = min;
  el('raiseButton').textContent = actions.min > actions.max ? 'Rilancio all-in' : 'Rilancia';
  el('allIn').hidden = actions.min >= actions.max;
}

async function refresh() {
  if (!session || polling) return;
  const active = session;
  polling = true;
  try {
    const data = await request('/'+active.code,{token:active.token});
    if (session !== active) return;
    el('connection').textContent = 'Connesso';
    render(data);
  } catch (error) {
    if (session !== active) return;
    if ([401,404].includes(error.status)) {
      closeTable();
      showError(error.message);
    } else el('connection').textContent = 'Riconnessione…';
  } finally {
    polling = false;
  }
}

async function enter(path, body) {
  if (busy) return;
  busy = true;
  showError('');
  try {
    const data = await request(path,{body});
    sessionFor({code:data.state.code,token:data.token});
    state = null;
    el('connection').textContent = 'Connesso';
    render(data.state);
  } catch (error) {
    showError(error.message);
  } finally {
    busy = false;
  }
}

async function send(route, data = {}) {
  if (busy || !session || !state) return;
  const active = session;
  busy = true;
  showError('');
  try {
    const response = await request('/'+active.code+'/'+route,{
      token:active.token,body:{version:state.version,...data},
    });
    if (session === active) {
      if (route === 'leave') closeTable();
      else render(response);
    }
  } catch (error) {
    if (session === active) showError(error.message);
  } finally {
    busy = false;
    refresh();
  }
}

function closeTable() {
  const code = session?.code;
  sessionFor(null);
  state = null;
  clockState = null;
  el('game').hidden = true;
  el('home').hidden = false;
  el('exit').hidden = true;
  el('connection').textContent = '';
  if (code) el('recover').elements.code.value = code;
  showError('');
}

async function copyText(button, text, prompt) {
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copiato';
    setTimeout(() => button.textContent = label,1400);
  } catch {
    window.prompt(prompt,text);
  }
}

el('mode').onchange = () => {
  el('blindSettings').hidden = el('mode').value === 'cash';
};
el('create').onsubmit = event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  enter('',{name:form.get('name'),roomName:form.get('roomName'),mode:form.get('mode'),
    stack:Number(form.get('stack')),small:Number(form.get('small')),big:Number(form.get('big')),
    blindMinutes:Number(form.get('blindMinutes'))});
};
for (const route of ['join','recover']) {
  el(route).onsubmit = event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = form.get('code').toUpperCase();
    const body = route === 'join' ? {name:form.get('name')} : {recoveryCode:form.get('recoveryCode').trim()};
    enter('/'+code+'/'+route,body);
  };
  if (urlCode && /^[A-Z2-9]{6}$/.test(urlCode)) el(route).elements.code.value = urlCode;
}
el('start').onclick = () => send('start');
el('pause').onclick = () => send('pause',{paused:!state.paused});
el('fold').onclick = () => send('action',{move:'fold'});
el('call').onclick = () => send('action',{move:'call'});
el('raise').onsubmit = event => {
  event.preventDefault();
  send('action',{move:'raise',target:el('target').valueAsNumber});
};
el('allIn').onclick = () => send('action',{move:'raise',target:state.actions.max});
el('potBet').onclick = () => send('action',{move:'raise',target:state.actions.pot});
el('doubleBet').onclick = () => send('action',{move:'raise',target:state.actions.doublePot});
el('reloadForm').onsubmit = event => {
  event.preventDefault();
  send('rebuy',{amount:el('reloadAmount').valueAsNumber});
};
el('exit').onclick = () => {
  if (window.confirm('Vuoi lasciare il tavolo e liberare il tuo posto?')) send('leave');
};
el('copy').onclick = () => {
  const invite = new URL('/',location.href);
  invite.searchParams.set('join',state.code);
  copyText(el('copy'),invite.href,'Copia il link di invito');
};
el('copyRecovery').onclick = () => copyText(el('copyRecovery'),state.recoveryCode,'Copia il codice personale');
refresh();
setInterval(refresh,900);
setInterval(updateClocks,180);
