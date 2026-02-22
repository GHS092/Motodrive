
import React, { useState, useEffect, useRef } from 'react';
import { Send, X, User, AlertTriangle } from 'lucide-react';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { ChatMessage, User as AppUser } from '../types';

interface ChatWindowProps {
  rideId: string;
  currentUser: AppUser;
  otherUserName: string;
  onClose: () => void;
}

const ChatWindow: React.FC<ChatWindowProps> = ({ rideId, currentUser, otherUserName, onClose }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [permissionError, setPermissionError] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rideId) return;

    const messagesRef = collection(db, 'rides', rideId, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));

    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        const msgs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as ChatMessage[];
        setMessages(msgs);
        setPermissionError(false);
        scrollToBottom();
      },
      (error) => {
        console.error("Error en Chat:", error);
        if (error.code === 'permission-denied') {
          setPermissionError(true);
        }
      }
    );

    return () => unsubscribe();
  }, [rideId]);

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || isSending) return;

    setIsSending(true);
    try {
      const messagesRef = collection(db, 'rides', rideId, 'messages');
      await addDoc(messagesRef, {
        text: newMessage,
        senderId: currentUser.id,
        senderName: currentUser.name,
        timestamp: Date.now()
      });
      setNewMessage('');
    } catch (error: any) {
      console.error("Error enviando mensaje:", error);
      if (error.code === 'permission-denied') {
        setPermissionError(true);
      } else {
        alert("No se pudo enviar el mensaje. Revisa tu conexión.");
      }
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center animate-in fade-in duration-200">
      <div className="bg-white w-full sm:w-96 sm:rounded-2xl rounded-t-3xl h-[80vh] sm:h-[600px] flex flex-col shadow-2xl animate-in slide-in-from-bottom-10">
        
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between bg-slate-50 rounded-t-3xl sm:rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-200 rounded-full flex items-center justify-center text-slate-500">
                <User className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">{otherUserName}</h3>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Chat del Viaje</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 bg-slate-200 rounded-full text-slate-600 hover:bg-slate-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#e5ddd5]">
          {permissionError && (
            <div className="bg-red-100 border border-red-200 p-3 rounded-xl text-red-600 text-xs font-bold flex items-center gap-2 mb-4">
               <AlertTriangle className="w-4 h-4" />
               Error de permisos: Actualiza las Reglas en Firebase Console.
            </div>
          )}

          {messages.length === 0 && !permissionError && (
             <div className="text-center py-10 text-slate-400 text-xs font-bold bg-white/50 rounded-xl mx-4 mt-4">
                Inicia la conversación con {otherUserName}
             </div>
          )}
          
          {messages.map((msg) => {
            const isMe = msg.senderId === currentUser.id;
            return (
              <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-2 shadow-sm text-sm ${isMe ? 'bg-black text-white rounded-tr-none' : 'bg-white text-slate-800 rounded-tl-none'}`}>
                  <p>{msg.text}</p>
                  <p className={`text-[9px] mt-1 text-right ${isMe ? 'text-slate-400' : 'text-slate-400'}`}>
                    {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSend} className="p-3 border-t bg-white flex gap-2 pb-6 sm:pb-3 rounded-b-none sm:rounded-b-2xl">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Escribe un mensaje..."
            disabled={permissionError}
            className="flex-1 bg-slate-100 border-none rounded-full px-4 py-3 focus:ring-2 focus:ring-yellow-400 outline-none font-medium text-slate-800 disabled:opacity-50"
          />
          <button 
            type="submit" 
            disabled={!newMessage.trim() || permissionError}
            className="bg-yellow-400 text-slate-900 p-3 rounded-full hover:bg-yellow-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-md transition-transform active:scale-90"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChatWindow;
