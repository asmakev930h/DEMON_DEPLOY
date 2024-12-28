const socket = io();

const authSection = document.getElementById('auth-section');
const appSection = document.getElementById('app-section');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const logoutButton = document.getElementById('logout-button');
const logDisplay = document.getElementById('log-display');
const commandInput = document.getElementById('command-input');
const sendButton = document.getElementById('send-command');

function appendLog(message) {
    const logEntry = document.createElement('div');
    logEntry.textContent = message;
    logDisplay.appendChild(logEntry);
    logDisplay.scrollTop = logDisplay.scrollHeight;
}

function showApp() {
    authSection.style.display = 'none';
    appSection.style.display = 'block';
}

function showAuth() {
    authSection.style.display = 'flex';
    appSection.style.display = 'none';
}

loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    socket.emit('login', { username, password });
});

registerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('register-username').value;
    const password = document.getElementById('register-password').value;
    socket.emit('register', { username, password });
});

logoutButton.addEventListener('click', () => {
    socket.emit('logout');
});

sendButton.addEventListener('click', () => {
    const command = commandInput.value;

    if (!command) {
        appendLog('Please enter a command');
        return;
    }

    if (command.toLowerCase() === 'start') {
        socket.emit('start');
    } else {
        socket.emit('command', command);
    }

    commandInput.value = '';
});

socket.on('registerResponse', (response) => {
    if (response.success) {
        alert('Registration successful. Please log in.');
    } else {
        alert(response.message);
    }
});

socket.on('loginResponse', (response) => {
    if (response.success) {
        showApp();
        appendLog('Logged in successfully');
    } else {
        alert(response.message);
    }
});

socket.on('logoutResponse', (response) => {
    if (response.success) {
        showAuth();
        appendLog('Logged out successfully');
    }
});

socket.on('message', (message) => {
    appendLog(message);
});

// Initially show the auth section
showAuth();

