# Docker Setup Guide

## Local Development with Docker

### Prerequisites

- Docker Desktop installed (Mac/Windows) or Docker Engine + Docker Compose (Linux)
- Git repository cloned

### Step 1: Prepare Environment File

```bash
cp .env.docker .env
# Edit .env and fill in your API credentials
```

Minimum required credentials:

- `DELTA_API_KEY` & `DELTA_API_SECRET`
- `PI42_API_KEY` & `PI42_API_SECRET`
- Optional: Trading keys if you want Phase 3 order execution

### Step 2: Build and Run Locally

```bash
# Build Docker image
docker-compose build

# Start all services (app, Redis, MongoDB)
docker-compose up -d

# View logs
docker-compose logs -f app

# Check service health
docker-compose ps
```

**Expected output after ~30s:**

```
CONTAINER ID   STATUS              NAMES
abc123...      Up 1min (healthy)   funding-arbitrage-bot
def456...      Up 1min (healthy)   funding-arbitrage-redis
ghi789...      Up 1min (healthy)   funding-arbitrage-mongodb
```

### Step 3: Verify Bot is Running

```bash
# Check bot logs for "Phase 1-5" activity
docker-compose logs app | tail -50

# Test API endpoint (should return 200)
curl http://localhost:5002/api/health

# Access WebSocket dashboard (if running)
# Open browser: http://localhost:5003
```

### Step 4: Stop/Cleanup

```bash
# Stop all containers (data persists)
docker-compose down

# Stop and remove all volumes (clears data)
docker-compose down -v

# Remove unused images
docker image prune -a
```

---

## Production Deployment on EC2

### Prerequisites

- AWS EC2 instance (Ubuntu 22.04 LTS recommended)
- Inbound rules: Ports 5002, 5003 (restrict to your IP or VPN)
- 20GB+ storage (for logs, DB, cache)

### Quick Deploy Script

```bash
#!/bin/bash
set -e

echo "🚀 Starting Funding Arbitrage Bot Deployment..."

# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add current user to docker group (logout/login required)
sudo usermod -aG docker $USER
newgrp docker

# Clone repository
git clone https://github.com/your-repo/funding-arbitrage-bot.git
cd funding-arbitrage-bot

# Copy environment template
cp .env.docker .env

# Edit .env with your credentials
echo "⚠️  IMPORTANT: Edit .env file with your API credentials"
echo "nano .env"
# Wait for user to edit
read -p "Press ENTER after editing .env..."

# Start services
docker-compose up -d

# Wait for services to be ready
echo "⏳ Waiting for services to be healthy..."
sleep 15

# Show status
docker-compose ps

# Show bot logs
echo "📊 Bot logs (last 30 lines):"
docker-compose logs app | tail -30

echo "✅ Deployment complete!"
echo "📌 Bot API: http://localhost:5002"
echo "📌 WebSocket: http://localhost:5003"
echo "📌 View logs: docker-compose logs -f app"
```

### Manual EC2 Deployment Steps

#### 1. SSH into EC2

```bash
ssh -i your-key.pem ubuntu@your-ec2-ip
```

#### 2. Install Docker & Docker Compose

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo apt-get install -y docker-compose
sudo usermod -aG docker $USER
# Logout and log back in to apply group changes
```

#### 3. Clone and Setup

```bash
git clone https://github.com/your-repo/funding-arbitrage-bot.git
cd funding-arbitrage-bot
cp .env.docker .env
nano .env  # Edit with your credentials
```

#### 4. Start Bot

```bash
docker-compose up -d
```

#### 5. Verify Services

```bash
# Check all containers running
docker-compose ps

# View logs
docker-compose logs -f app

# Test API
curl http://localhost:5002/api/health
```

#### 6. EC2 Security Configuration

```bash
# Configure firewall (if using UFW)
sudo ufw allow 5002/tcp
sudo ufw allow 5003/tcp
sudo ufw enable

# Or via AWS Security Groups:
# - Allow port 5002 from: Your IP, VPN
# - Allow port 5003 from: Your IP, VPN
# - Deny all other inbound
```

#### 7. Auto-restart on Reboot

Docker Compose with `restart: unless-stopped` ensures bot recovers automatically:

```bash
# After EC2 reboot, check status
docker-compose ps

