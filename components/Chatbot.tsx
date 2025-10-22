import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveSession, Modality, Type, FunctionDeclaration, LiveServerMessage, Blob, FunctionCall } from '@google/genai';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { useAppContext } from '../context/AppContext';
import { Transcript, Folder, Email } from '../types';
import { INITIAL_SYSTEM_PROMPT } from '../constants';
import { decode, encode, decodeAudioData } from '../utils/audioUtils';
import { MicIcon, PaperAirplaneIcon, PauseIcon, SpeakerIcon, SpeakerOffIcon } from './icons/IconComponents';
import { updateEmailFolder, getUnreadCount, sendEmail } from '../services/emailService';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

const EmailPreview: React.FC<{ draft: Partial<Email> }> = ({ draft }) => (
    <div className="border border-gray-300 rounded-md p-3 my-1 bg-white text-gray-800">
        <p className="text-xs text-gray-500">PREVIEW</p>
        <div className="mt-2 text-sm space-y-1">
            <p><span className="font-semibold">To:</span> {draft.recipient}</p>
            <p><span className="font-semibold">Subject:</span> {draft.subject}</p>
            <hr className="my-2"/>
            <p className="whitespace-pre-wrap">{draft.body}</p>
        </div>
    </div>
);


const Chatbot: React.FC = () => {
    const { state, dispatch } = useAppContext();
    const [position, setPosition] = useState({ x: window.innerWidth - 420, y: 100 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [transcript, setTranscript] = useState<Transcript[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [liveTranscript, setLiveTranscript] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [chatbotStatus, setChatbotStatus] = useState<'IDLE' | 'LISTENING' | 'PROCESSING' | 'SPEAKING'>('IDLE');
    const [isMuted, setIsMuted] = useState(false);

    const [composeState, setComposeState] = useState<{
        active: boolean;
        step: 'recipient' | 'subject' | 'body' | 'confirm' | 'change_prompt' | 'change_field' | '';
        draft: Partial<Email>;
        fieldToChange: 'recipient' | 'subject' | 'body' | '';
    }>({ active: false, step: '', draft: {}, fieldToChange: '' });
    
    // Refs for async operations and cleanup
    const sessionRef = useRef<LiveSession | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const transcriptEndRef = useRef<HTMLDivElement>(null);
    
    // Refs to get latest state inside callbacks and avoid stale closures
    const composeStateRef = useRef(composeState);
    useEffect(() => { composeStateRef.current = composeState; }, [composeState]);

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

    const speak = useCallback(async (text: string, onComplete?: () => void) => {
        setTranscript(prev => [...prev, { id: `ai-${Date.now()}`, text, isUser: false, timestamp: Date.now() }]);
        
        const handleEnd = () => {
            setChatbotStatus(isListening ? 'LISTENING' : 'IDLE');
            playBeep();
            onComplete?.();
        };

        if (isMuted) {
            handleEnd();
            return;
        }

        try {
            setChatbotStatus('PROCESSING');
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
                setChatbotStatus('SPEAKING');
                const audioCtx = audioContextRef.current;
                const audioBuffer = await decodeAudioData(decode(base64Audio), audioCtx, 24000, 1);
                const source = audioCtx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioCtx.destination);
                source.onended = handleEnd;
                source.start();
            } else {
                handleEnd();
            }
        } catch (error) {
            console.error("TTS Error:", error);
            handleEnd();
        }
    }, [isMuted, isListening, playBeep]);

    const functionDeclarations: FunctionDeclaration[] = [
        {
            name: 'open_folder',
            description: 'Opens a specific email folder (Inbox, Sent, Spam, Trash).',
            parameters: {
                type: Type.OBJECT,
                properties: { folder_name: { type: Type.STRING, enum: Object.values(Folder) } },
                required: ['folder_name'],
            },
        },
        {
            name: 'start_interactive_composition',
            description: 'Starts a step-by-step conversational process to compose a new email.',
            parameters: { type: Type.OBJECT, properties: {} },
        },
        {
            name: 'select_email',
            description: 'Selects an email from the list. The user must provide the ID.',
            parameters: {
                type: Type.OBJECT,
                properties: { email_id: { type: Type.STRING } },
                required: ['email_id'],
            }
        },
        {
            name: 'delete_selected_email',
            description: 'Deletes the currently selected email.',
            parameters: { type: Type.OBJECT, properties: {} },
        },
        {
            name: 'mark_selected_as_spam',
            description: 'Moves the currently selected email to Spam.',
            parameters: { type: Type.OBJECT, properties: {} },
        },
        {
            name: 'logout',
            description: 'Logs the user out of the application.',
            parameters: { type: Type.OBJECT, properties: {} },
        },
    ];

    const tools = [{ functionDeclarations }];

    const stopSession = useCallback(async () => {
        setIsListening(false);
        setChatbotStatus('IDLE');
    
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

    const handleFunctionCall = useCallback(async (fc: FunctionCall, session: LiveSession | null): Promise<void> => {
        setChatbotStatus('PROCESSING');
        const { name, args } = fc;
        const { userProfile, selectedEmail } = state;
        let resultText = "Done.";
        let shouldSpeakResult = true;

        switch (name) {
            case 'open_folder':
                const folder = args.folder_name as Folder;
                if (folder && Object.values(Folder).includes(folder)) {
                    dispatch({ type: 'SELECT_FOLDER', payload: folder });
                    const count = userProfile ? await getUnreadCount(userProfile.uid, folder) : 0;
                    resultText = `Opening ${folder}. You have ${count} unread messages.`;
                }
                break;
            case 'start_interactive_composition':
                setComposeState({ active: true, step: 'recipient', draft: {}, fieldToChange: '' });
                speak("Of course. Who is the recipient?");
                shouldSpeakResult = false; // Don't speak "Done" or send tool response
                break; 
            case 'select_email':
                if (args.email_id) dispatch({ type: 'SELECT_EMAIL', payload: args.email_id as string });
                break;
            case 'delete_selected_email':
                if (userProfile && selectedEmail) {
                    await updateEmailFolder(userProfile.uid, selectedEmail.id, Folder.TRASH);
                    dispatch({ type: 'DELETE_EMAIL', payload: selectedEmail.id });
                }
                break;
            case 'mark_selected_as_spam':
                if (userProfile && selectedEmail) {
                    await updateEmailFolder(userProfile.uid, selectedEmail.id, Folder.SPAM);
                    dispatch({ type: 'MOVE_TO_SPAM', payload: selectedEmail.id });
                }
                break;
            case 'logout':
                signOut(auth).catch(error => console.error("Logout from chatbot failed", error));
                resultText = "Signing you out.";
                break;
            default:
                console.warn(`Unknown function call: ${name}`);
                resultText = `Function ${name} not recognized.`;
        }

        if (shouldSpeakResult) {
            if (session) {
                // For live sessions, send response back to model to continue conversation
                session.sendToolResponse({ functionResponses: { id: fc.id, name, response: { result: resultText } } });
            } else {
                // For text input, just speak the result directly
                await speak(resultText);
            }
        }
    }, [dispatch, state, speak]);

    const handleComposeInput = useCallback(async (text: string) => {
        setTranscript(prev => [...prev, { id: `user-compose-${Date.now()}`, text, isUser: true, timestamp: Date.now() }]);
        setChatbotStatus('PROCESSING');
        
        let updatedDraft = { ...composeStateRef.current.draft };
        let nextStep: typeof composeState.step = composeStateRef.current.step;
        let nextFieldToChange: typeof composeState.fieldToChange = composeStateRef.current.fieldToChange;
        let shouldContinue = true;

        switch (composeStateRef.current.step) {
            case 'recipient':
                updatedDraft.recipient = text;
                nextStep = 'subject';
                speak("Got it. What's the subject?");
                break;
            case 'subject':
                updatedDraft.subject = text;
                nextStep = 'body';
                speak("Great. And what message would you like to send?");
                break;
            case 'body':
                updatedDraft.body = text;
                nextStep = 'confirm';
                setTranscript(prev => [...prev, {
                    id: `ai-preview-${Date.now()}`,
                    text: <EmailPreview draft={updatedDraft} />,
                    isUser: false, timestamp: Date.now(),
                }]);
                speak("Here is a preview. You can say 'send', 'make a change', or 'cancel'.");
                break;
            case 'confirm':
                const lowerText = text.toLowerCase();
                if (lowerText.includes('send')) {
                    if (state.userProfile) {
                        const emailToSend = { ...updatedDraft, sender: state.userProfile.email || 'You', senderEmail: state.userProfile.email || '', timestamp: new Date().toLocaleString(), read: true, folder: Folder.SENT };
                        const result = await sendEmail(state.userProfile.uid, emailToSend);
                        await speak(result.message);
                        if (result.success) dispatch({ type: 'SELECT_FOLDER', payload: Folder.SENT });
                    }
                    shouldContinue = false;
                } else if (lowerText.includes('change')) {
                    nextStep = 'change_prompt';
                    speak("What would you like to change: the recipient, subject, or body?");
                } else { 
                    speak("Okay, I've canceled this email.");
                    shouldContinue = false;
                }
                break;
            case 'change_prompt':
                const changeLowerText = text.toLowerCase();
                if (changeLowerText.includes('recipient')) nextFieldToChange = 'recipient';
                else if (changeLowerText.includes('subject')) nextFieldToChange = 'subject';
                else if (changeLowerText.includes('body')) nextFieldToChange = 'body';

                if (nextFieldToChange) {
                    nextStep = 'change_field';
                    speak(`Okay, what should the new ${nextFieldToChange} be?`);
                } else {
                    speak("Sorry, I didn't understand. Please say recipient, subject, or body.");
                }
                break;
            case 'change_field':
                if (composeStateRef.current.fieldToChange) {
                    updatedDraft[composeStateRef.current.fieldToChange] = text;
                    nextStep = 'confirm';
                    nextFieldToChange = '';
                    setTranscript(prev => [...prev, {
                        id: `ai-preview-updated-${Date.now()}`,
                        text: <EmailPreview draft={updatedDraft} />,
                        isUser: false, timestamp: Date.now(),
                    }]);
                    speak("I've updated the draft. Here is the new preview.");
                }
                break;
        }
        
        const newState = shouldContinue 
            ? { active: true, step: nextStep, draft: updatedDraft, fieldToChange: nextFieldToChange }
            : { active: false, step: '', draft: {}, fieldToChange: '' };
        
        setComposeState(newState);

    }, [state.userProfile, dispatch, speak]);
    
    const startVoiceSession = useCallback(async () => {
        if (isListening || sessionRef.current) return;
        
        setInputValue('');
        setLiveTranscript('');
        
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        
        const systemInstruction = INITIAL_SYSTEM_PROMPT(state.currentFolder, state.emails, state.selectedEmail);

        try {
            const session = await ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    systemInstruction,
                    tools,
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: {},
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
                    }
                },
                callbacks: {
                    onopen: async () => {
                        setIsListening(true);
                        setChatbotStatus('LISTENING');
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
                    onmessage: async (message: LiveServerMessage) => {
                        if (message.serverContent?.inputTranscription) {
                            const transcription = message.serverContent.inputTranscription.text;
                            setLiveTranscript(transcription);
                            if (message.serverContent?.turnComplete && transcription) {
                                setLiveTranscript('');
                                if (composeStateRef.current.active) {
                                    handleComposeInput(transcription);
                                } else {
                                    setTranscript(prev => [...prev, { id: `user-${Date.now()}`, text: transcription, isUser: true, timestamp: Date.now() }]);
                                }
                            }
                        }
    
                        if (message.serverContent?.modelTurn?.parts[0]?.inlineData?.data && !isMuted) {
                            setChatbotStatus('SPEAKING');
                            const base64Audio = message.serverContent.modelTurn.parts[0].inlineData.data;
                            if (audioContextRef.current && audioContextRef.current.state === 'running') {
                                const audioBuffer = await decodeAudioData(decode(base64Audio), audioContextRef.current, 24000, 1);
                                const source = audioContextRef.current.createBufferSource();
                                source.buffer = audioBuffer;
                                source.connect(audioContextRef.current.destination);
                                source.onended = () => {
                                   setChatbotStatus('LISTENING');
                                   playBeep();
                                };
                                source.start();
                            }
                        }
    
                        if (message.toolCall?.functionCalls) {
                           message.toolCall.functionCalls.forEach(fc => handleFunctionCall(fc, sessionRef.current));
                        }
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error('Session error:', e);
                        stopSession();
                    },
                    onclose: () => {},
                },
            });
            sessionRef.current = session;
        } catch (error) {
            console.error("Failed to connect to live session:", error);
            stopSession();
        }

    }, [isListening, state.currentFolder, state.emails, state.selectedEmail, stopSession, playBeep, isMuted, handleFunctionCall, handleComposeInput]);

    const handleTextSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const text = inputValue.trim();
        if (!text) return;
        setInputValue('');
        setLiveTranscript('');

        if (composeState.active) {
            handleComposeInput(text);
            return;
        }

        setTranscript(prev => [...prev, { id: `user-${Date.now()}`, text, isUser: true, timestamp: Date.now() }]);
        setChatbotStatus('PROCESSING');

        try {
            const systemInstruction = INITIAL_SYSTEM_PROMPT(state.currentFolder, state.emails, state.selectedEmail);
            let completeResponseText = '';
            
            const responseStream = await ai.models.generateContentStream({
                model: 'gemini-2.5-flash',
                contents: {
                    role: 'user',
                    parts: [{ text }],
                },
                config: { systemInstruction, tools }
            });

            for await (const chunk of responseStream) {
                if (chunk.functionCalls) {
                    for (const fc of chunk.functionCalls) {
                        await handleFunctionCall(fc, null);
                    }
                }
                const chunkText = chunk.text;
                if (chunkText) {
                    completeResponseText += chunkText;
                }
            }
             if (completeResponseText) {
                await speak(completeResponseText.trim());
             }

        } catch (error) {
            console.error("Text generation error:", error);
            await speak("Sorry, I encountered an error.");
        } finally {
            if (!composeStateRef.current.active) {
                setChatbotStatus('IDLE');
            }
        }
    };


    useEffect(() => {
        transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [transcript, liveTranscript]);
    
    useEffect(() => {
        return () => { stopSession(); };
    }, [stopSession]);


    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        setIsDragging(true);
        setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    };
    const handleMouseMove = (e: MouseEvent) => {
        if (isDragging) setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
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
    
    const getStatusInfo = () => {
        switch (chatbotStatus) {
            case 'LISTENING': return { text: 'Active & Listening', icon: <MicIcon className="w-5 h-5 text-red-500 animate-pulse" /> };
            case 'PROCESSING': return { text: 'Thinking...', icon: <div className="w-5 h-5 border-2 border-gray-400 border-t-blue-600 rounded-full animate-spin"></div> };
            case 'SPEAKING': return { text: 'Speaking...', icon: <SpeakerIcon className="w-5 h-5 text-blue-600" /> };
            default: return { text: 'Ready', icon: <MicIcon className="w-5 h-5 text-blue-600" /> };
        }
    };
    const statusInfo = getStatusInfo();


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
                    {statusInfo.icon}
                    <div>
                        <h2 className="text-sm font-semibold text-gray-800">VoxMail Assistant</h2>
                        <p className="text-xs text-gray-500">{composeState.active ? `Composing: ${composeState.step}` : statusInfo.text}</p>
                    </div>
                </div>
                <div className="flex items-center space-x-2">
                    <button onClick={() => setIsMuted(prev => !prev)} className="p-1 rounded-full hover:bg-gray-200" title={isMuted ? 'Unmute' : 'Mute'}>
                        {isMuted ? <SpeakerOffIcon className="w-5 h-5 text-gray-700" /> : <SpeakerIcon className="w-5 h-5 text-gray-700" />}
                    </button>
                    <button onClick={isListening ? stopSession : startVoiceSession} className="p-1 rounded-full hover:bg-gray-200" title={isListening ? 'Stop Listening' : 'Start Listening'}>
                        {isListening ? <PauseIcon className="w-5 h-5 text-gray-700" /> : <MicIcon className="w-5 h-5 text-gray-700" />}
                    </button>
                    <button onClick={() => dispatch({ type: 'TOGGLE_CHATBOT' })} className="p-1 rounded-full hover:bg-gray-200 text-gray-700 font-bold text-lg" title="Close">
                        &times;
                    </button>
                </div>
            </header>
            <div className="flex-1 p-4 overflow-y-auto bg-gray-50">
                 {transcript.length === 0 && !liveTranscript && (
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
                {liveTranscript && (
                    <div className="my-2 flex justify-end">
                        <div className="px-4 py-2 rounded-lg max-w-xs text-sm bg-blue-300 text-white opacity-90">
                            {liveTranscript}
                        </div>
                    </div>
                )}
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
                        disabled={isListening && !composeState.active}
                    />
                    <button type="submit" className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300">
                        <PaperAirplaneIcon className="w-5 h-5" />
                    </button>
                </div>
            </form>
        </div>
    );
};

export default Chatbot;