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
import { GoogleGenAI, Type, FunctionDeclaration, FunctionCall, Modality } from '@google/genai';
import { auth } from '../firebase';
import { useAppContext } from '../context/AppContext';
import { Transcript, Folder, Email } from '../types';
import { INITIAL_SYSTEM_PROMPT, SUPPORTED_LANGUAGES } from '../constants';
import { MicIcon, PaperAirplaneIcon, PauseIcon, SpeakerIcon, SpeakerOffIcon } from './icons/IconComponents';
import { updateEmailFolder, getUnreadCount, sendEmail, markEmailAsRead } from '../services/emailService';
import { useTranslations } from '../utils/translations';
import { decode, decodeAudioData } from '../utils/audioUtils';

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
    const aiRef = useRef<GoogleGenAI | null>(null);
    const { state, dispatch } = useAppContext();
    const [position, setPosition] = useState({ x: window.innerWidth - 420, y: 100 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const t = useTranslations();
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
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const transcriptEndRef = useRef<HTMLDivElement>(null);
    const spokenWelcome = useRef(false);
    
    const composeStateRef = useRef(composeState);
    useEffect(() => { composeStateRef.current = composeState; }, [composeState]);

    const getAiClient = useCallback(() => {
        if (!aiRef.current) {
            aiRef.current = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });
        }
        return aiRef.current;
    }, []);

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

    const stopSpeaking = useCallback(() => {
        currentAudioSourceRef.current?.stop();
        currentAudioSourceRef.current = null;
        if ('speechSynthesis' in window) {
            speechSynthesis.cancel();
        }
    }, []);

    const speak = useCallback(async (text: string | React.ReactNode, onComplete?: () => void) => {
        const textToSpeak = typeof text === 'string' ? text : ' '; // Only speak string content
        setTranscript(prev => [...prev, { id: `ai-${Date.now()}`, text, isUser: false, timestamp: Date.now() }]);
        stopSpeaking();
        
        const handleEnd = () => {
            setChatbotStatus(isListening ? 'LISTENING' : 'IDLE');
            playBeep();
            onComplete?.();
        };

        if (isMuted || typeof text !== 'string') {
            handleEnd();
            return;
        }

        setChatbotStatus('SPEAKING');

        try {
            const ai = getAiClient();
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: textToSpeak }] }],
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
                console.error("Could not generate audio from API.");
                handleEnd();
            }
        } catch (error) {
            console.error("Gemini TTS API error:", error);
            handleEnd();
        }
    }, [isMuted, isListening, playBeep, stopSpeaking, getAiClient]);

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
            name: 'read_email_by_index',
            description: 'Reads the content of a specific email from the current list aloud, based on its position (e.g., 1 for the first, 2 for the second).',
            parameters: {
                type: Type.OBJECT,
                properties: { index: { type: Type.NUMBER, description: 'The 1-based index of the email in the list.' } },
                required: ['index'],
            },
        },
        {
            name: 'stop_reading',
            description: 'Immediately stops the chatbot from speaking the current message.',
            parameters: { type: Type.OBJECT, properties: {} },
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
        {
            name: 'change_language',
            description: 'Changes the application and chatbot language.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    language_code: {
                        type: Type.STRING,
                        description: 'The language code to switch to.',
                        enum: SUPPORTED_LANGUAGES.map(l => l.code),
                    },
                },
                required: ['language_code'],
            },
        },
    ];

    const tools = [{ functionDeclarations }];
    
    const handleFunctionCall = useCallback(async (fc: FunctionCall) => {
        setChatbotStatus('PROCESSING');
        const { name, args } = fc;
        const { userProfile, selectedEmail } = state;
        let resultText = t('done');
        
        switch (name) {
            case 'open_folder': {
                const folder = args.folder_name as Folder;
                if (folder && Object.values(Folder).includes(folder)) {
                    dispatch({ type: 'SELECT_FOLDER', payload: folder });
                    const count = userProfile ? await getUnreadCount(userProfile.uid, folder) : 0;
                    resultText = t('openingFolderUnreadCount', { folder: t(folder.toLowerCase() as keyof ReturnType<typeof useTranslations>), count });
                }
                break;
            }
            case 'start_interactive_composition': {
                setComposeState({ active: true, step: 'recipient', draft: {}, fieldToChange: '' });
                speak(t('composeRecipientPrompt'));
                return ''; // Don't return text to speak, `speak` is called directly
            }
            case 'select_email': {
                if (args.email_id) dispatch({ type: 'SELECT_EMAIL', payload: args.email_id as string });
                break;
            }
            case 'read_email_by_index': {
                const index = args.index as number;
                if (index && index > 0 && state.emails.length >= index) {
                    const emailToRead = state.emails[index - 1];
                    dispatch({ type: 'SELECT_EMAIL', payload: emailToRead.id });
                    if (!emailToRead.read && userProfile) {
                        markEmailAsRead(userProfile.uid, emailToRead.id).catch(err => console.error("Chatbot failed to mark as read:", err));
                        dispatch({ type: 'MARK_AS_READ', payload: emailToRead.id });
                    }
                    const bodyText = emailToRead.body.replace(/<[^>]*>?/gm, '\n');
                    const textToSpeak = `${t('readingEmailFrom', { sender: emailToRead.sender })}. ${t('subject')}: ${emailToRead.subject}. ${t('bodyStartsNow')}. ${bodyText}`;
                    speak(textToSpeak);
                    return '';
                } else {
                    resultText = t('emailNotFoundAtIndex', { index });
                }
                break;
            }
            case 'stop_reading': {
                stopSpeaking();
                setChatbotStatus('IDLE');
                resultText = t('stopped');
                break;
            }
            case 'delete_selected_email': {
                if (userProfile && selectedEmail) {
                    await updateEmailFolder(userProfile.uid, selectedEmail.id, Folder.TRASH);
                    dispatch({ type: 'DELETE_EMAIL', payload: selectedEmail.id });
                }
                break;
            }
            case 'mark_selected_as_spam': {
                if (userProfile && selectedEmail) {
                    await updateEmailFolder(userProfile.uid, selectedEmail.id, Folder.SPAM);
                    dispatch({ type: 'MOVE_TO_SPAM', payload: selectedEmail.id });
                }
                break;
            }
            case 'logout': {
                auth.signOut().catch(error => console.error("Logout from chatbot failed", error));
                resultText = t('signingOut');
                break;
            }
            case 'change_language': {
                const langCode = args.language_code as string;
                const supported = SUPPORTED_LANGUAGES.find(l => l.code === langCode);
                if (supported) {
                    dispatch({ type: 'SET_LANGUAGE', payload: langCode });
                    resultText = t('languageSwitched', { language: supported.name });
                } else {
                    resultText = t('languageNotSupported', { langCode });
                }
                break;
            }
            default:
                console.warn(`Unknown function call: ${name}`);
                resultText = t('functionNotRecognized', { name });
        }

        return resultText;
    }, [dispatch, state, speak, t, stopSpeaking]);

    const handleComposeInput = useCallback(async (text: string) => {
        setTranscript(prev => [...prev, { id: `user-compose-${Date.now()}`, text, isUser: true, timestamp: Date.now() }]);
        setChatbotStatus('PROCESSING');
        
        let updatedDraft = { ...composeStateRef.current.draft };
        // FIX: Add explicit types to prevent TS from widening them to `string`.
        let nextStep: 'recipient' | 'subject' | 'body' | 'confirm' | 'change_prompt' | 'change_field' | '' = composeStateRef.current.step;
        let nextFieldToChange: 'recipient' | 'subject' | 'body' | '' = composeStateRef.current.fieldToChange;
        let shouldContinue = true;

        switch (composeStateRef.current.step) {
            case 'recipient': {
                let recipientValue = text.trim();
                const lowerText = text.toLowerCase();
                // Only parse as an email if it sounds like one, otherwise preserve original text for usernames
                if (lowerText.includes(' at ') || lowerText.includes(' dot ')) {
                    recipientValue = lowerText.split(' ').map(word => word === 'at' ? '@' : word === 'dot' ? '.' : word).join('');
                }
                updatedDraft.recipient = recipientValue;
                nextStep = 'subject';
                speak(t('composeGotItSubject'));
                break;
            }
            case 'subject':
                updatedDraft.subject = text;
                nextStep = 'body';
                speak(t('composeGreatBody'));
                break;
            case 'body':
                updatedDraft.body = text;
                nextStep = 'confirm';
                setTranscript(prev => [...prev, {
                    id: `ai-preview-${Date.now()}`,
                    text: <EmailPreview draft={updatedDraft} />,
                    isUser: false, timestamp: Date.now(),
                }]);
                speak(t('composePreview'));
                break;
            case 'confirm':
                const lowerText = text.toLowerCase();
                if (lowerText.includes(t('send').toLowerCase())) {
                    if (state.userProfile) {
                        const emailToSend = { 
                            ...updatedDraft, 
                            sender: state.userProfile.name || state.userProfile.email || 'You', 
                            senderEmail: state.userProfile.email || '', 
                            timestamp: new Date().toLocaleString(), 
                            read: true, 
                            folder: Folder.SENT 
                        };
                        const result = await sendEmail(state.userProfile.uid, emailToSend);
                        await speak(result.message);
                        if (result.success) dispatch({ type: 'SELECT_FOLDER', payload: Folder.SENT });
                    }
                    shouldContinue = false;
                } else if (lowerText.includes(t('change').toLowerCase())) {
                    nextStep = 'change_prompt';
                    speak(t('composeChangePrompt'));
                } else { 
                    speak(t('composeCanceled'));
                    shouldContinue = false;
                }
                break;
            case 'change_prompt':
                const changeLowerText = text.toLowerCase();
                if (changeLowerText.includes(t('recipient').toLowerCase())) nextFieldToChange = 'recipient';
                else if (changeLowerText.includes(t('subject').toLowerCase())) nextFieldToChange = 'subject';
                else if (changeLowerText.includes(t('body').toLowerCase())) nextFieldToChange = 'body';

                if (nextFieldToChange) {
                    nextStep = 'change_field';
                    speak(t('composeNewValuePrompt', { field: t(nextFieldToChange) }));
                } else {
                    speak(t('composeDidntUnderstandChange'));
                }
                break;
            case 'change_field':
                const fieldToChange = composeStateRef.current.fieldToChange;
                if (fieldToChange) {
                    let newValue = text;
                    if (fieldToChange === 'recipient') {
                        newValue = text.toLowerCase().split(' ').map(word => word === 'at' ? '@' : word === 'dot' ? '.' : word).join('');
                    }
                    updatedDraft[fieldToChange] = newValue;
                    nextStep = 'confirm';
                    nextFieldToChange = '';
                    setTranscript(prev => [...prev, {
                        id: `ai-preview-updated-${Date.now()}`,
                        text: <EmailPreview draft={updatedDraft} />,
                        isUser: false, timestamp: Date.now(),
                    }]);
                    speak(t('composeUpdatedPreview'));
                }
                break;
        }
        
        // FIX: Explicitly type `newState` to prevent the ternary operator from widening the types of `step` and `fieldToChange` to `string`.
        const newState: typeof composeState = shouldContinue 
            ? { active: true, step: nextStep, draft: updatedDraft, fieldToChange: nextFieldToChange }
            : { active: false, step: '', draft: {}, fieldToChange: '' };
        
        setComposeState(newState);

    }, [state.userProfile, dispatch, speak, t]);

    const processTranscript = useCallback(async (text: string) => {
        if (!text) return;
        setLiveTranscript('');

        if (composeStateRef.current.active) {
            await handleComposeInput(text);
            return;
        }

        setTranscript(prev => [...prev, { id: `user-${Date.now()}`, text, isUser: true, timestamp: Date.now() }]);
        setChatbotStatus('PROCESSING');

        try {
            const languageName = SUPPORTED_LANGUAGES.find(l => l.code === state.currentLanguage)?.name || 'English';
            const systemInstruction = INITIAL_SYSTEM_PROMPT(state.currentFolder, state.emails, state.selectedEmail, languageName);
            
            const ai = getAiClient();
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: { parts: [{ text }] },
                config: { systemInstruction, tools }
            });

            let finalResponseText = '';
            if (response.functionCalls) {
                for (const fc of response.functionCalls) {
                    const result = await handleFunctionCall(fc);
                    if (result) finalResponseText += result + ' ';
                }
            }
            if(response.text) {
                finalResponseText += response.text;
            }

            if (finalResponseText.trim()) {
                await speak(finalResponseText.trim());
            }

        } catch (error) {
            console.error("Text generation error:", error);
            await speak("Sorry, I encountered an error.");
        } finally {
            if (!composeStateRef.current.active) {
                setChatbotStatus('IDLE');
            }
        }
    }, [state.currentFolder, state.emails, state.selectedEmail, state.currentLanguage, handleComposeInput, handleFunctionCall, speak, getAiClient]);

    const handleTextSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const text = inputValue.trim();
        if (text) {
            setInputValue('');
            await processTranscript(text);
        }
    };
    
    const toggleListening = useCallback(() => {
        if (isListening) {
            recognitionRef.current?.stop();
            return;
        }
        
        const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            speak("Voice recognition is not supported in this browser.");
            return;
        }

        if (!recognitionRef.current) {
            recognitionRef.current = new SpeechRecognition();
            const recognition = recognitionRef.current;
            recognition.continuous = false;
            recognition.interimResults = true;

            recognition.onresult = (event) => {
                let interim = '';
                let final = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        final += event.results[i][0].transcript;
                    } else {
                        interim += event.results[i][0].transcript;
                    }
                }
                setLiveTranscript(interim);
                if (final.trim()) {
                    processTranscript(final.trim());
                }
            };
            recognition.onerror = (event) => {
                console.error("Speech recognition error", event.error);
                if(event.error !== 'no-speech') {
                    speak("Sorry, there was a recognition error.");
                }
            };
            recognition.onstart = () => {
                setIsListening(true);
                setChatbotStatus('LISTENING');
            };
            recognition.onend = () => {
                setIsListening(false);
                setChatbotStatus('IDLE');
            };
        }

        recognitionRef.current.lang = state.currentLanguage;
        recognitionRef.current.start();

    }, [isListening, state.currentLanguage, speak, processTranscript]);

    useEffect(() => {
        transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [transcript, liveTranscript]);
    
    useEffect(() => {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        
        if (!spokenWelcome.current && !isMuted) {
            spokenWelcome.current = true;
            speak(t('welcomeMessage'));
        }

    }, [isMuted, speak, t]);

    useEffect(() => {
        return () => { 
            stopSpeaking();
            recognitionRef.current?.stop();
            audioContextRef.current?.close().catch(console.error);
        };
    }, [stopSpeaking]);

    const handleMouseDown = (e: React.MouseEvent<HTMLElement>) => {
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
            case 'PROCESSING': return { text: 'Thinking...', icon: <div className="w-5 h-5 border-2 border-gray-400 border-t-blue-600 rounded-full animate-spin" /> };
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
                    <button onClick={toggleListening} className="p-1 rounded-full hover:bg-gray-200" title={isListening ? 'Stop Listening' : 'Start Listening'}>
                        {isListening ? <PauseIcon className="w-5 h-5 text-red-500" /> : <MicIcon className="w-5 h-5 text-gray-700" />}
                    </button>
                    <button onClick={() => dispatch({ type: 'TOGGLE_CHATBOT' })} className="p-1 rounded-full hover:bg-gray-200 text-gray-700 font-bold text-lg" title="Close">
                        ×
                    </button>
                </div>
            </header>
            <div className="flex-1 p-4 overflow-y-auto bg-gray-50">
                {transcript.map((item) => (
                    <div key={item.id} className={`my-2 flex ${item.isUser ? 'justify-end' : 'justify-start'}`}>
                        <div className={`px-4 py-2 rounded-lg max-w-xs text-sm ${item.isUser ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'}`}>
                            {item.text}
                        </div>
                    </div>
                ))}
                {liveTranscript && (
                    <div className="my-2 flex justify-end">
                        <div className={`px-4 py-2 rounded-lg max-w-xs text-sm bg-blue-300 text-white opacity-90`}>
                            {liveTranscript}
                        </div>
                    </div>
                )}
                <div ref={transcriptEndRef} />
            </div>
            <form onSubmit={handleTextSubmit} id="chatbot-form" className="p-3 border-t border-gray-200 bg-white rounded-b-lg">
                <div className="flex items-center space-x-2">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder={isListening ? 'Listening...' : 'Type a message or command...'}
                        className="flex-1 w-full bg-gray-100 border border-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={isListening}
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