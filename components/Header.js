import React from 'react';
import { useAppContext } from '../context/AppContext.js';
import { EnvelopeIcon, SettingsIcon } from './icons/IconComponents.js';
import { auth } from '../firebase.js';
import { SUPPORTED_LANGUAGES } from '../constants.js';

const Header = () => {
  const { state, dispatch } = useAppContext();

  const handleLogout = () => {
      // Fix: Use v8 `auth.signOut()` method
      auth.signOut().catch(error => console.error("Logout failed", error));
  };

  const handleLanguageChange = (e) => {
    dispatch({ type: 'SET_LANGUAGE', payload: e.target.value });
  };
  
  return (
    React.createElement('header', { className: "flex-shrink-0 flex items-center justify-between p-4 bg-white border-b border-gray-200" },
      React.createElement('div', { className: "flex items-center space-x-2 text-2xl font-bold" },
        React.createElement(EnvelopeIcon, { className: "w-8 h-8 text-blue-600" }),
        React.createElement('span', null, "VoxMail")
      ),

      React.createElement('div', { className: "flex items-center space-x-4" },
        React.createElement('select',
            {
                value: state.currentLanguage,
                onChange: handleLanguageChange,
                className: "text-sm bg-gray-50 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 py-1.5 px-2",
                "aria-label": "Select language"
            },
            SUPPORTED_LANGUAGES.map(lang => (
                React.createElement('option', { key: lang.code, value: lang.code }, lang.name)
            ))
        ),
        React.createElement('button', { className: "p-2 rounded-full hover:bg-gray-100 transition-colors", title: "Settings (coming soon)" },
            React.createElement(SettingsIcon, { className: "w-6 h-6 text-gray-600" })
        ),
        React.createElement('span', { className: "font-semibold text-gray-700" }, state.userProfile?.name || state.userProfile?.email),
        React.createElement('button', 
            {
                onClick: handleLogout,
                className: "text-sm font-semibold text-gray-600 hover:text-blue-600 transition-colors"
            },
            "Logout"
        )
      )
    )
  );
};

export default Header;
