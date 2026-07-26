# Skald Deployment

## Orange Pi 4 LTS

### Prerequisites

```bash
cd /home/nook
git clone https://github.com/nookerok/skald.git
cd skald

source ~/.nvm/nvm.sh
nvm install 22.23.1
nvm use 22.23.1

npm ci
npm run typecheck
npm test

mkdir -p /home/nook/skald-data
chmod 700 /home/nook/skald-data
```

### Configuration

```bash
cp packages/cli/deploy/skald.env.example /home/nook/skald-data/skald.env
chmod 600 /home/nook/skald-data/skald.env
nano /home/nook/skald-data/skald.env
```

Add your API keys to `skald.env`:
```
SKALD_OPENCODE_ZEN_API_KEY=your_key_here
SKALD_OLLAMA_CLOUD_API_KEY=your_key_here
```

### Manual Start

```bash
npm run start:server
```

### systemd Service

```bash
sudo cp packages/cli/deploy/skald.service /etc/systemd/system/skald.service
sudo systemctl daemon-reload
sudo systemctl enable --now skald
sudo systemctl status skald
```

### Logs

```bash
journalctl -u skald -f
```

### Update

```bash
cd /home/nook/skald
git pull --ff-only origin main
npm ci
npm run typecheck
npm test
sudo systemctl restart skald
```

### Backup

```bash
sudo systemctl stop skald
cp /home/nook/skald-data/events.sqlite /home/nook/skald-data/events-backup.sqlite
sudo systemctl start skald
```

> **Important:** Do not copy only the main SQLite file during active WAL writing.
> For simple backup, stop the service first.

## Security Notes

- This server is designed for **trusted local networks only**.
- No TLS, no authentication, no authorization.
- For public access, deploy a reverse proxy with TLS and auth.
- Firewall: allow port 3000 only from LAN CIDR.
- Single server process per database.
