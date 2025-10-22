import React, { useState } from 'react';
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword,
    User,
} from 'firebase/auth';
import { auth } from '../firebase';
import { setupNewUser } from '../services/emailService';
import { LogoEnvelopeIcon, MicIcon, UserIcon, LockIcon } from './icons/IconComponents';

const Login: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isRegistering, setIsRegistering] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (password.length < 6) {
            setError('Password must be at least 6 characters.');
            return;
        }
        
        try {
            if (isRegistering) {
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                await setupNewUser(userCredential.user);
            } else {
                const cred = await signInWithEmailAndPassword(auth, email, password);
                // Ensure profile doc exists for older accounts or if profile was removed
                await setupNewUser(cred.user);
            }
        } catch (err: any) {
            setError(err.message.replace('Firebase: ', ''));
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-sky-50 to-gray-50 p-4">
            <div className="w-full max-w-sm p-8 space-y-6 bg-white rounded-xl shadow-lg">
                <div className="text-center space-y-4">
                    <div className="inline-block p-3 bg-blue-600 rounded-2xl shadow-md">
                        <LogoEnvelopeIcon className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-blue-600">VoxMail</h1>
                    <p className="text-sm text-gray-500">Voice-First Email Platform</p>
                </div>
                
                <button 
                    className="w-full flex items-center justify-center gap-3 py-3 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    onClick={() => alert('Voice Sign-in is coming soon!')}
                    aria-label="Sign in with Voice (coming soon)"
                >
                    <MicIcon className="w-5 h-5 text-gray-600" />
                    Sign in with Voice
                </button>

                <div className="flex items-center">
                    <hr className="flex-grow border-gray-200" />
                    <span className="mx-4 text-xs font-medium text-gray-400 uppercase">OR CONTINUE MANUALLY</span>
                    <hr className="flex-grow border-gray-200" />
                </div>

                <div className="flex bg-gray-100 p-1 rounded-lg">
                    <button
                        onClick={() => { setIsRegistering(false); setError(null); }}
                        className={`w-1/2 py-2 text-sm font-semibold rounded-md transition-all duration-300 ${!isRegistering ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:bg-gray-200'}`}
                    >
                        Login
                    </button>
                    <button
                        onClick={() => { setIsRegistering(true); setError(null); }}
                        className={`w-1/2 py-2 text-sm font-semibold rounded-md transition-all duration-300 ${isRegistering ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:bg-gray-200'}`}
                    >
                        Register
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="email" className="text-sm font-medium text-gray-700">Email</label>
                        <div className="relative mt-1">
                            <span className="absolute inset-y-0 left-0 flex items-center pl-3" aria-hidden="true">
                                <UserIcon className="w-5 h-5 text-gray-400" />
                            </span>
                            <input 
                                id="email" 
                                type="email" 
                                value={email} 
                                onChange={(e) => setEmail(e.target.value)} 
                                placeholder="email@example.com" 
                                required
                                className="w-full py-3 pl-10 pr-3 bg-gray-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition placeholder-gray-400" 
                            />
                        </div>
                    </div>
                    <div>
                        <label htmlFor="password" className="text-sm font-medium text-gray-700">Password</label>
                        <div className="relative mt-1">
                            <span className="absolute inset-y-0 left-0 flex items-center pl-3" aria-hidden="true">
                                <LockIcon className="w-5 h-5 text-gray-400" />
                            </span>
                            <input 
                                id="password" 
                                type="password" 
                                value={password} 
                                onChange={(e) => setPassword(e.target.value)} 
                                placeholder="••••••••" 
                                required
                                className="w-full py-3 pl-10 pr-3 bg-gray-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition placeholder-gray-400" 
                            />
                        </div>
                    </div>
                    {error && <p className="text-red-500 text-xs text-center pt-1">{error}</p>}
                    <button 
                        type="submit"
                        className="w-full py-3 mt-4 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                        {isRegistering ? 'Register' : 'Sign In'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default Login;