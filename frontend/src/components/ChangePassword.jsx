import React, { useState } from 'react';
import axios from 'axios';
import { Lock, Check, AlertCircle } from 'lucide-react';
import { signOut } from '../api';

function ChangePassword() {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [message, setMessage] = useState(null);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setMessage(null);

        // Validation
        if (!currentPassword || !newPassword || !confirmPassword) {
            setMessage({ type: 'error', text: 'All fields are required' });
            return;
        }

        if (newPassword !== confirmPassword) {
            setMessage({ type: 'error', text: 'New passwords do not match' });
            return;
        }

        if (newPassword.length < 8) {
            setMessage({ type: 'error', text: 'Password must be at least 8 characters' });
            return;
        }

        setLoading(true);

        try {
            await axios.post('/api/users/change-password', {
                currentPassword,
                newPassword
            });

            // The server has ended every session for this account, this one included.
            signOut('Password changed. Sign in with your new password.');
        } catch (err) {
            setMessage({
                type: 'error',
                text: err.response?.data?.error || 'Failed to change password'
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-gray-900 rounded-2xl border border-gray-800/50 shadow-xl backdrop-blur-sm p-8">
            <div className="mb-6">
                <h3 className="text-xl font-bold text-white mb-2 flex items-center">
                    <Lock size={20} className="mr-3 text-blue-400" />
                    Change Password
                </h3>
                <p className="text-gray-400 text-sm">
                    Update your account password
                </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                {message && (
                    <div className={`p-4 rounded-lg flex items-center gap-3 ${message.type === 'success'
                        ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                        : 'bg-red-500/10 border border-red-500/20 text-red-400'
                        }`}>
                        {message.type === 'success' ? (
                            <Check size={20} className="flex-shrink-0" />
                        ) : (
                            <AlertCircle size={20} className="flex-shrink-0" />
                        )}
                        <span className="text-sm">{message.text}</span>
                    </div>
                )}

                <div>
                    <label className="block text-gray-400 text-sm font-medium mb-2">
                        Current Password
                    </label>
                    <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="w-full bg-gray-950 text-white px-4 py-3 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none transition-colors"
                        placeholder="Enter current password"
                    />
                </div>

                <div>
                    <label className="block text-gray-400 text-sm font-medium mb-2">
                        New Password
                    </label>
                    <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full bg-gray-950 text-white px-4 py-3 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none transition-colors"
                        placeholder="Enter new password"
                    />
                </div>

                <div>
                    <label className="block text-gray-400 text-sm font-medium mb-2">
                        Confirm New Password
                    </label>
                    <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full bg-gray-950 text-white px-4 py-3 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none transition-colors"
                        placeholder="Confirm new password"
                    />
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-semibold py-3 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {loading ? 'Changing Password...' : 'Change Password'}
                </button>
            </form>
        </div>
    );
}

export default ChangePassword;
