const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const bcrypt = require('bcrypt');

const userStates = {};
const bannedFilePath = path.join(__dirname, 'banned.json');

// In-memory user store (replace with a database in production)
const users = {};

if (!fs.existsSync(bannedFilePath)) {
    fs.writeFileSync(bannedFilePath, JSON.stringify([]));
}

const loadBannedUsers = () => JSON.parse(fs.readFileSync(bannedFilePath));
const saveBannedUsers = (bannedUsers) => fs.writeFileSync(bannedFilePath, JSON.stringify(bannedUsers));

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
    let authenticatedUser = null;

    socket.on('register', async ({ username, password }) => {
        if (users[username]) {
            socket.emit('registerResponse', { success: false, message: 'Username already exists' });
        } else {
            const hashedPassword = await bcrypt.hash(password, 10);
            users[username] = { password: hashedPassword };
            socket.emit('registerResponse', { success: true, message: 'Registration successful' });
        }
    });

    socket.on('login', async ({ username, password }) => {
        const user = users[username];
        if (user && await bcrypt.compare(password, user.password)) {
            authenticatedUser = username;
            socket.emit('loginResponse', { success: true, message: 'Login successful' });
        } else {
            socket.emit('loginResponse', { success: false, message: 'Invalid credentials' });
        }
    });

    socket.on('logout', () => {
        authenticatedUser = null;
        socket.emit('logoutResponse', { success: true, message: 'Logged out successfully' });
    });

    socket.on('start', () => {
        if (!authenticatedUser) {
            socket.emit('message', '❌ You must be logged in to use this service.');
            return;
        }

        const bannedUsers = loadBannedUsers();

        if (bannedUsers.includes(authenticatedUser)) {
            socket.emit('message', '❌ You are banned from using this service.');
            return;
        }

        const userDir = path.join(__dirname, 'users', authenticatedUser);
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }

        userStates[authenticatedUser] = { step: 'ask_repo', started: true };
        socket.emit('message', '🎅 WELCOME! Please provide the Repository URL you wish to clone and run.');
    });

    socket.on('command', (message) => {
        if (!authenticatedUser) {
            socket.emit('message', '❌ You must be logged in to use this service.');
            return;
        }

        const bannedUsers = loadBannedUsers();

        if (bannedUsers.includes(authenticatedUser)) {
            socket.emit('message', '❌ You are banned from using this service.');
            return;
        }

        if (!userStates[authenticatedUser]?.started) {
            socket.emit('message', '❌ Please use the start command before proceeding so as to avoid error');
            return;
        }

        const userDir = path.join(__dirname, 'users', authenticatedUser);
        if (!userStates[authenticatedUser]) {
            userStates[authenticatedUser] = { step: 'ask_repo', started: false };
        }
        const userState = userStates[authenticatedUser];

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

                userStates[authenticatedUser].runningProcess = nodeProcess;

                nodeProcess.stdout.on('data', (data) => socket.emit('message', `✅ NODE OUTPUT:\n${data}`));
                nodeProcess.stderr.on('data', (data) => socket.emit('message', `⚠️ NODE ERROR:\n${data}`));
                nodeProcess.on('close', (code) => {
                    socket.emit('message', `🚀 Script finished with code ${code}`);
                    delete userStates[authenticatedUser].runningProcess;
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
                                userStates[authenticatedUser].step = 'ask_file';
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

                userStates[authenticatedUser].runningProcess = nodeProcessFile;

                nodeProcessFile.stdout.on('data', (data) => socket.emit('message', `✅ NODE OUTPUT:\n${data}`));
                nodeProcessFile.stderr.on('data', (data) => socket.emit('message', `⚠️ NODE ERROR:\n${data}`));
                nodeProcessFile.on('close', (code) => {
                    socket.emit('message', `🚀 Script finished with code ${code}`);
                    delete userStates[authenticatedUser].runningProcess;
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

    
