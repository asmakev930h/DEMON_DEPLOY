const socket = io();

const logDisplay = document.getElementById('log-display');
const userIdInput = document.getElementById('user-id');
const commandInput = document.getElementById('command-input');
const sendButton = document.getElementById('send-command');

function appendLog(message) {
    const logEntry = document.createElement('div');
    logEntry.textContent = message;
    logDisplay.appendChild(logEntry);
    logDisplay.scrollTop = logDisplay.scrollHeight;
}

sendButton.addEventListener('click', () => {
    const userId = userIdInput.value;
    const command = commandInput.value;

    if (!userId) {
        appendLog('Please enter a User ID');
        return;
    }

    if (!command) {
        appendLog('Please enter a command');
        return;
    }

    if (command.toLowerCase() === 'start') {
        socket.emit('start', userId);
    } else {
        socket.emit('command', { userId, message: command });
    }

    commandInput.value = '';
});

socket.on('message', (message) => {
    appendLog(message);
});

