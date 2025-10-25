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

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import { auth, db } from '../firebase';
import { setupNewUser } from '../services/emailService';
import { LogoEnvelopeIcon, MicIcon, UserIcon, LockIcon } from './icons/IconComponents';
import { useAppContext } from '../context/AppContext';
import { useTranslations } from '../utils/translations';
import { decode, decodeAudioData } from '../utils/audioUtils';

const Login: React.FC = () => {
    const aiRef = useRef<GoogleGenAI | null>(null);
    const { state } = useAppContext();
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isRegistering, setIsRegistering] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [isVoiceLoginActive, setIsVoiceLoginActive] = useState(false);
    const [voiceStep, setVoiceStep] = useState<'idle' | 'action' | 'username' | 'email' | 'password' | 'confirm'>('idle');
    const [voiceFeedback, setVoiceFeedback] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [transcribedText, setTranscribedText] = useState('');

    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const voiceStepRef = useRef(voiceStep);
    useEffect(() => { voiceStepRef.current = voiceStep; }, [voiceStep]);
    const isRegisteringRef = useRef(isRegistering);
    useEffect(() => { isRegisteringRef.current = isRegistering; }, [isRegistering]);
    const handleVoiceInputRef = useRef<(text: string) => void>(() => {});

    const t = useTranslations();

    const getAiClient = useCallback(() => {
        if (!aiRef.current) {
            aiRef.current = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });
        }
        return aiRef.current;
    }, []);

    const playBeep = useCallback((freq = 880) => {
        if (!audioContextRef.current) return;
        const context = audioContextRef.current;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.frequency.value = freq;
        gain.gain.setValueAtTime(0, context.currentTime);
        gain.gain.linearRampToValueAtTime(0.3, context.currentTime + 0.05);
        gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.15);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.2);
    }, []);
    
    const stopListening = useCallback(() => {
        setIsListening(false);
        recognitionRef.current?.stop();
    }, []);

    const stopSpeaking = useCallback(() => {
        currentAudioSourceRef.current?.stop();
        currentAudioSourceRef.current = null;
    }, []);

    const cancelVoiceLogin = useCallback(() => {
        stopListening();
        stopSpeaking();
        setIsVoiceLoginActive(false);
        setVoiceStep('idle');
        setVoiceFeedback('');
        setUsername('');
        setEmail('');
        setPassword('');
        setError(null);
        setTranscribedText('');
    }, [stopListening, stopSpeaking]);

    const speak = useCallback(async (text: string, onComplete?: () => void) => {
        stopSpeaking(); // Stop any currently playing audio

        const handleEnd = () => {
            playBeep();
            onComplete?.();
        };

        // Ensure AudioContext is initialized
        if (!audioContextRef.current) {
            try {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            } catch (error) {
                console.error("Failed to initialize AudioContext:", error);
                // Fallback to browser speech synthesis
                fallbackSpeak(text, handleEnd);
                return;
            }
        }

        // Check if API key is available
        if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'YOUR_API_KEY_HERE') {
            console.warn("Gemini API key not configured, using fallback TTS");
            setVoiceFeedback("Using browser speech synthesis...");
            fallbackSpeak(text, handleEnd);
            return;
        }

        try {
            setVoiceFeedback("Generating speech...");
            const ai = getAiClient();
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
                },
            });

            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

            if (base64Audio && audioContextRef.current) {
                const audioBuffer = await decodeAudioData(decode(base64Audio), audioContextRef.current, 24000, 1);
                const source = audioContextRef.current.createBufferSource();
                currentAudioSourceRef.current = source;
                source.buffer = audioBuffer;
                source.connect(audioContextRef.current.destination);
                source.onended = () => {
                    if (currentAudioSourceRef.current === source) {
                        currentAudioSourceRef.current = null;
                        handleEnd();
                    }
                };
                source.start();
            } else {
                console.error("Could not generate audio from API, using fallback TTS");
                fallbackSpeak(text, handleEnd);
            }
        } catch (error) {
            console.error("Gemini TTS API error:", error);
            fallbackSpeak(text, handleEnd);
        }
    }, [playBeep, stopSpeaking, getAiClient]);

    const fallbackSpeak = useCallback((text: string, onComplete?: () => void) => {
        try {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.onend = onComplete;
            utterance.onerror = (error) => {
                console.error("Speech synthesis error:", error);
                onComplete?.();
            };
            speechSynthesis.speak(utterance);
        } catch (error) {
            console.error("Failed to use fallback TTS:", error);
            onComplete?.();
        }
    }, []);

    const startListening = useCallback(() => {
        const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            speak("Voice recognition is not supported in this browser.", cancelVoiceLogin);
            return;
        }
        
        recognitionRef.current = new SpeechRecognition();
        const recognition = recognitionRef.current;
        recognition.lang = state.currentLanguage;
        recognition.continuous = false;
        recognition.interimResults = false;

        recognition.onresult = (event) => {
            const lastResult = event.results[event.results.length - 1];
            const transcript = lastResult[0].transcript.trim();
            handleVoiceInputRef.current(transcript);
        };
        
        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            if(event.error !== 'no-speech') {
                speak("Sorry, I had trouble understanding. Please try again.", cancelVoiceLogin);
            }
        };

        recognition.onend = () => {
            setIsListening(false);
        };

        recognition.start();
        setIsListening(true);
    }, [state.currentLanguage, speak, cancelVoiceLogin]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        try {
            if (isRegisteringRef.current) {
                // REGISTER LOGIC
                if (!username.trim()) {
                    setError('Username is required.');
                    return;
                }
                if (password.length < 6) {
                    setError('Password must be at least 6 characters.');
                    if (isVoiceLoginActive) speak("Password must be at least 6 characters. Please try again.", cancelVoiceLogin);
                    return;
                }
                const normalizedUsername = username.trim().toLowerCase();
                const usernameDoc = await db.collection('usernames').doc(normalizedUsername).get();
                if (usernameDoc.exists) {
                    const errText = 'This username is already taken. Please choose another.';
                    setError(errText);
                    if (isVoiceLoginActive) speak(errText, cancelVoiceLogin);
                    return;
                }
                
                const userCredential = await auth.createUserWithEmailAndPassword(email, password);
                await setupNewUser(userCredential.user!, username);
            } else {
                // LOGIN LOGIC
                let loginEmail = email;
                if (!email.trim().includes('@')) {
                    const normalizedUsername = email.trim().toLowerCase();
                    const usernameDoc = await db.collection('usernames').doc(normalizedUsername).get();
                    if (!usernameDoc.exists) {
                        const errText = "User with that username not found.";
                        setError(errText);
                        if (isVoiceLoginActive) speak(errText, cancelVoiceLogin);
                        return;
                    }
                    const uid = usernameDoc.data()!.uid;
                    const userDoc = await db.collection('users').doc(uid).get();
                    if (!userDoc.exists || !userDoc.data()?.email) {
                        const errText = "Could not find user details. Please contact support.";
                        setError(errText);
                        if (isVoiceLoginActive) speak(errText, cancelVoiceLogin);
                        return;
                    }
                    loginEmail = userDoc.data()!.email;
                }
                
                await auth.signInWithEmailAndPassword(loginEmail, password);
            }
        } catch (err: any) {
            const errorMessage = err.message.replace('Firebase: ', '');
            setError(errorMessage);
            if (isVoiceLoginActive) {
                speak(`An error occurred: ${errorMessage}. Please try again.`, cancelVoiceLogin);
            }
        }
    };
    
    const handleVoiceInput = useCallback((text: string) => {
        const lowerText = text.toLowerCase().trim();
        setTranscribedText(text);

        if (!lowerText) {
            speak("I didn't hear anything. Let's try that again.", startListening);
            return;
        }

        switch(voiceStepRef.current) {
            case 'action':
                if (lowerText.includes('register')) {
                    setIsRegistering(true);
                    setVoiceFeedback('Registering. What username would you like?');
                    speak('Registering. What username would you like?', startListening);
                    setVoiceStep('username');
                } else {
                    setIsRegistering(false);
                    setVoiceFeedback('Logging in. What is your email or username?');
                    speak('Logging in. What is your email or username?', startListening);
                    setVoiceStep('email');
                }
                break;
            case 'username':
                setUsername(text.trim());
                setVoiceFeedback('Got it. Now, what is your email?');
                speak('Got it. Now, what is your email?', startListening);
                setVoiceStep('email');
                break;
            case 'email':
                const parsedEmail = lowerText.includes('at') ? lowerText.split(' ').map(word => word === 'at' ? '@' : word === 'dot' ? '.' : word).join('') : text.trim();
                setEmail(parsedEmail);
                setVoiceFeedback('Got it. What is your password?');
                speak('Got it. What is your password?', startListening);
                setVoiceStep('password');
                break;
            case 'password':
                const parsedPassword = lowerText.replace(/\s/g, '');
                setPassword(parsedPassword);
                setVoiceFeedback('Ready to submit? Say yes to confirm or no to cancel.');
                speak('Ready to submit? Say yes to confirm or no to cancel.', startListening);
                setVoiceStep('confirm');
                break;
            case 'confirm':
                 if (lowerText.includes('yes') || lowerText.includes('proceed') || lowerText.includes('submit')) {
                    const actionText = isRegisteringRef.current ? 'Registering...' : 'Signing in...';
                    setVoiceFeedback(actionText);
                    handleSubmit({ preventDefault: () => {} } as React.FormEvent);
                 } else {
                    speak("Okay, I'll cancel.", cancelVoiceLogin);
                 }
                break;
        }
    }, [speak, cancelVoiceLogin, handleSubmit, startListening]);
    
    useEffect(() => { handleVoiceInputRef.current = handleVoiceInput; }, [handleVoiceInput]);

    const handleVoiceLoginStart = () => {
        setIsVoiceLoginActive(true);
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        setVoiceStep('action');
        const feedback = 'Welcome! Would you like to log in or register?';
        setVoiceFeedback(feedback);
        speak(feedback, startListening);
    };

    useEffect(() => {
        return () => { 
            stopListening();
            stopSpeaking();
            audioContextRef.current?.close().catch(console.error);
         };
    }, [stopListening, stopSpeaking]);
    
    if (isVoiceLoginActive) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-sky-50 to-gray-50 p-4">
                <div className="w-full max-w-sm p-8 space-y-6 bg-white rounded-xl shadow-lg text-center">
                    <MicIcon className="w-16 h-16 text-blue-600 mx-auto animate-pulse" />
                    <h2 className="text-2xl font-bold text-gray-800">{t('voiceSignInTitle')}</h2>
                    <p className="text-lg text-gray-600 min-h-[5rem] flex items-center justify-center">{voiceFeedback}</p>
                    <div className="text-sm text-gray-600 bg-gray-100 rounded-lg p-3 min-h-[3.5rem] flex items-center justify-center">
                        <p className="font-mono">{transcribedText || (isListening ? '...' : ' ')}</p>
                    </div>
                    <div className="pt-4">
                        <button 
                            onClick={cancelVoiceLogin}
                            className="w-full py-3 font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors"
                        >
                            {t('cancel')}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

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
                
                <button 
                    className="w-full flex items-center justify-center gap-3 py-3 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    onClick={handleVoiceLoginStart}
                    aria-label="Sign in or register with your voice"
                >
                    <MicIcon className="w-5 h-5 text-gray-600" />
                    {t('useVoiceSignIn')}
                </button>

                <div className="flex items-center">
                    <hr className="flex-grow border-gray-200" />
                    <span className="mx-4 text-xs font-medium text-gray-400 uppercase">{t('orContinueManually')}</span>
                    <hr className="flex-grow border-gray-200" />
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