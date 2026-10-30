import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Archive, RotateCcw, Trash2, Plus, Clock, HardDrive } from 'lucide-react';

function BackupManager({ serverId, canRestore = true }) {
    const [backups, setBackups] = useState([]);
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [restoring, setRestoring] = useState(null);
    const [deleting, setDeleting] = useState(null);

    const fetchBackups = useCallback(async () => {
        if (!serverId) {
            console.error('serverId is undefined');
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const res = await axios.get(`/api/server/${serverId}/backups`);
            setBackups(Array.isArray(res.data) ? res.data : []);
        } catch (err) {
            console.error('Failed to fetch backups:', err);
            setBackups([]);
        } finally {
            setLoading(false);
        }
    }, [serverId]);

    useEffect(() => {
        fetchBackups();
    }, [fetchBackups]);

    const createBackup = async () => {
        setCreating(true);
        try {
            await axios.post(`/api/server/${serverId}/backups`);
            await fetchBackups();
            alert('Backup created successfully!');
        } catch (err) {
            alert(`Backup failed: ${err.response?.data?.error || err.message}`);
        } finally {
            setCreating(false);
        }
    };

    const restoreBackup = async (filename) => {
        if (!window.confirm('WARNING: This will overwrite all current server files. Are you sure?')) return;

        setRestoring(filename);
        try {
            await axios.post(`/api/server/${serverId}/backups/restore`, { filename });
            alert('Server restored successfully!');
        } catch (err) {
            alert(`Restore failed: ${err.response?.data?.error || err.message}`);
        } finally {
            setRestoring(null);
        }
    };

    const deleteBackup = async (filename) => {
        if (!window.confirm('Are you sure you want to delete this backup?')) return;

        setDeleting(filename);
        try {
            await axios.delete(`/api/server/${serverId}/backups/${encodeURIComponent(filename)}`);
            await fetchBackups();
        } catch (err) {
            alert(`Delete failed: ${err.response?.data?.error || err.message}`);
        } finally {
            setDeleting(null);
        }
    };

    const formatSize = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatDate = (dateStr) => {
        return new Date(dateStr).toLocaleString();
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h3 className="text-white font-bold text-lg flex items-center">
                    <Archive size={20} className="mr-2 text-yellow-400" />
                    Backups
                </h3>
                <button
                    onClick={createBackup}
                    disabled={creating}
                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg flex items-center space-x-2 font-medium text-sm"
                >
                    <Plus size={16} />
                    <span>{creating ? 'Creating Backup...' : 'Create Backup'}</span>
                </button>
            </div>

            <div className="bg-gray-900/50 rounded-xl border border-gray-700/30 overflow-hidden">
                <table className="w-full text-left text-sm text-gray-400">
                    <thead className="bg-gray-950 text-gray-200 uppercase font-medium">
                        <tr>
                            <th className="px-6 py-3">Filename</th>
                            <th className="px-6 py-3">Created</th>
                            <th className="px-6 py-3">Size</th>
                            <th className="px-6 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                        {loading ? (
                            <tr>
                                <td colSpan="4" className="px-6 py-8 text-center">Loading backups...</td>
                            </tr>
                        ) : backups.length === 0 ? (
                            <tr>
                                <td colSpan="4" className="px-6 py-8 text-center text-gray-500">No backups found.</td>
                            </tr>
                        ) : (
                            backups.map((backup) => (
                                <tr key={backup.filename} className="hover:bg-gray-800/30 transition-colors">
                                    <td className="px-6 py-4 font-mono text-white">{backup.filename}</td>
                                    <td className="px-6 py-4 flex items-center">
                                        <Clock size={14} className="mr-2 text-gray-600" />
                                        {formatDate(backup.created)}
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center">
                                            <HardDrive size={14} className="mr-2 text-gray-600" />
                                            {formatSize(backup.size)}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right space-x-2">
                                        {canRestore && <>
                                        <button
                                            onClick={() => restoreBackup(backup.filename)}
                                            disabled={restoring === backup.filename}
                                            className="text-yellow-400 hover:text-yellow-300 disabled:opacity-50 p-2"
                                            title="Restore"
                                        >
                                            <RotateCcw size={18} />
                                        </button>
                                        <button
                                            onClick={() => deleteBackup(backup.filename)}
                                            disabled={deleting === backup.filename}
                                            className="text-red-400 hover:text-red-300 disabled:opacity-50 p-2"
                                            title="Delete"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                        </>}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default BackupManager;
