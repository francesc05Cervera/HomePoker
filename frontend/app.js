const apiOrigin = document.querySelector('meta[name=api-origin]').content;
const el = id => document.getElementById(id);
const numeral = new Intl.NumberFormat('it-IT');
const number = value => numeral.format(value);
const phases = {lobby:'Lobby',preflop:'Preflop',flop:'Flop',turn:'Turn',river:'River',result:'Risultato'};
const suits = {s:'♠',h:'♥',d:'♦',c:'♣'};
const suiteNames = {s:'picche',h:'cuori',d:'quadri',c:'fiori'};
const urlCode = new URLSearchParams(location.search).get('join')?.toUpperCase();
let session;
try { session = JSON.parse(sessionStorage.getItem('holdem-session')); } catch {}
if (urlCode && urlCode !== session?.code) session = null;
let state;
let busy = false;
let polling = false;

function sessionFor(value) {
  session = value;
  try {
    if (value) sessionStorage.setItem('holdem-session',JSON.stringify(value));
    else sessionStorage.removeItem('holdem-session');
  } catch {}
}

async function request(path, {body, token} = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(apiOrigin + '/api/rooms' + path,{
    headers, method:body ? 'POST' : 'GET', body:body ? JSON.stringify(body) : undefined,
    signal:AbortSignal.timeout(7000)
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error),{status:response.status});
  return data;
}

function showError(message) {
  el('error').textContent = message;
  el('error').hidden = !message;
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
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
  const element = node('span',rank+suits[suit],'card' + ('hd'.includes(suit) ? ' red' : ''));
  element.setAttribute('aria-label',rank + ' di ' + suiteNames[suit]);
  return element;
}

function render(current) {
  if (!session || current.code !== session.code) return;
  if (state?.code === current.code && state.version >= current.version) return;
  state = current;
  const {players,actor,button,me,host,phase,hand,actions} = current;
  const ownTurn = !!actions;
  el('home').hidden = true;
  el('game').hidden = false;
  el('exit').hidden = false;
  el('roomName').textContent = current.roomName;
  el('stage').textContent = phase === 'lobby' ? 'LOBBY' : 'MANO ' + hand + ' · ' + phases[phase].toUpperCase();
  el('code').textContent = current.code;
  el('pot').textContent = 'Piatto ' + number(current.pot) + '  ·  Bui ' + number(current.small) + '/' + number(current.big);
  el('board').replaceChildren(...Array.from({length:5},(_,i) => card(current.board[i])));
  const remaining = players.filter(player => player.stack > 0);
  const champion = phase === 'result' && remaining.length === 1 ? remaining[0] : null;
  let status = phase === 'lobby' ? players.length + ' / 9 giocatori · In attesa della prima mano' : 'Mano conclusa';
  if (actor) status = ownTurn ? 'Tocca a te' : 'Turno di ' + players.find(player => player.id === actor).name;
  if (champion) status = champion.name + ' vince il tavolo';
  el('turn').textContent = status;
  el('seats').replaceChildren(...players.map(player => {
    const seat = node('article',null,'seat' + (actor === player.id ? ' acting' : '') + (player.folded ? ' folded' : ''));
    const name = player.name + (player.id === me ? ' (tu)' : '') + (player.id === button ? ' · Dealer' : '');
    let detail = number(player.stack) + ' fiches';
    if (player.street) detail += ' · ' + number(player.street) + ' puntate';
    if (player.folded) detail += ' · Fold';
    if (!player.stack) detail += player.inHand && phase !== 'result' ? ' · All-in' : ' · Eliminato';
    seat.append(node('h3',name),node('p',detail));
    if (player.cards.length) {
      const cards = node('div',null,'cards');
      cards.append(...player.cards.map(card));
      seat.append(cards);
    }
    return seat;
  }));
  el('result').hidden = !current.results.length;
  el('result').replaceChildren(...current.results.map(result => node('p',result.name + ' vince ' + number(result.amount) + ' fiches · ' + result.hand)));
  el('start').hidden = me !== host || !['lobby','result'].includes(phase) || !!champion;
  el('start').disabled = remaining.length < 2;
  el('start').textContent = phase === 'lobby' ? 'Distribuisci le carte' : 'Prossima mano';
  el('moves').hidden = !ownTurn;
  if (!ownTurn) return;
  el('call').textContent = actions.call ? 'Chiama ' + number(actions.call) : 'Check';
  el('raise').hidden = !actions.raise;
  const input = el('target');
  input.min = Math.min(actions.min, actions.max);
  input.max = actions.max;
  input.value = input.min;
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
      leave();
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
      token:active.token,body:{version:state.version,...data}
    });
    if (session === active) render(response);
  } catch (error) {
    if (session === active) showError(error.message);
  } finally {
    busy = false;
    refresh();
  }
}

function leave() {
  state = null;
  // Keep the tab's credential so reloading can recover the seat.
  session = null;
  el('game').hidden = true;
  el('home').hidden = false;
  el('exit').hidden = true;
  el('connection').textContent = '';
  showError('');
}

el('create').onsubmit = event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  enter('',{name:form.get('name'),roomName:form.get('roomName'),stack:Number(form.get('stack')),big:Number(form.get('big'))});
};
el('join').onsubmit = event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  enter('/'+form.get('code').toUpperCase()+'/join',{name:form.get('name')});
};
if (urlCode && /^[A-Z2-9]{6}$/.test(urlCode)) el('join').elements.code.value = urlCode;
el('start').onclick = () => send('start');
el('fold').onclick = () => send('action',{move:'fold'});
el('call').onclick = () => send('action',{move:'call'});
el('raise').onsubmit = event => {
  event.preventDefault();
  send('action',{move:'raise',target:el('target').valueAsNumber});
};
el('allIn').onclick = () => send('action',{move:'raise',target:state.actions.max});
el('exit').onclick = leave;
el('copy').onclick = async () => {
  const invite = new URL('/',location.href);
  invite.searchParams.set('join',state.code);
  try {
    await navigator.clipboard.writeText(invite.href);
    el('copy').textContent = 'Copiato';
    setTimeout(() => el('copy').textContent = 'Copia invito',1800);
  } catch {
    window.prompt('Copia il link di invito',invite.href);
  }
};
refresh();
setInterval(refresh,900);

