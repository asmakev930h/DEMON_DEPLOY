const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const crypto = require('crypto');

const userStates = {};
const bannedFilePath = path.join(__dirname, 'banned.json');
const usersFilePath = path.join(__dirname, 'users.json');

if (!fs.existsSync(bannedFilePath)) {
    fs.writeFileSync(bannedFilePath, JSON.stringify([]));
}

if (!fs.existsSync(usersFilePath)) {
    fs.writeFileSync(usersFilePath, JSON.stringify({}));
}

const loadBannedUsers = () => JSON.parse(fs.readFileSync(bannedFilePath));
const saveBannedUsers = (bannedUsers) => fs.writeFileSync(bannedFilePath, JSON.stringify(bannedUsers));
const loadUsers = () => JSON.parse(fs.readFileSync(usersFilePath));
const saveUsers = (users) => fs.writeFileSync(usersFilePath, JSON.stringify(users));

app.use(express.static('public'));
app.use(express.json());

const runNpmStartForAllUsers = () => {
    const usersDir = path.join(__dirname, 'users');
    if (fs.existsSync(usersDir)) {
        const userDirs = fs.readdirSync(usersDir);

        userDirs.forEach((userDir) => {
            const userPath = path.join(usersDir, userDir);
            const packageJsonPath = path.join(userPath, 'package.json');

            if (fs.existsSync(packageJsonPath)) {
                console.log(`✅ STARTED PROCESS FOR: [${userDir}]`);
                const npmStart = spawn('npm', ['start'], { cwd: userPath });

                npmStart.stdout.on('data', (data) => console.log(``));
                npmStart.stderr.on('data', (data) => console.error(``));
                npmStart.on('close', (code) => {
                    if (code === 0) {
                        console.log(`✅ [${userDir}] Status: Success`);
                    } else {
                        console.error(`❌ [${userDir}] Status: Failed`);
                    }
                });
            } else {
                console.log(`⚠️ SKIPPED [${userDir}]: No package.json found.`);
            }
        });
    } else {
        console.log('❌ NO USERS DIRECTORY FOUND.');
    }
};

runNpmStartForAllUsers();

