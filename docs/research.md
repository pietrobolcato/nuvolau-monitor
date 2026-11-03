# Apertura prenotazioni Nuvolau per luglio 2027

Ricognizione del **3 novembre 2026**. Obiettivo: due persone, notte del **21 luglio 2027**, partenza il 22. Il sito ufficiale indica **gennaio 2027** per l'apertura delle prenotazioni, senza pubblicare giorno e ora. La stagione è prevista dal 20 giugno al 20 settembre 2027. [Pagina ufficiale](https://rifugionuvolau.it/dormire/), [homepage](https://rifugionuvolau.it/), [versione inglese](https://rifugionuvolau.it/en/booking/).

## Cosa mostra il sito attuale

La [pagina del modulo](https://rifugionuvolau.it/modulo-di-prenotazione/) mostra un avviso di camere chiuse e un collegamento al [calendario](https://rifugionuvolau.it/disponibilita/). I pulsanti di prenotazione sono presenti anche adesso: controllarne solo testo o esistenza darebbe un falso positivo.

Il calendario offre il selettore di luglio 2027. Le cinque camerate hanno identificativi 4, 6, 8, 5 e 7 e capacità complessiva di 24 letti. Il 21 luglio 2027 tutte le celle riportano zero posti. Questo dato, con le prenotazioni ancora da aprire, descrive l'inventario esposto dal sistema; **non dimostra che i letti siano già venduti**.

Il motore è **VikBooking per WordPress**, rilevabile sia negli asset caricati sia nella struttura del calendario. Il calendario espone data e posti residui mediante `data-cell-date` e `data-units-left`. Non è necessario indovinare il colore delle celle. La documentazione distingue le [viste di ricerca e disponibilità](https://vikwp.com/support/knowledge-base/vik-booking/installation-first-setup/shortcodes-available) e i [diversi stati del calendario](https://vikwp.com/support/knowledge-base/vik-booking/dates-times-calendars/dates-statuses-in-availability-calendars).

Le [FAQ ufficiali](https://rifugionuvolau.it/faq/) indicano che le disponibilità cambiano anche per cancellazioni e suggeriscono di riprovare. Perciò il monitor continua dopo la prima apertura e non equipara una ricerca vuota alla chiusura delle prenotazioni.

## Riscontri storici verificati con Internet Archive

| Evidenza | Risultato | Fonte |
| --- | --- | --- |
| Pagina del 22 febbraio 2024 | Il modulo attivo era dentro `/dormire/`, con check-in, check-out, letti, ospiti e ricerca | [Snapshot](https://web.archive.org/web/20240222050049/https://rifugionuvolau.it/dormire/) |
| Pagina del 2 dicembre 2024 | Apertura delle prenotazioni annunciata per il 1° febbraio 2025 | [Snapshot](https://web.archive.org/web/20241202174053/https://rifugionuvolau.it/dormire/) |
| Homepage del 21 gennaio 2026 | Giugno dal 1° febbraio; luglio dal 3; agosto dal 5; settembre dal 7 febbraio 2026 | [Snapshot](https://web.archive.org/web/20260121191957/https://rifugionuvolau.it/) |
| Homepage del 1° febbraio 2026 | Il popup mantiene lo stesso calendario scaglionato | [Snapshot](https://web.archive.org/web/20260201043351/https://rifugionuvolau.it/) |

La homepage archiviata contiene quattro countdown **HurryTimer** dentro un popup. I valori `endDate` sono timestamp Unix in millisecondi: per luglio `1770118080000`, equivalente al **3 febbraio 2026 alle 12:28, Europe/Rome**. Anche gli altri tre terminano alle 12:28 dei rispettivi giorni. È un parametro del conto alla rovescia, **non una prova che le vendite siano state abilitate a quell'ora**. Non va trasformato in una previsione per il 2027.

Il calendario scaglionato del 2026 compare inoltre nel testo alternativo di un post Instagram incorporato nella homepage del rifugio: il rifugio motivava la scelta con il sovraccarico di utenti sul sito. La presenza di quel post storico oggi non aggiorna l'annuncio per il 2027.

Il modulo archiviato del 2024 inviava `option=com_vikbooking`, `task=search`, `checkindate`, `checkoutdate`, `roomsnum` e un campo `adults[]` per ogni letto. L'etichetta del selettore era “Letti” e ogni letto consentiva un ospite: per due persone la richiesta coerente è **due letti con un adulto ciascuno**.

Il [template pubblico dei risultati VikBooking](https://plugins.svn.wordpress.org/vikbooking/trunk/site/views/search/tmpl/default.php) conferma il contenitore `.vbo-results-wrapper` e il numero di letti/camere in `.vbo-results-numrooms`. Il [template classico](https://plugins.svn.wordpress.org/vikbooking/trunk/site/views/search/tmpl/default_classic.php) usa prezzi e pulsanti di selezione distinti dai contenuti promozionali. Questi riferimenti rendono i selettori motivati, ma una personalizzazione futura del sito può comunque richiedere aggiornamenti.

Il sito è stato rinnovato: ora l'informazione, il modulo e il calendario hanno pagine distinte. I metadati WordPress della pagina non bastano per stabilire quando sia cambiato il banner: possono essere contenuti condivisi o popup. Il monitor osserva il contenuto effettivamente restituito.

## Quale data usare

Per il 2027 la fonte operativa resta l'annuncio ufficiale di gennaio. Fonti terze continuano a citare febbraio o a riportare lo scaglionamento: per esempio [questa newsletter](https://dolomitesdecoded.beehiiv.com/p/when-dolomites-rifugi-open-bookings-for-next-summer) indica il 1° febbraio. Non è coerente con l'annuncio corrente del rifugio e non è una base per ritardare il monitoraggio fino a febbraio.

Per la notte del 21 luglio vanno seguiti tre eventi separati: pubblicazione di un giorno/orario specifico per luglio, attivazione del modulo con luglio selezionabile e disponibilità di due letti per la notte scelta. Una sola ricerca fallita durante l'apertura di giugno non conclude nulla su luglio.

## Limiti del cron gratuito

[GitHub Actions](https://docs.github.com/en/actions/concepts/billing-and-usage) offre runner standard gratuiti per repository pubblici. La [documentazione sullo schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) specifica un intervallo minimo di cinque minuti, possibili ritardi/scarti e disabilitazione dopo 60 giorni di inattività nei repository pubblici. Non consente una garanzia sull'istante esatto dell'apertura.

[Healthchecks.io](https://healthchecks.io/) offre controlli gratuiti per rilevare job che non inviano più il loro heartbeat. È utile perché un monitor che smette di girare non può avvisare da solo. [cron-job.org](https://cron-job.org/en/faq/) offre chiamate HTTP fino a una al minuto, ma non ospita Chromium: richiederebbe un servizio che esegua il browser oppure l'attivazione di un workflow, ancora soggetto alla coda di GitHub.
