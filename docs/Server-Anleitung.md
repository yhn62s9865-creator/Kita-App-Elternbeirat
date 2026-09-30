# Kita-App auf einem gemieteten Server in Deutschland

Der einfachste Weg, die App **von überall erreichbar** zu machen: Sie läuft auf einem kleinen
gemieteten Server in einem deutschen Rechenzentrum. Dein Heimnetz, Router oder
Internetanschluss spielen dabei keine Rolle.

```
Handy der Eltern ──HTTPS──▶ dein Server in Deutschland (Verschlüsselung + Kita-App)
      https://eltern.deine-domain.de
```

Ein Installationsskript richtet alles ein: die App, die **Verschlüsselung (HTTPS)** mit
automatisch erneuertem Zertifikat, eine **Firewall**, **automatische Sicherheitsupdates**
und eine **tägliche Datensicherung**.

**Du brauchst:**
- einen kleinen Server (VPS): **ca. 4 bis 6 € im Monat**
- eine Domain (Internetadresse): **ca. 1 bis 15 € im Jahr**
- deinen Computer (Windows oder Mac)

Zeitbedarf: etwa eine Stunde. Die genannten Preise und Menüpunkte sind Richtwerte und
können sich bei den Anbietern ändern.

---

## Schritt 1: Anbieter wählen

Gut geeignet sind zum Beispiel **Hetzner** (Rechenzentren in Nürnberg und Falkenstein),
**netcup**, **IONOS** oder **Strato**. Alle haben Rechenzentren in Deutschland.

Diese Anleitung nimmt **Hetzner Cloud** als Beispiel, denn:
- Abrechnung **stundengenau**: Nach dem Probelauf löschst du den Server, und die Kosten enden.
- einfache Oberfläche, Server in einer Minute bereit
- den **Vertrag zur Auftragsverarbeitung (AVV)** für den Datenschutz schließt man online im
  Kundenkonto ab

## Schritt 2: Domain besorgen

Die Eltern rufen die App über eine Adresse wie `https://eltern.kita-sonnenschein.de` auf.

- **Hat die Kita schon eine Website?** Dann den Träger oder Webmaster fragen, ob du eine
  **Subdomain** wie `eltern.kita-sonnenschein.de` bekommen kannst. Das wirkt für Eltern am
  vertrauenswürdigsten.
- **Sonst:** eine eigene Domain registrieren, z. B. bei INWX, IONOS, Strato oder netcup.
  Eine `.de`-Domain kostet meist nur wenige Euro im Jahr.

## Schritt 3: Server bestellen (Beispiel Hetzner Cloud)

1. Auf **hetzner.com/cloud** ein Konto anlegen und in der **Cloud Console** ein Projekt
   „Kita-App“ erstellen.
2. **Server hinzufügen:**
   - **Standort:** Nürnberg oder Falkenstein (Deutschland)
   - **Image:** **Debian 12** (oder Ubuntu 24.04)
   - **Typ:** der **kleinste** Typ reicht völlig aus
   - **Netzwerk:** **Öffentliche IPv4 eingeschaltet lassen**. Viele Eltern kommen sonst nicht
     auf die Seite.
   - **SSH-Key:** kannst du weglassen. Dann bekommst du das root-Passwort per E-Mail.
   - **Name:** `kita-app`
3. **Erstellen & kaufen.** Nach etwa einer Minute steht die **IP-Adresse** des Servers in der
   Übersicht, z. B. `49.12.34.56`. Notiere sie dir.
4. Im Kundenkonto den **AVV** (Auftragsverarbeitungsvertrag) abschließen.

## Schritt 4: Domain auf den Server zeigen lassen

Beim Domain-Anbieter in der **DNS-Verwaltung** einen neuen Eintrag anlegen:

| Typ | Name | Wert |
|---|---|---|
| **A** | `eltern` | die IP des Servers, z. B. `49.12.34.56` |

(Für die Domain ohne Vorsilbe steht bei „Name“ meist `@`.)

Es dauert **10 bis 30 Minuten**, bis der Eintrag überall bekannt ist. Prüfen kannst du es
im Terminal (siehe Schritt 5) mit `ping eltern.deine-domain.de`. Dort muss die IP des
Servers erscheinen.

## Schritt 5: Erstmals mit dem Server verbinden

Am Computer ein Terminal öffnen:
- **Windows:** Start-Menü → „Terminal“ (oder „PowerShell“)
- **Mac:** Programm „Terminal“

Eingeben (IP durch deine ersetzen):

```
ssh root@49.12.34.56
```

- Die Frage nach dem „fingerprint“ mit `yes` beantworten.
- Das Passwort aus der E-Mail eingeben. Beim Tippen erscheinen keine Zeichen, das ist normal.
- Oft musst du beim ersten Mal **ein neues Passwort festlegen**. Gut merken!

Mit `exit` die Verbindung wieder beenden.

## Schritt 6: App hochladen

1. Wie beim Testen: Auf GitHub den Branch `claude/kita-app-parent-signup-3jlavy` wählen →
   **Code → Download ZIP** → entpacken → den Ordner in **`kita-app`** umbenennen.
