import React from 'react';
import { useAppContext } from '../context/AppContext';
import { EnvelopeIcon, SettingsIcon } from './icons/IconComponents';
import { auth } from '../firebase';
import { SUPPORTED_LANGUAGES } from '../constants';

const Header: React.FC = () => {
  const { state, dispatch } = useAppContext();

  const handleLogout = () => {
      // Fix: Use v8 `auth.signOut()` method
      auth.signOut().catch(error => console.error("Logout failed", error));
  };

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    dispatch({ type: 'SET_LANGUAGE', payload: e.target.value });
  };
  
  return (
    <header className="flex-shrink-0 flex items-center justify-between p-4 bg-white border-b border-gray-200">
      <div className="flex items-center space-x-2 text-2xl font-bold">
        <EnvelopeIcon className="w-8 h-8 text-blue-600" />
        <span>VoxMail</span>
      </div>

      <div className="flex items-center space-x-4">
        <select
            value={state.currentLanguage}
            onChange={handleLanguageChange}
            className="text-sm bg-gray-50 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 py-1.5 px-2"
            aria-label="Select language"
        >
            {SUPPORTED_LANGUAGES.map(lang => (
                <option key={lang.code} value={lang.code}>{lang.name}</option>
            ))}
        </select>
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