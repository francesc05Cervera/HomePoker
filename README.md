# HomePoker

Texas Hold’em no-limit per 2–9 giocatori, con fiches virtuali. Il frontend è in frontend/ e il server Node.js in backend/.

## Avvio locale

Usa Node.js 22.13 o successivo.

    npm --prefix backend ci
    npm --prefix backend start

Apri http://localhost:8080. Usa due profili o contesti del browser per giocare con sessioni distinte sullo stesso computer. Il backend può avviarsi in modalità solo API se la cartella frontend/ è assente. Per impostazione predefinita i tavoli sono salvati in backend/data/homepoker.sqlite. Configura HOLDEM_DB_PATH per cambiare file, HOLDEM_HOST per cambiare host e HOLDEM_PORT o PORT per cambiare porta.

    npm --prefix backend test

## Regole

- In Torneo, i bui aumentano del 50% a ogni livello, arrotondati verso l’alto. L’admin imposta l’intervallo. I bui si aggiornano alla mano successiva. I giocatori eliminati possono continuare a osservare il tavolo.
- In Cash Game, i bui restano fissi. Un giocatore senza fiches può inviare una richiesta di ricarica da 1 fino a 2× lo stack iniziale. L’admin può accettarla o rifiutarla durante qualsiasi fase. La ricarica viene applicata quando il giocatore riceve le carte nella mano successiva.
- L’admin avvia la prima mano. Quando ci sono almeno due giocatori pronti, la prossima mano parte 5 secondi dopo il risultato. L’admin può fermare l’avvio tra le mani.
- Un turno dura 60 secondi. A tempo scaduto il server fa check se non ci sono fiches da chiamare, altrimenti fold. Con un all-in e nessuna azione rimanente, il server rivela le strade mancanti ogni 3 secondi. Il flop esce in un unico gruppo.
- Le richieste di stato fungono da segnale di presenza. Se per 6 secondi il server non riceve richieste da un giocatore ancora in mano, congela la mano e i timer per massimo 45 secondi. Al rientro ripristina il posto, oppure fa ripartire i timer dal residuo allo scadere dell’attesa.
- Il codice personale permette di riprendere il posto da un altro dispositivo insieme al codice del tavolo. L’uscita volontaria lo invalida. Un giocatore già all-in conserva il diritto al piatto fino alla fine della mano.
- Carte coperte, mazzo e credenziali restano sul server. Solo il proprietario del posto vede il codice personale e le proprie carte prima dello showdown. Le stanze scadono dopo 24 ore senza operazioni di gioco o modifiche.

## Deploy su Render

| Impostazione | Backend · Web Service | Frontend · Static Site |
| --- | --- | --- |
| Root Directory | backend | frontend |
| Build Command | npm ci | node build.mjs |
| Start Command | npm start | — |
| Publish Directory | — | dist |
| Health Check Path | /healthz | — |

Configura DATABASE_URL sul Web Service con l’URL di un database PostgreSQL. Il server crea la tabella homepoker_rooms al primo avvio. In alternativa puoi configurare HOLDEM_DB_PATH con un percorso su un disco persistente. Il backend richiede una di queste opzioni su Render. Tieni il Web Service su una sola istanza per gestire i segnali di presenza in modo coerente.

Imposta API_ORIGIN nello Static Site con l’URL HTTPS del Web Service. Imposta FRONTEND_ORIGIN sul Web Service con l’origine HTTPS dello Static Site. Distribuisci la nuova versione del backend prima del frontend. I tavoli creati dalla versione precedente, che vivevano in memoria, non possono essere trasferiti nel database.

## API

Le richieste POST usano JSON. Creazione, iscrizione e recupero restituiscono token e state. Per le operazioni autenticate invia Authorization: Bearer <token>. Gli aggiornamenti richiedono version oltre ai campi nella tabella.

| Metodo | Percorso | JSON aggiuntivo |
| --- | --- | --- |
| POST | /api/rooms | name, roomName, mode, stack, small, big, blindMinutes |
| POST | /api/rooms/:code/join | name |
| POST | /api/rooms/:code/recover | recoveryCode |
| GET | /api/rooms/:code | — |
| POST | /api/rooms/:code/start | — |
| POST | /api/rooms/:code/action | move, target per raise |
| POST | /api/rooms/:code/rebuy | amount |
| POST | /api/rooms/:code/rebuy-decision | player, accept |
| POST | /api/rooms/:code/pause | paused |
| POST | /api/rooms/:code/leave | — |

mode accetta cash o tournament. move accetta call (anche per check), fold o raise. target è il totale della puntata nel giro corrente. Il server calcola e valida anche i rilanci rapidi Piatto e 2× piatto.
