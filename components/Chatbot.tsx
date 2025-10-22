import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveSession, Modality, Type, FunctionDeclaration, GenerateContentResponse, LiveServerMessage, Blob } from '@google/genai';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { useAppContext } from '../context/AppContext';
import { Transcript, Folder } from '../types';
import { INITIAL_SYSTEM_PROMPT } from '../constants';
import { decode, encode, decodeAudioData } from '../utils/audioUtils';
import { MicIcon, PaperAirplaneIcon, PauseIcon } from './icons/IconComponents';

// Lazily initialize the GoogleGenAI client to avoid crashing the app
// when an API key is not provided in production.
const GEMINI_API_KEY = (typeof window !== 'undefined'
    ? (window as any).GEMINI_API_KEY
    : undefined) || (process.env.GEMINI_API_KEY as string | undefined) || (process.env.API_KEY as string | undefined);

let aiClient: GoogleGenAI | null = null;
const getAiClient = (): GoogleGenAI | null => {
    if (aiClient) return aiClient;
    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'undefined') {
        console.warn('Gemini API key is not configured. Chatbot features are disabled.');
        return null;
    }
    aiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    return aiClient;
};

const Chatbot: React.FC = () => {
    const { state, dispatch } = useAppContext();
    const [position, setPosition] = useState({ x: window.innerWidth - 420, y: 100 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [transcript, setTranscript] = useState<Transcript[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [isListening, setIsListening] = useState(false);
    
    const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const transcriptEndRef = useRef<HTMLDivElement>(null);
    
    // --- Context-Aware Function Declarations ---
    const functionDeclarations: FunctionDeclaration[] = [
        {
            name: 'open_folder',
            description: 'Opens a specific email folder within the VoxMail application (e.g., Inbox, Sent, Spam, Trash).',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    folder_name: { type: Type.STRING, enum: Object.values(Folder) },
                },
                required: ['folder_name'],
            },
        },
        {
            name: 'compose_email',
            description: 'Opens the compose new email window within the VoxMail application, optionally pre-filling fields.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    recipient: { type: Type.STRING },
                    subject: { type: Type.STRING },
                    body: { type: Type.STRING },
                },
            },
        },
        {
            name: 'logout',
            description: 'Logs the current user out of the VoxMail application.',
            parameters: { type: Type.OBJECT, properties: {} },
        },
    ];

    const tools = [{ functionDeclarations }];

    const handleFunctionCall = useCallback((name: string, args: any) => {
        console.log(`Function Call: ${name}`, args);
        switch (name) {
            case 'open_folder':
                if (args.folder_name && Object.values(Folder).includes(args.folder_name)) {
                    dispatch({ type: 'SELECT_FOLDER', payload: args.folder_name });
                }
                break;
            case 'compose_email':
                dispatch({ type: 'START_COMPOSE' });
                if(args.recipient || args.subject || args.body) {
                    dispatch({ type: 'UPDATE_COMPOSE', payload: { recipient: args.recipient, subject: args.subject, body: args.body } });
                }
                break;
            case 'logout':
                signOut(auth).catch(error => console.error("Logout from chatbot failed", error));
                break;
            default:
                console.warn(`Unknown function call: ${name}`);
        }
    }, [dispatch]);

    const stopSession = useCallback(async () => {
        setIsListening(false);
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }
        if (scriptProcessorRef.current) {
            scriptProcessorRef.current.disconnect();
            scriptProcessorRef.current = null;
        }
        if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
            await inputAudioContextRef.current.close();
            inputAudioContextRef.current = null;
        }
        if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
            await outputAudioContextRef.current.close();
            outputAudioContextRef.current = null;
        }
        if (sessionPromiseRef.current) {
            const session = await sessionPromiseRef.current;
            session.close();
            sessionPromiseRef.current = null;
        }
    }, []);

    const startVoiceSession = useCallback(async () => {
        if (isListening) return;
        setIsListening(true);
        setInputValue('');

        let nextStartTime = 0;
        let currentInputTranscription = '';

        inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        
        const systemInstruction = INITIAL_SYSTEM_PROMPT(state.currentFolder, state.emails);

        const client = getAiClient();
        if (!client) {
            setTranscript(prev => [...prev, { id: `warn-${Date.now()}`, text: 'Chat features are unavailable: missing API key.', isUser: false, timestamp: Date.now() }]);
            setIsListening(false);
            return;
        }
        sessionPromiseRef.current = client.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            config: {
                systemInstruction,
                tools,
                responseModalities: [Modality.AUDIO],
                inputAudioTranscription: {},
            },
            callbacks: {
                onopen: async () => {
                    mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
                    const source = inputAudioContextRef.current!.createMediaStreamSource(mediaStreamRef.current);
                    scriptProcessorRef.current = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);

                    scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                        const pcmBlob: Blob = {
                            data: encode(new Uint8Array(new Int16Array(inputData.map(x => x * 32768)).buffer)),
                            mimeType: 'audio/pcm;rate=16000',
                        };
                        sessionPromiseRef.current?.then((session) => {
                            session.sendRealtimeInput({ media: pcmBlob });
                        });
                    };
                    source.connect(scriptProcessorRef.current);
                    scriptProcessorRef.current.connect(inputAudioContextRef.current!.destination);
                },
                onmessage: async (message: LiveServerMessage) => {
                    if (message.serverContent?.modelTurn?.parts[0]?.inlineData?.data) {
                        const base64Audio = message.serverContent.modelTurn.parts[0].inlineData.data;
                        nextStartTime = Math.max(nextStartTime, outputAudioContextRef.current!.currentTime);
                        const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContextRef.current!, 24000, 1);
                        const source = outputAudioContextRef.current!.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(outputAudioContextRef.current!.destination);
                        source.start(nextStartTime);
                        nextStartTime += audioBuffer.duration;
                    }

                    if (message.serverContent?.inputTranscription) {
                        currentInputTranscription = message.serverContent.inputTranscription.text;
                        setInputValue(currentInputTranscription);
                    }

                    if (message.toolCall?.functionCalls) {
                        message.toolCall.functionCalls.forEach(fc => handleFunctionCall(fc.name, fc.args));
                    }
                },
                onerror: (e: ErrorEvent) => {
                    console.error('Session error:', e);
                    stopSession();
                },
                onclose: () => {
                    console.log('Session closed.');
                },
            },
        });
    }, [isListening, state.currentFolder, state.emails, handleFunctionCall, stopSession]);


    const handleTextSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inputValue.trim()) return;

        const text = inputValue;
        setInputValue('');
        setTranscript(prev => [...prev, { id: `user-${Date.now()}`, text, isUser: true, timestamp: Date.now() }]);

        try {
            const systemInstruction = INITIAL_SYSTEM_PROMPT(state.currentFolder, state.emails);
            let responseText = '';
            
            const client = getAiClient();
            if (!client) {
                setTranscript(prev => [...prev, { id: `warn-${Date.now()}`, text: 'Chat features are unavailable: missing API key.', isUser: false, timestamp: Date.now() }]);
                return;
            }
            const responseStream = await client.models.generateContentStream({
                model: 'gemini-2.5-flash',
                contents: {
                    role: 'user',
                    parts: [{ text }],
                },
                config: { systemInstruction, tools }
            });

            for await (const chunk of responseStream) {
                if(chunk.functionCalls) {
                    chunk.functionCalls.forEach(fc => handleFunctionCall(fc.name, fc.args));
                }
                const chunkText = chunk.text;
                if (chunkText) {
                    responseText += chunkText;
                    setTranscript(prev => {
                        const last = prev[prev.length - 1];
                        if (prev.length > 0 && !last.isUser) {
                            return [...prev.slice(0, -1), { ...last, text: responseText }];
                        }
                        return [...prev, { id: `ai-${Date.now()}`, text: responseText, isUser: false, timestamp: Date.now() }];
                    });
                }
            }
        } catch (error) {
            console.error("Text generation error:", error);
            setTranscript(prev => [...prev, { id: `err-${Date.now()}`, text: "Sorry, I encountered an error.", isUser: false, timestamp: Date.now() }]);
        }
    };


    useEffect(() => {
        transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [transcript]);
    
    useEffect(() => {
        // Cleanup on component unmount
        return () => {
            stopSession();
        };
    }, [stopSession]);


    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        setIsDragging(true);
        setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (isDragging) {
            setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
        }
    };

    const handleMouseUp = () => setIsDragging(false);

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, dragStart]);


    return (
        <div
            className="fixed flex flex-col bg-white rounded-lg shadow-2xl border border-gray-200"
            style={{ left: position.x, top: position.y, width: '400px', height: '500px' }}
        >
            <header
                className="flex items-center justify-between p-3 bg-gray-100 rounded-t-lg border-b border-gray-200 cursor-move"
                onMouseDown={handleMouseDown}
            >
                <div className="flex items-center space-x-2">
                    <MicIcon className={`w-5 h-5 ${isListening ? 'text-red-500 animate-pulse' : 'text-blue-600'}`} />
                    <div>
                        <h2 className="text-sm font-semibold text-gray-800">VoxMail Assistant</h2>
                        <p className="text-xs text-gray-500">{isListening ? 'Active & Listening' : 'Ready'}</p>
                    </div>
                </div>
                <div className="flex items-center space-x-2">
                    <button onClick={isListening ? stopSession : startVoiceSession} className="p-1 rounded-full hover:bg-gray-200">
                        {isListening ? <PauseIcon className="w-5 h-5 text-gray-700" /> : <MicIcon className="w-5 h-5 text-gray-700" />}
                    </button>
                    <button onClick={() => dispatch({ type: 'TOGGLE_CHATBOT' })} className="p-1 rounded-full hover:bg-gray-200 text-gray-700 font-bold text-lg">
                        &times;
                    </button>
                </div>
            </header>
            <div className="flex-1 p-4 overflow-y-auto bg-gray-50">
                 {transcript.length === 0 && (
                    <div className="text-center text-gray-500 p-4">
                        <p className="text-sm">Hi! I'm your voice assistant. How can I help you manage your email today?</p>
                    </div>
                )}
                {transcript.map((item) => (
                    <div key={item.id} className={`my-2 flex ${item.isUser ? 'justify-end' : 'justify-start'}`}>
                        <div className={`px-4 py-2 rounded-lg max-w-xs text-sm ${item.isUser ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'}`}>
                            {item.text}
                        </div>
                    </div>
                ))}
                <div ref={transcriptEndRef} />
            </div>
            <form onSubmit={handleTextSubmit} className="p-3 border-t border-gray-200 bg-white rounded-b-lg">
                <div className="flex items-center space-x-2">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder={isListening ? 'Listening...' : 'Type a message or command...'}
                        className="flex-1 w-full bg-gray-100 border border-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={isListening}
                    />
                    <button type="submit" className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300" disabled={isListening}>
                        <PaperAirplaneIcon className="w-5 h-5" />
                    </button>
                </div>
            </form>
        </div>
    );
};

export default Chatbot;