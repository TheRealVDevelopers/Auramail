import React from 'react';
import { useAppContext } from '../context/AppContext';
import { EnvelopeIcon, SettingsIcon } from './icons/IconComponents';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';

const Header: React.FC = () => {
  const { state } = useAppContext();

  const handleLogout = () => {
      signOut(auth).catch(error => console.error("Logout failed", error));
  };
  
  return (
    <header className="flex-shrink-0 flex items-center justify-between p-4 bg-white border-b border-gray-200">
      <div className="flex items-center space-x-2 text-2xl font-bold">
        <EnvelopeIcon className="w-8 h-8 text-blue-600" />
        <span>VoxMail</span>
      </div>

      <div className="flex items-center space-x-4">
        <button className="p-2 rounded-full hover:bg-gray-100 transition-colors" title="Settings (coming soon)">
            <SettingsIcon className="w-6 h-6 text-gray-600" />
        </button>
        <span className="font-semibold text-gray-700">{state.userProfile?.name || state.userProfile?.email}</span>
        <button 
            onClick={handleLogout}
            className="text-sm font-semibold text-gray-600 hover:text-blue-600 transition-colors"
        >
            Logout
        </button>
      </div>
    </header>
  );
};

export default Header;