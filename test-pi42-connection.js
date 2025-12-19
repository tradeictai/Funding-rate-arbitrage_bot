import { io } from 'socket.io-client';

console.log('🧪 Testing Pi42 WebSocket Connection\n');

const ws = io('https://fawss.pi42.com/', {
  reconnection: true,
  reconnectionDelay: 4000,
  transports: ['websocket']
});

ws.on('connect', () => {
  console.log('✅ Connected to Pi42 WebSocket');
  console.log('📡 Subscribing to markPriceArr...\n');

  ws.emit('subscribe', {
    params: ['markPriceArr']
  });
});

ws.on('markPriceArr', (data) => {
  console.log('📥 RECEIVED markPriceArr event!');
  console.log(`Total tokens: ${data.length}`);

  // Show first 3 tokens
  data.slice(0, 3).forEach((token, i) => {
    console.log(`\n#${i + 1}: ${token.s}`);
    console.log(`  Mark Price: ${token.p}`);
    console.log(`  Funding Rate: ${(token.r * 100).toFixed(4)}%`);
    console.log(`  Next Funding: ${token.T ? new Date(token.T).toLocaleString() : 'N/A'}`);
  });

  console.log('\n✅ Pi42 is working correctly!\n');
});

ws.onAny((event, ...args) => {
  if (event !== 'markPriceArr' && event !== 'connect' && event !== 'pong') {
    console.log(`🔔 Event: ${event}`);
  }
});

ws.on('disconnect', (reason) => {
  console.log('❌ Disconnected:', reason);
});

ws.on('error', (err) => {
  console.error('⚠️ Error:', err);
});

console.log('⏳ Waiting for connection...\n');

// Auto-exit after 30 seconds
setTimeout(() => {
  console.log('\n⏱️ Test timeout - exiting');
  process.exit(0);
}, 30000);
