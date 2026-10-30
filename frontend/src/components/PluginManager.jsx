import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Package, Download, Trash2, CheckCircle, AlertCircle, Upload } from 'lucide-react';

function PluginManager({ server }) {
    const [plugins, setPlugins] = useState([]);
    const [availablePlugins, setAvailablePlugins] = useState([]);
    const [loading, setLoading] = useState(true);
    const [installing, setInstalling] = useState({});
    const [workshopItems, setWorkshopItems] = useState([]);

    const fetchPlugins = useCallback(async () => {
        if (!server || !server.id) {
            console.error('Server or server.id is undefined');
            setLoading(false);
            return;
        }
        try {
            const res = await axios.get(`/api/server/${server.id}/plugins`);
            setPlugins(res.data.installed || []);
            setAvailablePlugins(res.data.available || []);
            setLoading(false);
        } catch (err) {
            console.error('Failed to fetch plugins:', err);
            setLoading(false);
        }
    }, [server]);

    useEffect(() => {
        fetchPlugins();
    }, [fetchPlugins]);

    const handleInstall = async (pluginId) => {
        setInstalling(prev => ({ ...prev, [pluginId]: true }));
        try {
            await axios.post(`/api/server/${server.id}/plugins/install`, { pluginId });
            await fetchPlugins();
        } catch (err) {
            alert(`Failed to install plugin: ${err.response?.data?.error || err.message}`);
        } finally {
            setInstalling(prev => ({ ...prev, [pluginId]: false }));
        }
    };

    const handleWorkshopSearch = async (queryOverride) => {
        const searchQuery = queryOverride !== undefined ? queryOverride : '';

        setLoading(true);
        try {
            const res = await axios.get(`/api/server/${server.id}/workshop/search`, {
                params: { q: searchQuery }
            });
            setWorkshopItems(res.data.items || []);
        } catch (err) {
            if (err.response?.status === 400 && err.response?.data?.error?.includes('API Key')) {
                alert('Steam Web API Key is missing! Please go to Settings to configure it.');
            } else {
                console.error(`Search failed: ${err.response?.data?.error || err.message}`);
                if (searchQuery) {
                    alert(`Search failed: ${err.response?.data?.error || err.message}`);
                }
            }
        } finally {
            setLoading(false);
        }
    };

    const handleInstallWorkshop = async (workshopId) => {
        alert(`To install this addon (ID: ${workshopId}), please add it to your Steam Workshop Collection.`);
    };

    useEffect(() => {
        // Load default workshop items on mount
        handleWorkshopSearch('');
    }, []);

    if (loading) {
        return <div className="text-gray-400">Loading plugins...</div>;
    }

    return (
        <div className="space-y-6">
            {/* Installed Plugins */}
            <div className="bg-gray-900/50 rounded-xl p-6 border border-gray-800">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
                    <CheckCircle size={20} className="mr-2 text-green-400" />
                    Installed Plugins
                </h3>

                {plugins.length === 0 ? (
                    <p className="text-gray-500 text-sm">No plugins installed yet.</p>
                ) : (
                    <div className="space-y-3">
                        {plugins.map(plugin => (
                            <div key={plugin.id} className="bg-gray-950 rounded-lg p-4 border border-gray-800 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <Package size={20} className="text-green-400" />
                                    <div>
                                        <h4 className="font-semibold text-white">{plugin.name}</h4>
                                        <p className="text-xs text-gray-400">{plugin.description}</p>
                                    </div>
                                </div>
                                {/* Uninstall button removed: the backend has no uninstall route (claude, 2026-10-30). */}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Available Plugins */}
            <div className="bg-gray-900/50 rounded-xl p-6 border border-gray-800">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
                    <Download size={20} className="mr-2 text-blue-400" />
                    Available Plugins
                </h3>

                {availablePlugins.length === 0 ? (
                    <p className="text-gray-500 text-sm">No additional plugins available for this game.</p>
                ) : (
                    <div className="space-y-3">
                        {availablePlugins.map(plugin => (
                            <div key={plugin.id} className="bg-gray-950 rounded-lg p-4 border border-gray-800 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <Package size={20} className="text-gray-600" />
                                    <div>
                                        <h4 className="font-semibold text-white">{plugin.name}</h4>
                                        <p className="text-xs text-gray-400">{plugin.description}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleInstall(plugin.id)}
                                    disabled={installing[plugin.id]}
                                    className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 ${installing[plugin.id]
                                        ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                        : 'bg-blue-600 hover:bg-blue-500 text-white'
                                        }`}
                                >
                                    <Download size={16} />
                                    {installing[plugin.id] ? 'Installing...' : 'Install'}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Info */}
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p className="text-blue-400 text-sm">
                    <strong>Note:</strong> Plugins extend your server's functionality. Make sure to restart your server after installing or uninstalling plugins.
                </p>
            </div>

            {/* Steam Workshop */}
            <div className="bg-gray-900/50 rounded-xl p-6 border border-gray-800">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
                    <Upload size={20} className="mr-2 text-purple-400" />
                    Steam Workshop
                </h3>

                <div className="space-y-6">
                    {/* Collection ID Configuration */}
                    <div className="bg-gray-950 rounded-lg p-4 border border-gray-800">
                        <label className="block text-sm font-medium text-gray-400 mb-2">Workshop Collection ID</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder="e.g. 123456789"
                                defaultValue={server.workshopCollectionId || ''}
                                className="flex-1 bg-gray-900 text-white border border-gray-700 rounded-lg px-4 py-2 focus:border-blue-500 focus:outline-none"
                                id="collectionIdInput"
                            />
                            <button
                                onClick={async () => {
                                    const id = document.getElementById('collectionIdInput').value;
                                    try {
                                        await axios.post(`/api/server/${server.id}/workshop`, { collectionId: id });
                                        alert('Workshop collection updated! Restart server to apply.');
                                    } catch (err) {
                                        alert('Failed to update collection: ' + err.message);
                                    }
                                }}
                                className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-lg font-medium"
                            >
                                Set Collection
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                            Set a Steam Workshop Collection ID to automatically download addons on server start.
                        </p>
                    </div>

                    {/* Workshop Search */}
                    <div>
                        <h4 className="text-white font-medium mb-3">Search Workshop</h4>
                        <div className="flex gap-2 mb-4">
                            <input
                                type="text"
                                placeholder="Search for addons..."
                                className="flex-1 bg-gray-950 text-white border border-gray-700 rounded-lg px-4 py-2 focus:border-blue-500 focus:outline-none"
                                id="workshopSearchInput"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        handleWorkshopSearch(e.target.value);
                                    }
                                }}
                            />
                            <button
                                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-medium"
                                onClick={() => handleWorkshopSearch(document.getElementById('workshopSearchInput').value)}
                            >
                                Search
                            </button>
                        </div>

                        {/* Search Results Grid */}
                        {workshopItems.length > 0 && (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
                                {workshopItems.map(item => (
                                    <div key={item.id} className="bg-gray-950 rounded-lg border border-gray-800 overflow-hidden flex flex-col">
                                        <div className="h-32 bg-gray-900 relative">
                                            {item.preview ? (
                                                <img src={item.preview} alt={item.title} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-gray-700">
                                                    <Package size={32} />
                                                </div>
                                            )}
                                        </div>
                                        <div className="p-3 flex-1 flex flex-col">
                                            <h5 className="font-semibold text-white text-sm mb-1 line-clamp-1" title={item.title}>{item.title}</h5>
                                            <p className="text-xs text-gray-500 mb-3 line-clamp-2 flex-1">{item.description}</p>
                                            <button
                                                onClick={() => handleInstallWorkshop(item.id)}
                                                className="w-full bg-gray-800 hover:bg-green-600 hover:text-white text-gray-300 py-2 rounded text-xs font-medium transition-colors flex items-center justify-center gap-2"
                                            >
                                                <Download size={14} />
                                                Install
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        {workshopItems.length === 0 && !loading && (
                            <p className="text-gray-500 text-sm italic">Search for addons to see results here.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default PluginManager;
