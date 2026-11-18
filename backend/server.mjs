import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { createRoom, getRoom, joinRoom, readRoom, updateRoom } from './rooms.mjs';
import { fail } from './http-error.mjs';

async function loadFrontend() {
  const directory = new URL('../frontend/', import.meta.url);
  try {
    await stat(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return new Map();
    throw error;
  }
  const assets = [
    ['/', 'index.html', 'text/html'],
    ['/app.js', 'app.js', 'text/javascript'],
    ['/style.css', 'style.css', 'text/css']
  ];
  return new Map(await Promise.all(assets.map(async ([path, file, mime]) => [
    path, {body:await readFile(new URL(file, directory)), mime}
  ])));
}

const files = await loadFrontend();
const frontendOrigins = new Set();
if (process.env.RENDER_EXTERNAL_HOSTNAME === 'homepoker-e2ns.onrender.com') {
  frontendOrigins.add('https://home-poker-9869.onrender.com');
}
if (process.env.FRONTEND_ORIGIN) {
  frontendOrigins.add(new URL(process.env.FRONTEND_ORIGIN).origin);
}

function allowFrontend(req, res) {
  res.setHeader('Vary', 'Origin');
  const origin = req.headers.origin;
  if (!frontendOrigins.has(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  return true;
}
async function json(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail('Formato della richiesta non valido.',415);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) fail('Richiesta troppo grande.',413);
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString());
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error();
    return data;
  } catch { fail('Dati della richiesta non validi.'); }
}

function reply(res, data) {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

const server = createServer(async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  try {
    const url = new URL(req.url,'http://localhost');
    if (url.pathname === '/healthz' && req.method === 'GET') {
      return reply(res, {ok:true});
    }
    if (url.pathname === '/api/rooms' || url.pathname.startsWith('/api/rooms/')) {
      const allowed = allowFrontend(req, res);
      if (req.method === 'OPTIONS') {
        if (!allowed) fail('Origine non consentita.', 403);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.statusCode = 204;
        return res.end();
      }
    }
    const file = files.get(url.pathname);
    if (file && req.method === 'GET') {
      res.setHeader('Content-Type',file.mime + '; charset=utf-8');
      res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      return res.end(file.body);
    }
    if (req.method === 'POST' && url.pathname === '/api/rooms') {
      return reply(res,createRoom(await json(req)));
    }
    const match = /^\/api\/rooms\/([A-Z2-9]{6})(?:\/(join|action|start))?$/.exec(url.pathname);
    if (!match) fail('Tavolo non trovato.',404);
    const [,code,route] = match;
    if (req.method === 'GET' && !route) {
      return reply(res,readRoom(getRoom(code),req.headers.authorization));
    }
    if (req.method !== 'POST' || !route) fail('Operazione non disponibile.',405);
    const data = await json(req);
    const room = getRoom(code);
    const result = route === 'join'
      ? joinRoom(room,data)
      : updateRoom(room,req.headers.authorization,route,data);
    reply(res,result);
  } catch (error) {
    res.statusCode = error.status ?? 500;
    if (!error.status) console.error(error);
    reply(res,{error:error.status ? error.message : 'Errore del server.'});
  }
});

const port = Number(process.env.PORT ?? process.env.HOLDEM_PORT ?? 8080);
server.listen(port,process.env.HOLDEM_HOST ?? '0.0.0.0',() => {
  const port = server.address().port;
  console.log('Tavolo Hold’em: http://localhost:' + port);
  if (server.address().address === '0.0.0.0') {
    for (const address of Object.values(networkInterfaces()).flat()) {
      if (address.family === 'IPv4' && !address.internal) console.log('Rete locale: http://' + address.address + ':' + port);
    }
  }
});




