const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));

const ROUND_TIME = 90;

const WORDS = [
    'قطة', 'كلب', 'بيت', 'شمس', 'قمر', 'نجمة', 'سيارة', 'طائرة',
    'سمكة', 'زرافة', 'مطر', 'شجرة', 'زهرة', 'تفاحة', 'موز', 'برتقالة',
    'كرة', 'دراجة', 'قبعة', 'نظارة', 'ساعة', 'قلم', 'كتاب', 'هاتف',
    'كمبيوتر', 'مصباح', 'سفينة', 'جسر', 'جبل', 'شاطئ', 'قلعة', 'صاروخ',
    'قلب', 'نجم', 'منزل', 'كرسي', 'طاولة', 'شمسية', 'سحابة', 'قوس قزح',
    'فراولة', 'بطة', 'ديناصور', 'روبوت', 'قطار', 'منطاد', 'غواصة', 'حقيبة'
];

const rooms = new Map();

function randomWord() { return WORDS[Math.floor(Math.random() * WORDS.length)]; }
function cleanCode(code) { return String(code || '').trim().replace(/\s+/g, '').slice(0, 12); }
function cleanName(name) { return String(name || '').trim().slice(0, 16) || 'لاعب'; }

function normalizeWord(w) {
    return String(w).replace(/[\u064B-\u0652\u0640]/g, '')
        .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
        .replace(/\s+/g, ' ').trim().toLowerCase();
}

function leaveRoom(socket) {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (room) {
        if (room.timer) clearInterval(room.timer);
        room.players = room.players.filter((p) => p !== socket.id);
        if (room.drawerId === socket.id) room.drawerId = null;
        if (room.guesserId === socket.id) room.guesserId = null;
        if (room.players.length === 0) {
            rooms.delete(roomId);
        } else {
            room.over = false;
            room.word = null;
            socket.to(roomId).emit('opponentLeft');
        }
    }
    socket.leave(roomId);
    delete socket.data.roomId;
    delete socket.data.role;
}

function setupRound(room) {
    room.round++;
    room.over = false;
    room.word = null;
    room.timeLeft = 0;
    const choices = [];
    while (choices.length < 2) {
        const w = randomWord();
        if (!choices.includes(w)) choices.push(w);
    }
    room.wordChoices = choices;
    io.to(room.drawerId).emit('chooseWord', { choices, round: room.round });
    io.to(room.guesserId).emit('waitForDrawer', { round: room.round });
}

function startTimer(room) {
    room.timeLeft = ROUND_TIME;
    room.over = false;
    io.to(room.id).emit('roundStarted', { round: room.round });
    io.to(room.drawerId).emit('yourWord', room.word);
    io.to(room.id).emit('timerTick', room.timeLeft);

    if (room.timer) clearInterval(room.timer);
    room.timer = setInterval(() => {
        room.timeLeft--;
        io.to(room.id).emit('timerTick', room.timeLeft);
        if (room.timeLeft <= 10 && room.timeLeft > 0) io.to(room.id).emit('timerWarning', room.timeLeft);
        if (room.timeLeft <= 0) {
            clearInterval(room.timer);
            room.timer = null;
            room.over = true;
            if (!room.scores[room.drawerId]) room.scores[room.drawerId] = 0;
            room.scores[room.drawerId]++;
            io.to(room.id).emit('roundTimeout', {
                word: room.word, scores: room.scores, names: room.names
            });
        }
    }, 1000);
}

io.on('connection', (socket) => {
    socket.data.roomId = null;
    socket.data.role = null;

    socket.on('joinRoom', (data, cb) => {
        const code = cleanCode(data && data.code);
        const name = cleanName(data && data.name);
        if (!code) return cb && cb({ ok: false, error: 'code_required' });
        leaveRoom(socket);

        let room = rooms.get(code);
        if (!room) {
            room = {
                id: code, players: [], drawerId: null, guesserId: null,
                word: null, round: 0, over: false, timer: null, timeLeft: 0,
                scores: {}, names: {}, wordChoices: []
            };
            rooms.set(code, room);
        }
        if (room.players.length >= 2) return cb && cb({ ok: false, error: 'room_full' });

        const isDrawer = room.players.length === 0;
        socket.join(code);
        socket.data.roomId = code;
        socket.data.role = isDrawer ? 'drawer' : 'guesser';
        room.players.push(socket.id);
        room.names[socket.id] = name;
        if (isDrawer) room.drawerId = socket.id; else room.guesserId = socket.id;

        if (isDrawer) {
            room.over = false;
            io.to(code).emit('playerJoined', { names: room.names, players: room.players.length });
            cb && cb({ ok: true, role: 'drawer', roomId: code, name, names: room.names, scores: room.scores });
        } else {
            setupRound(room);
            cb && cb({ ok: true, role: 'guesser', roomId: code, name, names: room.names, scores: room.scores });
        }
    });

    socket.on('selectWord', (data) => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        if (!room || socket.data.role !== 'drawer' || room.word) return;
        const word = String((data && data.word) || '').trim().slice(0, 30);
        if (!word) return;
        room.word = word;
        startTimer(room);
    });

    socket.on('draw', (data) => {
        const roomId = socket.data.roomId;
        if (!roomId || socket.data.role !== 'drawer') return;
        socket.to(roomId).emit('draw', data);
    });

    socket.on('clearCanvas', () => {
        const roomId = socket.data.roomId;
        if (!roomId || socket.data.role !== 'drawer') return;
        socket.to(roomId).emit('clearCanvas');
    });

    socket.on('guess', (data) => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        if (!room || !room.word || room.over) return;
        const text = String((data && data.text) || '').trim().slice(0, 60);
        if (!text) return;
        io.to(roomId).emit('guess', { text, fromId: socket.id, role: socket.data.role, name: room.names[socket.id] || 'لاعب' });
        if (normalizeWord(text) === normalizeWord(room.word)) {
            if (room.timer) clearInterval(room.timer);
            room.over = true;
            if (!room.scores[socket.id]) room.scores[socket.id] = 0;
            room.scores[socket.id]++;
            io.to(roomId).emit('correctGuess', {
                text, word: room.word, guesserId: socket.id,
                drawerId: room.drawerId, scores: room.scores, names: room.names
            });
        }
    });

    socket.on('newRound', () => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        if (!room || room.players.length < 2 || socket.data.role !== 'drawer') return;
        if (room.timer) clearInterval(room.timer);

        const prevDrawer = room.drawerId;
        room.drawerId = room.guesserId;
        room.guesserId = prevDrawer;
        const setRole = (id, role) => { const s = io.sockets.sockets.get(id); if (s) s.data.role = role; };
        setRole(room.guesserId, 'guesser');
        setRole(room.drawerId, 'drawer');
        io.to(room.guesserId).emit('roleChange', { role: 'guesser' });
        io.to(room.drawerId).emit('roleChange', { role: 'drawer' });
        setupRound(room);
    });

    socket.on('disconnect', () => leaveRoom(socket));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`H&A server running on http://localhost:${PORT}`); });