const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
const rooms = new Map();
const WS_OPEN = 1;
const clients = new Set();

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({length: 6}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function frameText(text) {
  const payload = Buffer.from(text, 'utf8');
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    // Safe for our tiny messages; upper 32 bits stay zero.
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(payload.length, 6);
  }
  return Buffer.concat([header, payload]);
}

function send(ws, message) {
  if (!ws || ws.readyState !== WS_OPEN) return;
  const body = frameText(JSON.stringify(message));
  ws.socket.write(body);
}

function broadcast(room, message, except = null) {
  for (const client of room.clients) {
    if (client !== except) send(client, message);
  }
}

function handleMessage(ws, msg) {
  let parsed;
  try { parsed = JSON.parse(msg); }
  catch { return send(ws, {type:'server_error', message:'Geçersiz mesaj.'}); }

  if (parsed.type === 'create_room') {
    if (ws.roomId) return;
    const roomId = makeRoomCode();
    const room = {id: roomId, host: ws, clients: new Set([ws]), snapshot: null};
    rooms.set(roomId, room);
    ws.roomId = roomId; ws.playerId = 0; ws.isHost = true;
    send(ws, {type:'room_created', roomId, playerId:0, isHost:true});
    return;
  }

  if (parsed.type === 'join_room') {
    const roomId = String(parsed.roomId || '').toUpperCase();
    const room = rooms.get(roomId);
    if (!room) return send(ws, {type:'room_error', message:'Bu oda bulunamadı.'});
    if (room.clients.size >= 2) return send(ws, {type:'room_error', message:'Oda dolu.'});
    ws.roomId = roomId; ws.playerId = 1; ws.isHost = false;
    room.clients.add(ws);
    send(ws, {type:'room_joined', roomId, playerId:1, isHost:false, snapshot:room.snapshot});
    send(room.host, {type:'peer_joined'});
    if (room.snapshot) send(ws, {type:'snapshot', snapshot:room.snapshot});
    return;
  }

  if (!ws.roomId) return send(ws, {type:'server_error', message:'Önce bir odaya gir.'});
  const room = rooms.get(ws.roomId);
  if (!room) return;

  if (parsed.type === 'host_snapshot') {
    if (!ws.isHost) return;
    room.snapshot = parsed.snapshot;
    broadcast(room, {type:'snapshot', snapshot:parsed.snapshot}, ws);
    return;
  }

  if (parsed.type === 'action') {
    send(room.host, {
      type:'action',
      action: parsed.action,
      payload: parsed.payload || {},
      playerId: ws.playerId
    });
  }
}

function destroyClient(ws) {
  clients.delete(ws);
  if (!ws.roomId) return;
  const room = rooms.get(ws.roomId);
  if (!room) return;
  room.clients.delete(ws);
  if (ws.isHost) {
    broadcast(room, {type:'server_error', message:'Host bağlantısı kapandı. Oyun sona erdi.'}, ws);
    for (const client of room.clients) {
      client.roomId = null; client.playerId = null; client.isHost = false;
    }
    rooms.delete(room.id);
  } else {
    send(room.host, {type:'peer_left'});
  }
}

function attachWebSocket(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  if (head?.length) socket.unshift(head);

  const ws = {socket, readyState:WS_OPEN, roomId:null, playerId:null, isHost:false, buffer:Buffer.alloc(0)};
  clients.add(ws);
  send(ws, {type:'connected'});

  socket.on('data', chunk => {
    ws.buffer = Buffer.concat([ws.buffer, chunk]);
    parseFrames(ws);
  });
  socket.on('close', () => { ws.readyState = 3; destroyClient(ws); });
  socket.on('error', () => { try { socket.destroy(); } catch {} });
}

function parseFrames(ws) {
  const b = ws.buffer;
  let offset = 0;
  while (offset + 2 <= b.length) {
    const byte1 = b[offset];
    const byte2 = b[offset+1];
    const opcode = byte1 & 0x0f;
    const masked = !!(byte2 & 0x80);
    let len = byte2 & 0x7f;
    let pos = offset + 2;

    if (len === 126) {
      if (b.length < pos + 2) break;
      len = b.readUInt16BE(pos); pos += 2;
    } else if (len === 127) {
      if (b.length < pos + 8) break;
      const high = b.readUInt32BE(pos), low = b.readUInt32BE(pos+4); pos += 8;
      if (high !== 0) throw new Error('Frame too large');
      len = low;
    }

    const maskStart = pos;
    if (masked) pos += 4;
    if (b.length < pos + len) break;
    let payload = b.subarray(pos, pos + len);
    if (masked) {
      const mask = b.subarray(maskStart, maskStart + 4);
      const decoded = Buffer.alloc(len);
      for (let i=0;i<len;i++) decoded[i] = payload[i] ^ mask[i % 4];
      payload = decoded;
    }
    offset = pos + len;

    if (opcode === 0x8) {
      try { ws.socket.end(); } catch {}
      return;
    }
    if (opcode === 0x9) {
      // pong
      ws.socket.write(Buffer.from([0x8A, 0x00]));
      continue;
    }
    if (opcode === 0x1) handleMessage(ws, payload.toString('utf8'));
  }
  ws.buffer = b.subarray(offset);
}

function serveFile(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC, urlPath));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};
    res.writeHead(200, {'Content-Type': types[ext] || 'application/octet-stream','Cache-Control':'no-store'});
    res.end(data);
  });
}

const server = http.createServer(serveFile);
server.on('upgrade', (req, socket, head) => {
  if (req.headers.upgrade?.toLowerCase() !== 'websocket') return socket.destroy();
  attachWebSocket(req, socket, head);
});

server.listen(PORT, () => {
  console.log(`Şehir Savaşları Online PvP sunucusu: http://localhost:${PORT}`);
  console.log(`Aynı Wi-Fi'de diğer cihazlar: http://<SUNUCU-IP>:${PORT}`);
});
