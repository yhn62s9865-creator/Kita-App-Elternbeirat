# Kita-App auf dem Raspberry Pi – mit der Synology DS218j als Tor ins Internet

Die DS218j kann kein Docker, deshalb läuft die App auf einem **Raspberry Pi**. Die NAS
übernimmt, was sie gut kann: Internetadresse, Verschlüsselung (HTTPS) und Weiterleitung.

```
Handy ──HTTPS──▶ Router ──Port 443──▶ DS218j (Reverse Proxy) ──▶ Raspberry Pi (Kita-App, Port 3000)
```

**Du brauchst:** Raspberry Pi 3, 4 oder 5 (auch Zero 2 W geht), passendes Netzteil,
microSD-Karte ab 16 GB, möglichst ein **LAN-Kabel** zum Router (stabiler als WLAN),
einen Windows- oder Mac-Computer.

Zeitbedarf: etwa 1 bis 1,5 Stunden.

---

## Teil A: Raspberry Pi vorbereiten

### 1. Betriebssystem auf die SD-Karte schreiben

1. Am Computer den **Raspberry Pi Imager** installieren: https://www.raspberrypi.com/software/
2. Imager starten:
   - **Raspberry-Pi-Modell** auswählen
   - **Betriebssystem:** *Raspberry Pi OS (other)* → **Raspberry Pi OS Lite (64-bit)**
     (ohne Desktop, braucht weniger Leistung)
   - **SD-Karte** auswählen → *Weiter*
3. Auf die Frage „Einstellungen anpassen?“ → **Einstellungen bearbeiten**:
   - Hostname: `kita-app`
   - Benutzername und Passwort festlegen, z. B. Benutzer `beirat` (Passwort gut merken!)
   - WLAN nur eintragen, wenn du kein LAN-Kabel verwendest
   - Zeitzone `Europe/Berlin`, Tastatur `de`
   - Reiter **Dienste:** **SSH aktivieren** (mit Passwort)
4. *Speichern* → *Ja* → schreiben lassen.

### 2. Pi anschließen

SD-Karte in den Pi, LAN-Kabel zum Router, zuletzt den Strom anschließen. Etwa **2 Minuten warten**.

### 3. Feste Adressen im Router

Damit sich die Adressen von Pi und NAS nie ändern (**FRITZ!Box:** *Heimnetz → Netzwerk →
Netzwerkverbindungen* → beim Gerät auf den Stift klicken):

- beim **kita-app** (Pi): Haken bei **„Diesem Netzwerkgerät immer die gleiche IPv4-Adresse zuweisen“**
- bei der **NAS**: ebenso

Notiere dir beide Adressen:

| Gerät | IP-Adresse (Beispiel) | deine |
|---|---|---|
| Raspberry Pi | `192.168.178.30` | ………… |
| DS218j | `192.168.178.20` | ………… |

---

## Teil B: App auf den Pi bringen und installieren

### 4. App herunterladen

Wie beim Testen: Auf GitHub den Branch `claude/kita-app-parent-signup-3jlavy` wählen →
**Code → Download ZIP** → entpacken. Den entpackten Ordner in **`kita-app`** umbenennen.

### 5. Auf den Pi kopieren

Am Computer ein Terminal öffnen, und zwar dort, wo der Ordner `kita-app` liegt:
- **Windows:** Im Explorer den Ordner *öffnen, in dem* `kita-app` liegt (z. B. Downloads) →
  Rechtsklick auf eine leere Stelle → **„Im Terminal öffnen“**
- **Mac:** Terminal öffnen, `cd ` tippen und den Ordner *mit* `kita-app` hineinziehen, Enter

Dann eingeben (`beirat` durch deinen Benutzernamen ersetzen):

```
scp -r kita-app beirat@kita-app.local:
```

Bei der ersten Verbindung mit `yes` bestätigen, dann das Pi-Passwort eingeben.
Beim Tippen des Passworts erscheinen keine Zeichen, das ist normal.

> Klappt `kita-app.local` nicht, nimm stattdessen die IP-Adresse des Pi, z. B.
> `scp -r kita-app beirat@192.168.178.30:`

### 6. Installieren

Mit dem Pi verbinden:

```
ssh beirat@kita-app.local
```

Dann auf dem Pi:

```
cd kita-app
sudo bash deploy/raspberry-pi/install.sh
```

Das Skript installiert alles Nötige und fragt nach:
- **Kita-Code** (für alle Eltern, mind. 6 Zeichen), z. B. `sonnenschein24`
- **Admin-Code** (nur für dich bzw. die Leitung, mind. 12 Zeichen), z. B. `Elternbeirat-Pilot-7391`
- **IP-Adresse der NAS**, z. B. `192.168.178.20`

Am Ende steht **„✅ Fertig! Die Kita-App läuft.“** Die App startet ab jetzt automatisch,
auch nach einem Stromausfall.

### 7. Im Heimnetz testen

Am Computer oder Handy im WLAN: `http://kita-app.local:3000` (oder `http://192.168.178.30:3000`)
und `…:3000/admin`.

---

## Teil C: Die DS218j als Tor ins Internet

### 8. Vorab: Hat dein Anschluss eine eigene IPv4-Adresse?