# View logs
docker-compose logs -f app
```

---

## Log Management

### Docker Logs Configuration

Logs are automatically rotated via `docker-compose.yml`:

- **App logs**: Max 100MB per file, keeps 3 files → ~300MB total
- **Redis logs**: Max 50MB per file, keeps 2 files
- **MongoDB logs**: Max 100MB per file, keeps 2 files

Old logs are automatically compressed and deleted when size limit is exceeded.

### View Logs

```bash
# Real-time logs
docker-compose logs -f app

# Last 100 lines
docker-compose logs app --tail 100

# Since last 5 minutes
docker-compose logs app --since 5m

# Specific service
docker-compose logs redis
docker-compose logs mongodb
```

### Manual Log Cleanup (if needed)

```bash
# Prune all Docker logs older than 24 hours
docker system prune --filter "until=24h" -f

# Remove specific container logs
docker logs --tail 0 funding-arbitrage-bot
```

---

## Monitoring & Troubleshooting

### Health Checks

```bash
# Check container health status
docker-compose ps

# Output should show "(healthy)" for all services after ~40s
```

### Common Issues

**Issue: "Connection refused" for Redis/MongoDB**

```bash
# Verify services are running
docker-compose ps

# Restart services
docker-compose restart redis mongodb

# Check logs
docker-compose logs redis
docker-compose logs mongodb
```

**Issue: API returns 401 Unauthorized**

- Check .env has correct DELTA_API_KEY, PI42_API_KEY
- Verify API keys haven't expired
- Check exchange IP whitelist settings

**Issue: Disk space warning**

```bash
# Check disk usage
df -h

# View Docker stats
docker system df

# Prune unused images/volumes
docker system prune -a --volumes
```

**Issue: Container keeps restarting**

```bash
# Check logs for errors
docker-compose logs app

# Verify .env file is readable
ls -la .env

# Check MongoDB/Redis connectivity
docker-compose logs mongo
docker-compose logs redis
```

### Accessing MongoDB Directly

```bash
# Connect to MongoDB shell inside container
docker-compose exec mongodb mongosh

# Inside mongosh:
use funding-arbitrage
db.opportunities.find().limit(5)
db.config.findOne()
exit
```

### Accessing Redis Directly

```bash
# Connect to Redis inside container
docker-compose exec redis redis-cli

# Commands:
KEYS *
GET funding:opportunities
FLUSHDB  # Clear all data
exit
```

---

## Backup & Data Persistence

### Default Volumes

- `redis-data`: Redis persistence file
- `mongodb-data`: MongoDB database files
- `mongodb-config`: MongoDB configuration

Data is stored in Docker named volumes (location varies by OS):

- **Mac**: `~/Library/Containers/com.docker.docker/Volumes/`
- **Linux**: `/var/lib/docker/volumes/`
- **Windows**: `C:\ProgramData\Docker\volumes\`

### Backup MongoDB

```bash
# Export all data
docker-compose exec mongodb mongodump --out /tmp/backup

# Copy backup to host
docker cp funding-arbitrage-mongodb:/tmp/backup ./mongodb-backup
```

### Backup Redis

```bash
# Redis RDB file is auto-saved in volume
docker cp funding-arbitrage-redis:/data/dump.rdb ./redis-dump.rdb
```

---

## Production Checklist Before Going Live

- [ ] API credentials filled in correctly in `.env`
- [ ] IP whitelist configured on Delta Exchange
- [ ] Testing mode disabled: `PAPER_TRADING_MODE=false`
- [ ] Correct leverage set: `LEVERAGE=10`
- [ ] Position size limits configured: `MAX_POSITION_SIZE_USD=1000`
- [ ] Funding threshold tuned: `PRIMARY_THRESHOLD=0.1`
- [ ] Discord/Telegram alerts configured (if enabled)
- [ ] MongoDB backups scheduled (optional)
- [ ] Monitor disk space weekly (`docker system df`)
- [ ] First 24h ran in paper trading mode to verify logic

---

## Quick Reference

| Command                      | Purpose                       |
| ---------------------------- | ----------------------------- |
| `docker-compose up -d`       | Start all services            |
| `docker-compose down`        | Stop all services             |
| `docker-compose logs -f app` | View bot logs in real-time    |
| `docker-compose ps`          | Check service health status   |
| `docker-compose restart app` | Restart bot only              |
| `docker-compose build`       | Rebuild Docker image          |
| `docker-compose down -v`     | Stop services and delete data |
