let adbInstance

export function setAdbInstance(instance) {
    adbInstance = instance;
}

export function getAdbInstance() {
    return adbInstance;
}

// The ADB connection multiplexes everything (shell commands, raw sockets) over
// a single USB transport. Firing multiple operations concurrently (e.g. the
// status bar's polling loop racing with the Forwarded Service proxy) causes
// intermittent "Socket open failed"/transport errors. Serialize all ADB
// operations through this queue app-wide instead of letting callers race.
let adbLockQueue = Promise.resolve();

export function withAdbLock(fn) {
    const result = adbLockQueue.then(fn, fn);
    adbLockQueue = result.then(() => {}, () => {});
    return result;
}

/**
 * Spawn a long-running/continuous command (e.g. `journalctl -f`, `dmesg --follow`)
 * and return its stdout stream plus a way to stop it. Unlike executeCommand, this
 * does not wait for the process to finish - only the spawn itself goes through
 * withAdbLock, not the whole streaming lifetime (that would starve every other
 * ADB operation for as long as the stream stays open).
 * @param {string} command
 * @returns {Promise<{stdout: ReadableStream<Uint8Array>, kill: () => void}>}
 */
export async function spawnLogStream(command) {
    if (!adbInstance) {
        throw new Error('ADB instance not available');
    }
    return withAdbLock(async () => {
        const process = adbInstance.subprocess.shellProtocol?.isSupported
            ? await adbInstance.subprocess.shellProtocol.spawn(command)
            : await adbInstance.subprocess.noneProtocol.spawn(command);

        return {
            stdout: process.stdout,
            kill: () => {
                try {
                    process.kill?.();
                } catch (error) {
                    console.warn('Failed to kill log stream process:', error);
                }
            }
        };
    });
}

// 执行shell命令
export async function executeCommand(command) {
    if (!adbInstance) {
        return '';
    }
    try {
        return await withAdbLock(async () => {
            // 优先使用 shell protocol，如果不支持则使用 none protocol
            if (adbInstance.subprocess.shellProtocol?.isSupported) {
                const result = await adbInstance.subprocess.shellProtocol.spawnWaitText(command);
                return result.stdout;
            } else {
                // 使用 none protocol 作为备选
                const process = await adbInstance.subprocess.noneProtocol.spawn(command);
                const reader = process.stdout.getReader();
                const chunks = [];
                const decoder = new TextDecoder();

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(decoder.decode(value, { stream: true }));
                }
                return chunks.join('');
            }
        });
    } catch (error) {
        console.error('执行命令出错:', error);
        return '';
    }
}

// 计算文件大小
export function formatSize(size) {
    if (size < 1024) {
        return size + 'B'
    } else if (size < 1024 * 1024) {
        return (Number(size) / 1024).toFixed(2) + 'KB'
    } else if (size < 1024 * 1024 * 1024) {
        return (Number(size) / 1024 / 1024).toFixed(2) + 'MB'
    } else {
        return (Number(size) / 1024 / 1024 / 1024).toFixed(2) + 'GB'
    }
}