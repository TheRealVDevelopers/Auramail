// Add type definitions for the Web Speech API to fix TypeScript errors.
// This is necessary because the API is not yet a W3C standard.
interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    grammars: any;
    lang: string;
    interimResults: boolean;
    maxAlternatives: number;
    onaudioend: ((ev: Event) => any) | null;
    onaudiostart: ((ev: Event) => any) | null;
    onend: ((ev: Event) => any) | null;
    onerror: ((ev: any) => any) | null;
    onnomatch: ((ev: any) => any) | null;
    onresult: ((ev: any) => any) | null;
    onsoundend: ((ev: Event) => any) | null;
    onsoundstart: ((ev: Event) => any) | null;
    onspeechend: ((ev: Event) => any) | null;
    onspeechstart: ((ev: Event) => any) | null;
    onstart: ((ev: Event) => any) | null;
    serviceURI: string;
    abort(): void;
    start(): void;
    stop(): void;
}

declare global {
    interface Window {
        SpeechRecognition: new () => SpeechRecognition;
        webkitSpeechRecognition: new () => SpeechRecognition;
    }
}

// Speech Recognition type definitions
interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    grammars: any;
    lang: string;
    interimResults: boolean;
    maxAlternatives: number;
    onaudioend: ((ev: Event) => any) | null;
    onaudiostart: ((ev: Event) => any) | null;
    onend: ((ev: Event) => any) | null;
    onerror: ((ev: any) => any) | null;
    onnomatch: ((ev: any) => any) | null;
    onresult: ((ev: any) => any) | null;
    onsoundend: ((ev: Event) => any) | null;
    onsoundstart: ((ev: Event) => any) | null;
    onspeechend: ((ev: Event) => any) | null;
    onspeechstart: ((ev: Event) => any) | null;
    onstart: ((ev: Event) => any) | null;
    serviceURI: string;
    abort(): void;
    start(): void;
    stop(): void;
}

declare global {
    interface Window {
        SpeechRecognition: new () => SpeechRecognition;
        webkitSpeechRecognition: new () => SpeechRecognition;
    }
}

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { auth, db } from '../firebase';
import { setupNewUser } from '../services/emailService';
import { LogoEnvelopeIcon, UserIcon, LockIcon, MicIcon } from './icons/IconComponents';
import { useTranslations } from '../utils/translations';
import { useAppContext } from '../context/AppContext';
import { speakWithBrowserTTS } from '../utils/audioUtils';

