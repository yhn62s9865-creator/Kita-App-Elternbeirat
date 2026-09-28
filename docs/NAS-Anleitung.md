# Kita-App auf der eigenen NAS – von überall erreichbar

> **Hast du eine NAS ohne Docker (z. B. Synology DS218j oder andere „j“-Modelle)?**
> Dann nimm die [Anleitung mit Raspberry Pi](Raspberry-Pi-Anleitung.md): Die App läuft auf
> dem Pi, die NAS übernimmt Adresse und Verschlüsselung.

Diese Anleitung ist für eine **Synology-NAS mit DSM 7.2 und Container Manager** geschrieben
(z. B. „plus“-Modelle). Bei anderen Geräten
(QNAP, UGREEN, Unraid …) funktioniert es nach dem gleichen Prinzip, nur die Menüs heißen
anders. Je nach DSM-Version können einzelne Menüpunkte leicht abweichen.

**So funktioniert es:**

```
Handy der Eltern ──HTTPS──▶ Router ──▶ NAS: Reverse Proxy ──▶ Kita-App (Docker)
  https://meinekita.synology.me      Port 443      (Verschlüsselung)     Port 3000, nur intern
```

Zeitbedarf: ungefähr eine Stunde.

---

## Schritt 0: Vorab prüfen – hat dein Anschluss eine eigene IPv4-Adresse?

Von außen erreichbar ist die NAS nur, wenn dein Internetanschluss eine **öffentliche
IPv4-Adresse** hat. Viele Kabel- und Glasfaseranschlüsse haben nur „**DS-Lite**“, und damit
funktioniert eine Portfreigabe nicht.

