import React, { useState, useEffect, useRef, useCallback } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { useAppContext } from '../context/AppContext';
import { Transcript, Folder, Email } from '../types';
import { MicIcon, PaperAirplaneIcon, PauseIcon, SpeakerIcon, SpeakerOffIcon } from './icons/IconComponents';
import { updateEmailFolder, getUnreadCount, sendEmail } from '../services/emailService';

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
    const [chatbotStatus, setChatbotStatus] = useState<'IDLE' | 'PROCESSING'>('IDLE');

    const [composeState, setComposeState] = useState<{
        active: boolean;
        step: 'recipient' | 'subject' | 'body' | 'confirm' | 'change_prompt' | 'change_field' | '';
        draft: Partial<Email>;
        fieldToChange: 'recipient' | 'subject' | 'body' | '';
    }>({ active: false, step: '', draft: {}, fieldToChange: '' });
    
    const transcriptEndRef = useRef<HTMLDivElement>(null);
    const composeStateRef = useRef(composeState);
    useEffect(() => { composeStateRef.current = composeState; }, [composeState]);

    const speak = useCallback(async (text: string, onComplete?: () => void) => {
        setTranscript(prev => [...prev, { id: `ai-${Date.now()}`, text, isUser: false, timestamp: Date.now() }]);
        setChatbotStatus('PROCESSING');
        
        // Simulate AI response delay
        setTimeout(() => {
            setChatbotStatus('IDLE');
            onComplete?.();
        }, 1000);
    }, []);

    const handleFunctionCall = useCallback(async (name: string, args: any): Promise<void> => {
        setChatbotStatus('PROCESSING');
        const { userProfile, selectedEmail } = state;
        let resultText = "Done.";

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
                return; // Don't speak "Done"
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

        await speak(resultText);
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

    const handleTextSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const text = inputValue.trim();
        if (!text) return;
        setInputValue('');

        if (composeState.active) {
            handleComposeInput(text);
            return;
        }

        setTranscript(prev => [...prev, { id: `user-${Date.now()}`, text, isUser: true, timestamp: Date.now() }]);
        setChatbotStatus('PROCESSING');

        // Simple command parsing for demo
        const lowerText = text.toLowerCase();
        
        if (lowerText.includes('open') && lowerText.includes('inbox')) {
            await handleFunctionCall('open_folder', { folder_name: Folder.INBOX });
        } else if (lowerText.includes('open') && lowerText.includes('sent')) {
            await handleFunctionCall('open_folder', { folder_name: Folder.SENT });
        } else if (lowerText.includes('compose') || lowerText.includes('write')) {
            await handleFunctionCall('start_interactive_composition', {});
        } else if (lowerText.includes('logout') || lowerText.includes('sign out')) {
            await handleFunctionCall('logout', {});
        } else {
            await speak("I can help you with email management. Try saying 'open inbox', 'compose email', or 'logout'.");
        }
    };

    useEffect(() => {
        transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [transcript]);

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
            case 'PROCESSING': return { text: 'Thinking...', icon: <div className="w-5 h-5 border-2 border-gray-400 border-t-blue-600 rounded-full animate-spin"></div> };
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
                    <button onClick={() => dispatch({ type: 'TOGGLE_CHATBOT' })} className="p-1 rounded-full hover:bg-gray-200 text-gray-700 font-bold text-lg" title="Close">
                        &times;
                    </button>
                </div>
            </header>
            <div className="flex-1 p-4 overflow-y-auto bg-gray-50">
                 {transcript.length === 0 && (
                    <div className="text-center text-gray-500 p-4">
                        <p className="text-sm">Hi! I'm your email assistant. Try typing commands like:</p>
                        <ul className="text-xs mt-2 space-y-1">
                            <li>• "open inbox"</li>
                            <li>• "compose email"</li>
                            <li>• "logout"</li>
                        </ul>
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
                        placeholder="Type a message or command..."
                        className="flex-1 w-full bg-gray-100 border border-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button type="submit" className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                        <PaperAirplaneIcon className="w-5 h-5" />
                    </button>
                </div>
            </form>
        </div>
    );
};

export default Chatbot;