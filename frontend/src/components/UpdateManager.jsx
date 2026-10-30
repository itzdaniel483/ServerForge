import React, { useState } from 'react';
import axios from 'axios';
import { RefreshCw, Download, CheckCircle, AlertCircle } from 'lucide-react';

import { getSocket } from '../api';

function UpdateManager({ server }) {
    const [updating, setUpdating] = useState(false);
    const [logs, setLogs] = useState([]);
    const [updateComplete, setUpdateComplete] = useState(false);
    const [updateError, setUpdateError] = useState(null);

    const handleUpdate = async () => {
        if (!server || !server.id) {
            setUpdateError('Server information is missing');
            return;
        }
        setUpdating(true);
        setLogs([]);
        setUpdateComplete(false);
        setUpdateError(null);

        try {
            await axios.post(`/api/server/${server.id}/update`);
        } catch (err) {
            setUpdateError(err.response?.data?.error || 'Failed to start update');
            setUpdating(false);
        }
    };

    React.useEffect(() => {
        if (!server || !server.id) {
            console.error('Server or server.id is undefined in UpdateManager');
            return;
        }

        const handleLog = (log) => {
            setLogs(prev => [...prev, log]);
        };

        const handleComplete = (result) => {
            setUpdating(false);
            if (result.success) {
                setUpdateComplete(true);
            } else {
                setUpdateError(result.error || 'Update failed');
            }
        };

        const socket = getSocket();
        socket.on(`update-log-${server.id}`, handleLog);
        socket.on(`update-complete-${server.id}`, handleComplete);

        return () => {
            socket.off(`update-log-${server.id}`, handleLog);
            socket.off(`update-complete-${server.id}`, handleComplete);
        };
    }, [server]);

    return (
        <div className="space-y-4">
            <div className="bg-gray-900/50 rounded-xl p-6 border border-gray-800">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-semibold text-white mb-2 flex items-center">
                            <Download size={20} className="mr-2 text-blue-400" />
                            Server Update
                        </h3>
                        <p className="text-gray-400 text-sm">
                            Update this server to the latest version using SteamCMD.
                        </p>
                    </div>
                    <button
                        onClick={handleUpdate}
                        disabled={updating}
                        className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 ${updating
                            ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                            : 'bg-blue-600 hover:bg-blue-500 text-white'
                            }`}
                    >
                        <RefreshCw size={16} className={updating ? 'animate-spin' : ''} />
                        {updating ? 'Updating...' : 'Update Server'}
                    </button>
                </div>

                {updateComplete && (
                    <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 flex items-center gap-3 mb-4">
                        <CheckCircle size={20} className="text-green-400" />
                        <span className="text-green-400">Update completed successfully!</span>
                    </div>
                )}

                {updateError && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-center gap-3 mb-4">
                        <AlertCircle size={20} className="text-red-400" />
                        <span className="text-red-400">{updateError}</span>
                    </div>
                )}

                {logs.length > 0 && (
                    <div className="bg-gray-950 rounded-lg p-4 border border-gray-800 max-h-96 overflow-y-auto">
                        <div className="font-mono text-xs text-gray-300 space-y-1">
                            {logs.map((log, i) => (
                                <div key={i}>{log}</div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                <p className="text-yellow-400 text-sm">
                    <strong>Note:</strong> The server will be automatically stopped during the update process and must be manually restarted afterwards.
                </p>
            </div>
        </div>
    );
}

export default UpdateManager;
