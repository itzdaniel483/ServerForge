import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Terminal, Plus, X, Save, Clock } from 'lucide-react';

function CommandEditor({ serverId, serverData }) {
    const [executable, setExecutable] = useState('');
    const [args, setArgs] = useState([]);
    const [newArg, setNewArg] = useState('');
    const [saving, setSaving] = useState(false);

    const [port, setPort] = useState('27015');

    useEffect(() => {
        if (serverData) {
            setExecutable(serverData.executable || '');
            setArgs(serverData.args || []);

            // Extract port from args
            const portIndex = (serverData.args || []).indexOf('+port');
            if (portIndex !== -1 && serverData.args[portIndex + 1]) {
                setPort(serverData.args[portIndex + 1]);
            }

        }
    }, [serverData]);


    const updatePort = (newPort) => {
        setPort(newPort);
        const newArgs = [...args];
        const portIndex = newArgs.indexOf('+port');

        if (newPort) {
            if (portIndex !== -1) {
                newArgs[portIndex + 1] = newPort;
            } else {
                newArgs.push('+port', newPort);
            }
        } else {
            if (portIndex !== -1) {
                newArgs.splice(portIndex, 2);
            }
        }
        setArgs(newArgs);
    };

    const addArg = () => {
        if (newArg.trim()) {
            setArgs([...args, newArg.trim()]);
            setNewArg('');
        }
    };

    const removeArg = (index) => {
        setArgs(args.filter((_, i) => i !== index));
    };

    const saveConfig = async () => {
        setSaving(true);
        try {
            await axios.put(`/api/server/${serverId}/config`, {
                executable,
                args
            });
            alert('Configuration saved!');
        } catch (err) {
            alert(`Save failed: ${err.response?.data?.error || err.message}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="glass rounded-2xl p-4">
                <h3 className="text-white font-bold text-lg mb-4 flex items-center">
                    <Terminal size={20} className="mr-2 text-blue-400" />
                    Startup Configuration
                </h3>

                {/* Executable Path */}
                <div className="mb-6">
                    <label className="block text-gray-400 text-sm mb-2">Executable Path</label>
                    <input
                        type="text"
                        value={executable}
                        onChange={(e) => setExecutable(e.target.value)}
                        className="w-full bg-gray-950 text-white px-4 py-2 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none font-mono text-sm"
                        placeholder="C:\Games\Server\srcds.exe"
                    />
                    <p className="text-xs text-gray-500 mt-1">A file inside the server folder</p>
                </div>

                {/* Server Port */}
                <div className="mb-6">
                    <label className="block text-gray-400 text-sm mb-2">Server Port</label>
                    <input
                        type="text"
                        value={port}
                        onChange={(e) => updatePort(e.target.value)}
                        className="w-full bg-gray-950 text-white px-4 py-2 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none font-mono text-sm"
                        placeholder="27015"
                    />
                    <p className="text-xs text-gray-500 mt-1">Default is 27015</p>
                </div>

                {/* Command Arguments */}
                <div>
                    <label className="block text-gray-400 text-sm mb-2">Command-Line Arguments</label>
                    <div className="space-y-2 mb-3">
                        {args.map((arg, index) => (
                            <div key={index} className="flex items-center space-x-2">
                                <input
                                    type="text"
                                    value={arg}
                                    onChange={(e) => {
                                        const newArgs = [...args];
                                        newArgs[index] = e.target.value;
                                        setArgs(newArgs);
                                    }}
                                    className="flex-1 bg-gray-950 text-white px-4 py-2 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none font-mono text-sm"
                                />
                                <button
                                    onClick={() => removeArg(index)}
                                    className="text-red-400 hover:text-red-300 p-2"
                                    title="Remove argument"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Add New Argument */}
                    <div className="flex items-center space-x-2">
                        <input
                            type="text"
                            value={newArg}
                            onChange={(e) => setNewArg(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && addArg()}
                            className="flex-1 bg-gray-950 text-white px-4 py-2 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none font-mono text-sm"
                            placeholder="-game garrysmod"
                        />
                        <button
                            onClick={addArg}
                            className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg flex items-center space-x-2 text-sm"
                        >
                            <Plus size={16} />
                            <span>Add</span>
                        </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">Common args: -console, -game, +map, +maxplayers</p>
                </div>

                {/* Preview */}
                <div className="mt-6 p-4 bg-gray-950 rounded-lg border border-gray-800">
                    <p className="text-xs text-gray-500 mb-2">Command Preview:</p>
                    <code className="text-green-400 text-sm break-all">
                        {executable} {args.join(' ')}
                    </code>
                </div>

                {/* Save Button */}
                <div className="mt-6">
                    <button
                        onClick={saveConfig}
                        disabled={saving}
                        className="w-full bg-accent-600 hover:bg-accent-500 disabled:opacity-50 text-white px-4 py-3 rounded-xl flex items-center justify-center space-x-2 font-medium"
                    >
                        <Save size={18} />
                        <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
                    </button>
                </div>
            </div>

            {/* Scheduled restarts moved to the Schedule tab (claude, 2026-10-30) */}
        </div>
    );
}

export default CommandEditor;
