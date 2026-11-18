import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const configuredUrl = process.env.API_ORIGIN;
if (!configuredUrl) throw new Error('Imposta API_ORIGIN con l’URL pubblico HTTPS del Web Service.');
const url = new URL(configuredUrl);
if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
  throw new Error('API_ORIGIN deve essere un’origine HTTPS senza percorsi o credenziali.');
}

const dist = new URL('./dist/', import.meta.url);
await mkdir(dist, {recursive:true});
const template = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const placeholder = '<meta name="api-origin" content="">';
if (!template.includes(placeholder)) throw new Error('Configurazione API del frontend mancante.');
await Promise.all([
  writeFile(new URL('index.html', dist), template.replace(placeholder, '<meta name="api-origin" content="' + url.origin + '">')),
  ...['style.css','app.js','home-hero.webp'].map(file => copyFile(new URL(file, import.meta.url), new URL(file, dist)))
]);
