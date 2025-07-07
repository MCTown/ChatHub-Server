import {Worker} from 'worker_threads';
import chokidar from 'chokidar';
import path from 'path';
import {Logger} from "./utils/Logger";

let serverWorker: Worker | null = null;

function startServerThread() {
    if (serverWorker) return;
    Logger.info('启动 server 线程');
    serverWorker = new Worker(path.resolve(__dirname, 'server.ts'), {
        execArgv: ['-r', 'ts-node/register'],  // 让 Worker 能直接执行 TS
    });
    serverWorker.on('exit', (code) => {
        Logger.warn(`server 线程退出，退出码 ${code}`);
        serverWorker = null;
    });
    serverWorker.on('error', (err) => {
        Logger.error('server 线程报错:', err);
        process.exit(1)
    });
}

async function stopServerThread() {
    if (!serverWorker) return;
    Logger.info('终止 server 线程…');
    await serverWorker.terminate();
    serverWorker = null;
}

async function restartServerThread():Promise<void> {
    Logger.info('检测到 clients.yaml 改动，重启 server 线程');
    await stopServerThread();
    startServerThread();
}

// 监视配置文件
const configPath = path.resolve(__dirname, 'clients.yaml');
const watcher = chokidar.watch(configPath, {ignoreInitial: true});
watcher.on('change', () => {
    void restartServerThread();
});

// 捕获退出信号，保证清理线程
let cleaning = false;

async function cleanupAndExit(code = 0):Promise<void> {
    if (cleaning) return;
    cleaning = true;
    Logger.info('watcher 退出，清理 server 线程');
    await stopServerThread();
    process.exit(code);
}

process.on('SIGINT', () => cleanupAndExit(0));
process.on('SIGTERM', () => cleanupAndExit(0));
process.on('uncaughtException', (err) => {
    Logger.error('未捕获异常:', err);
    void cleanupAndExit(1);
});
process.on('exit', (code) => {
    if (!cleaning) {
        Logger.info(`process.exit(${code})，做最后一次清理`);
        void stopServerThread();
    }
});

// 一开始启动一次
startServerThread();
