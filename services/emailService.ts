import { collection, query, where, getDocs, addDoc, doc, updateDoc, writeBatch, serverTimestamp, Timestamp, setDoc, getDoc } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db } from '../firebase';
import { Email, Folder } from '../types';

const getEmailsCollection = (userId: string) => collection(db, 'users', userId, 'emails');
const getUsersCollection = () => collection(db, 'users');

/**
 * Sets up a new user by creating their profile document and seeding initial emails.
 */
export const setupNewUser = async (user: User): Promise<void> => {
    // 1. Create user profile document, storing the email in lowercase for consistent lookups.
    const userDocRef = doc(db, 'users', user.uid);
    await setDoc(userDocRef, {
        uid: user.uid,
        email: user.email?.trim().toLowerCase() || null, // Normalize to lowercase and trim whitespace
        createdAt: serverTimestamp(),
    }, { merge: true });

    // 2. Seed initial emails for the new user
    await seedEmailsForNewUser(user.uid);
};

/**
 * Finds a user's UID by their email address, searching in a case-insensitive and whitespace-insensitive manner.
 * @returns The user's UID string, or null if not found.
 */
const findUserByEmail = async (email: string): Promise<string | null> => {
    try {
        const usersCol = getUsersCollection();
        // Normalize the input email by trimming whitespace and converting to lowercase to match the stored format.
        const normalizedEmail = email.trim().toLowerCase();
        if (!normalizedEmail) {
            console.log('findUserByEmail: Empty email provided');
            return null; // Don't query for an empty or whitespace-only string
        }
        
        console.log('findUserByEmail: Searching for email:', normalizedEmail);
        const q = query(usersCol, where('email', '==', normalizedEmail));
        const querySnapshot = await getDocs(q);

        console.log('findUserByEmail: Query result size:', querySnapshot.size);
        
        if (querySnapshot.empty) {
            console.log('findUserByEmail: No user found with email:', normalizedEmail);
            return null;
        }
        
        // Get the UID from the document data instead of the document ID
        const userDoc = querySnapshot.docs[0];
        const userData = userDoc.data();
        const uid = userData.uid || userDoc.id; // Fallback to document ID if uid field is missing
        console.log('findUserByEmail: Found user with UID:', uid);
        return uid;
    } catch (error) {
        console.error('findUserByEmail: Error occurred:', error);
        throw error;
    }
};


export const getEmails = async (userId: string, folder: Folder): Promise<Email[]> => {
    const emailsCol = getEmailsCollection(userId);
    // The query is modified to remove the `orderBy` clause, which requires a composite index.
    const q = query(emailsCol, where('folder', '==', folder));
    const querySnapshot = await getDocs(q);

    // Map to an intermediate array that includes the original Date object for reliable sorting.
    const tempEmails = querySnapshot.docs.map(doc => {
        const data = doc.data();
        const date = (data.timestamp as Timestamp)?.toDate() ?? new Date();
        return {
            ...data,
            id: doc.id,
            date: date,
        };
    });

    // Sort the intermediate array by the Date object, descending.
    tempEmails.sort((a, b) => b.date.getTime() - a.date.getTime());

    // Map to the final Email[] format, converting the timestamp to a string for display.
    const emails: Email[] = tempEmails.map(data => ({
        id: data.id,
        threadId: data.threadId,
        sender: data.sender,
        senderEmail: data.senderEmail,
        recipient: data.recipient,
        subject: data.subject,
        body: data.body,
        read: data.read,
        folder: data.folder,
        timestamp: data.date.toLocaleString(),
    }));
    
    return emails;
};

export const sendEmail = async (senderUid: string, email: Partial<Email>): Promise<{ success: boolean; message: string; }> => {
    // Step 1: Always save to the sender's "Sent" folder first.
    try {
        const sentEmailData = {
            ...email,
            folder: Folder.SENT,
            read: true,
            timestamp: serverTimestamp(),
            senderUid: senderUid,
        };
        const senderEmailsCol = getEmailsCollection(senderUid);
        await addDoc(senderEmailsCol, sentEmailData);
    } catch (error) {
        console.error("Critical Error: Failed to save email to Sent folder.", error);
        return { success: false, message: "Could not save the email to your Sent folder. Please check your connection or permissions." };
    }

    if (!email.recipient) {
        return { success: true, message: 'Email saved to Sent folder.' };
    }

    // Step 2: Try to deliver to the recipient.
    try {
        const recipientUid = await findUserByEmail(email.recipient);

        if (recipientUid) {
             // Handle sending to self
            if (recipientUid === senderUid) {
                const selfInboxEmailData = { ...email, folder: Folder.INBOX, read: false, timestamp: serverTimestamp(), senderUid: senderUid };
                await addDoc(getEmailsCollection(senderUid), selfInboxEmailData);
                return { success: true, message: 'Email sent successfully to yourself!' };
            }

            // Deliver a copy to recipient's inbox
            const receivedEmailData = { ...email, folder: Folder.INBOX, read: false, timestamp: serverTimestamp(), senderUid: senderUid };
            await addDoc(getEmailsCollection(recipientUid), receivedEmailData);
            return { success: true, message: 'Email sent successfully!' };
        } else {
            return { success: false, message: `Email saved to Sent, but recipient "${email.recipient}" was not found in VoxMail.` };
        }
    } catch (error: any) {
        console.error("Delivery Error:", error);
        return { 
            success: false, 
            message: `Email delivery failed: ${error.message || 'Unknown error'}. Your email has been saved in 'Sent'.` 
        };
    }
};


export const updateEmailFolder = async (userId: string, emailId: string, folder: Folder): Promise<void> => {
    const emailDoc = doc(db, 'users', userId, 'emails', emailId);
    await updateDoc(emailDoc, { folder });
};

export const markEmailAsRead = async (userId: string, emailId: string): Promise<void> => {
    const emailDoc = doc(db, 'users', userId, 'emails', emailId);
    await updateDoc(emailDoc, { read: true });
};

export const seedEmailsForNewUser = async (userId: string): Promise<void> => {
    const emailsCol = getEmailsCollection(userId);
    const q = query(emailsCol);
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
        console.log(`Seeding emails for new user: ${userId}`);
        const batch = writeBatch(db);

        const MOCK_EMAILS_TEMPLATE: Omit<Email, 'id' | 'timestamp'>[] = [
          {
            threadId: 't1',
            sender: 'GitHub',
            senderEmail: 'noreply@github.com',
            recipient: 'you@example.com',
            subject: '[voxmail] Your build has passed!',
            body: 'Your recent commit to the main branch of voxmail has passed all checks. Great job!',
            read: false,
            folder: Folder.INBOX,
          },
          {
            threadId: 't2',
            sender: 'Figma',
            senderEmail: 'team@figma.com',
            recipient: 'you@example.com',
            subject: 'Updates to our collaboration features',
            body: 'Hi there, we have some exciting new updates to make collaboration even smoother. Check out our latest blog post to learn more.',
            read: false,
            folder: Folder.INBOX,
          },
          {
            threadId: 't3',
            sender: 'Alice',
            senderEmail: 'alice@example.com',
            recipient: 'you@example.com',
            subject: 'Lunch on Friday?',
            body: 'Hey! Are you free for lunch this Friday? I was thinking we could try that new cafe downtown. Let me know!',
            read: true,
            folder: Folder.INBOX,
          },
        ];

        MOCK_EMAILS_TEMPLATE.forEach(email => {
            const docRef = doc(emailsCol);
            batch.set(docRef, { ...email, timestamp: serverTimestamp() });
        });

        await batch.commit();
    }
};