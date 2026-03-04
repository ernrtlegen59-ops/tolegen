const socket = io();

let me = "";
let onlineUsers = [];
let groups = [];
let activeChat = null;

const state = {
  directCache: new Map(),
  groupCache: new Map()
};

const loginEl = document.getElementById("login");
const appEl = document.getElementById("app");
const usernameInput = document.getElementById("usernameInput");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");
const usersList = document.getElementById("usersList");
const groupsList = document.getElementById("groupsList");
const chatTitle = document.getElementById("chatTitle");
const messagesEl = document.getElementById("messages");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");
const newGroupBtn = document.getElementById("newGroupBtn");
const modal = document.getElementById("modal");
const groupMembers = document.getElementById("groupMembers");
const groupNameInput = document.getElementById("groupNameInput");
const groupError = document.getElementById("groupError");
const createGroupBtn = document.getElementById("createGroupBtn");
const cancelGroupBtn = document.getElementById("cancelGroupBtn");

function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderMessages(messages) {
  messagesEl.innerHTML = "";

  messages.forEach((msg) => {
    const mine = msg.from === me;
    const div = document.createElement("div");
    div.className = `msg${mine ? " me" : ""}`;
    div.innerHTML = `
      <div><strong>${escapeHtml(msg.from)}</strong></div>
      <div>${escapeHtml(msg.text)}</div>
      <div class="meta">${timeLabel(msg.time)}</div>
    `;
    messagesEl.appendChild(div);
  });

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderUsers() {
  const users = onlineUsers.filter((u) => u !== me);
  usersList.innerHTML = "";

  users.forEach((username) => {
    const li = document.createElement("li");
    li.textContent = username;
    if (activeChat?.type === "direct" && activeChat.target === username) {
      li.classList.add("active");
    }

    li.onclick = () => openDirect(username);
    usersList.appendChild(li);
  });
}

function renderGroups() {
  groupsList.innerHTML = "";

  groups.forEach((group) => {
    const li = document.createElement("li");
    li.textContent = group.name;
    if (activeChat?.type === "group" && activeChat.groupId === group.id) {
      li.classList.add("active");
    }

    li.onclick = () => openGroup(group);
    groupsList.appendChild(li);
  });
}

function updateSidebar() {
  renderUsers();
  renderGroups();
}

function openDirect(username) {
  activeChat = { type: "direct", target: username };
  chatTitle.textContent = `Личный чат: ${username}`;

  socket.emit("direct-history", { target: username }, (messages) => {
    state.directCache.set(username, messages);
    renderMessages(messages);
    updateSidebar();
  });
}

function openGroup(group) {
  activeChat = { type: "group", groupId: group.id, name: group.name };
  chatTitle.textContent = `Группа: ${group.name}`;

  socket.emit("group-history", { groupId: group.id }, (messages) => {
    state.groupCache.set(group.id, messages);
    renderMessages(messages);
    updateSidebar();
  });
}

function registerUser(username, onSuccess) {
  socket.emit("register", { username }, (result) => {
    if (!result.ok) {
      loginError.textContent = result.error;
      return;
    }

    me = result.username;
    loginEl.classList.add("hidden");
    appEl.classList.remove("hidden");
    loginError.textContent = "";

    if (typeof onSuccess === "function") {
      onSuccess();
    }
  });
}

loginBtn.onclick = () => {
  const username = usernameInput.value.trim();
  registerUser(username);
};

socket.on("online-users", (users) => {
  onlineUsers = users;
  updateSidebar();
});

socket.on("connect", () => {
  if (me) {
    registerUser(me, () => {
      if (activeChat?.type === "direct") {
        openDirect(activeChat.target);
      }
      if (activeChat?.type === "group") {
        const group = groups.find((g) => g.id === activeChat.groupId);
        if (group) openGroup(group);
      }
    });
  }
});

socket.on("groups-list", (list) => {
  groups = list;
  renderGroups();

  if (activeChat?.type === "group") {
    const stillExists = groups.some((g) => g.id === activeChat.groupId);
    if (!stillExists) {
      activeChat = null;
      chatTitle.textContent = "Выбери чат";
      messagesEl.innerHTML = "";
    }
  }
});

socket.on("direct-message", (message) => {
  const peer = message.from === me ? message.to : message.from;
  const history = state.directCache.get(peer) || [];
  history.push(message);
  state.directCache.set(peer, history);

  if (activeChat?.type === "direct" && activeChat.target === peer) {
    renderMessages(history);
  }
});

socket.on("group-message", (message) => {
  const history = state.groupCache.get(message.groupId) || [];
  history.push(message);
  state.groupCache.set(message.groupId, history);

  if (activeChat?.type === "group" && activeChat.groupId === message.groupId) {
    renderMessages(history);
  }
});

messageForm.onsubmit = (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();

  if (!activeChat || !text) {
    return;
  }

  if (activeChat.type === "direct") {
    socket.emit("send-direct", { to: activeChat.target, text }, (result) => {
      if (!result.ok) {
        alert(result.error);
        return;
      }
      messageInput.value = "";
    });
    return;
  }

  socket.emit("send-group", { groupId: activeChat.groupId, text }, (result) => {
    if (!result.ok) {
      alert(result.error);
      return;
    }
    messageInput.value = "";
  });
};

newGroupBtn.onclick = () => {
  groupError.textContent = "";
  groupNameInput.value = "";
  const candidates = onlineUsers.filter((u) => u !== me);

  groupMembers.innerHTML = candidates.length
    ? candidates
        .map(
          (name) => `<label><input type="checkbox" value="${escapeHtml(name)}" /> ${escapeHtml(name)}</label>`
        )
        .join("")
    : "<p>Нет онлайн пользователей</p>";

  modal.classList.remove("hidden");
};

cancelGroupBtn.onclick = () => {
  modal.classList.add("hidden");
};

createGroupBtn.onclick = () => {
  const name = groupNameInput.value.trim();
  const selected = Array.from(groupMembers.querySelectorAll("input[type='checkbox']:checked")).map((el) => el.value);

  socket.emit("create-group", { name, members: selected }, (result) => {
    if (!result.ok) {
      groupError.textContent = result.error;
      return;
    }

    modal.classList.add("hidden");
    groupError.textContent = "";
    openGroup(result.group);
  });
};