const Login: React.FC = () => {
    const { state } = useAppContext();
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isRegistering, setIsRegistering] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Voice authentication states
    const [isVoiceMode, setIsVoiceMode] = useState(false);
    const [voiceStep, setVoiceStep] = useState<'initial' | 'choice' | 'username' | 'password' | 'confirm'>('initial');
    const [voiceFeedback, setVoiceFeedback] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [transcribedText, setTranscribedText] = useState('');
    const [needsUserGesture, setNeedsUserGesture] = useState(true);
    const [isAuthenticating, setIsAuthenticating] = useState(false);

    // Refs
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const hasSpokenWelcomeRef = useRef(false);
    const voiceStepRef = useRef(voiceStep);
    const isRegisteringRef = useRef(isRegistering);
    const usernameRef = useRef('');
    const passwordRef = useRef('');

    const t = useTranslations();

    // Helper to sanitize voice-captured input for email/username usage
    const sanitizeUsername = useCallback((name: string) => {
        let cleaned = name.trim().toLowerCase();

        // Handle natural speech for common email terms if they were transcribed as words
        cleaned = cleaned
            .replace(/\s+at\s+/g, '@')
            .replace(/\s+dot\s+/g, '.')
            .replace(/\s+/g, ''); // Remove all remaining spaces

        // If it looks like a full email already, don't mess with it too much, just basic cleanup
        if (cleaned.includes('@')) {
            return cleaned.replace(/[^\w.@-]/g, '');
        }

        // Otherwise treat as username and be strict
        return cleaned
            .replace(/[^\w.-]/g, '') // Only allow alphanumeric, dots, and hyphens
            .replace(/^[.-]+|[.-]+$/g, ''); // Remove leading/trailing dots and hyphens
    }, []);

    const sanitizePassword = useCallback((pass: string) => {
        return pass.replace(/\s/g, ''); // Always remove spaces for internal consistency
    }, []);

    // Keep refs in sync
    useEffect(() => { voiceStepRef.current = voiceStep; }, [voiceStep]);
    useEffect(() => { isRegisteringRef.current = isRegistering; }, [isRegistering]);

    // Voice helper functions
    const speak = useCallback((text: string, onComplete?: () => void) => {
        const currentLang = state.currentLanguage;
        setVoiceFeedback(text);
        speakWithBrowserTTS(text, currentLang, onComplete);
    }, [state.currentLanguage]);

    const stopListening = useCallback(() => {
        setIsListening(false);
        recognitionRef.current?.stop();
    }, []);

    const startListening = useCallback(() => {
        const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            speak("Voice recognition is not supported in this browser.");
            return;
        }

        if (!recognitionRef.current) {
            recognitionRef.current = new SpeechRecognition();
            const recognition = recognitionRef.current;
            recognition.lang = state.currentLanguage;
            recognition.continuous = false;
            recognition.interimResults = false;

            recognition.onresult = (event) => {
                const transcript = event.results[event.results.length - 1][0].transcript.trim();
                setTranscribedText(transcript);
                handleVoiceInput(transcript);
            };

            recognition.onerror = (event) => {
                console.error('Speech recognition error:', event.error);
                if (event.error !== 'no-speech') {
                    speak("Sorry, I had trouble understanding. Let's try again.", startListening);
                } else {
                    speak("I didn't hear anything. Please try again.", startListening);
                }
            };

            recognition.onend = () => {
                setIsListening(false);
            };
        }

        recognitionRef.current.start();
        setIsListening(true);
    }, [speak, state]);

    // Handle voice input based on current step
    const handleVoiceInput = useCallback((text: string) => {
        const lowerText = text.toLowerCase().trim();
        console.log('[VOICE INPUT]', lowerText, 'at step:', voiceStepRef.current);

        switch (voiceStepRef.current) {
            case 'initial':
                // User chooses voice or manual
                if (lowerText.includes('voice')) {
                    setVoiceStep('choice');
                    speak('Would you like to register a new account or login?', startListening);
                } else if (lowerText.includes('manual')) {
                    setIsVoiceMode(false);
                    if (window.speechSynthesis) {
                        window.speechSynthesis.cancel();
                    }
                }
                break;

            case 'choice':
                // User chooses register or login
                if (lowerText.includes('register')) {
                    setIsRegistering(true);
                    setVoiceStep('username');
                    speak('What username would you like?', startListening);
                } else if (lowerText.includes('login')) {
                    setIsRegistering(false);
                    setVoiceStep('username');
                    speak('What is your username?', startListening);
                }
                break;

            case 'username': {
                const sanitized = sanitizeUsername(text);
                usernameRef.current = sanitized;
                setUsername(sanitized);

                if (isRegisteringRef.current) {
                    // For registration, auto-generate email IF they didn't speak one
                    const generatedEmail = sanitized.includes('@') ? sanitized : `${sanitized}@gmail.com`;
                    setEmail(generatedEmail);
                    setVoiceStep('password');
                    speak(`Your email will be ${generatedEmail}. Please say your password.`, startListening);
                } else {
                    // For login, just ask for password
                    setVoiceStep('password');
                    speak('What is your password?', startListening);
                }
                break;
            }

            case 'password': {
                const sanitizedPass = sanitizePassword(text);
                passwordRef.current = sanitizedPass;
                setPassword(sanitizedPass);
                setVoiceStep('confirm');

                if (isRegisteringRef.current) {
                    speak('Ready to create your account? Say yes to confirm or no to cancel.', startListening);
                } else {
                    speak('Ready to login? Say yes to confirm or no to cancel.', startListening);
                }
                break;
            }

            case 'confirm':
                if (lowerText.includes('yes') || lowerText.includes('yeah') || lowerText.includes('confirm') || lowerText.includes('proceed')) {
                    stopListening();
                    setIsAuthenticating(true);
                    speak(isRegisteringRef.current ? 'Creating your account and training the application. Please wait...' : 'Logging you in...');
                    // Proceed with authentication
                    setTimeout(() => {
                        handleVoiceAuth(usernameRef.current, passwordRef.current);
                    }, 1500);
                } else if (lowerText.includes('no') || lowerText.includes('cancel')) {
                    speak('Authentication cancelled. Returning to start.', () => {
                        resetVoiceAuth();
                    });
                }
                break;
        }
    }, [speak, startListening, stopListening]);

    // Perform actual authentication
    const handleVoiceAuth = async (usernameValue: string, passwordValue: string) => {
        try {
            if (isRegisteringRef.current) {
                // Registration
                const sanitizedUsername = sanitizeUsername(usernameValue);
                const sanitizedPass = sanitizePassword(passwordValue);
                if (!sanitizedUsername) {
                    setIsAuthenticating(false);
                    speak('Username is required. Let\'s try again.', () => resetVoiceAuth());
                    return;
                }
                if (sanitizedPass.length < 6) {
                    setIsAuthenticating(false);
                    speak('Password must be at least 6 characters. Let\'s try again.', () => resetVoiceAuth());
                    return;
                }

                const normalizedUsername = sanitizedUsername.toLowerCase();
                const usernameDoc = await db.collection('usernames').doc(normalizedUsername).get();
                if (usernameDoc.exists) {
                    setIsAuthenticating(false);
                    speak('This username is already taken. Let\'s try again.', () => resetVoiceAuth());
                    return;
                }

                const emailValue = sanitizedUsername.includes('@') ? sanitizedUsername : `${sanitizedUsername}@gmail.com`;
                console.log('[VOICE AUTH] Creating user account with email:', emailValue);
                const userCredential = await auth.createUserWithEmailAndPassword(emailValue, sanitizedPass);
                console.log('[VOICE AUTH] User created, setting up profile...');
                await setupNewUser(userCredential.user!, sanitizedUsername);
                console.log('[VOICE AUTH] Setup complete. Transitioning to dashboard...');

                // Wait a moment for auth state to propagate, then speak success message
                setTimeout(() => {
                    speak('Account created successfully! Training complete. Taking you to your dashboard now.');
                    // Auth state change will automatically trigger navigation to dashboard
                }, 500);
            } else {
                // Login
                const sanitizedUsername = sanitizeUsername(usernameValue);
                const sanitizedPass = sanitizePassword(passwordValue);
                const normalizedUsername = sanitizedUsername.toLowerCase();
                const usernameDoc = await db.collection('usernames').doc(normalizedUsername).get();

                if (!usernameDoc.exists) {
                    setIsAuthenticating(false);
                    speak('Username not found. Let\'s try again.', () => resetVoiceAuth());
                    return;
                }

                const uid = usernameDoc.data()!.uid;
                const userDoc = await db.collection('users').doc(uid).get();

                if (!userDoc.exists || !userDoc.data()?.email) {
                    setIsAuthenticating(false);
                    speak('Could not find user details. Please contact support.');
                    return;
                }

                const loginEmail = userDoc.data()!.email;
                console.log('[VOICE AUTH] Logging in with email:', loginEmail);
                await auth.signInWithEmailAndPassword(loginEmail, sanitizedPass);
                console.log('[VOICE AUTH] Login successful. Transitioning to dashboard...');

                // Wait a moment for auth state to propagate, then speak success message
                setTimeout(() => {
                    speak('Login successful! Welcome back. Taking you to your dashboard now.');
                    // Auth state change will automatically trigger navigation to dashboard
                }, 500);
            }
        } catch (err: any) {
            console.error('[VOICE AUTH] Error:', err);
            setIsAuthenticating(false);
            const errorMessage = err.message.replace('Firebase: ', '');
            speak(`Error: ${errorMessage}. Let\'s try again.`, () => resetVoiceAuth());
        }
    };

    // Reset voice authentication
    const resetVoiceAuth = () => {
        setIsAuthenticating(false);
        setVoiceStep('choice');
        usernameRef.current = '';
        passwordRef.current = '';
        setUsername('');
        setPassword('');
        setEmail('');
        setTranscribedText('');
        speak('Would you like to register a new account or login?', startListening);
    };

    // Cleanup on unmount OR when user becomes authenticated
    useEffect(() => {
        return () => {
            stopListening();
            if (window.speechSynthesis) {
                window.speechSynthesis.cancel();
            }
            if (recognitionRef.current) {
                recognitionRef.current.abort();
                recognitionRef.current = null;
            }
        };
    }, [stopListening]);

    // Log auth state changes for debugging
    useEffect(() => {
        console.log('[LOGIN] Auth state changed - isAuthenticated:', state.isAuthenticated, 'loading:', state.loading);
    }, [state.isAuthenticated, state.loading]);

    // Stop login chatbot completely when user authenticates
    useEffect(() => {
        if (state.isAuthenticated) {
            console.log('[LOGIN] User authenticated, stopping login chatbot...');
            stopListening();
            if (window.speechSynthesis) {
                window.speechSynthesis.cancel();
            }
            if (recognitionRef.current) {
                recognitionRef.current.abort();
                recognitionRef.current = null;
            }
            setIsListening(false);
            setIsVoiceMode(false);
        }
    }, [state.isAuthenticated, stopListening]);

    // Welcome message - spoken once on page load
    useEffect(() => {
        if (!hasSpokenWelcomeRef.current) {
            hasSpokenWelcomeRef.current = true;
            // Set voice mode as default, waiting for user gesture
            setIsVoiceMode(true);
            setVoiceStep('initial');
        }
    }, []);

    // Handle user gesture to enable voice
    const handleEnableVoice = useCallback(() => {
        if (!needsUserGesture) return;

        setNeedsUserGesture(false);
        speak('Welcome to VoxMail. Say voice for voice authentication, or manual for manual login.', startListening);
    }, [needsUserGesture, speak, startListening]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        try {
            if (isRegistering) {
                // REGISTER LOGIC
                const sanitizedUsername = sanitizeUsername(username);
                const sanitizedPass = sanitizePassword(password);
                if (!sanitizedUsername) {
                    setError('Username is required.');
                    return;
                }
                if (sanitizedPass.length < 6) {
                    setError('Password must be at least 6 characters.');
                    return;
                }
                const normalizedUsername = sanitizedUsername.toLowerCase();
                const usernameDoc = await db.collection('usernames').doc(normalizedUsername).get();
                if (usernameDoc.exists) {
                    setError('This username is already taken. Please choose another.');
                    return;
                }

                const finalEmail = email.trim() || `${sanitizedUsername}@gmail.com`;
                console.log('[MANUAL REG] Creating user with email:', finalEmail, 'username:', sanitizedUsername);
                const userCredential = await auth.createUserWithEmailAndPassword(finalEmail, sanitizedPass);
                await setupNewUser(userCredential.user!, sanitizedUsername);
            } else {
                // LOGIN LOGIC
                let loginEmail = email.trim();
                const sanitizedPass = sanitizePassword(password);
                console.log('[MANUAL LOGIN] Attempting login with input:', loginEmail);

                if (!loginEmail.includes('@')) {
                    const sanitizedUsername = sanitizeUsername(loginEmail);
                    const normalizedUsername = sanitizedUsername.toLowerCase();
                    console.log('[MANUAL LOGIN] Input treated as username, sanitized to:', normalizedUsername);

                    const usernameDoc = await db.collection('usernames').doc(normalizedUsername).get();
                    if (!usernameDoc.exists) {
                        setError("User with that username not found.");
                        return;
                    }
                    const uid = usernameDoc.data()!.uid;
                    const userDoc = await db.collection('users').doc(uid).get();
                    if (!userDoc.exists || !userDoc.data()?.email) {
                        setError("Could not find user details. Please contact support.");
                        return;
                    }
                    loginEmail = userDoc.data()!.email;
                }

                console.log('[MANUAL LOGIN] Performing Firebase Auth with email:', loginEmail);
                await auth.signInWithEmailAndPassword(loginEmail, sanitizedPass);
            }
        } catch (err: any) {
            const errorMessage = err.message.replace('Firebase: ', '');
            setError(errorMessage);
        }
    };

    // Render voice authentication UI
    if (isVoiceMode) {
        // Show "Click to Start" overlay if user gesture is needed
        if (needsUserGesture) {
            return (
                <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-sky-50 to-gray-50 p-4">
                    <div
                        className="w-full max-w-md p-12 space-y-8 bg-white rounded-xl shadow-lg text-center cursor-pointer hover:shadow-2xl transition-shadow"
                        onClick={handleEnableVoice}
                    >
                        <div className="inline-block p-4 bg-blue-600 rounded-full shadow-md">
                            <MicIcon className="w-16 h-16 text-white animate-pulse" />
                        </div>
                        <h1 className="text-3xl font-bold text-blue-600">VoxMail Voice Assistant</h1>
                        <p className="text-xl text-gray-700 font-semibold">🎤 Click anywhere to start</p>
                        <p className="text-sm text-gray-500">Voice authentication will begin automatically</p>

                        <button
                            onClick={() => {
                                setIsVoiceMode(false);
                                setNeedsUserGesture(false);
                            }}
                            className="mt-6 px-6 py-2 text-sm font-semibold text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                            Use Manual Login Instead
                        </button>
                    </div>
                </div>
            );
        }

        // Show active voice authentication interface
        return (
            <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-sky-50 to-gray-50 p-4">
                <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-xl shadow-lg text-center">
                    <MicIcon className="w-20 h-20 text-blue-600 mx-auto animate-pulse" />
                    <h2 className="text-2xl font-bold text-gray-800">
                        {isAuthenticating ? 'Processing...' : 'Voice Authentication'}
                    </h2>

                    <div className="min-h-[6rem] flex items-center justify-center">
                        <p className="text-lg text-gray-600">{voiceFeedback}</p>
                    </div>

                    {transcribedText && !isAuthenticating && (
                        <div className="bg-blue-50 rounded-lg p-4">
                            <p className="text-sm text-gray-500 mb-1">You said:</p>
                            <p className="font-mono text-gray-800">{transcribedText}</p>
                        </div>
                    )}

                    {isAuthenticating && (
                        <div className="bg-green-50 rounded-lg p-4">
                            <div className="flex items-center justify-center space-x-2">
                                <div className="w-4 h-4 bg-green-500 rounded-full animate-bounce"></div>
                                <div className="w-4 h-4 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                                <div className="w-4 h-4 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                            </div>
                            <p className="text-sm text-green-700 mt-2 font-semibold">
                                {isRegisteringRef.current ? 'Creating account and setting up your profile...' : 'Logging you in...'}
                            </p>
                        </div>
                    )}

                    <div className="flex items-center justify-center space-x-2">
                        {isListening && !isAuthenticating && (
                            <div className="flex items-center space-x-2 text-red-500">
                                <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                                <span className="text-sm font-semibold">Listening...</span>
                            </div>
                        )}
                    </div>

                    {!isAuthenticating && (
                        <button
                            onClick={() => {
                                setIsVoiceMode(false);
                                if (window.speechSynthesis) {
                                    window.speechSynthesis.cancel();
                                }
                                stopListening();
                            }}
                            className="mt-6 px-6 py-2 text-sm font-semibold text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                            Switch to Manual Login
                        </button>
                    )}
                </div>
            </div>
        );
    }

    // Render manual login form
    return (
        <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-sky-50 to-gray-50 p-4">
            <div className="w-full max-w-sm p-8 space-y-6 bg-white rounded-xl shadow-lg">
                <div className="text-center space-y-4">
                    <div className="inline-block p-3 bg-blue-600 rounded-2xl shadow-md">
                        <LogoEnvelopeIcon className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-blue-600">{t('voxmailTitle')}</h1>
                    <p className="text-sm text-gray-500">{t('voxmailSubtitle')}</p>
                </div>

                <div className="flex bg-gray-100 p-1 rounded-lg">
                    <button
                        onClick={() => { setIsRegistering(false); setError(null); }}
                        className={`w-1/2 py-2 text-sm font-semibold rounded-md transition-all duration-300 ${!isRegistering ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:bg-gray-200'}`}
                    >
                        {t('login')}
                    </button>
                    <button
                        onClick={() => { setIsRegistering(true); setError(null); }}
                        className={`w-1/2 py-2 text-sm font-semibold rounded-md transition-all duration-300 ${isRegistering ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:bg-gray-200'}`}
                    >
                        {t('register')}
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {isRegistering && (
                        <div>
                            <label htmlFor="username" className="text-sm font-medium text-gray-700">{t('username')}</label>
                            <div className="relative mt-1">
                                <span className="absolute inset-y-0 left-0 flex items-center pl-3" aria-hidden="true">
                                    <UserIcon className="w-5 h-5 text-gray-400" />
                                </span>
                                <input
                                    id="username"
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    placeholder="your_username"
                                    required
                                    className="w-full py-3 pl-10 pr-3 bg-gray-100 text-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition placeholder-gray-500"
                                />
                            </div>
                        </div>
                    )}
                    <div>
                        <label htmlFor="email" className="text-sm font-medium text-gray-700">{isRegistering ? t('email') : t('emailOrUsername')}</label>
                        <div className="relative mt-1">
                            <span className="absolute inset-y-0 left-0 flex items-center pl-3" aria-hidden="true">
                                <UserIcon className="w-5 h-5 text-gray-400" />
                            </span>
                            <input
                                id="email"
                                type={isRegistering ? 'email' : 'text'}
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder={isRegistering ? "email@example.com" : "username or email@example.com"}
                                required
                                className="w-full py-3 pl-10 pr-3 bg-gray-100 text-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition placeholder-gray-500"
                            />
                        </div>
                    </div>
                    <div>
                        <label htmlFor="password" className="text-sm font-medium text-gray-700">{t('password')}</label>
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
                                className="w-full py-3 pl-10 pr-3 bg-gray-100 text-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition placeholder-gray-500"
                            />
                        </div>
                    </div>
                    {error && <p className="text-red-500 text-xs text-center pt-1">{error}</p>}
                    <button
                        type="submit"
                        className="w-full py-3 mt-4 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                        {isRegistering ? t('register') : t('login')}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default Login;