2. Im Terminal in den Ordner wechseln, *in dem* `kita-app` liegt, z. B. Downloads:
   - **Windows:** Im Explorer diesen Ordner öffnen → Rechtsklick auf eine leere Stelle →
     **„Im Terminal öffnen“**
   - **Mac:** `cd ` tippen, den Ordner ins Terminal ziehen, Enter
3. Hochladen:
   ```
   scp -r kita-app root@49.12.34.56:
   ```

## Schritt 7: Installieren

```
ssh root@49.12.34.56
cd kita-app
bash deploy/server/install.sh
```

Das Skript fragt nach:
- der **Domain**, z. B. `eltern.kita-sonnenschein.de`
- dem **Kita-Code** (für alle Eltern, mind. 6 Zeichen)
- dem **Admin-Code** (nur für dich bzw. die Leitung, mind. 12 Zeichen)

Nach ein bis zwei Minuten erscheint **„✅ Fertig! Die Kita-App ist online.“**

## Schritt 8: Testen

Am Handy (WLAN oder mobile Daten, beides geht jetzt):
- `https://eltern.deine-domain.de` → Kita-Code eingeben
- `https://eltern.deine-domain.de/admin` → Admin-Code eingeben

Im Browser muss das **Schloss-Symbol** erscheinen. 🎉

Für den Probelauf: Einladungstext und Vorschläge für Test-Listen findest du in der
[NAS-Anleitung](NAS-Anleitung.md#probelauf-mit-freiwilligen). Dort einfach die Adresse
durch deine ersetzen.

---

## Im Betrieb

Alle Befehle nach `ssh root@<IP>`:

| Was | Befehl |
|---|---|
| Läuft die App? | `systemctl status kita-app` |
| Protokoll ansehen | `journalctl -u kita-app -f` (beenden mit `Strg + C`) |
| Codes ändern | `cd kita-app && bash deploy/server/install.sh --neue-codes` |
| Datensicherungen ansehen | `ls /var/lib/kita-app/backups` |

**Sicherheitsupdates** installiert der Server automatisch.

### Neue Version der App einspielen

1. Neue ZIP herunterladen, entpacken, in `kita-app` umbenennen.
2. Hochladen: `scp -r kita-app root@<IP>:`
3. `ssh root@<IP>`, dann `cd kita-app && bash deploy/server/install.sh`

Codes, Daten und Domain bleiben erhalten.

### Weitere Apps auf demselben Server

Der Server kann neben der Kita-App weitere Apps beherbergen, z. B. die **Soulfood Chor-App**. Jede App hat
einen eigenen, markierten Abschnitt in der HTTPS-Konfiguration (`/etc/caddy/Caddyfile`); das Skript der
Kita-App ersetzt nur seinen eigenen Abschnitt (`# >>> kita-app` … `# <<< kita-app`), die anderen Apps bleiben
bei einem Update erreichbar.

### Datensicherung

- Der Server sichert die Daten **jede Nacht** und hebt **30 Tage** auf.
- Zusätzlich ab und zu eine Kopie auf deinen Computer holen (im Terminal am Computer):
  ```
  scp root@<IP>:/var/lib/kita-app/data.json kita-sicherung.json
  ```
- Bei Hetzner kann man zusätzlich automatische **Backups** des ganzen Servers dazubuchen
  (kleiner Aufpreis).

### Nach dem Probelauf

- **Weitermachen:** alles so lassen, die Kosten laufen monatlich weiter.
- **Beenden:** Zuerst die Daten sichern (siehe oben), dann in der Cloud Console den
  **Server löschen**. Die Kosten enden damit. ⚠️ Alle Daten auf dem Server sind dann weg.

---

## Datenschutz

- Server in **Deutschland**, **AVV** mit dem Anbieter abgeschlossen (Schritt 3).
- Verbindung nur verschlüsselt (HTTPS). Die App ist nur über die Verschlüsselung
  erreichbar, alle anderen Zugänge außer SSH sperrt die Firewall.
- Für den **Probelauf** reichen Vornamen oder Fantasienamen. Die Probeeltern wissen, dass
  es ein Test ist.
- Vor dem **Dauerbetrieb** mit Kita-Leitung und Träger abstimmen (siehe README).

---

## Häufige Probleme

**„Die Domain … ist (noch) nicht eingerichtet“ oder „zeigt auf …“**
→ Der A-Eintrag aus Schritt 4 fehlt, ist falsch oder noch nicht überall bekannt. Eintrag
prüfen, 30 Minuten warten, dann das Skript erneut starten.

**„HTTPS antwortet noch nicht“**
→ Oft braucht das Zertifikat nur ein paar Minuten. Sonst `journalctl -u caddy -n 30 --no-pager`
ansehen und mir die Meldung schicken.

**`ssh`: „Permission denied“**
→ Falsches Passwort. In der Cloud Console kann man das root-Passwort zurücksetzen.

**„Zu viele falsche Versuche“**
→ Nach 10 falschen Code-Eingaben ist ein Gerät 15 Minuten gesperrt. Einfach warten.
