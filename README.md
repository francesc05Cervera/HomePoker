# HomePoker

Backend multiplayer per Texas Hold’em no-limit, da 2 a 9 giocatori, con fiches virtuali. Il server gestisce il mazzo, le carte private, le azioni e lo showdown.

## Avvio

Richiede Node.js 20 o successivo. Non ci sono dipendenze da installare.

    node backend/server.mjs

Per impostazione predefinita ascolta sulla porta 8080. Imposta le variabili d’ambiente HOLDEM_HOST e HOLDEM_PORT per cambiare indirizzo e porta, ad esempio HOLDEM_HOST=127.0.0.1 per limitare l’accesso al computer locale.

## API

Le richieste POST usano JSON.

| Metodo | Percorso | Corpo JSON |
| --- | --- | --- |
| POST | /api/rooms | name, roomName, stack, big |
| POST | /api/rooms/:code/join | name |
| GET | /api/rooms/:code | — |
| POST | /api/rooms/:code/start | version |
| POST | /api/rooms/:code/action | version, move, target (solo per raise) |

Creazione e accesso restituiscono token e state. Usa Authorization: Bearer <token> per leggere lo stato, iniziare una mano o giocare. Invia la version più recente osservata. Le mosse sono fold, call (anche check) e raise. target è il totale della puntata nel giro corrente.

Il mazzo viene mescolato a ogni mano sul server con Fisher–Yates e node:crypto. I tavoli vivono in memoria e si azzerano al riavvio. Il backend si avvia da solo. Quando trova i tre file statici nella cartella frontend/ accanto a backend/, serve anche l’interfaccia. In una distribuzione separata, instrada /api/rooms e i relativi sottopercorsi verso il backend dal dominio del frontend.

## Deploy su Render

Usa la stessa repo e il branch main per entrambi i servizi.

| Impostazione | Web Service | Static Site |
| --- | --- | --- |
| Root Directory | backend | frontend |
| Runtime | Node | Static Site |
| Build Command | node --check server.mjs | node build.mjs |
| Start Command | node server.mjs | — |
| Publish Directory | — | dist |
| Health Check Path | /healthz | — |

1. Crea il Web Service e copia il suo URL pubblico HTTPS.
2. Crea lo Static Site con la variabile di build API_ORIGIN impostata all’URL del Web Service, ad esempio https://homepoker-api.onrender.com.
3. Nel Web Service imposta FRONTEND_ORIGIN all’URL dello Static Site, ad esempio https://homepoker-web.onrender.com. Usa solo schema e dominio. Render passerà la porta nella variabile PORT.

Usa l’URL dello Static Site per giocare e condividere gli inviti. Mantieni il backend su una sola istanza perché lo stato è in memoria. I riavvii e i nuovi deploy cancellano le stanze aperte.
