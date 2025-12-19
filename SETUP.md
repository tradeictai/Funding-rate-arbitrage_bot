# Setup Guide - Funding Arbitrage Dashboard

Quick setup guide to get the dashboard running in 5 minutes.

## Prerequisites

- Node.js 20.0.0 or higher
- Your arbitrage bot backend running
- Port 3000 and 5000 available

## Installation Steps

### 1. Navigate to Dashboard Folder

```bash
cd C:\Users\My\Desktop\funding-arbitrage-dashboard
```

### 2. Install Dependencies

```bash
npm install
```

This will install:
- React and React DOM
- React Router
- Socket.IO Client
- Tailwind CSS
- Recharts
- Lucide React
- Zustand
- date-fns

### 3. Start Development Server

```bash
npm run dev
```

Expected output:
```
  VITE v5.0.8  ready in 500 ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: use --host to expose
  ➜  press h to show help
```

### 4. Set Up Backend WebSocket Server

See `BACKEND_INTEGRATION.md` for detailed instructions.

Quick version:

1. Install Socket.IO in backend:
```bash
cd C:\Users\My\Desktop\CEX-Funding-Rate-Arbitrage
npm install socket.io
```

2. Create `src/server/websocketServer.js` (see BACKEND_INTEGRATION.md)

3. Update `src/index.js` to start WebSocket server

4. Restart backend:
```bash
npm start
```

### 5. Open Dashboard

Navigate to: **http://localhost:3000**

## Verify Connection

### Check Connection Status

In the dashboard header, you should see:
- ✅ **Connected** (green) - Backend is connected
- ❌ **Disconnected** (red) - Backend not reachable

### Check Console

**Frontend Console (Browser F12):**
```
✅ WebSocket connected
```

**Backend Console:**
```
✅ WebSocket server running on port 5000
✅ Frontend connected: [socket-id]
```

## Quick Test

### Test 1: Funding Rates

1. Go to **Opportunities** page
2. You should see live funding rates from Delta and Pi42
3. Rates should update every few seconds

### Test 2: Dashboard

1. Go to **Dashboard** page
2. Check "Opportunities Today" counter
3. View funding rate chart

### Test 3: Monitoring (requires active position)

1. Execute a trade from backend
2. Go to **Monitoring** page
3. See live position updates
4. Watch quantity check and flip detection panels

## Common Issues

### Issue 1: "Cannot connect to backend"

**Symptoms:**
- Header shows "Disconnected"
- No data in any page

**Solutions:**
1. Make sure backend is running
2. Verify backend WebSocket server started (check console)
3. Check port 5000 is not blocked by firewall
4. Verify vite.config.js proxy settings

### Issue 2: "Page is blank"

**Symptoms:**
- White screen
- Nothing renders

**Solutions:**
1. Check browser console for errors
2. Clear browser cache (Ctrl + Shift + Del)
3. Restart dev server (`npm run dev`)

### Issue 3: "npm install fails"

**Symptoms:**
- Package installation errors
- Dependency conflicts

**Solutions:**
```bash
# Delete node_modules and package-lock.json
rm -rf node_modules package-lock.json

# Clear npm cache
npm cache clean --force

# Reinstall
npm install
```

### Issue 4: "Port 3000 already in use"

**Solution:**
```bash
# Kill process on port 3000 (Windows)
netstat -ano | findstr :3000
taskkill /PID [PID] /F

# Or change port in vite.config.js
# server: { port: 3001 }
```

## Development Mode

### Hot Reload

The dashboard uses Vite's hot module replacement (HMR). Changes to any file will automatically reload the browser.

### Debug Mode

Open browser DevTools (F12) to see:
- WebSocket events in Console
- Component hierarchy in React DevTools
- Network requests

## Build for Production

```bash
npm run build
```

Output: `dist/` folder

Serve production build:
```bash
npm run preview
```

## Project Structure Quick Reference

```
src/
├── components/     # React components
│   ├── Dashboard/  # Dashboard page components
│   ├── Opportunities/ # Opportunities page
│   ├── Orders/     # Orders page
│   ├── Monitoring/ # Live monitoring
│   └── Layout/     # Layout components
├── pages/          # Page components
├── context/        # WebSocket context
├── store/          # Zustand state
└── App.jsx         # Main app component
```

## Next Steps

1. **Configure Settings**: Go to Settings page and adjust parameters
2. **Test Live Monitoring**: Execute a trade and watch real-time updates
3. **Customize UI**: Modify Tailwind classes in components
4. **Add Features**: See TODO.md for enhancement ideas

## Support

For issues:
1. Check `BACKEND_INTEGRATION.md` for backend setup
2. Check browser console for errors
3. Check backend console for WebSocket issues
4. Verify both servers are running

## URLs Reference

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend WebSocket | http://localhost:5000 |
| Backend API Proxy | http://localhost:3000/api |

## Environment

- **Node**: 20.0.0+
- **Frontend Port**: 3000
- **Backend Port**: 5000
- **Hot Reload**: Enabled
- **Auto Refresh**: Enabled
