const socket = io();

const authSection = document.getElementById('auth-section');
const appSection = document.getElementById('app-section');
const usernameInput = document.getElementById('username-input');
const registerBtn = document.getElementById('register-btn');
const loginBtn = document.getElementById('login-btn');
const logDisplay = document.getElementById('log-display');
const commandInput = document.getElementById('command-input');
const sendButton = document.getElementById('send-command');

let currentUserId = null;

function appendLog(message) {
    const logEntry = document.createElement('div');
    logEntry.textContent = message;
    logEntry.classList.add('log-entry', 'fade-in');
    logDisplay.appendChild(logEntry);
    logDisplay.scrollTop = logDisplay.scrollHeight;
}

function showAppSection() {
    authSection.classList.add('hidden');
    appSection.classList.remove('hidden');
}

registerBtn.addEventListener('click', () => {
    const username = usernameInput.value;
    if (username) {
        socket.emit('register', username);
    }
});

loginBtn.addEventListener('click', () => {
    const username = usernameInput.value;
    if (username) {
        socket.emit('login', username);
    }
});

sendButton.addEventListener('click', () => {
    const command = commandInput.value;

    if (!currentUserId) {
        appendLog('Please log in first');
        return;
    }

    if (!command) {
        appendLog('Please enter a command');
        return;
    }

    if (command.toLowerCase() === 'start') {
        socket.emit('start', currentUserId);
    } else {
        socket.emit('command', { userId: currentUserId, message: command });
    }

    commandInput.value = '';
});

socket.on('registerResponse', (response) => {
    if (response.success) {
        currentUserId = response.userId;
        appendLog(`Registered successfully. Your user ID is: ${currentUserId}`);
        showAppSection();
    } else {
        appendLog(`Registration failed: ${response.message}`);
    }
});

socket.on('loginResponse', (response) => {
    if (response.success) {
        currentUserId = response.userId;
        appendLog(`Logged in successfully. Your user ID is: ${currentUserId}`);
        showAppSection();
    } else {
        appendLog(`Login failed: ${response.message}`);
    }
});

socket.on('message', (message) => {
    appendLog(message);
});