**FRITZ!Box:** *Internet → Online-Monitor*. Steht dort „DS-Lite“, klappt der Zugang von
außen so nicht. Siehe „Wenn DS-Lite“ in der [NAS-Anleitung](NAS-Anleitung.md#wenn-ds-lite-oder-keine-portfreigabe-möglich-ist).
Am einfachsten ist dann meist, beim Anbieter eine öffentliche IPv4-Adresse anzufragen.

### 9. Internetadresse und Zertifikat (auf der NAS)

1. DSM → **Systemsteuerung → Externer Zugriff → DDNS → Hinzufügen**
2. Dienstanbieter **Synology**, Hostname z. B. `meinekita` → `meinekita.synology.me`
3. Haken **„Zertifikat von Let's Encrypt erhalten“** setzen → OK

### 10. Router: Ports zur **NAS** freigeben (nicht zum Pi!)

**FRITZ!Box:** *Internet → Freigaben → Portfreigaben → Gerät für Freigaben hinzufügen* → **NAS**:

| Port | Wofür |
|---|---|
| **443** (TCP) | die App (HTTPS) |
| **80** (TCP) | Erneuerung des Let's-Encrypt-Zertifikats |

> ⚠️ **Nur diese beiden.** Niemals 5000/5001 (NAS-Anmeldung) oder 3000 (die App ohne
> Verschlüsselung) freigeben. Der Pi selbst bekommt **keine** Freigabe.

### 11. Reverse Proxy: Weiterleitung von der NAS zum Pi

1. DSM → **Systemsteuerung → Anmeldeportal → Erweitert → Reverse Proxy → Erstellen**
2. Ausfüllen:

   | | Protokoll | Hostname | Port |
   |---|---|---|---|
   | **Quelle** | HTTPS | `meinekita.synology.me` | 443 |
   | **Ziel** | HTTP | **IP des Pi**, z. B. `192.168.178.30` | 3000 |

3. Reiter **„Benutzerdefinierte Kopfzeile“** → *Erstellen*:

   | Kopfzeilenname | Wert |
   |---|---|
   | `X-Forwarded-For` | `$proxy_add_x_forwarded_for` |

   Damit erkennt die App, welches Handy eine Anfrage schickt. Das braucht die Sperre gegen
   das Durchprobieren von Codes.
4. Speichern.
5. **Systemsteuerung → Sicherheit → Zertifikat → Einstellungen**: bei
   `meinekita.synology.me` das Let's-Encrypt-Zertifikat auswählen.

### 12. Von außen testen

Am Handy **WLAN aus** → `https://meinekita.synology.me` → Schloss-Symbol im Browser prüfen →
Kita-Code eingeben. Und `https://meinekita.synology.me/admin` mit dem Admin-Code.

🎉 Jetzt kannst du die Probeeltern einladen. Einen Einladungstext und Vorschläge für
Test-Listen findest du in der [NAS-Anleitung](NAS-Anleitung.md#probelauf-mit-freiwilligen).

---

## Teil D: Im Betrieb

| Was | Wie (am Pi, nach `ssh beirat@kita-app.local`) |
|---|---|
| Läuft die App? | `sudo systemctl status kita-app` |
| Protokoll ansehen | `sudo journalctl -u kita-app -f` (beenden mit `Strg + C`) |
| Codes oder NAS-Adresse ändern | `cd kita-app && sudo bash deploy/raspberry-pi/install.sh --neue-codes` |
| Pi-Updates (monatlich) | `sudo apt update && sudo apt full-upgrade -y` |
| Pi herunterfahren | `sudo poweroff` (erst dann den Stecker ziehen) |

### Neue Version der App einspielen

1. Neue ZIP herunterladen, entpacken, in `kita-app` umbenennen.
2. Wie in Schritt 5 kopieren: `scp -r kita-app beirat@kita-app.local:`
3. Am Pi: `cd kita-app && sudo bash deploy/raspberry-pi/install.sh`

Codes und Daten bleiben dabei erhalten.

### Datensicherung

- Der Pi sichert die Daten **jede Nacht automatisch** und hebt die letzten **30 Tage** auf:
  `sudo ls /var/lib/kita-app/backups`
- SD-Karten können kaputtgehen. Kopiere deshalb ab und zu eine Sicherung auf die NAS oder
  deinen Computer. Am Pi:
  ```
  sudo cp /var/lib/kita-app/data.json ~/kita-sicherung.json && sudo chown $USER ~/kita-sicherung.json
  ```
  und dann am Computer: `scp beirat@kita-app.local:kita-sicherung.json .`
- **Wiederherstellen:** Datei nach `/var/lib/kita-app/data.json` zurückkopieren, dann
  `sudo chown kita-app:kita-app /var/lib/kita-app/data.json && sudo systemctl restart kita-app`

---

## Häufige Probleme

**`kita-app.local` wird nicht gefunden**
→ Stattdessen die IP-Adresse des Pi verwenden (Schritt 3).

**„502 Bad Gateway“ von außen**
→ Die NAS erreicht den Pi nicht. Ist der Pi an? Läuft die App (`sudo systemctl status kita-app`)?
Stimmt die Ziel-IP im Reverse Proxy?

**Das Installationsskript meldet „Paketquellen nicht erreichbar“**
→ Der Pi hat kein Internet. LAN-Kabel bzw. WLAN-Einstellungen prüfen.

**„Zu viele falsche Versuche“, obwohl der Code stimmt**
→ Nach 10 falschen Eingaben ist ein Gerät 15 Minuten gesperrt. Sind *alle* Eltern
gleichzeitig gesperrt, fehlt die Kopfzeile aus Schritt 11, oder beim Installieren wurde eine
falsche NAS-Adresse eingetragen (ändern mit `--neue-codes`).
