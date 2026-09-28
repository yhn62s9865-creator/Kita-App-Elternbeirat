#!/usr/bin/env bash
# Installiert oder aktualisiert die Kita-App auf einem Raspberry Pi (Raspberry Pi OS / Debian).
#
# Aufruf im App-Ordner:
#   sudo bash deploy/raspberry-pi/install.sh               # Erstinstallation bzw. Update
#   sudo bash deploy/raspberry-pi/install.sh --neue-codes  # Codes / NAS-Adresse ändern
#
# Bei einem Update bleiben Codes und Daten erhalten.
set -euo pipefail

APP_DIR=/opt/kita-app
DATA_DIR=/var/lib/kita-app
ENV_FILE=/etc/kita-app.env
SERVICE=kita-app
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mFehler: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Bitte mit sudo starten:  sudo bash deploy/raspberry-pi/install.sh"
[ -f "$SRC_DIR/server.js" ] || fail "server.js nicht gefunden. Bitte das Skript aus dem App-Ordner heraus starten."
[ "$(uname -m)" != armv6l ] || fail "Dieses Modell (Raspberry Pi 1 / Zero der 1. Generation) ist zu alt. Bitte Pi 3, 4, 5 oder Zero 2 W verwenden."

# ---------- 1. Node.js ----------
node_major() { if command -v node >/dev/null; then node -p 'process.versions.node.split(".")[0]'; else echo 0; fi; }

if [ "$(node_major)" -lt 20 ]; then
  say "Installiere Node.js (dauert ein paar Minuten) …"
  apt-get update -q || fail "Paketquellen nicht erreichbar. Hat der Pi Internet? (Test: ping -c1 deb.debian.org)"
  apt-get install -y -q ca-certificates curl || fail "Konnte curl nicht installieren."
  if curl -fsSL https://deb.nodesource.com/setup_22.x | bash -; then
    apt-get install -y -q nodejs
  fi
  # Rückfall: Node.js aus Raspberry Pi OS (reicht ab Version 18)
  [ "$(node_major)" -ge 18 ] || apt-get install -y -q nodejs
fi
[ "$(node_major)" -ge 18 ] || fail "Node.js konnte nicht installiert werden. Bitte die Internetverbindung des Pi prüfen."
NODE_BIN="$(command -v node)"
echo "Node.js $(node -v) ist bereit."

# ---------- 2. Benutzer und Dateien ----------
say "Kopiere die App nach $APP_DIR …"
id kita-app >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin kita-app
mkdir -p "$APP_DIR" "$DATA_DIR/backups"
rm -rf "$APP_DIR/public"
cp "$SRC_DIR/server.js" "$SRC_DIR/xlsx.js" "$SRC_DIR/package.json" "$APP_DIR/"
cp -r "$SRC_DIR/public" "$APP_DIR/"
chown -R root:root "$APP_DIR"
chown -R kita-app:kita-app "$DATA_DIR"
chmod 750 "$DATA_DIR" "$DATA_DIR/backups"

# ---------- 3. Zugangscodes ----------
code_problems() {
  KITA_CODE="$1" ADMIN_CODE="$2" "$NODE_BIN" -e '
    const { codeProblems } = require(process.argv[1]);
    const p = codeProblems(process.env.KITA_CODE, process.env.ADMIN_CODE);
    for (const c of [process.env.KITA_CODE, process.env.ADMIN_CODE]) {
      if (/[\s"'"'"'\\]/.test(c)) p.push("Bitte keine Leerzeichen, Anführungszeichen oder \\ in den Codes verwenden.");
    }
    console.log([...new Set(p)].join("\n"));
  ' "$APP_DIR/server.js"
}

