import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Folder, File, ChevronRight, Save, X, FileText, Code } from 'lucide-react';

function FileManager({ serverId, canEdit = true }) {
    const [currentPath, setCurrentPath] = useState('');
    const [files, setFiles] = useState([]);
    const [selectedFile, setSelectedFile] = useState(null);
    const [fileContent, setFileContent] = useState('');
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(false);

    const fetchFiles = useCallback(async () => {
        if (!serverId) {
            console.error('serverId is undefined');
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const res = await axios.get(`/api/server/${serverId}/files`, {
                params: { path: currentPath }
            });
            // Ensure res.data.files is an array
            setFiles(Array.isArray(res.data.files) ? res.data.files : []);
        } catch (err) {
            console.error('Failed to fetch files:', err);
            setFiles([]);
        } finally {
            setLoading(false);
        }
    }, [currentPath, serverId]);

    useEffect(() => {
        fetchFiles();
    }, [fetchFiles]);

    useEffect(() => {
        setSaving(false);
    }, [selectedFile]);

    const loadFile = async (fileName) => {
        const fullPath = currentPath ? `${currentPath}/${fileName}` : fileName;
        setSelectedFile(fullPath);
        setLoading(true);
        try {
            const res = await axios.get(`/api/server/${serverId}/files`, {
                params: { path: fullPath }
            });
            setFileContent(res.data.content);
        } catch (err) {
            console.error('Failed to load file:', err);
            setFileContent('');
        } finally {
            setLoading(false);
        }
    };

    const saveFile = async () => {
        if (!selectedFile) return;
        setSaving(true);
        try {
            // Endpoint fixed: the backend route is /file (it was /files/save, which didn't exist).
            await axios.post(`/api/server/${serverId}/file`, {
                path: selectedFile,
                content: fileContent
            });
        } catch (err) {
            alert('Failed to save file: ' + (err.response?.data?.error || err.message));
        } finally {
            setSaving(false);
        }
    };

    const navigateToFolder = (folderName) => {
        setSelectedFile(null);
        const newPath = currentPath ? `${currentPath}/${folderName}` : folderName;
        setCurrentPath(newPath);
    };

    const navigateUp = () => {
        setSelectedFile(null);
        const pathParts = currentPath.split('/');
        pathParts.pop();
        setCurrentPath(pathParts.join('/'));
    };

    const getFileIcon = (fileName) => {
        const ext = fileName.split('.').pop().toLowerCase();
        if (['cfg', 'ini', 'txt', 'json', 'xml'].includes(ext)) {
            return <FileText size={16} className="text-blue-400" />;
        }
        if (['lua', 'js', 'py'].includes(ext)) {
            return <Code size={16} className="text-green-400" />;
        }
        return <File size={16} className="text-gray-400" />;
    };

    const breadcrumbs = currentPath ? currentPath.split('/') : [];

    return (
        <div className="h-[calc(100vh-380px)] min-h-[480px] flex gap-4">
            {/* File Browser */}
            <div className="w-1/3 glass rounded-2xl flex flex-col">
                {/* Breadcrumb */}
                <div className="p-4 border-b border-gray-700/30 flex items-center space-x-2 text-sm">
                    <button
                        onClick={() => setCurrentPath('')}
                        className="text-blue-400 hover:text-blue-300 font-medium"
                    >
                        Root
                    </button>
                    {breadcrumbs.map((part, idx) => (
                        <React.Fragment key={idx}>
                            <ChevronRight size={14} className="text-gray-600" />
                            <button
                                onClick={() => setCurrentPath(breadcrumbs.slice(0, idx + 1).join('/'))}
                                className="text-blue-400 hover:text-blue-300"
                            >
                                {part}
                            </button>
                        </React.Fragment>
                    ))}
                </div>

                {/* File List */}
                <div className="flex-1 overflow-y-auto p-2">
                    {currentPath && (
                        <button
                            onClick={navigateUp}
                            className="w-full text-left px-3 py-2 hover:bg-gray-800/50 rounded-lg flex items-center space-x-2 text-gray-400 text-sm mb-1"
                        >
                            <Folder size={16} />
                            <span>..</span>
                        </button>
                    )}
                    {loading && !selectedFile ? (
                        <div className="text-center text-gray-500 py-8">Loading...</div>
                    ) : (
                        <>
                            {files.filter(f => f.isDirectory).map(file => (
                                <button
                                    key={file.name}
                                    onClick={() => navigateToFolder(file.name)}
                                    className="w-full text-left px-3 py-2 hover:bg-gray-800/50 rounded-lg flex items-center space-x-2 text-white text-sm"
                                >
                                    <Folder size={16} className="text-yellow-500" />
                                    <span>{file.name}</span>
                                </button>
                            ))}
                            {files.filter(f => !f.isDirectory).map(file => (
                                <button
                                    key={file.name}
                                    onClick={() => loadFile(file.name)}
                                    className={`w-full text-left px-3 py-2 hover:bg-gray-800/50 rounded-lg flex items-center space-x-2 text-sm ${selectedFile === (currentPath ? `${currentPath}/${file.name}` : file.name)
                                        ? 'bg-blue-600/20 text-blue-300'
                                        : 'text-gray-300'
                                        }`}
                                >
                                    {getFileIcon(file.name)}
                                    <span className="flex-1">{file.name}</span>
                                    <span className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)}KB</span>
                                </button>
                            ))}
                        </>
                    )}
                </div>
            </div>

            {/* File Editor */}
            <div className="flex-1 glass rounded-2xl flex flex-col">
                {selectedFile ? (
                    <>
                        <div className="p-4 border-b border-gray-700/30 flex items-center justify-between">
                            <span className="text-white font-medium flex items-center space-x-2">
                                {getFileIcon(selectedFile)}
                                <span>{selectedFile.split('/').pop()}</span>
                            </span>
                            <div className="flex items-center space-x-2">
                                {canEdit && <button
                                    onClick={saveFile}
                                    disabled={saving}
                                    className="bg-accent-600 hover:bg-accent-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg flex items-center space-x-2 text-sm"
                                >
                                    <Save size={16} />
                                    <span>{saving ? 'Saving...' : 'Save'}</span>
                                </button>}
                                <button
                                    onClick={() => setSelectedFile(null)}
                                    className="text-gray-400 hover:text-white p-2"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        </div>
                        <textarea
                            value={fileContent}
                            onChange={(e) => setFileContent(e.target.value)}
                            readOnly={!canEdit}
                            className="flex-1 bg-gray-950 text-gray-100 p-4 font-mono text-sm resize-none focus:outline-none"
                            spellCheck={false}
                        />
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-gray-500">
                        <div className="text-center">
                            <FileText size={48} className="mx-auto mb-4 opacity-50" />
                            <p>Select a file to edit</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default FileManager;
