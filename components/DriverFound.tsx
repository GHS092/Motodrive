
import React, { useState } from 'react';
import { Driver, RideRequest, User } from '../types';
import { Phone, MessageCircle, Star, Shield, MapPin, XCircle, Copy, Check } from 'lucide-react';
import ChatWindow from './ChatWindow';

interface DriverFoundProps {
  driver: Driver;
  activeRide: RideRequest | null;
  currentUser: User;
  onCancel: () => void;
  statusText: string;
  onOpenChat: () => void;
}

const DriverFound: React.FC<DriverFoundProps> = ({ driver, activeRide, currentUser, onCancel, statusText, onOpenChat }) => {
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCall = () => {
    if (driver.phone) {
      window.location.href = `tel:${driver.phone}`;
      // También mostramos el modal por si el usuario está en desktop o la acción falla
      setTimeout(() => setShowPhoneModal(true), 1000);
    } else {
        alert("El conductor no tiene un número registrado.");
    }
  };

  const copyToClipboard = () => {
    if (driver.phone) {
      navigator.clipboard.writeText(driver.phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      <div className="flex flex-col h-full animate-in slide-in-from-bottom-10 duration-500 relative">
        
        {/* Status Banner */}
        <div className="w-full py-2 mb-4 rounded-lg text-center font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 bg-green-100 text-green-700 border border-green-200">
            <div className="w-2 h-2 rounded-full bg-green-500"></div>
            {statusText}
        </div>

        {/* PRECIO VISIBLE */}
        <div className="flex flex-col items-center mb-6">
             <div className="flex items-baseline gap-1">
                 <span className="text-sm font-bold text-slate-400">Total:</span>
                 <span className="text-4xl font-black text-slate-900 tracking-tighter">
                    S/ {(activeRide?.fare || 0).toFixed(2)}
                 </span>
             </div>
             <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded uppercase tracking-widest mt-1 border border-slate-100">
                Pago en Efectivo
             </span>
        </div>

        {/* Driver Card */}
        <div className="flex flex-col items-center mb-8 relative">
          <div className="absolute inset-0 blur-2xl opacity-20 rounded-full bg-yellow-400"></div>
          
          <div className="relative">
              <img 
                src={driver.photoUrl} 
                alt={driver.name} 
                className="w-28 h-28 rounded-full border-4 object-cover shadow-2xl relative z-10 border-white"
              />
               <div className="absolute -bottom-3 -right-3 z-20 px-2 py-1 rounded-lg flex items-center gap-1 text-xs font-black shadow-lg bg-white text-slate-900">
                  <Star className="w-3 h-3 fill-current" /> {driver.rating}
              </div>
          </div>

          <h2 className="text-2xl font-black mt-4 text-slate-900">{driver.name}</h2>
          <div className="flex flex-col items-center gap-1 mt-1">
               <p className="text-sm font-bold text-slate-600 bg-slate-100 px-3 py-1 rounded-full">{driver.bikeModel || 'Moto Estándar'}</p>
               <p className="text-xs font-black text-yellow-600 border border-yellow-200 bg-yellow-50 px-2 py-0.5 rounded uppercase tracking-widest">
                  {driver.plates || 'SIN PLACA'}
               </p>
          </div>
        </div>

        {/* Info Grid */}
        <div className="grid grid-cols-2 gap-4 mb-6">
           <div className="p-4 rounded-2xl border flex flex-col items-center justify-center gap-2 bg-slate-50 border-slate-100">
               <div className="p-2 rounded-full bg-white text-slate-900 shadow-sm">
                   <Shield className="w-5 h-5" />
               </div>
               <p className="text-[10px] uppercase font-bold text-slate-400">Verificado</p>
           </div>
           <div className="p-4 rounded-2xl border flex flex-col items-center justify-center gap-2 bg-slate-50 border-slate-100">
               <div className="p-2 rounded-full bg-white text-slate-900 shadow-sm">
                   <MapPin className="w-5 h-5" />
               </div>
               <p className="text-[10px] uppercase font-bold text-slate-400">GPS Activo</p>
           </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-4 w-full mt-auto">
          <button 
            onClick={onOpenChat}
            className="flex items-center justify-center gap-2 py-4 rounded-2xl font-bold transition-all hover:scale-[1.02] active:scale-95 bg-slate-100 text-slate-700 hover:bg-slate-200"
          >
              <MessageCircle className="w-5 h-5" /> Chat
          </button>
          <button 
            onClick={handleCall}
            className="flex items-center justify-center gap-2 py-4 rounded-2xl font-bold transition-all hover:scale-[1.02] active:scale-95 shadow-lg bg-black text-white hover:bg-slate-900 shadow-slate-900/20"
          >
              <Phone className="w-5 h-5" /> Llamar
          </button>
        </div>

        <button 
          onClick={onCancel}
          className="w-full py-4 mt-3 text-red-400 text-xs font-bold uppercase tracking-wider hover:text-red-500 flex items-center justify-center gap-2"
        >
          <XCircle className="w-4 h-4" /> Cancelar Servicio
        </button>
      </div>

      {/* PHONE MODAL FALLBACK */}
      {showPhoneModal && (
        <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-3xl p-6 w-full max-w-xs shadow-2xl animate-in zoom-in-95">
             <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-lg">Contactar Conductor</h3>
                <button onClick={() => setShowPhoneModal(false)} className="p-1 bg-slate-100 rounded-full"><XCircle className="w-6 h-6 text-slate-400"/></button>
             </div>
             <div className="text-center py-4">
                <img src={driver.photoUrl} className="w-16 h-16 rounded-full mx-auto mb-2 border-2 border-slate-100" />
                <p className="font-bold text-slate-900">{driver.name}</p>
                <div className="mt-4 bg-slate-100 p-4 rounded-2xl flex items-center justify-between">
                   <span className="font-mono text-lg font-bold text-slate-700">{driver.phone || 'Sin número'}</span>
                   <button onClick={copyToClipboard} className="p-2 bg-white rounded-lg shadow-sm active:scale-95">
                      {copied ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5 text-slate-500" />}
                   </button>
                </div>
                <p className="text-xs text-slate-400 mt-2 font-medium">Copia el número si la llamada no inició automáticamente.</p>
             </div>
             <a href={`tel:${driver.phone}`} className="block w-full bg-black text-white text-center py-3 rounded-xl font-bold mt-2">Intentar Llamar de nuevo</a>
          </div>
        </div>
      )}
    </>
  );
};

export default DriverFound;