if [ ! -f "$ENV_FILE" ] || [ "${1:-}" = "--neue-codes" ]; then
  say "Zugangscodes festlegen"
  echo "Kita-Code:  für alle Eltern, mindestens 6 Zeichen (z. B. sonnenschein24)"
  echo "Admin-Code: nur für Kita-Leitung/Elternbeirat, mindestens 12 Zeichen"
  # Für eine Installation ohne Rückfragen können KITA_CODE, ADMIN_CODE und NAS_IP vorab gesetzt werden
  kita="${KITA_CODE:-}"; admin="${ADMIN_CODE:-}"; nas="${NAS_IP-unset}"
  while true; do
    [ -n "$kita" ] || read -r -p "Kita-Code: " kita
    [ -n "$admin" ] || read -r -p "Admin-Code: " admin
    problems="$(code_problems "$kita" "$admin")"
    [ -z "$problems" ] && break
    printf '\033[31m%s\033[0m\n' "$problems"
    [ -z "${KITA_CODE:-}" ] || fail "Die vorgegebenen Codes sind unsicher."
    kita=""; admin=""
  done

  if [ "$nas" = unset ]; then
    echo
    echo "IP-Adresse der Synology-NAS (sie leitet die Anfragen aus dem Internet weiter),"
    echo "z. B. 192.168.178.20. Leer lassen, wenn du erst einmal nur im Heimnetz testen willst."
    read -r -p "IP-Adresse der NAS: " nas
  fi
  if [ -n "$nas" ] && ! [[ "$nas" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
    fail "\"$nas\" ist keine gültige IP-Adresse (Beispiel: 192.168.178.20)."
  fi

  umask 077
  cat > "$ENV_FILE" <<EOF
# Einstellungen der Kita-App – ändern mit:  sudo bash deploy/raspberry-pi/install.sh --neue-codes
NODE_ENV=production
PORT=3000
DATA_FILE=$DATA_DIR/data.json
TZ=Europe/Berlin
KITA_CODE=$kita
ADMIN_CODE=$admin
TRUST_PROXY=$nas
EOF
  chmod 600 "$ENV_FILE"
else
  echo "Vorhandene Codes aus $ENV_FILE werden weiter verwendet."
fi

# ---------- 4. Dienst (startet automatisch, auch nach Stromausfall) ----------
say "Richte den Dienst ein …"
cat > /etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=Kita-App (Termine, Helferlisten, Notbetreuung)
After=network-online.target
Wants=network-online.target

[Service]
User=kita-app
Group=kita-app
EnvironmentFile=$ENV_FILE
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN $APP_DIR/server.js
Restart=on-failure
RestartSec=5
# Die App darf nur in ihren Datenordner schreiben
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ReadWritePaths=$DATA_DIR
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
EOF

# ---------- 5. Tägliche Datensicherung (30 Tage) ----------
if [ -d /etc/cron.daily ]; then
  cat > /etc/cron.daily/kita-app-backup <<EOF
#!/bin/sh
# Tägliche Sicherung der Kita-App-Daten, die letzten 30 Tage bleiben erhalten
[ -f $DATA_DIR/data.json ] || exit 0
cp $DATA_DIR/data.json "$DATA_DIR/backups/data-\$(date +%F).json"
find $DATA_DIR/backups -name 'data-*.json' -mtime +30 -delete
EOF
  chmod 755 /etc/cron.daily/kita-app-backup
fi

systemctl daemon-reload
systemctl enable $SERVICE >/dev/null 2>&1
systemctl restart $SERVICE

# ---------- 6. Prüfen ----------
say "Prüfe, ob die App läuft …"
ok=""
for _ in $(seq 1 15); do
  if curl -fsS -o /dev/null http://127.0.0.1:3000/ 2>/dev/null; then ok=1; break; fi
  sleep 1
done
if [ -z "$ok" ]; then
  journalctl -u $SERVICE -n 20 --no-pager || true
  fail "Die App ist nicht gestartet. Die Meldungen oben zeigen den Grund."
fi

ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
say "✅ Fertig! Die Kita-App läuft."
echo "Im Heimnetz testen:   http://${ip:-<IP-des-Pi>}:3000   und   http://${ip:-<IP-des-Pi>}:3000/admin"
echo "Diese Adresse (${ip:-IP des Pi}, Port 3000) als Ziel im Reverse Proxy der NAS eintragen."
echo
echo "Nützliche Befehle:"
echo "  Protokoll ansehen:  sudo journalctl -u $SERVICE -f"
echo "  Neu starten:        sudo systemctl restart $SERVICE"
echo "  Datensicherungen:   sudo ls $DATA_DIR/backups"
