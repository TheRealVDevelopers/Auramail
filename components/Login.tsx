import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword,
} from 'firebase/auth';
import { GoogleGenAI, LiveSession, Modality, LiveServerMessage, Blob } from '@google/genai';
import { auth } from '../firebase';
import { setupNewUser } from '../services/emailService';
import { decode, encode, decodeAudioData } from '../utils/audioUtils';
import { LogoEnvelopeIcon, MicIcon, UserIcon, LockIcon } from './icons/IconComponents';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

const Login: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isRegistering, setIsRegistering] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // State for voice login flow
    const [isVoiceLoginActive, setIsVoiceLoginActive] = useState(false);
    const [voiceStep, setVoiceStep] = useState<'idle' | 'action' | 'email' | 'password' | 'confirm'>('idle');
    const [voiceFeedback, setVoiceFeedback] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [transcribedText, setTranscribedText] = useState('');

    // Refs for audio and session management
    const sessionRef = useRef<LiveSession | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    
    // Refs to get latest state inside callbacks and avoid stale closures
    const voiceStepRef = useRef(voiceStep);
    useEffect(() => { voiceStepRef.current = voiceStep; }, [voiceStep]);
    const isRegisteringRef = useRef(isRegistering);
    useEffect(() => { isRegisteringRef.current = isRegistering; }, [isRegistering]);

    // Ref to hold the latest version of the input handler function
    const handleVoiceInputRef = useRef<(text: string) => void>(() => {});

    // --- Audio and Session Management ---
    
    const playBeep = useCallback(() => {
        if (!audioContextRef.current) return;
        const context = audioContextRef.current;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.frequency.value = 880;
        gain.gain.setValueAtTime(0, context.currentTime);
        gain.gain.linearRampToValueAtTime(0.3, context.currentTime + 0.05);
        gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.15);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.2);
    }, []);
    
    const stopSession = useCallback(async () => {
        setIsListening(false);
        mediaStreamRef.current?.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
        scriptProcessorRef.current?.disconnect();
        scriptProcessorRef.current = null;
        
        sessionRef.current?.close();
        sessionRef.current = null;

        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            await audioContextRef.current.close().catch(console.error);
            audioContextRef.current = null;
        }
    }, []);

    const cancelVoiceLogin = useCallback(() => {
        stopSession();
        setIsVoiceLoginActive(false);
        setVoiceStep('idle');
        setVoiceFeedback('');
        setEmail('');
        setPassword('');
        setError(null);
        setTranscribedText('');
    }, [stopSession]);

    const speak = useCallback(async (text: string, onComplete?: () => void) => {
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-preview-tts',
                contents: [{ parts: [{ text }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
                }
            });
            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (base64Audio && audioContextRef.current) {
                const audioCtx = audioContextRef.current;
                const audioBuffer = await decodeAudioData(decode(base64Audio), audioCtx, 24000, 1);
                const source = audioCtx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioCtx.destination);
                source.onended = () => { 
                    playBeep();
                    onComplete?.();
                };
                source.start();
            } else {
                playBeep();
                onComplete?.();
            }
        } catch (error) {
            console.error("TTS Error:", error);
            playBeep();
            onComplete?.();
        }
    }, [playBeep]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (password.length < 6) {
            setError('Password must be at least 6 characters.');
            if (isVoiceLoginActive) {
                speak("Password must be at least 6 characters. Please try again.", cancelVoiceLogin);
            }
            return;
        }
        
        try {
            if (isRegisteringRef.current) {
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                await setupNewUser(userCredential.user);
            } else {
                await signInWithEmailAndPassword(auth, email, password);
            }
            // Successful login/register will unmount this component via the auth state listener
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
        setTranscribedText(text); // Show the final transcription

        if (!lowerText) {
            speak("I didn't hear anything. Let's try that again.");
            return;
        }

        switch(voiceStepRef.current) {
            case 'action':
                if (lowerText.includes('register')) {
                    setIsRegistering(true);
                    setVoiceFeedback('Registering. What is your email?');
                    speak('Registering. What is your email?');
                } else {
                    setIsRegistering(false);
                    setVoiceFeedback('Logging in. What is your email?');
                    speak('Logging in. What is your email?');
                }
                setVoiceStep('email');
                break;
            case 'email':
                const parsedEmail = lowerText.replace(/\s/g, '').replace(/at/g, '@').replace(/dot/g, '.');
                setEmail(parsedEmail);
                setVoiceFeedback('Got it. What is your password?');
                speak('Got it. What is your password?');
                setVoiceStep('password');
                break;
            case 'password':
                const parsedPassword = lowerText.replace(/\s/g, '');
                setPassword(parsedPassword);
                setVoiceFeedback('Ready to submit? Say yes to confirm or no to cancel.');
                speak('Ready to submit? Say yes to confirm or no to cancel.');
                setVoiceStep('confirm');
                break;
            case 'confirm':
                 if (lowerText.includes('yes') || lowerText.includes('proceed') || lowerText.includes('submit')) {
                    const actionText = isRegisteringRef.current ? 'Registering...' : 'Signing in...';
                    setVoiceFeedback(actionText);
                    speak(actionText, () => {
                        handleSubmit({ preventDefault: () => {} } as React.FormEvent);
                    });
                    // Don't change state here, let handleSubmit and auth state handle it
                 } else {
                    speak("Okay, I'll cancel.", cancelVoiceLogin);
                 }
                break;
        }
    }, [speak, cancelVoiceLogin, handleSubmit]);
    
    useEffect(() => { handleVoiceInputRef.current = handleVoiceInput; }, [handleVoiceInput]);

    const startVoiceSession = useCallback(async () => {
        if (isListening || sessionRef.current) return;
        
        setTranscribedText('');
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        
        try {
            const session = await ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: { 
                    systemInstruction: "You are a voice assistant for a login page. Your only function is to accurately transcribe what the user says.",
                    inputAudioTranscription: {},
                    responseModalities: [Modality.AUDIO],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
                },
                callbacks: {
                    onopen: async () => {
                        setIsListening(true);
                        mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
                        const source = audioContextRef.current!.createMediaStreamSource(mediaStreamRef.current);
                        scriptProcessorRef.current = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
                        scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                            if (!sessionRef.current) return;
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const pcmBlob: Blob = {
                                data: encode(new Uint8Array(new Int16Array(inputData.map(x => x * 32768)).buffer)),
                                mimeType: 'audio/pcm;rate=16000',
                            };
                            sessionRef.current.sendRealtimeInput({ media: pcmBlob });
                        };
                        source.connect(scriptProcessorRef.current);
                        scriptProcessorRef.current.connect(audioContextRef.current!.destination);
                    },
                    onmessage: (message: LiveServerMessage) => {
                        if (message.serverContent?.inputTranscription) {
                            const transcription = message.serverContent.inputTranscription.text;
                            setTranscribedText(transcription); // Live update
                            if (message.serverContent?.turnComplete) {
                                handleVoiceInputRef.current(transcription);
                            }
                        }
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error('Session error:', e);
                        speak("Sorry, there was a connection error.", cancelVoiceLogin);
                    },
                    onclose: () => {},
                },
            });
            sessionRef.current = session;
            return session;
        } catch (error) {
            console.error("Failed to start session:", error);
            cancelVoiceLogin();
            return null;
        }
    }, [isListening, speak, cancelVoiceLogin]);

    const handleVoiceLoginStart = async () => {
        setIsVoiceLoginActive(true);
        const session = await startVoiceSession();
        if (session) {
            setVoiceStep('action');
            const feedback = 'Welcome! Would you like to log in or register?';
            setVoiceFeedback(feedback);
            speak(feedback);
        }
    };

    useEffect(() => {
        // Cleanup function to run when the component unmounts
        return () => { stopSession(); };
    }, [stopSession]);
    
    if (isVoiceLoginActive) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-sky-50 to-gray-50 p-4">
                <div className="w-full max-w-sm p-8 space-y-6 bg-white rounded-xl shadow-lg text-center">
                    <MicIcon className="w-16 h-16 text-blue-600 mx-auto animate-pulse" />
                    <h2 className="text-2xl font-bold text-gray-800">Voice Sign-In</h2>
                    <p className="text-lg text-gray-600 min-h-[5rem] flex items-center justify-center">{voiceFeedback}</p>
                    <div className="text-sm text-gray-600 bg-gray-100 rounded-lg p-3 min-h-[3.5rem] flex items-center justify-center">
                        <p className="font-mono">{transcribedText || (isListening ? '...' : ' ')}</p>
                    </div>
                    <div className="pt-4">
                        <button 
                            onClick={cancelVoiceLogin}
                            className="w-full py-3 font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors"
                        >
                            Cancel
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
                    <h1 className="text-3xl font-bold text-blue-600">VoxMail</h1>
                    <p className="text-sm text-gray-500">Voice-First Email Platform</p>
                </div>
                
                <button 
                    className="w-full flex items-center justify-center gap-3 py-3 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    onClick={handleVoiceLoginStart}
                    aria-label="Sign in or register with your voice"
                >
                    <MicIcon className="w-5 h-5 text-gray-600" />
                    Use Voice Sign-In
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
                                className="w-full py-3 pl-10 pr-3 bg-gray-100 text-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition placeholder-gray-500" 
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
                                className="w-full py-3 pl-10 pr-3 bg-gray-100 text-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition placeholder-gray-500" 
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