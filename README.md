# Kita-App für Eltern und Elternbeirat

Kleine Web-App, die im Handy-Browser läuft, ganz ohne App-Store:

- **Termine & Listen:** Anmeldungen für Elternabende, Feste und Ausflüge sowie
  **Helferlisten** („Kuchen backen | 8“, „Aufbau 14–15 Uhr | 4“, …).
- **Notbetreuung:** Wenn wegen Krankheit oder Personalmangel nicht genug Erzieherinnen da
  sind, meldet die Kita-Leitung einen **Engpass-Tag** mit einer begrenzten Zahl an Plätzen.
  Eltern melden ihr Kind an („Brauche Betreuung“, bei vollen Plätzen auf die **Warteliste**
  mit automatischem Nachrücken) oder ab („Kind bleibt zuhause“).
- **Excel:** Jede Liste lässt sich per Knopfdruck als **echte Excel-Datei (.xlsx)**
  herunterladen, mit Überschrift, fetter Kopfzeile und Filter. Sie ist so eingestellt,
  dass sie beim Drucken auf die Seitenbreite passt, zum Beispiel zum Aushängen.

## So funktioniert's

| Wer | Adresse | Zugang |
|---|---|---|
| Eltern | `/` | gemeinsamer **Kita-Code** (z. B. per Elternbrief verteilt) |
| Kita-Leitung / Elternbeirat | `/admin` | separater **Admin-Code** |

**Verwaltung:**
- Listen anlegen: Titel, Datum, Uhrzeit, Ort, Beschreibung, Anmeldeschluss.
  - *Anmeldung zu einem Termin:* Eltern tragen sich mit Personenzahl ein, optional mit
    einer Höchstzahl.
  - *Helferliste:* eine Aufgabe pro Zeile, die gewünschte Helferzahl nach einem `|`.
  - Pro Liste lässt sich einstellen, ob Eltern sehen dürfen, **wer** sich eingetragen hat.
    Standardmäßig sehen sie nur die Zahlen.
- Engpass-Tage anlegen, Plätze ändern, Anmeldung schließen.
- Einträge löschen, Excel-Liste herunterladen.

**Eltern:** tragen einmal ihren Namen bzw. den Namen des Kindes ein (wird nur auf dem
eigenen Handy gemerkt), tragen sich mit einem Klick ein und können sich bis zum
Anmeldeschluss wieder austragen.

## Auf einem eigenen Server betreiben (z. B. Kita- oder Träger-Server)

Das geht gut: Die App ist ein einziges kleines Programm und speichert alles in **einer
Datei** (`data.json`). Sie braucht keine Datenbank und schickt keine Daten an fremde Dienste.

### Variante A: mit Docker (empfohlen, z. B. auf einer Synology-/QNAP-NAS)

1. Projektordner auf den Server kopieren.
2. In `docker-compose.yml` die beiden Codes ändern.
3. `docker compose up -d` ausführen (auf einer Synology NAS geht das auch über den
   „Container Manager“ → Projekt erstellen).
4. Die Daten liegen im Ordner `daten/`. **Diesen Ordner regelmäßig sichern.**

### Variante B: direkt mit Node.js

Benötigt [Node.js](https://nodejs.org) ab Version 20, keine weiteren Pakete.

```bash
KITA_CODE=sonnenschein ADMIN_CODE=ein-langer-geheimer-code npm start
# → http://<server>:3000  bzw.  http://<server>:3000/admin
```

Ohne Umgebungsvariablen gelten die Test-Codes `kita` und `leitung`.
Weitere Einstellungen: `PORT` (Standard 3000) und `DATA_FILE` (Pfad zur Datendatei).

### Wichtig: Erreichbarkeit von zuhause

Läuft die App nur im Kita-Netz, kommen Eltern von zuhause oder unterwegs **nicht** heran.
Dafür braucht der Server:

1. eine **Adresse im Internet**, also eine (Sub-)Domain oder DynDNS, z. B.
   `eltern.kita-sonnenschein.de`, und eine Portfreigabe im Router,
2. **HTTPS** (Verschlüsselung). Auf einer Synology richtet man das über „Reverse Proxy“
   und ein kostenloses Let's-Encrypt-Zertifikat ein, sonst z. B. mit Caddy oder nginx.

Das am besten mit der IT des Trägers absprechen. Oft verwaltet sie das Kita-Netz und hat
schon einen passenden Server. Ist das zu aufwendig, ist ein kleiner gemieteter Server bei
einem deutschen Anbieter die Alternative. Die App läuft dort genauso.

## Datenschutz (DSGVO)

- Gespeichert werden nur die Namen, die Eltern selbst eintragen (z. B. „Familie Müller“,
  „Mia S.“), Gruppe, Personenzahl und eine freiwillige Bemerkung. Keine E-Mail-Adressen,
  keine Telefonnummern, keine Tracking- oder Analysedienste.
- Eltern sehen standardmäßig nur Zahlen, keine fremden Namen.
- Betrieb auf eigenem Server bzw. in Deutschland, Verbindung nur über **HTTPS**.
- Einsatz mit Kita-Leitung und **Träger** abstimmen; kurze Datenschutzinfo für Eltern
  bereitstellen (was wird gespeichert, wer sieht es, wann wird gelöscht).
- Alte Listen und Engpass-Tage regelmäßig in der Verwaltung löschen.

## Entwicklung

```bash
npm test     # automatische Tests
npm start    # startet die App auf http://localhost:3000
```

## Ideen für die nächsten Ausbaustufen

1. **Benachrichtigungen** bei neuen Listen oder Engpass-Tagen (Web-Push oder E-Mail).
2. **Priorisierung** in der Notbetreuung (z. B. „beide Eltern berufstätig“) statt
   „wer zuerst kommt“.
3. **Plätze pro Gruppe** in der Notbetreuung.
4. **Automatisches Löschen** alter Listen nach X Wochen.
5. Als **App installierbar** machen (PWA: „Zum Startbildschirm hinzufügen“).
