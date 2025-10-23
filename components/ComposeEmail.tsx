import React from 'react';
import { useAppContext } from '../context/AppContext';
import { sendEmail, saveOrUpdateDraft } from '../services/emailService';
import { CloseIcon } from './icons/IconComponents';
import { Folder } from '../types';

const ComposeEmail: React.FC = () => {
  const { state, dispatch } = useAppContext();
  const { composeEmail, userProfile } = state;

  const handleClose = async () => {
    if (userProfile && (composeEmail.recipient || composeEmail.subject || composeEmail.body)) {
      await saveOrUpdateDraft(userProfile.uid, composeEmail);
      // Fetching emails again to show the new draft would be ideal,
      // but for now, it will appear when the user re-enters the folder.
    }
    dispatch({ type: 'CLOSE_COMPOSE' });
  };

  const handleSend = async () => {
    if (composeEmail.recipient && composeEmail.subject && composeEmail.body && userProfile) {
      const emailToSend = {
          ...composeEmail,
          sender: userProfile.name || userProfile.email || 'You',
          senderEmail: userProfile.email || '',
          timestamp: new Date().toLocaleString(),
          read: true,
          folder: Folder.SENT,
      };
      
      const result = await sendEmail(userProfile.uid, emailToSend, composeEmail.id);
      
      // This will close the modal and remove the draft from the list if it was one.
      dispatch({ type: 'SEND_COMPOSE' }); 
      dispatch({ type: 'SELECT_FOLDER', payload: Folder.SENT });

      // If sending failed or had a warning (e.g., recipient not found), show an alert.
      if (!result.success) {
          alert(result.message);
      }

    } else {
        alert("Please fill in the recipient, subject, and body to send an email.");
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    dispatch({ type: 'UPDATE_COMPOSE', payload: { [e.target.name]: e.target.value } });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50">
      <div className="bg-white w-full max-w-2xl h-[70%] rounded-t-lg shadow-2xl flex flex-col">
        <header className="flex items-center justify-between p-4 bg-gray-100 rounded-t-lg border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800">New Message</h2>
          <button onClick={handleClose} className="p-1 rounded-full text-gray-500 hover:bg-gray-200 hover:text-gray-800">
            <CloseIcon />
          </button>
        </header>
        <div className="p-4 flex-1 flex flex-col">
          <input
            type="email"
            name="recipient"
            placeholder="To"
            value={composeEmail.recipient || ''}
            onChange={handleChange}
            className="w-full bg-transparent p-2 border-b border-gray-300 focus:outline-none focus:border-blue-500"
          />
          <input
            type="text"
            name="subject"
            placeholder="Subject"
            value={composeEmail.subject || ''}
            onChange={handleChange}
            className="w-full bg-transparent p-2 border-b border-gray-300 focus:outline-none focus:border-blue-500"
          />
          <textarea
            name="body"
            placeholder="Compose email..."
            value={composeEmail.body || ''}
            onChange={handleChange}
            className="flex-1 w-full bg-transparent p-2 mt-4 resize-none focus:outline-none"
          />
        </div>
        <footer className="p-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
          <button
            onClick={handleSend}
            className="bg-blue-600 text-white font-semibold py-2 px-6 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Send
          </button>
        </footer>
      </div>
    </div>
  );
};

export default ComposeEmail;
