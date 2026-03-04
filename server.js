const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 1. Настройка папок (Render будет искать файлы здесь)
app.use(express.static(__dirname)); 
app.use(express.static(path.join(__dirname, "public")));

// 2. Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 3. База данных в памяти
const activeUsers = new Set();
const userSocketIds = new Map();
const socketUser = new Map();
const groups = new Map();
const groupMessages = new Map();
const directMessages = new Map();

// --- Вспомогательные функции ---
function directKey(userA, userB) { return [userA, userB].sort().join("::"); }
function getOnlineUsers() { return Array.from(activeUsers).sort((a, b) => a.localeCompare(b)); }
function getGroupsForUser(username) {
    return Array.from(groups.values())
        .filter((group) => group.members.includes(username))
        .map((group) => ({ id: group.id, name: group.name, members: group.members }));
}
function emitOnlineUsers() { io.emit("online-users", getOnlineUsers()); }
function emitGroupsToUser(username) {
    const socketIds = userSocketIds.get(username);
    if (!socketIds) return;
    const list = getGroupsForUser(username);
    socketIds.forEach((socketId) => { io.to(socketId).emit("groups-list", list); });
}

io.on("connection", (socket) => {
    // Регистрация
    socket.on("register", ({ username }, callback) => {
        const trimmed = (username || "").trim();
        if (!trimmed) return callback({ ok: false, error: "Введите имя пользователя" });
        activeUsers.add(trimmed);
        socketUser.set(socket.id, trimmed);
        if (!userSocketIds.has(trimmed)) userSocketIds.set(trimmed, new Set());
        userSocketIds.get(trimmed).add(socket.id);
        callback({ ok: true, username: trimmed });
        emitOnlineUsers();
        emitGroupsToUser(trimmed);
    });

    // Личные сообщения
    socket.on("send-direct", ({ to, text }, callback) => {
        const from = socketUser.get(socket.id);
        if (!from || !to || !text) return callback({ ok: false, error: "Ошибка данных" });
        const payload = { id: Date.now(), from, to, text, time: new Date().toISOString() };
        const key = directKey(from, to);
        if (!directMessages.has(key)) directMessages.set(key, []);
        directMessages.get(key).push(payload);
        (userSocketIds.get(to) || []).forEach(id => io.to(id).emit("direct-message", payload));
        (userSocketIds.get(from) || []).forEach(id => io.to(id).emit("direct-message", payload));
        callback({ ok: true });
    });

    // --- ВОТ ЭТОГО БЛОКА У ТЕБЯ НЕ ХВАТАЛО: ---
    socket.on("create-group", ({ name, members }, callback) => {
        const creator = socketUser.get(socket.id);
        if (!creator) return callback({ ok: false, error: "Не авторизован" });
        if (!name) return callback({ ok: false, error: "Введите название группы" });

        const groupId = "g-" + Date.now();
        const finalMembers = Array.from(new Set([creator, ...members]));
        const group = { id: groupId, name, members: finalMembers };

        groups.set(groupId, group);
        groupMessages.set(groupId, []);

        finalMembers.forEach(user => emitGroupsToUser(user));
        callback({ ok: true, group });
    });

    socket.on("group-history", ({ groupId }, callback) => {
        callback(groupMessages.get(groupId) || []);
    });

    socket.on("send-group", ({ groupId, text }, callback) => {
        const from = socketUser.get(socket.id);
        if (!from || !groupId || !text) return callback({ ok: false });
        const payload = { id: Date.now(), from, groupId, text, time: new Date().toISOString() };
        groupMessages.get(groupId).push(payload);
        const group = groups.get(groupId);
        if (group) {
            group.members.forEach(m => {
                (userSocketIds.get(m) || []).forEach(sid => io.to(sid).emit("group-message", payload));
            });
        }
        callback({ ok: true });
    });

    socket.on("disconnect", () => {
        const username = socketUser.get(socket.id);
        if (!username) return;
        const ids = userSocketIds.get(username);
        if (ids) {
            ids.delete(socket.id);
            if (ids.size === 0) {
                userSocketIds.delete(username);
                activeUsers.delete(username);
                emitOnlineUsers();
            }
        }
    });
});

// --- ЗАПУСК (исправлено для Render) ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер работает на порту ${PORT}`);
});
