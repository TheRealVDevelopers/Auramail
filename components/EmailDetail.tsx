
import React from 'react';
import { useAppContext } from '../context/AppContext';
import { TrashIcon, SpamIcon } from './icons/IconComponents';
import { updateEmailFolder } from '../services/emailService';
import { Folder } from '../types';

const EmailDetail: React.FC = () => {
  const { state, dispatch } = useAppContext();
  const { selectedEmail, userProfile } = state;

  if (!selectedEmail) {
    return null; // Should be handled by parent
  }

  const handleDelete = async () => {
    if (!userProfile || !selectedEmail) return;
    try {
        await updateEmailFolder(userProfile.uid, selectedEmail.id, Folder.TRASH);
        dispatch({ type: 'DELETE_EMAIL', payload: selectedEmail.id });
    } catch (error) {
        console.error("Failed to delete email:", error);
    }
  };
  
  const handleSpam = async () => {
    if (!userProfile || !selectedEmail) return;
    try {
        await updateEmailFolder(userProfile.uid, selectedEmail.id, Folder.SPAM);
        dispatch({ type: 'MOVE_TO_SPAM', payload: selectedEmail.id });
    } catch (error) {
        console.error("Failed to mark as spam:", error);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-white">
      <div className="p-4 border-b border-gray-200 flex justify-between items-center">
        <h2 className="text-xl font-semibold truncate text-gray-800">{selectedEmail.subject}</h2>
        <div className="flex items-center space-x-2">
            <button onClick={handleSpam} title="Mark as Spam" className="p-2 rounded-full hover:bg-gray-200 transition-colors"><SpamIcon className="w-5 h-5 text-gray-600"/></button>
            <button onClick={handleDelete} title="Delete Email" className="p-2 rounded-full hover:bg-gray-200 transition-colors"><TrashIcon className="w-5 h-5 text-gray-600"/></button>
        </div>
      </div>
      <div className="p-6">
        <div className="flex items-center mb-6">
          <div className="w-10 h-10 bg-blue-500 text-white rounded-full flex-shrink-0 mr-4 flex items-center justify-center font-bold text-xl">
             {selectedEmail.sender.charAt(0)}
          </div>
          <div>
            <p className="font-semibold text-gray-900">{selectedEmail.sender}</p>
            <p className="text-sm text-gray-500">to {selectedEmail.recipient}</p>
          </div>
          <p className="ml-auto text-sm text-gray-500">{selectedEmail.timestamp}</p>
        </div>
      </div>
      <div className="flex-1 p-6 overflow-y-auto text-gray-700 leading-relaxed text-sm" style={{ whiteSpace: 'pre-wrap' }}>
        <p dangerouslySetInnerHTML={{ __html: selectedEmail.body }}></p>
      </div>
    </div>
  );
};

export default EmailDetail;