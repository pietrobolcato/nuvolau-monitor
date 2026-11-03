# Monitor prenotazioni Rifugio Nuvolau

Controlla **2 persone, arrivo mercoledì 21 luglio 2027, partenza giovedì 22 luglio 2027**. Una notte è l'assunzione configurata. Il monitor usa Chromium con Playwright e può girare ogni cinque minuti su GitHub Actions.

**Situazione verificata il 3 novembre 2026:** il sito annuncia prenotazioni 2027 da gennaio, senza giorno o ora. Il modulo è disattivato; il calendario del 21 luglio mostra zero posti, che in questo momento **non significa tutto esaurito**. Nel 2026 le prenotazioni di luglio aprivano il 3 febbraio, separatamente dagli altri mesi. Fonti e dettagli in [docs/research.md](docs/research.md).

## Avvio locale

Configurazione concordata il 3 novembre 2026: **21–22 luglio 2027, due adulti**, GitHub Actions e notifiche Telegram. Non prenota automaticamente. La pianificazione resta disabilitata finché la repository variable `MONITOR_ENABLED` non è `true`; gli avvii manuali restano disponibili per il collaudo.

Richiede Node.js 22 o successivo.

```sh
npm ci
npx playwright install chromium
npm run dry-run
```

Il dry run visita il sito e salva `artifacts/<timestamp>/`: screenshot PNG, HTML, testo, osservazioni strutturate e report. **Non invia notifiche e non modifica lo stato persistente.**

```sh
npm test
```

Diagnostica locale e Telegram (creare prima `.env` dal modello, senza sovrascrivere credenziali esistenti):

```sh
npm run doctor
# Dopo aver salvato il token in .env e inviato /start al bot:
npm run telegram:discover
# Salvare in .env il proprio TELEGRAM_CHAT_ID, poi:
npm run telegram:test
```

Non pubblicare token né incollarli in chat. La diagnostica non stampa segreti. La ricerca del chat ID non mostra messaggi e non modifica un webhook esistente. Il messaggio di test è esplicitamente distinto dagli avvisi di disponibilità.

I test sono offline: Chromium esamina fixture sintetiche e simula il modulo storico con veri calendari jQuery UI. Coprono i falsi positivi, il POST di ricerca con date e ospiti esatti, errori, cambi di stato e retry delle notifiche. Il sito oggi non espone un modulo attivo, quindi il percorso positivo reale del 2027 dovrà essere verificato quando comparirà.

## Attivazione su GitHub Actions