- **FRITZ!Box:** *Internet → Online-Monitor*. Steht dort „DS-Lite“ oder nur eine
  IPv6-Adresse, siehe [Wenn DS-Lite](#wenn-ds-lite-oder-keine-portfreigabe-möglich-ist) unten.
- Steht dort eine normale IPv4-Adresse (z. B. `87.123.45.67`): alles gut, weiter mit Schritt 1.

## Schritt 1: Zugangscodes festlegen

Überlege dir zwei Codes:

| Code | Für wen | Mindestens | Beispiel |
|---|---|---|---|
| `KITA_CODE` | alle Probeeltern | 6 Zeichen | `sonnenschein24` |
| `ADMIN_CODE` | nur du bzw. die Kita-Leitung | 12 Zeichen | `Elternbeirat-Pilot-7391` |

Öffne die Datei `docker-compose.yml` in einem Texteditor und trage beide Codes ein.
Solange dort noch die Beispielwerte stehen, **startet die App absichtlich nicht**.
So kann sie nicht versehentlich ungeschützt im Internet stehen.

## Schritt 2: Dateien auf die NAS kopieren

1. In DSM die **File Station** öffnen.
2. Im Ordner `docker` einen neuen Ordner `kita-app` anlegen. Gibt es den Ordner `docker`
   noch nicht, installiert der Container Manager ihn im nächsten Schritt.
3. Den **gesamten Inhalt** des App-Ordners dort hochladen: `server.js`, `xlsx.js`,
   `package.json`, `Dockerfile`, `docker-compose.yml` und den Ordner `public`.

## Schritt 3: App im Container Manager starten

1. **Paket-Zentrum → Container Manager** installieren, falls noch nicht vorhanden.
2. Container Manager öffnen → **Projekt → Erstellen**.
3. Projektname: `kita-app`. Pfad: den Ordner `docker/kita-app` wählen.
4. Quelle: **„Vorhandene docker-compose.yml verwenden“** → Weiter → Fertig.
   Die App wird jetzt gebaut und gestartet. Das dauert beim ersten Mal ein paar Minuten.
5. Prüfen: *Container → kita-app → Protokoll*. Dort muss stehen:
   `Kita-App läuft auf http://localhost:3000`.
   Steht dort „Die App startet nicht, weil die Zugangscodes unsicher sind“, dann Schritt 1
   wiederholen und das Projekt neu erstellen.

## Schritt 4: Eine Adresse im Internet (DDNS)

1. **Systemsteuerung → Externer Zugriff → DDNS → Hinzufügen**.
2. Dienstanbieter: **Synology**. Hostname frei wählen, z. B. `meinekita` →
   ergibt `meinekita.synology.me`.
3. Den Haken **„Zertifikat von Let's Encrypt erhalten“** setzen. Das ist die Verschlüsselung
   (HTTPS), kostenlos.
4. OK.

> Den Namen `meinekita` in dieser Anleitung durch deinen eigenen ersetzen.

## Schritt 5: Router – Ports freigeben

Im Router die NAS für diese beiden Ports freigeben (**FRITZ!Box:** *Internet → Freigaben →
Portfreigaben → Gerät für Freigaben hinzufügen → NAS → Neue Freigabe*):

| Port | Wofür |
|---|---|
| **443** (TCP) | die App (HTTPS) |
| **80** (TCP) | nur für das automatische Erneuern des Let's-Encrypt-Zertifikats |

> ⚠️ **Nur diese beiden Ports freigeben.** Auf keinen Fall 5000/5001, denn das ist die
> Anmeldung zur NAS selbst. Sie sollte nicht aus dem Internet erreichbar sein.

## Schritt 6: Reverse Proxy – die App unter HTTPS erreichbar machen

1. **Systemsteuerung → Anmeldeportal → Erweitert → Reverse Proxy → Erstellen**.
2. Ausfüllen:

   | | Protokoll | Hostname | Port |
   |---|---|---|---|
   | **Quelle** | HTTPS | `meinekita.synology.me` | 443 |
   | **Ziel** | HTTP | `localhost` | 3000 |

3. Reiter **„Benutzerdefinierte Kopfzeile“** → *Erstellen*, dann diesen Eintrag:

   | Kopfzeilenname | Wert |
   |---|---|
   | `X-Forwarded-For` | `$proxy_add_x_forwarded_for` |

   Damit erkennt die App, von welchem Gerät eine Anfrage kommt. Das braucht die Sperre gegen
   das Durchprobieren von Codes.
4. Speichern.
5. **Systemsteuerung → Sicherheit → Zertifikat → Einstellungen**: Beim Eintrag
   `meinekita.synology.me` das Let's-Encrypt-Zertifikat auswählen.

## Schritt 7: Testen

1. Am Handy das **WLAN ausschalten**, damit du wirklich „von außen“ testest.
2. `https://meinekita.synology.me` öffnen → Kita-Code eingeben.
3. `https://meinekita.synology.me/admin` → Admin-Code eingeben.
4. Im Browser muss das **Schloss-Symbol** zu sehen sein.

Klappt es nicht? Siehe [Häufige Probleme](#häufige-probleme).

## Schritt 8: Datensicherung

Alle Daten stecken in **einer Datei**: `docker/kita-app/daten/data.json`.
Am einfachsten mit **Hyper Backup** den Ordner `docker/kita-app/daten` regelmäßig sichern,
z. B. täglich auf eine USB-Festplatte.

## Neue Version einspielen

1. Die geänderten Dateien in `docker/kita-app` überschreiben. Den Ordner `daten` und deine
   `docker-compose.yml` mit den Codes **nicht** überschreiben.
2. Container Manager → **Projekt → kita-app → Aktion → Erstellen** (baut neu und startet).

---

## Probelauf mit Freiwilligen

### Datenschutz im Probelauf

- Die Probeeltern wissen, dass es ein **Test** ist, und machen freiwillig mit.
- Für den Test reichen **Vornamen oder Fantasienamen**.
- Nach dem Probelauf die Test-Listen in der Verwaltung **löschen**.
- Für den echten Betrieb später: Abstimmung mit Kita-Leitung und Träger (siehe README).

### Einladung zum Weiterleiten (Vorlage)

> Hallo zusammen,
>
> danke, dass ihr beim Test unserer Kita-App mitmacht! 🙌 Die App soll später Anmeldelisten
> (Elternabend, Feste, Helfer) und die Notbetreuung bei Personalengpässen einfacher machen.
>
> **So geht's:**
> 1. Diesen Link am Handy öffnen: **https://meinekita.synology.me**
> 2. Kita-Code eingeben: **sonnenschein24**
> 3. Tipp: Über „Zum Startbildschirm hinzufügen“ habt ihr die App wie ein normales App-Symbol.
>
> **Bitte einmal ausprobieren:**
> - Oben unter „Meine Angaben“ euren Namen eintragen (Vorname oder Fantasiename reicht)
> - Bei der Test-Helferliste für eine Aufgabe eintragen, danach wieder austragen
> - Zum Test-Elternabend anmelden
> - Unter „Notbetreuung“ für den Test-Tag „Brauche Betreuung“ oder „Kind bleibt zuhause“ wählen
>
> **Eure Rückmeldung bis [Datum]:**
> - Hat alles geklappt? Wo seid ihr hängen geblieben?
> - War etwas unklar oder umständlich?
> - Was fehlt euch?
>
> Es ist nur ein Test, alle Einträge werden danach gelöscht.
> Danke! [Dein Name], Elternbeirat

### Vorher in der Verwaltung anlegen

- eine **Helferliste**, z. B. „Test: Laternenfest“ mit `Punsch | 2`, `Kuchen | 4`, `Aufbau | 3`,
  „Namen zeigen“ an
- eine **Anmeldung**, z. B. „Test: Elternabend“ mit 20 Plätzen
- einen **Engpass-Tag** mit wenigen Plätzen (z. B. 3), damit man die Warteliste sieht.
  Den Anmeldeschluss leer lassen oder in die Zukunft legen.

---

## Häufige Probleme

**Die Seite lädt von außen nicht, im WLAN aber schon**
→ Portfreigabe 443 im Router prüfen (Schritt 5), Anschlussart prüfen (Schritt 0).

**Der Browser warnt „Verbindung nicht sicher“**
→ Das Zertifikat ist nicht zugewiesen (Schritt 6, Punkt 5), oder Port 80 ist nicht
freigegeben, dann kann Let's Encrypt das Zertifikat nicht ausstellen.

**„502 Bad Gateway“**
→ Die App läuft nicht. Container Manager → Container → kita-app → Protokoll ansehen.

**„Zu viele falsche Versuche“, obwohl der Code stimmt**
→ Nach 10 falschen Eingaben ist ein Gerät 15 Minuten gesperrt. Einfach warten.
Sind *alle* Eltern gleichzeitig gesperrt, fehlen die Kopfzeilen aus Schritt 6, Punkt 3.

### Wenn DS-Lite oder keine Portfreigabe möglich ist

1. **Beim Anbieter eine öffentliche IPv4-Adresse anfragen.** Viele Anbieter stellen auf
   Nachfrage um, manchmal gegen einen kleinen Aufpreis. Danach funktioniert die Anleitung
   wie beschrieben.
2. **Tunnel-Dienst** (z. B. Cloudflare Tunnel): Die NAS baut selbst eine Verbindung nach
   außen auf, Portfreigaben sind nicht nötig. Nachteil: Der Datenverkehr läuft über einen
   US-Anbieter. Für einen Probelauf mit Fantasienamen vertretbar, für den echten Betrieb mit
   dem Träger abstimmen.
3. **Kleiner Mietserver** bei einem deutschen Anbieter (einige Euro im Monat). Die App läuft
   dort mit derselben `docker-compose.yml`.
