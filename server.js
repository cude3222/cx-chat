const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// Хостинг сам назначит порт через process.env.PORT. Если запускаешь дома — включится 8085
const PORT = process.env.PORT || 8085;

// 1. Создаем HTTP-сервер, чтобы чат открывался как обычный сайт по ссылке
const server = http.createServer((req, res) => {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('Ошибка загрузки index.html. Убедитесь, что файл лежит рядом с server.js');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
    });
});

// 2. Подключаем WebSocket-сервер на тот же порт
const wss = new WebSocket.Server({ noServer: true });

const roomsHistory = { 'main': [] };

function getRoomOnlineCount(roomName) {
    let count = 0;
    wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN && c.room === roomName && c.isAuth) count++; });
    return count;
}

function broadcastOnlineToRoom(roomName) {
    const count = getRoomOnlineCount(roomName);
    wss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN && c.room === roomName && c.isAuth) {
            c.send(JSON.stringify({ type: 'online', count: count }));
        }
    });
}

wss.on('connection', (ws) => {
    ws.room = 'main';
    ws.isAuth = false;
    ws.username = '';

    ws.on('message', (message) => {
        try {
            const parsed = JSON.parse(message);
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            if (parsed.type === 'login') {
                const nick = parsed.sender.trim();
                let isNicknameTaken = false;
                wss.clients.forEach(client => {
                    if (client !== ws && client.isAuth && client.username.toLowerCase() === nick.toLowerCase()) {
                        isNicknameTaken = true;
                    }
                });

                if (isNicknameTaken) {
                    ws.send(JSON.stringify({ type: 'login_status', success: false, info: 'Этот никнейм уже занят онлайн!' }));
                    return;
                }

                ws.isAuth = true;
                ws.username = nick;
                ws.send(JSON.stringify({ type: 'login_status', success: true }));
                ws.send(JSON.stringify({ type: 'history', data: roomsHistory[ws.room] || [] }));
                ws.send(JSON.stringify({ type: 'msg', sender: 'СИСТЕМА', text: 'Добро пожаловать', time: timeStr, isSystem: true }));
                broadcastOnlineToRoom(ws.room);
                return;
            }

            if (!ws.isAuth) return;

            if (parsed.type === 'join_room') {
                const oldRoom = ws.room;
                ws.room = parsed.room;
                if (!roomsHistory[ws.room]) roomsHistory[ws.room] = [];
                ws.send(JSON.stringify({ type: 'history', data: roomsHistory[ws.room] }));
                ws.send(JSON.stringify({ type: 'msg', sender: 'СИСТЕМА', text: `Вы перешли в комнату: ${ws.room}`, time: timeStr, isSystem: true }));
                broadcastOnlineToRoom(oldRoom);
                broadcastOnlineToRoom(ws.room);
            } 
            else if (parsed.type === 'msg') {
                const messageData = { type: 'msg', sender: ws.username, text: parsed.text, time: timeStr, isSystem: false };
                roomsHistory[ws.room].push(messageData);
                if (roomsHistory[ws.room].length > 100) roomsHistory[ws.room].shift();
                wss.clients.forEach(c => {
                    if (c.readyState === WebSocket.OPEN && c.room === ws.room && c.isAuth) c.send(JSON.stringify(messageData));
                });
            } 
            else if (parsed.type === 'command' && parsed.text === '/clear') {
                roomsHistory[ws.room] = [];
                wss.clients.forEach(c => {
                    if (c.readyState === WebSocket.OPEN && c.room === ws.room && c.isAuth) {
                        c.send(JSON.stringify({ type: 'msg', sender: 'СИСТЕМА', text: 'История очищена.', time: timeStr, isSystem: true }));
                    }
                });
            }
        } catch (e) { console.error(e); }
    });

    ws.on('close', () => { if (ws.isAuth && ws.room) broadcastOnlineToRoom(ws.room); });
});

// Интегрируем веб-сервер и сокеты в один поток
server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

server.listen(PORT, () => {
    console.log(`>>> Глобальный сервер Cx-Chat успешно запущен на порту ${PORT}...`);
});