1. Crea un **repository personale pubblico dedicato** e carica **questa cartella** nella sua radice. Non caricare il backend AI Lens Creator. Pubblico consente runner standard gratuiti; privato consuma la quota inclusa nel tuo piano.
2. Mantieni abilitata la sezione **Issues**. Il workflow ha permessi `contents: write` e `issues: write`: registra lo stato nel branch `monitor-state` e crea un'issue per ciascun evento. I token sono gestiti dai secrets di Actions.
3. Per ricevere email GitHub, seleziona **Watch → Custom → Issues**, abilita le notifiche email nelle impostazioni personali e verifica l'arrivo dell'issue iniziale. Un'issue creata non garantisce un'email se le tue preferenze la disabilitano.
4. Per Telegram, crea un bot con [BotFather](https://t.me/BotFather), apri la chat con il bot e invia `/start`. In **Settings → Secrets and variables → Actions** aggiungi `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`. Il chat ID è ottenibile dalla risposta dell'API `getUpdates` dopo il messaggio iniziale; non inserire il token nei file o nei log. Per usare solo Telegram, aggiungi la repository variable `GITHUB_ALERTS=false`.
5. In **Actions → Nuvolau monitor → Run workflow**, esegui prima con `dry_run=true`, poi senza, dopo aver configurato i secrets. Il secondo avvio manda una notifica iniziale. **Verifica che ti arrivi**, quindi imposta la repository variable `MONITOR_ENABLED=true` per attivare il cron. Per sole notifiche Telegram imposta anche `GITHUB_ALERTS=false`.
6. Consigliato: crea un controllo gratuito su [Healthchecks.io](https://healthchecks.io/), con periodo 5 minuti e tolleranza, per esempio, 20 minuti. Salva il suo URL nel secret `HEALTHCHECKS_URL` e attiva le tue notifiche. Rileva anche il caso in cui Actions smetta completamente di eseguire il workflow.

Il cron `2-59/5 * * * *` è UTC ed esegue ai minuti 2, 7, 12, ecc. Parte soltanto quando il workflow è nel **branch predefinito**. Il workflow dei test usa `main`.

Gli screenshot sono caricati come artifact solo per eventi, errori e avvii manuali, con retention di tre giorni. I log e il riepilogo del job restano visibili in Actions. Questo limita lo spazio consumato: anche quando i minuti dei runner sono gratuiti, tieni d'occhio quote di storage e condizioni del piano.

## Segnali e notifiche

| Stato | Interpretazione |
| --- | --- |
| `WAITING` | Chiusura o futura apertura annunciata; non deduce che i posti siano esauriti |
| `FORM_READY` | È comparso un modulo attivo con date e ricerca; le tue date restano da verificare |
| `OPEN_ANNOUNCED` | Annuncio esplicito di apertura; disponibilità non ancora verificata |
| `CALENDAR_AVAILABLE` | Il calendario indica almeno due letti per il 21 luglio; prenotabilità da verificare |
| `AVAILABLE` | La ricerca per 21–22 luglio e due letti restituisce risultati con prezzo, selezione e numero di letti, corroborati da almeno due posti nel calendario |
| `NO_AVAILABILITY` | La ricerca esatta non restituisce posti; non prova che tutto luglio sia aperto o esaurito |
| `REVIEW` | Pagina, iframe o fornitore cambiato; verifica manuale tramite screenshot |
| `ERROR` | Nessuna pagina controllabile; il guasto è segnalato |

Il monitor osserva pagina italiana, modulo, calendario, homepage, versione inglese e fino a due nuovi link pertinenti sul dominio autorizzato. Legge popup e timestamp dei countdown; non considera il semplice pulsante “Prenota ora” o la presenza degli script VikBooking una prova di apertura. I countdown sono indizi del sito, non garanzie sull'orario effettivo.

Le modifiche al testo e ai link producono un avviso anche se il classificatore non conosce il nuovo layout. Le tabelle tariffarie caricate in ritardo vengono escluse dalla comparazione per evitare allarmi dovuti solo al caricamento. Legende del calendario, script, campi nascosti e moduli disabilitati non valgono come disponibilità. Un CAPTCHA o un errore di caricamento resta un errore. Se cambia il dominio del fornitore, il monitor segnala il link e richiede revisione dell'adattatore.

Il calendario viene spostato su **luglio 2027 usando il selettore pubblico**; i posti si leggono dalla cella con data esatta e dagli attributi `data-units-left`. Il conteggio riguarda la notte d'arrivo, non anche quella della partenza. `sameDorm: false` consente due letti in camerate diverse e il report specifica se ne risultano due insieme. Imposta `true` se devono essere nella stessa camerata.

La ricerca automatica usa soltanto il modulo VikBooking riconosciuto, rispetta giorni disabilitati e limiti del calendario, invia due letti con un adulto ciascuno e controlla la richiesta emessa. Non seleziona né blocca letti, non fornisce dati personali e non conferma prenotazioni. Un nuovo tipo di modulo genera `FORM_READY` e screenshot invece di essere compilato alla cieca.

Non serve una chiave LLM e non ci sono costi API. Gli screenshot sono diagnostica per la verifica umana; **non c'è un classificatore visivo automatico**. Un avviso soltanto grafico che cambi i pixel mantenendo lo stesso URL e senza testo alternativo potrebbe sfuggire alla comparazione: per quel caso servirebbe un ulteriore livello visuale. Il controllo del modulo e dell'inventario resta indipendente dall'annuncio.

## Persistenza e affidabilità

Lo stato vive in `state.json` nel branch `monitor-state`, separato dal codice. Ogni controllo aggiorna l'osservazione; un'outbox viene salvata prima degli invii e conserva gli eventi non consegnati. Il successo di Telegram non cancella un invio GitHub fallito. Un'interruzione nell'istante tra invio Telegram e salvataggio può produrre un duplicato: consegna almeno una volta, non esattamente una volta.

Arrivano notifiche al primo avvio, ai cambi di stato, alle modifiche di contenuto, alla comparsa di posti, dopo due controlli degradati e al ripristino. Gli stati che richiedono attenzione vengono ricordati ogni sei ore. Le cancellazioni sono monitorate anche dopo la prima apertura; nessun arresto automatico alla prima disponibilità. Il monitor rifiuta soggiorni già passati.

Il timestamp misura **quando il monitor ha visto il segnale**. Il report include l'ultimo controllo negativo completo: l'intervallo tra i due delimita il cambiamento osservato. [GitHub avverte](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) che i job cron possono arrivare in ritardo o essere scartati; cinque minuti è l'intervallo minimo, non un limite massimo garantito alla latenza. Nei repository pubblici i workflow pianificati possono essere disabilitati dopo 60 giorni senza attività. Gli aggiornamenti del branch tengono il repository attivo, ma il controllo esterno rimane utile per rilevare disabilitazioni, errori di permessi o token.

Quando sarà annunciata una data precisa per luglio, conviene essere presenti sul sito qualche minuto prima. Per un controllo ogni minuto puoi eseguire il medesimo comando su un computer già acceso mediante cron (con un lock per evitare sovrapposizioni); non offre un hosting gratuito aggiuntivo. [cron-job.org](https://cron-job.org/en/faq/) può chiamare URL ogni minuto, ma da solo non esegue questo progetto Playwright. Usarlo per attivare Actions non elimina la coda dei runner.

## Configurazione locale con notifiche

```sh
cp .env.example .env
# Compila i secrets nel file .env ignorato da git.
node --env-file=.env src/main.js
```

Lo stato locale viene salvato in `.state/state.json`. Non avviare più processi contemporaneamente sullo stesso file. In Actions la concorrenza è serializzata dal workflow.

Modifica `config.json` per date, numero di persone, vincolo camerata, timeout e frequenza dei promemoria. L'adattatore accetta deliberatamente una sola notte: più notti richiedono la verifica che gli stessi letti rimangano disponibili per l'intero soggiorno.

Per disattivare: **Actions → Nuvolau monitor → Disable workflow**. Le credenziali Telegram possono essere revocate tramite BotFather.
