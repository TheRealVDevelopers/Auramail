import { Email, Folder } from '../types';

// Mock email data
const mockEmails: Email[] = [
  {
    id: '1',
    sender: 'John Doe',
    senderEmail: 'john@example.com',
    recipient: 'you@example.com',
    subject: 'Welcome to VoxMail!',
    body: 'This is a sample email to get you started. You can use voice commands to manage your emails.',
    timestamp: new Date().toLocaleString(),
    read: false,
    folder: Folder.INBOX
  },
  {
    id: '2',
    sender: 'Sarah Wilson',
    senderEmail: 'sarah@company.com',
    recipient: 'you@example.com',
    subject: 'Meeting Tomorrow',
    body: 'Hi! Just a reminder about our meeting tomorrow at 2 PM. Please bring the quarterly reports.',
    timestamp: new Date(Date.now() - 3600000).toLocaleString(),
    read: true,
    folder: Folder.INBOX
  },
  {
    id: '3',
    sender: 'You',
    senderEmail: 'you@example.com',
    recipient: 'team@company.com',
    subject: 'Project Update',
    body: 'Here is the latest update on our project. Everything is on track for the deadline.',
    timestamp: new Date(Date.now() - 7200000).toLocaleString(),
    read: true,
    folder: Folder.SENT
  }
];

export const mockEmailService = {
  // Get emails for a folder
  getEmails: async (userId: string, folder: Folder): Promise<Email[]> => {
    console.log(`Mock: Getting emails for user ${userId} in folder ${folder}`);
    return mockEmails.filter(email => email.folder === folder);
  },

  // Get unread count
  getUnreadCount: async (userId: string, folder: Folder): Promise<number> => {
    console.log(`Mock: Getting unread count for user ${userId} in folder ${folder}`);
    return mockEmails.filter(email => email.folder === folder && !email.read).length;
  },

  // Update email folder
  updateEmailFolder: async (userId: string, emailId: string, folder: Folder): Promise<void> => {
    console.log(`Mock: Moving email ${emailId} to folder ${folder}`);
    const email = mockEmails.find(e => e.id === emailId);
    if (email) {
      email.folder = folder;
    }
  },

  // Send email
  sendEmail: async (userId: string, email: Partial<Email>): Promise<{ success: boolean; message: string }> => {
    console.log(`Mock: Sending email from user ${userId}`, email);
    const newEmail: Email = {
      id: Date.now().toString(),
      sender: 'You',
      senderEmail: 'you@example.com',
      recipient: email.recipient || '',
      subject: email.subject || '',
      body: email.body || '',
      timestamp: new Date().toLocaleString(),
      read: true,
      folder: Folder.SENT
    };
    mockEmails.push(newEmail);
    return { success: true, message: 'Email sent successfully!' };
  },

  // Setup new user
  setupNewUser: async (user: any): Promise<void> => {
    console.log('Mock: Setting up new user', user);
    // In a real app, this would create user data in the database
  }
};
