const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const activeUsers = new Set();
const userSocketIds = new Map();
const socketUser = new Map();

const groups = new Map();
const groupMessages = new Map();
const directMessages = new Map();

function directKey(userA, userB) {
  return [userA, userB].sort().join("::");
}

function getOnlineUsers() {
  return Array.from(activeUsers).sort((a, b) => a.localeCompare(b));
}

function getGroupsForUser(username) {
  return Array.from(groups.values())
    .filter((group) => group.members.includes(username))
    .map((group) => ({ id: group.id, name: group.name, members: group.members }));
}

function emitOnlineUsers() {
  io.emit("online-users", getOnlineUsers());
}

function emitGroupsToUser(username) {
  const socketIds = userSocketIds.get(username);
  if (!socketIds) return;

  const list = getGroupsForUser(username);
  socketIds.forEach((socketId) => {
    io.to(socketId).emit("groups-list", list);
  });
}

io.on("connection", (socket) => {
  socket.on("register", ({ username }, callback) => {
    const trimmed = (username || "").trim();

    if (!trimmed) {
      callback({ ok: false, error: "Введите имя пользователя" });
      return;
    }

    activeUsers.add(trimmed);
    socketUser.set(socket.id, trimmed);

    if (!userSocketIds.has(trimmed)) userSocketIds.set(trimmed, new Set());
    userSocketIds.get(trimmed).add(socket.id);

    callback({ ok: true, username: trimmed });
    emitOnlineUsers();
    emitGroupsToUser(trimmed);
  });

  socket.on("direct-history", ({ target }, callback) => {
    const me = socketUser.get(socket.id);
    if (!me || !target) {
      callback([]);
      return;
    }

    const key = directKey(me, target);
    callback(directMessages.get(key) || []);
  });

  socket.on("send-direct", ({ to, text }, callback) => {
    const from = socketUser.get(socket.id);
    const msg = (text || "").trim();

    if (!from || !to || !msg) {
      callback({ ok: false, error: "Некорректные данные" });
      return;
    }

    if (!activeUsers.has(to)) {
      callback({ ok: false, error: "Пользователь не онлайн" });
      return;
    }

    const payload = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: "direct",
      from,
      to,
      text: msg,
      time: new Date().toISOString()
    };

    const key = directKey(from, to);
    if (!directMessages.has(key)) directMessages.set(key, []);
    directMessages.get(key).push(payload);

    (userSocketIds.get(to) || new Set()).forEach((id) => io.to(id).emit("direct-message", payload));
    (userSocketIds.get(from) || new Set()).forEach((id) => io.to(id).emit("direct-message", payload));

    callback({ ok: true });
  });

  socket.on("create-group", ({ name, members }, callback) => {
    const creator = socketUser.get(socket.id);
    const trimmedName = (name || "").trim();

    if (!creator) {
      callback({ ok: false, error: "Не авторизован" });
      return;
    }

    if (!trimmedName) {
      callback({ ok: false, error: "Введите название группы" });
      return;
    }

    const rawMembers = Array.isArray(members) ? members : [];
    const uniqueMembers = Array.from(new Set(rawMembers.map((m) => (m || "").trim()).filter(Boolean)));
    const finalMembers = Array.from(new Set([creator, ...uniqueMembers])).filter((user) => activeUsers.has(user));

    if (finalMembers.length < 2) {
      callback({ ok: false, error: "Добавьте хотя бы 1 онлайн пользователя" });
      return;
    }

    const groupId = `g-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const group = { id: groupId, name: trimmedName, members: finalMembers, createdBy: creator };

    groups.set(groupId, group);
    groupMessages.set(groupId, []);

    finalMembers.forEach((username) => {
      emitGroupsToUser(username);
      (userSocketIds.get(username) || new Set()).forEach((sid) => io.to(sid).emit("group-created", group));
    });

    callback({ ok: true, group });
  });

  socket.on("group-history", ({ groupId }, callback) => {
    const username = socketUser.get(socket.id);
    const group = groups.get(groupId);

    if (!username || !group || !group.members.includes(username)) {
      callback([]);
      return;
    }

    callback(groupMessages.get(groupId) || []);
  });

  socket.on("send-group", ({ groupId, text }, callback) => {
    const from = socketUser.get(socket.id);
    const msg = (text || "").trim();
    const group = groups.get(groupId);

    if (!from || !group || !group.members.includes(from) || !msg) {
      callback({ ok: false, error: "Некорректные данные" });
      return;
    }

    const payload = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: "group",
      groupId,
      groupName: group.name,
      from,
      text: msg,
      time: new Date().toISOString()
    };

    groupMessages.get(groupId).push(payload);

    group.members.forEach((member) => {
      (userSocketIds.get(member) || new Set()).forEach((sid) => io.to(sid).emit("group-message", payload));
    });

    callback({ ok: true });
  });

  socket.on("disconnect", () => {
    const username = socketUser.get(socket.id);
    if (!username) return;

    socketUser.delete(socket.id);
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

app.use(express.static(path.join(__dirname, "public")));

server.listen(PORT, HOST, () => {
  console.log(`Server started at http://localhost:${PORT}`);
  console.log(`LAN access: http://10.86.17.49:${PORT}`);
});