io.on('connection', (socket) => {
    console.log('A user connected');

    socket.on('register', (username) => {
        const users = loadUsers();
        if (users[username]) {
            socket.emit('registerResponse', { success: false, message: 'Username already exists' });
        } else {
            const userId = crypto.randomBytes(16).toString('hex');
            users[username] = { id: userId };
            saveUsers(users);
            socket.emit('registerResponse', { success: true, userId: userId });
        }
    });

    socket.on('login', (username) => {
        const users = loadUsers();
        if (users[username]) {
            socket.emit('loginResponse', { success: true, userId: users[username].id });
        } else {
            socket.emit('loginResponse', { success: false, message: 'User not found' });
        }
    });

    socket.on('start', (userId) => {
        const bannedUsers = loadBannedUsers();

        if (bannedUsers.includes(userId)) {
            socket.emit('message', '❌ You are banned from using this service.');
            return;
        }

        const userDir = path.join(__dirname, 'users', String(userId));
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }

        userStates[userId] = { step: 'ask_repo', started: true };
        socket.emit('message', '🎅 WELCOME! Please provide the Repository URL you wish to clone and run.');
    });

    socket.on('command', (data) => {
        const { userId, message } = data;
        const bannedUsers = loadBannedUsers();

        if (bannedUsers.includes(userId)) {
            socket.emit('message', '❌ You are banned from using this service.');
            return;
        }

        if (!userStates[userId]?.started) {
            socket.emit('message', '❌ Please use the start command before proceeding so as to avoid error');
            return;
        }

        const userDir = path.join(__dirname, 'users', String(userId));
        if (!userStates[userId]) {
            userStates[userId] = { step: 'ask_repo', started: false };
        }
        const userState = userStates[userId];

        switch (true) {
            case message.toLowerCase() === 'clear':
                if (fs.existsSync(userDir)) {
                    socket.emit('message', '🗑 Clearing your directory...');
                    const rmProcess = spawn('rm', ['-rf', userDir]);

                    rmProcess.on('close', (code) => {
                        if (code === 0) {
                            socket.emit('message', '✅ Your directory has been cleared successfully.');
                        } else {
                            socket.emit('message', '❌ Failed to clear your directory.');
                        }
                    });
                } else {
                    socket.emit('message', '❌ Directory not found.');
                }
                break;

            case message.toLowerCase() === 'list':
                if (fs.existsSync(userDir)) {
                    const files = fs.readdirSync(userDir);
                    if (files.length === 0) {
                        socket.emit('message', '❌ No files found.');
                    } else {
                        socket.emit('message', `📂 Files in your directory:\n🍑 ${files.join('\n🍑 ')}`);
                    }
                } else {
                    socket.emit('message', '❌ Directory not found.');
                }
                break;

            case message.toLowerCase().startsWith('run '):
                const filenameToRun = message.slice(4).trim();
                const filePathToRun = path.join(userDir, filenameToRun);

                if (!fs.existsSync(filePathToRun)) {
                    return socket.emit('message', '❌ The specified file does not exist.');
                }

                socket.emit('message', `🚀 Running the file: ${filenameToRun}`);
                const nodeProcess = spawn('node', [filePathToRun], { cwd: userDir });

                userStates[userId].runningProcess = nodeProcess;

                nodeProcess.stdout.on('data', (data) => socket.emit('message', `✅ NODE OUTPUT:\n${data}`));
                nodeProcess.stderr.on('data', (data) => socket.emit('message', `⚠️ NODE ERROR:\n${data}`));
                nodeProcess.on('close', (code) => {
                    socket.emit('message', `🚀 Script finished with code ${code}`);
                    delete userStates[userId].runningProcess;
                });
                break;

            case userState.step === 'ask_repo':
                const repoUrl = message;
                socket.emit('message', `🔄 Cloning the repository from: ${repoUrl}`);
                const gitClone = spawn('git', ['clone', repoUrl, '.'], { cwd: userDir });

                gitClone.stdout.on('data', (data) => socket.emit('message', `✅ GIT OUTPUT:\n${data}`));
                gitClone.stderr.on('data', (data) => socket.emit('message', `⚠️ GIT ERROR:\n${data}`));
                gitClone.on('close', (code) => {
                    if (code === 0) {
                        socket.emit('message', '✅ Repository cloned successfully!\nNow Installing dependencies...');
                        const yarnInstall = spawn('yarn', ['install'], { cwd: userDir });

                        yarnInstall.stdout.on('data', (data) => socket.emit('message', `✅ YARN OUTPUT:\n${data}`));
                        yarnInstall.stderr.on('data', (data) => socket.emit('message', `⚠️ YARN ERROR:\n${data}`));
                        yarnInstall.on('close', (installCode) => {
                            if (installCode === 0) {
                                socket.emit('message', '✅ Dependencies installed successfully!!\nWhich file would you like to run e.g index.js');
                                userStates[userId].step = 'ask_file';
                            } else {
                                socket.emit('message', '❌ Error installing dependencies.');
                            }
                        });
                    } else {
                        socket.emit('message', '❌ Error cloning the repository.');
                    }
                });
                break;

            case userState.step === 'ask_file':
                const filename = message;
                const filePath = path.join(userDir, filename);

                if (!fs.existsSync(filePath)) {
                    return socket.emit('message', '❌ The specified file does not exist.');
                }

                socket.emit('message', `🚀 Running the file: ${filename}`);
                const nodeProcessFile = spawn('node', [filePath], { cwd: userDir });

                userStates[userId].runningProcess = nodeProcessFile;

                nodeProcessFile.stdout.on('data', (data) => socket.emit('message', `✅ NODE OUTPUT:\n${data}`));
                nodeProcessFile.stderr.on('data', (data) => socket.emit('message', `⚠️ NODE ERROR:\n${data}`));
                nodeProcessFile.on('close', (code) => {
                    socket.emit('message', `🚀 Script finished with code ${code}`);
                    delete userStates[userId].runningProcess;
                });
                break;

            default:
                socket.emit('message', '❌ Unrecognized command. Use list, clear, or start.');
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}.`));

                
