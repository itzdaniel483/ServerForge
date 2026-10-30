const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');

class BackupService {
    constructor() {
        this.backupsDir = process.env.BACKUPS_DIR || path.join(__dirname, '../backups');
        fs.ensureDirSync(this.backupsDir);
    }

    getBackupPath(serverId) {
        const dir = path.join(this.backupsDir, serverId);
        fs.ensureDirSync(dir);
        return dir;
    }

    /**
     * Create a backup of the server directory
     */
    async createBackup(server) {
        const { Worker } = require('worker_threads');

        const backupId = Math.random().toString(36).substring(2, 15);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `backup_${timestamp}_${backupId}.zip`;
        const outputPath = path.join(this.getBackupPath(server.id), filename);

        console.log(`Creating backup for ${server.id} at ${outputPath}`);

        try {
            // Run zip creation in a worker thread to avoid blocking the event loop
            const result = await new Promise((resolve, reject) => {
                const worker = new Worker(path.join(__dirname, 'backupWorker.js'), {
                    workerData: {
                        serverPath: server.path,
                        outputPath: outputPath
                    }
                });

                worker.on('message', (msg) => {
                    if (msg.success) {
                        resolve(msg);
                    } else {
                        reject(new Error(msg.error));
                    }
                });

                worker.on('error', reject);
                worker.on('exit', (code) => {
                    if (code !== 0) {
                        reject(new Error(`Worker stopped with exit code ${code}`));
                    }
                });
            });

            console.log(`Backup created: ${filename} (${result.size} bytes)`);

            return {
                filename,
                size: result.size,
                created: new Date()
            };
        } catch (err) {
            console.error('Backup failed:', err);
            throw err;
        }
    }

    /**
     * List backups for a server
     */
    async listBackups(serverId) {
        const dir = this.getBackupPath(serverId);
        const files = await fs.readdir(dir);

        const backups = [];
        for (const file of files) {
            if (file.endsWith('.zip')) {
                const stats = await fs.stat(path.join(dir, file));
                backups.push({
                    filename: file,
                    size: stats.size,
                    created: stats.mtime
                });
            }
        }

        // Sort by newest first
        return backups.sort((a, b) => b.created - a.created);
    }

    /**
     * Restore a backup
     * WARNING: This deletes the current server directory!
     */
    async restoreBackup(server, filename) {
        const backupPath = path.join(this.getBackupPath(server.id), filename);

        if (!await fs.pathExists(backupPath)) {
            throw new Error('Backup file not found');
        }

        console.log(`Restoring backup ${filename} for ${server.id}`);

        // 1. Empty current directory (dangerous!)
        await fs.emptyDir(server.path);

        // 2. Extract zip
        const zip = new AdmZip(backupPath);
        zip.extractAllTo(server.path, true);

        return true;
    }

    /**
     * Keep only the newest `keep` backups for a server (used by scheduled backups).
     */
    async prune(serverId, keep = 10) {
        const list = await this.listBackups(serverId);
        for (const old of list.slice(Math.max(1, keep))) await fs.remove(path.join(this.getBackupPath(serverId), old.filename));
    }

    /**
     * Delete a backup file
     */
    async deleteBackup(serverId, filename) {
        const filePath = path.join(this.getBackupPath(serverId), filename);
        await fs.remove(filePath);
        return true;
    }
}

module.exports = new BackupService();
