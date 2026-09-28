# Kita-Notbetreuung

Kleine Web-App für Kita und Elternbeirat: Wenn wegen Krankheit oder Personalmangel
nicht genug Erzieherinnen da sind, meldet die Kita-Leitung einen **Engpass-Tag** mit einer
begrenzten Zahl an Plätzen. Eltern können dann per Handy

- ihr Kind **anmelden** („Brauche Betreuung“) – wer zuerst kommt, bekommt einen Platz,
  alle weiteren landen auf der **Warteliste** und rücken bei Absagen automatisch nach, oder
- ihr Kind **abmelden** („Kind bleibt zuhause“) – damit die Kita weiß, wer freiwillig
  zuhause bleibt.

## So funktioniert's

| Wer | Adresse | Zugang |
|---|---|---|
| Eltern | `/` | gemeinsamer **Kita-Code** (z. B. per Elternbrief/WhatsApp-Gruppe verteilt) |
| Kita-Leitung / Elternbeirat | `/admin` | separater **Admin-Code** |

**Verwaltung:** Engpass-Tag anlegen (Datum, Plätze, optional Anmeldeschluss und Hinweis),
Plätze nachträglich ändern, Anmeldung schließen, Liste als CSV für Excel exportieren.

**Eltern:** sehen nur die Zahlen (belegt / Warteliste / zuhause) und ihre eigenen Einträge,
**nicht** die Namen anderer Kinder. Einträge können bis zum Anmeldeschluss zurückgezogen
werden. Das Gerät merkt sich Kita-Code und Namen des Kindes.

## Starten

Benötigt nur [Node.js](https://nodejs.org) ab Version 20 – keine weiteren Pakete.

```bash
KITA_CODE=sonnenschein ADMIN_CODE=geheim-4711 npm start
# → http://localhost:3000  bzw.  http://localhost:3000/admin
```

Ohne Umgebungsvariablen gelten die Test-Codes `kita` und `leitung`.
Die Daten landen in `data.json` (Pfad änderbar über `DATA_FILE`, Port über `PORT`).

Tests: `npm test`

## Datenschutz (DSGVO) – bitte vor dem Echtbetrieb klären

- Es werden nur **Vorname/Initial und Gruppe** gespeichert – keine E-Mail, Telefonnummer o. ä.
- Hosting möglichst bei einem Anbieter in der EU, Verbindung nur über **HTTPS**.
- Den Einsatz mit Kita-Leitung und **Träger** abstimmen; ggf. kurze Datenschutzinfo für Eltern.
- Alte Engpass-Tage regelmäßig in der Verwaltung löschen.

## Ideen für die nächsten Ausbaustufen

1. **Benachrichtigungen**, sobald ein Engpass-Tag gemeldet wird (Web-Push, E-Mail oder
   Link in die bestehende Eltern-WhatsApp-/Signal-Gruppe).
2. **Priorisierung** statt „wer zuerst kommt“: z. B. Kennzeichnung „beide Eltern berufstätig /
   systemrelevant“, damit die Kita nach ihren Kriterien Plätze vergeben kann.
3. **Plätze pro Gruppe** statt für die ganze Kita.
4. **Eltern-Konten** statt gemeinsamem Code (z. B. Einladungslink pro Familie).
5. Als **App installierbar** machen (PWA: „Zum Startbildschirm hinzufügen“).
6. **Hosting**: z. B. kleiner Server/VPS in Deutschland, Render/Fly.io (EU-Region) o. Ä.
