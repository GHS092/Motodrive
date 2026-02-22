
import React, { useState, useEffect, useRef } from 'react';
import { Driver, RideRequest, AdminSettings } from '../types';
import { Power, MapPin, Navigation, DollarSign, Bell, User, LogOut, Crosshair, ArrowRight, Loader, MessageCircle, Wallet, CreditCard, Upload, CheckCircle, AlertCircle, Phone, X, Camera, ChevronRight, Moon, Sun, Package, Edit3, Bike, Box, ArrowLeftRight, Zap, ZoomIn, FileText, Wifi, WifiOff } from 'lucide-react';
import MapVisualization from './MapVisualization';
import { calculateRealRoute } from '../services/mapService';
import ChatWindow from './ChatWindow';
import { collection, query, onSnapshot, orderBy, updateDoc, doc, serverTimestamp, getDoc, where } from 'firebase/firestore';
import { db } from '../services/firebase';

interface DriverDashboardProps {
  driver: Driver;
  onUpdateDriver: (data: Partial<Driver>) => void; // Changed to Partial to avoid sending full object
  onLogout: () => void;
  activeRequest: RideRequest | null;
  nearbyRides?: RideRequest[]; // Nueva prop: Lista de viajes disponibles
  onSelectRide?: (ride: RideRequest) => void; // Nueva prop: Para seleccionar un viaje de la lista
  onAcceptRequest: () => void;
  onRejectRequest: () => void;
  onCompleteRide: () => void;
  onStartTrip: () => void;
  onRequestRecharge?: (amount: number, credits: number, proof: string) => Promise<void>; // Updated to Promise
  onRequestWithdrawal?: (amount: number, qrUrl: string) => Promise<void>; // Updated to Promise
  adminSettings?: AdminSettings;
}

// Función de compresión local
const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        if (file.size < 500000) { 
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (e) => resolve(e.target?.result as string);
            reader.onerror = (e) => reject(e);
            return;
        }
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) { resolve(event.target?.result as string); return; }
                const MAX_WIDTH = 400;
                const scaleFactor = MAX_WIDTH / img.width;
                canvas.width = MAX_WIDTH;
                canvas.height = img.height * scaleFactor;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
        };
        reader.onerror = (err) => reject(err);
    });
};

const DriverDashboard: React.FC<DriverDashboardProps> = ({ 
  driver, onUpdateDriver, onLogout, 
  activeRequest, nearbyRides = [], onSelectRide,
  onAcceptRequest, onRejectRequest, onCompleteRide, onStartTrip,
  onRequestRecharge, onRequestWithdrawal, adminSettings
}) => {
  // Inicializamos online si está disponible O en viaje
  const [isOnline, setIsOnline] = useState(driver?.status === 'AVAILABLE' || driver?.status === 'BUSY');
  
  const [routePolyline, setRoutePolyline] = useState<[number, number][] | undefined>(undefined);
  const [navInfo, setNavInfo] = useState<{distance: string, duration: string} | null>(null);
  
  // Estados para el Chat
  const [showChat, setShowChat] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);

  // Estado llamada
  const [isCalling, setIsCalling] = useState(false);

  // Estados para Billetera
  const [showWallet, setShowWallet] = useState(false);
  const [walletTab, setWalletTab] = useState<'RECHARGE' | 'WITHDRAW'>('RECHARGE');
  const [proofImage, setProofImage] = useState<string | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [rechargeAmount, setRechargeAmount] = useState('');
  const [uploading, setUploading] = useState(false);
  // Visor de Imagenes
  const [viewingImage, setViewingImage] = useState<string | null>(null);

  // Estado para subida de foto de perfil
  const [isUpdatingPhoto, setIsUpdatingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputProofRef = useRef<HTMLInputElement>(null); // Ref para subida de comprobante

  // Estado para Negociación
  const [counterOfferAmount, setCounterOfferAmount] = useState('');
  const [isNegotiating, setIsNegotiating] = useState(false);

  // Estado para retiros pendientes
  const [pendingWithdrawalsAmount, setPendingWithdrawalsAmount] = useState(0);

  // Estado para Panel de Viajes Libres
  const [panelTab, setPanelTab] = useState<'RIDE' | 'DELIVERY'>('RIDE');

  // DARK MODE STATE
  const [isDarkMode, setIsDarkMode] = useState(false);

  const toggleTheme = () => {
    // Disabled as per user request for white theme
    setIsDarkMode(false);
  };

  // --- LISTENER DE RETIROS PENDIENTES ---
  useEffect(() => {
      if (!driver.id) return;
      
      const q = query(
          collection(db, 'recharge_requests'), 
          where('userId', '==', driver.id),
          where('status', '==', 'PENDING'),
          where('requestType', '==', 'WITHDRAWAL')
      );
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
          const total = snapshot.docs.reduce((acc, doc) => acc + (doc.data().amount || 0), 0);
          setPendingWithdrawalsAmount(total);
      });
      
      return () => unsubscribe();
  }, [driver.id]);

  // --- REFS PARA CONTROL DE GPS Y ESTADO ---
  const driverRef = useRef(driver);
  const onUpdateDriverRef = useRef(onUpdateDriver);
  const lastUpdateRef = useRef(0);
  const isOnlineRef = useRef(isOnline); // Ref para acceso síncrono en listeners

  useEffect(() => { driverRef.current = driver; }, [driver]);
  useEffect(() => { onUpdateDriverRef.current = onUpdateDriver; }, [onUpdateDriver]);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);

  // --- SOLUCIÓN 1: SYNC INICIAL Y VISIBILIDAD (RECUPERACIÓN DE ESTADO) ---
  useEffect(() => {
    // Si entramos y el driver dice available, ponemos el switch en true
    if (driver && (driver.status === 'AVAILABLE' || driver.status === 'BUSY')) {
        setIsOnline(true);
    }
    
    // Listener para cuando la app vuelve del segundo plano (desbloqueo de celular)
    const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible' && isOnlineRef.current) {
            console.log("App visible: Forzando resincronización de estado AVAILABLE");
            // Forzamos actualización inmediata para que el cliente nos vea
            onUpdateDriverRef.current({
                status: 'AVAILABLE'
            });
        }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // --- SOLUCIÓN 2: HEARTBEAT (LATIDO) ---
  // Mantiene vivo el estado en Firebase aunque el GPS no se mueva
  useEffect(() => {
      if (!isOnline) return;

      const heartbeatInterval = setInterval(() => {
          console.log("Heartbeat: Enviando señal de vida a Firebase");
          // Re-enviamos el estado actual y la posición para refrescar timestamp en server
          // Esto evita que parezca desconectado si está estacionado
          const currentStatus = driverRef.current.status === 'OFFLINE' ? 'AVAILABLE' : driverRef.current.status;
          
          onUpdateDriverRef.current({
              status: currentStatus
          });
      }, 45000); // Cada 45 segundos

      return () => clearInterval(heartbeatInterval);
  }, [isOnline]);

  // --- SOLUCIÓN 3: GPS REAL OPTIMIZADO (THROTTLED & ROBUST) ---
  useEffect(() => {
    if (!isOnline || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        // Limitamos actualizaciones a 1 cada 5 segundos para no saturar, pero suficiente para tracking
        if (now - lastUpdateRef.current < 5000) return;
        
        lastUpdateRef.current = now;
        
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        
        if (isNaN(lat) || isNaN(lng)) return;

        const newPos = { lat, lng };
        
        // CRÍTICO: Si el switch local dice ONLINE, forzamos AVAILABLE en la DB
        // aunque la DB diga OFFLINE (corrige desincronización)
        const currentStatus = driverRef.current.status;
        const statusToKeep = currentStatus === 'OFFLINE' ? 'AVAILABLE' : currentStatus;

        // ONLY send changed fields to prevent large writes (like photoUrl)
        onUpdateDriverRef.current({ 
            position: newPos, 
            status: statusToKeep 
        });
      },
      (err) => {
          console.warn(`GPS Warning (${err.code}): ${err.message}.`);
          // Si falla el GPS, NO desconectamos al conductor, solo no actualizamos posición.
          // El Heartbeat se encargará de mantenerlo online.
      },
      { 
          enableHighAccuracy: true, 
          maximumAge: 0, 
          timeout: 15000 
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [isOnline]);

  const toggleStatus = async () => {
    if (!isOnline && (driver.credits || 0) < 2) {
        alert(`SALDO INSUFICIENTE\n\nTienes ${(driver.credits || 0).toFixed(2)} créditos.\nNecesitas mínimo 2.00 créditos para conectarte.`);
        setShowWallet(true);
        return;
    }
    
    const newStatus = !isOnline;
    setIsOnline(newStatus);
    
    try {
        // Use onUpdateDriver prop instead of direct updateDoc to avoid double writes and consistency issues
        onUpdateDriver({
          status: newStatus ? 'AVAILABLE' : 'OFFLINE'
        });
        
    } catch (e) {
        console.error("Error toggle status:", e);
        // Revertir si falla
        setIsOnline(!newStatus);
        alert("Error de conexión. No se pudo cambiar el estado.");
    }
  };

  // Logica revisada: 
  const hasPendingRequest = isOnline && activeRequest && activeRequest.status === 'PENDING';
  const isAccepted = activeRequest && activeRequest.status === 'ACCEPTED';
  const isInProgress = activeRequest && activeRequest.status === 'IN_PROGRESS';
  const hasActiveTrip = isAccepted || isInProgress;

  // Filtrado de viajes para el panel
  const filteredRides = nearbyRides.filter(ride => {
      if (panelTab === 'RIDE') return ride.serviceType !== 'DELIVERY';
      return ride.serviceType === 'DELIVERY';
  });

  // Cálculo de ruta
  useEffect(() => {
    if (!hasActiveTrip || !activeRequest) {
        setRoutePolyline(undefined);
        setNavInfo(null);
        return;
    }

    const updateRoute = async () => {
        const start = driver.position;
        const end = isInProgress ? activeRequest.destinationCoordinates : activeRequest.pickupCoordinates;
        const routeData = await calculateRealRoute(start, end);
        if (routeData && routeData.geometry) {
            setRoutePolyline(routeData.geometry);
            setNavInfo({ distance: routeData.distance, duration: routeData.duration });
        }
    };

    updateRoute();
  }, [hasActiveTrip, isInProgress, activeRequest?.id, driver.position]); 

  // Listener de Chat
  useEffect(() => {
    if (!activeRequest || !hasActiveTrip) {
      setHasUnread(false);
      return;
    }
    const messagesRef = collection(db, 'rides', activeRequest.id, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));
    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        if (snapshot.empty) return;
        const messages = snapshot.docs.map(doc => doc.data());
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.senderId !== driver.id && !showChat) {
            setHasUnread(true);
        }
      },
      (error) => { console.warn("Chat listener error (Driver):", error.code); }
    );
    return () => unsubscribe();
  }, [activeRequest?.id, hasActiveTrip, showChat, driver.id]);

  // --- LÓGICA DE LLAMADA ROBUSTA ---
  const handleCallPassenger = async () => {
      if (!activeRequest) return;
      
      setIsCalling(true);
      let phoneToCall = activeRequest.passengerPhone;

      // Si el número no está en el viaje, lo buscamos en el perfil del cliente
      if (!phoneToCall) {
          try {
              const clientSnap = await getDoc(doc(db, "clients", activeRequest.passengerId));
              if (clientSnap.exists()) {
                  const clientData = clientSnap.data();
                  if (clientData && clientData.phone) {
                      phoneToCall = clientData.phone;
                      // Opcional: Actualizar el viaje en segundo plano para que la próxima sea rápido
                      updateDoc(doc(db, "rides", activeRequest.id), { passengerPhone: phoneToCall }).catch(console.error);
                  }
              }
          } catch (e) {
              console.error("Error recuperando teléfono del cliente:", e);
          }
      }

      setIsCalling(false);

      if (phoneToCall) {
          window.location.href = `tel:${phoneToCall}`;
      } else {
          alert("El número del pasajero no se encuentra registrado en el sistema.");
      }
  };

  const handleRechargeSubmit = async () => {
      if (!rechargeAmount || !proofImage || !onRequestRecharge) return;
      const amount = parseFloat(rechargeAmount);
      
      if (isNaN(amount) || amount <= 0) {
          alert("Por favor ingresa un monto válido.");
          return;
      }

      setUploading(true);
      
      // DYNAMIC BONUS LOGIC
      let credits = amount;
      const isBonusEnabled = adminSettings?.enableDriverBonus === true; // STRICT CHECK
      const threshold = adminSettings?.driverBonusThreshold ?? 50.00;
      const bonusPercent = adminSettings?.driverBonusPercent ?? 0.10;

      if (isBonusEnabled && amount >= threshold) {
          credits = Math.floor(amount * (1 + bonusPercent));
      }

      try {
        // IMPORTANT: AWAIT THE REQUEST
        await onRequestRecharge(amount, credits, proofImage);
        
        setProofImage(null);
        setRechargeAmount('');
        alert("Solicitud de recarga enviada.");
        setShowWallet(false);
      } catch (error) {
        console.error("Error submitting recharge (Driver):", error);
        alert("Error al enviar solicitud. Intenta nuevamente.");
      } finally {
        setUploading(false);
      }
  };
  
  const handleWithdrawSubmit = async () => {
      if (!withdrawAmount || !proofImage || !onRequestWithdrawal) return;
      const amt = parseFloat(withdrawAmount);
      if (isNaN(amt) || amt < 30) {
          alert("El retiro mínimo es de S/ 30.00");
          return;
      }
      
      const availableBalance = (driver.walletBalance || 0) - pendingWithdrawalsAmount;

      if (amt > availableBalance) {
          alert(`Saldo insuficiente. Tienes S/ ${pendingWithdrawalsAmount.toFixed(2)} en solicitudes pendientes. Tu saldo disponible real es S/ ${availableBalance.toFixed(2)}.`);
          return;
      }
      
      setUploading(true);
      try {
        // Usamos proofImage como el QR del conductor para recibir el pago
        // IMPORTANT: AWAIT THE REQUEST
        await onRequestWithdrawal(amt, proofImage); 
        
        setProofImage(null);
        setWithdrawAmount('');
        alert("Solicitud de retiro enviada.");
        setShowWallet(false);
      } catch (error) {
          console.error("Error submitting withdrawal:", error);
          alert("Error al enviar solicitud de retiro.");
      } finally {
          setUploading(false);
      }
  }
  
  const handleTransferToCredits = async () => {
      const amount = parseFloat(withdrawAmount);
      if (isNaN(amount) || amount <= 0) return;
      if (amount > (driver.walletBalance || 0)) {
          alert("Saldo insuficiente.");
          return;
      }
      
      if(confirm(`¿Deseas mover S/ ${amount} de tus ganancias a tus créditos operativos?`)) {
          const newWallet = (driver.walletBalance || 0) - amount;
          const newCredits = (driver.credits || 0) + amount;
          await updateDoc(doc(db, 'drivers', driver.id), {
              walletBalance: newWallet,
              credits: newCredits
          });
          setWithdrawAmount('');
          alert("Transferencia exitosa.");
      }
  }

  const handleSupportClick = () => {
      if(adminSettings?.supportPhone) {
          window.open(`https://wa.me/${adminSettings.supportPhone}`, '_blank');
      } else {
          alert("Número de soporte no configurado");
      }
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsUpdatingPhoto(true);
      try {
          const base64 = await compressImage(file);
          // Use onUpdateDriver to handle DB update, avoid double writes
          onUpdateDriver({ photoUrl: base64 });
          alert("Foto actualizada.");
      } catch (error) {
          console.error("Error updating photo:", error);
          alert("Error al actualizar foto.");
      } finally {
          setIsUpdatingPhoto(false);
      }
  };

  // MANEJADOR DE CARGA DE COMPROBANTE / QR
  const handleProofUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      
      setUploading(true);
      try {
          const base64 = await compressImage(file);
          setProofImage(base64);
      } catch (err) {
          console.error(err);
          alert("Error al procesar la imagen del comprobante.");
      } finally {
          setUploading(false);
      }
  };
  
  const submitCounterOffer = async () => {
      if(!activeRequest || !counterOfferAmount) return;
      const amount = parseFloat(counterOfferAmount);
      if(isNaN(amount) || amount <= activeRequest.fare) {
          alert("La contraoferta debe ser mayor al precio original.");
          return;
      }
      
      try {
          await updateDoc(doc(db, "rides", activeRequest.id), {
              driverOffer: amount
          });
          setIsNegotiating(false);
          alert("Oferta enviada al cliente. Espera su confirmación.");
      } catch (e) {
          console.error(e);
          alert("Error enviando oferta");
      }
  }


  return (
    <div className={`${isDarkMode ? 'dark' : ''} relative w-full h-[100dvh] overflow-hidden`}>
    <div className="relative w-full h-full bg-slate-50 overflow-hidden transition-colors duration-300">
      {/* Header Conductor */}
      <div className="absolute top-0 w-full z-50 p-4 pointer-events-none">
        <div className="flex justify-between items-start pointer-events-auto">
            
            <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept="image/*" 
                onChange={handlePhotoUpload}
            />

            <div className="bg-white/90 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-700 p-2 pr-5 rounded-full flex items-center gap-3 shadow-xl transition-colors group">
                <div 
                    onClick={() => !isUpdatingPhoto && fileInputRef.current?.click()}
                    className="relative cursor-pointer"
                >
                    <img src={driver.photoUrl} className="w-10 h-10 rounded-full border-2 border-slate-200 dark:border-slate-600 object-cover group-hover:border-yellow-500 transition-colors" />
                    <div className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                </div>

                <div onClick={() => setShowWallet(true)} className="cursor-pointer">
                    <h2 className="text-slate-900 dark:text-white font-bold text-xs flex items-center gap-1">
                        {driver.name.split(' ')[0]}
                        <span className={`text-[9px] px-1.5 py-0.5 rounded ${(driver.credits || 0) < 2 ? 'bg-red-500 text-white' : 'bg-yellow-500 text-black'}`}>
                            {(driver.credits || 0).toFixed(1)} Cr
                        </span>
                    </h2>
                    <span className="text-[9px] text-slate-500 dark:text-slate-400 uppercase font-black tracking-widest flex items-center gap-1">
                        {isOnline ? (
                            <><Wifi className="w-3 h-3"/> EN TURNO</>
                        ) : (
                            <><WifiOff className="w-3 h-3"/> DESCONECTADO</>
                        )}
                    </span>
                </div>
            </div>

            <div className="flex items-center gap-2">
                 {/* Dark Mode Toggle */}
                <button onClick={toggleTheme} className="bg-white dark:bg-slate-800 p-3 rounded-full border border-slate-200 dark:border-slate-700 shadow-lg active:scale-95 transition-transform">
                    {isDarkMode ? <Sun className="w-5 h-5 text-yellow-400" /> : <Moon className="w-5 h-5 text-slate-600" />}
                </button>

                <button onClick={onLogout} className="bg-red-50 dark:bg-red-500/10 p-3 rounded-full border border-red-100 dark:border-red-500/20 text-red-500 dark:text-red-400 active:scale-90 transition-transform shadow-lg">
                    <LogOut className="w-5 h-5" />
                </button>
            </div>
        </div>
      </div>

      {/* --- PANEL DE NAVEGACIÓN COMPACTO (CÁPSULA) --- */}
      {hasActiveTrip && navInfo && (
          <div className="absolute top-24 left-0 right-0 z-40 flex justify-center pointer-events-none animate-in slide-in-from-top-4">
              <div className="pointer-events-auto bg-white/95 dark:bg-slate-900/90 backdrop-blur-md border border-slate-200 dark:border-slate-700 rounded-full py-2 px-5 shadow-2xl flex items-center gap-4 max-w-[90%]">
                   
                   {/* Icono de Estado */}
                   <div className={`p-2 rounded-full ${isInProgress ? 'bg-green-100 dark:bg-green-500/20' : 'bg-yellow-100 dark:bg-yellow-400/20'}`}>
                       <Navigation className={`w-5 h-5 ${isInProgress ? 'text-green-600 dark:text-green-500' : 'text-yellow-600 dark:text-yellow-400'}`} />
                   </div>

                   {/* Info Texto */}
                   <div className="flex flex-col min-w-0">
                       <p className={`text-[9px] font-black uppercase tracking-widest leading-none mb-1 ${isInProgress ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
                           {isInProgress ? 'Hacia Destino' : 'Recogiendo'}
                       </p>
                       <div className="flex items-baseline gap-2">
                           <span className="text-slate-900 dark:text-white font-bold text-lg leading-none">{navInfo.distance}</span>
                           <span className="text-slate-500 dark:text-slate-500 text-xs font-bold">{navInfo.duration}</span>
                       </div>
                   </div>
              </div>
          </div>
      )}

      {/* Mapa Principal - Z-0 Background con filtro oscuro */}
      <div className={`absolute inset-0 z-0 transition-[filter] duration-500 ${isDarkMode ? 'brightness-[0.7] contrast-[1.2] invert hue-rotate-180 saturate-[0.8]' : ''}`}>
          <MapVisualization 
            userLocation={driver.position} 
            drivers={[driver]} 
            isSearching={isOnline && !hasActiveTrip}
            isAdminView={true}
            routeCoords={routePolyline}
            trackUser={hasActiveTrip}
          />
      </div>

      {/* Botonera Inferior Flotante (Overlay Absolute) */}
      <div className="absolute bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200 rounded-t-[2.5rem] p-6 pb-10 md:pb-6 shadow-[0_-20px_40px_rgba(0,0,0,0.1)] transition-colors duration-300 max-h-[75dvh] flex flex-col">
        
        {/* --- PANEL DE ESPERA Y MERCADO DE VIAJES (SI NO HAY VIAJE ACTIVO/PENDIENTE) --- */}
        {!hasPendingRequest && !hasActiveTrip && (
            <div className="flex flex-col h-full">
                 
                 {/* SWITCH ONLINE/OFFLINE + TÍTULO */}
                 <div className="flex justify-between items-center mb-4">
                    <div>
                        <h3 className="text-slate-900 dark:text-white font-black text-lg tracking-tight leading-none">
                            {isOnline ? 'VIAJES DISPONIBLES' : 'ESTÁS DESCONECTADO'}
                        </h3>
                        <p className="text-slate-500 dark:text-slate-500 text-[10px] font-bold uppercase tracking-widest mt-1">
                            {isOnline ? 'Toca para ofertar' : 'Conéctate para ver viajes'}
                        </p>
                    </div>
                    <button 
                        onClick={toggleStatus} 
                        className={`w-12 h-12 rounded-full border-2 flex items-center justify-center transition-all active:scale-95 ${isOnline ? 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700' : 'bg-red-500 border-red-400 shadow-lg shadow-red-500/30'}`}
                     >
                        <Power className={`w-5 h-5 ${isOnline ? 'text-green-500' : 'text-white'}`} />
                     </button>
                 </div>

                 {isOnline && (
                     <>
                        {/* PESTAÑAS (TABS) */}
                        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl mb-4">
                            <button 
                                onClick={() => setPanelTab('RIDE')}
                                className={`flex-1 py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all ${panelTab === 'RIDE' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
                            >
                                <Bike className="w-4 h-4" /> Viajes
                                {nearbyRides.filter(r => r.serviceType !== 'DELIVERY').length > 0 && <span className="bg-red-500 text-white text-[8px] px-1.5 rounded-full">{nearbyRides.filter(r => r.serviceType !== 'DELIVERY').length}</span>}
                            </button>
                            <button 
                                onClick={() => setPanelTab('DELIVERY')}
                                className={`flex-1 py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all ${panelTab === 'DELIVERY' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
                            >
                                <Box className="w-4 h-4" /> Envíos
                                {nearbyRides.filter(r => r.serviceType === 'DELIVERY').length > 0 && <span className="bg-red-500 text-white text-[8px] px-1.5 rounded-full">{nearbyRides.filter(r => r.serviceType === 'DELIVERY').length}</span>}
                            </button>
                        </div>

                        {/* LISTA DE VIAJES (MARKET LIST) */}
                        <div className="flex-1 overflow-y-auto -mx-2 px-2 no-scrollbar space-y-3 min-h-[200px] max-h-[400px]">
                            {filteredRides.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-10 text-slate-400 dark:text-slate-600 opacity-60">
                                    <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded-full mb-3">
                                        <Loader className="w-8 h-8 animate-spin" /> 
                                    </div>
                                    <p className="text-xs font-bold">Esperando nuevas solicitudes...</p>
                                </div>
                            ) : (
                                filteredRides.map(ride => (
                                    <div 
                                        key={ride.id} 
                                        onClick={() => onSelectRide && onSelectRide(ride)}
                                        className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 hover:border-yellow-400 dark:hover:border-yellow-500 transition-colors cursor-pointer group active:scale-[0.98]"
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="flex items-center gap-2">
                                                <div className={`p-1.5 rounded-lg ${ride.serviceType === 'DELIVERY' ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400' : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                                                    {ride.serviceType === 'DELIVERY' ? <Package className="w-4 h-4"/> : <User className="w-4 h-4"/>}
                                                </div>
                                                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">{ride.distance}</span>
                                                {ride.paymentMethod === 'WALLET' && (
                                                    <span className="bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase border border-green-200 dark:border-green-800">
                                                        Pago con Saldo
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-xl font-black text-slate-900 dark:text-white">S/ {ride.fare.toFixed(2)}</span>
                                        </div>
                                        
                                        <div className="space-y-2 mb-3">
                                            <div className="flex items-center gap-2">
                                                <div className="w-2 h-2 rounded-full bg-slate-900 dark:bg-white shrink-0"></div>
                                                <p className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate">{ride.pickup}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="w-2 h-2 rounded-sm bg-yellow-400 shrink-0"></div>
                                                <p className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate">{ride.destination}</p>
                                            </div>
                                        </div>

                                        <div className="flex gap-2 opacity-80 group-hover:opacity-100 transition-opacity">
                                            <button className="flex-1 py-2 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-[10px] font-black uppercase rounded-lg shadow-sm border border-slate-100 dark:border-slate-600">Ver Detalle</button>
                                            <button className="flex-1 py-2 bg-yellow-400 text-black text-[10px] font-black uppercase rounded-lg shadow-sm">Tomar Viaje</button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                     </>
                 )}
                 
                 <div className="mt-4 flex gap-3 w-full border-t border-slate-100 dark:border-slate-800 pt-4">
                     <button onClick={() => setShowWallet(true)} className="flex-1 bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center gap-2 text-slate-700 dark:text-white font-bold text-[10px] uppercase hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-transform">
                         <Wallet className="w-4 h-4 text-yellow-500 dark:text-yellow-400" /> Mi Billetera
                     </button>
                     <button onClick={handleSupportClick} className="flex-1 bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center gap-2 text-slate-700 dark:text-white font-bold text-[10px] uppercase hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-transform">
                         <Phone className="w-4 h-4 text-green-500 dark:text-green-400" /> Soporte
                     </button>
                 </div>
            </div>
        )}

        {/* ... (rest of the component) ... */}
        {hasPendingRequest && (
            <div className="animate-in slide-in-from-bottom-5">
                {/* ... Timeline and buttons ... */}
                <div className="flex items-center justify-between mb-4">
                    <div className="bg-yellow-400 text-black px-3 py-1 rounded-full text-xs font-black flex items-center gap-2 uppercase tracking-wide">
                        <Bell className="w-4 h-4 animate-bounce" /> {activeRequest?.serviceType === 'DELIVERY' ? 'Solicitud Delivery' : 'Nuevo Pedido'}
                    </div>
                    <div className="text-right">
                        <p className="text-[10px] text-slate-400 font-bold uppercase">Ganancia Neta</p>
                        <span className="text-slate-900 dark:text-white font-black text-2xl font-mono">S/ {(activeRequest?.fare || 0).toFixed(2)}</span>
                    </div>
                </div>

                {activeRequest?.paymentMethod === 'WALLET' && (
                    <div className="bg-green-100 dark:bg-green-900/30 border border-green-200 dark:border-green-800 p-3 rounded-xl flex items-center gap-3 mb-4">
                        <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                        <div>
                            <p className="text-green-700 dark:text-green-400 font-bold text-xs uppercase">¡Viaje Prepagado!</p>
                            <p className="text-green-600 dark:text-green-500 text-[10px]">El cliente pagó con Saldo Vento. Recibirás tu ganancia en tu Billetera al finalizar.</p>
                        </div>
                    </div>
                )}
                
                {/* Timeline UI Restaurado */}
                <div className="bg-slate-50 dark:bg-slate-800/60 p-5 rounded-3xl border border-slate-200 dark:border-slate-700/50 mb-6 relative overflow-hidden transition-colors">
                    
                    <div className="space-y-6 relative z-10">
                        {/* Pickup */}
                        <div className="flex gap-4 items-start">
                             <div className="w-8 h-8 rounded-full bg-white dark:bg-slate-900 border-2 border-slate-900 dark:border-white shadow-sm flex items-center justify-center shrink-0 z-10">
                                 <div className="w-2 h-2 bg-slate-900 dark:bg-white rounded-full"></div>
                             </div>
                             <div className="flex-1">
                                 <p className="text-slate-500 dark:text-slate-500 text-[9px] uppercase font-black tracking-widest mb-0.5">Recoger en</p>
                                 <p className="text-slate-900 dark:text-white text-sm font-bold leading-tight">{activeRequest?.pickup}</p>
                             </div>
                        </div>

                        {/* Destination */}
                        <div className="flex gap-4 items-start">
                             <div className="w-8 h-8 rounded-full bg-white dark:bg-slate-900 border-2 border-yellow-400 shadow-sm flex items-center justify-center shrink-0 z-10">
                                 <div className="w-2 h-2 bg-yellow-400 rounded-sm"></div>
                             </div>
                             <div className="flex-1">
                                 <p className="text-slate-500 dark:text-slate-500 text-[9px] uppercase font-black tracking-widest mb-0.5">Llevar a</p>
                                 <p className="text-slate-900 dark:text-white text-sm font-bold leading-tight">{activeRequest?.destination}</p>
                             </div>
                        </div>
                    </div>

                    {/* DELIVERY NOTE SPECIFIC */}
                    {activeRequest?.serviceType === 'DELIVERY' && activeRequest.deliveryNote && (
                        <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700/50">
                            <p className="text-[10px] text-yellow-600 dark:text-yellow-500 font-bold uppercase mb-1 flex items-center gap-1">
                                <Package className="w-3 h-3"/> Nota del Envío
                            </p>
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 italic bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded-lg">
                                "{activeRequest.deliveryNote}"
                            </p>
                        </div>
                    )}
                    
                    <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700/50 flex justify-between items-center">
                         <div className="flex items-center gap-2">
                             <DollarSign className="w-4 h-4 text-slate-400" />
                             <span className="text-xs text-slate-500 dark:text-slate-400 font-bold">Comisión: <span className="text-red-500 dark:text-red-400">-S/ {(activeRequest?.commission || 0).toFixed(2)}</span></span>
                         </div>
                         <div className="flex items-center gap-2">
                             <User className="w-4 h-4 text-slate-400" />
                             <span className="text-xs text-slate-500 dark:text-slate-300 font-bold truncate max-w-[100px]">{activeRequest?.passengerName}</span>
                         </div>
                    </div>
                </div>

                {isNegotiating ? (
                    <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl mb-4 border border-slate-200 dark:border-slate-700 animate-in fade-in">
                        <label className="text-xs font-bold text-slate-500 mb-2 block">Tu Contraoferta (S/)</label>
                        <div className="flex gap-2">
                            <input 
                                type="number" 
                                value={counterOfferAmount}
                                onChange={(e) => setCounterOfferAmount(e.target.value)}
                                className="flex-1 bg-slate-100 dark:bg-slate-900 rounded-lg p-3 outline-none font-bold text-slate-900 dark:text-white"
                                placeholder={(activeRequest?.fare || 0).toString()}
                            />
                            <button onClick={submitCounterOffer} className="bg-yellow-400 text-black px-4 rounded-lg font-bold text-xs">Enviar</button>
                            <button onClick={() => setIsNegotiating(false)} className="bg-slate-200 text-slate-600 px-3 rounded-lg font-bold text-xs"><X className="w-4 h-4"/></button>
                        </div>
                    </div>
                ) : (
                    <div className="flex gap-3">
                        <button onClick={onRejectRequest} className="flex-1 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 py-4 rounded-2xl font-bold text-xs uppercase tracking-wider hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">Volver</button>
                        <button onClick={() => setIsNegotiating(true)} className="flex-1 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 py-4 rounded-2xl font-bold text-xs uppercase tracking-wider hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors">Contraofertar</button>
                        <button onClick={onAcceptRequest} className="flex-[2] bg-yellow-400 text-black py-4 rounded-2xl font-black text-sm uppercase tracking-wider shadow-xl shadow-yellow-400/20 active:scale-95 transition-transform">ACEPTAR</button>
                    </div>
                )}
            </div>
        )}

        {hasActiveTrip && (
             <div className="space-y-3 animate-in fade-in">
                <div className="flex items-center justify-between bg-slate-100 dark:bg-slate-800/50 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 mb-2 transition-colors">
                    <div className="flex items-center gap-3">
                         <div className="bg-white dark:bg-slate-700 p-2 rounded-full text-slate-400 dark:text-slate-300 shadow-sm">
                             <User className="w-5 h-5" />
                         </div>
                         <div>
                             <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-black tracking-wide">{activeRequest?.serviceType === 'DELIVERY' ? 'Cliente (Envío)' : 'Pasajero'}</p>
                             <p className="text-slate-900 dark:text-white font-bold text-sm">{activeRequest?.passengerName}</p>
                             {activeRequest?.paymentMethod === 'WALLET' && <p className="text-[9px] text-green-500 font-bold uppercase mt-0.5">Prepagado</p>}
                         </div>
                    </div>
                    
                    <div className="flex gap-2">
                        {/* BOTÓN DE LLAMAR (SIEMPRE VISIBLE Y ROBUSTO) */}
                        <button 
                            onClick={handleCallPassenger}
                            disabled={isCalling}
                            className="bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50 text-green-600 dark:text-green-400 p-3 rounded-xl transition-colors active:scale-95 shadow-sm border border-green-200 dark:border-transparent flex items-center justify-center min-w-[48px]"
                        >
                            {isCalling ? <Loader className="w-6 h-6 animate-spin"/> : <Phone className="w-6 h-6" />}
                        </button>

                        <button onClick={() => { setShowChat(true); setHasUnread(false); }} className="relative bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 text-slate-900 dark:text-white p-3 rounded-xl transition-colors active:scale-95 shadow-sm border border-slate-200 dark:border-transparent">
                            <MessageCircle className="w-6 h-6" />
                            {hasUnread && <span className="absolute top-2 right-2 w-3 h-3 bg-red-500 border-2 border-white dark:border-slate-700 rounded-full animate-pulse"></span>}
                        </button>
                    </div>
                </div>

                {isAccepted && (
                    <button onClick={onStartTrip} className="w-full bg-yellow-400 text-black py-4 rounded-2xl font-black text-base shadow-2xl active:scale-95 transition-transform">INICIAR VIAJE</button>
                )}

                {isInProgress && (
                    <button onClick={onCompleteRide} className="w-full bg-slate-900 dark:bg-white text-white dark:text-black py-4 rounded-2xl font-black text-base shadow-2xl active:scale-95 transition-transform">TERMINAR VIAJE</button>
                )}
            </div>
        )}
      </div>

      {showChat && activeRequest && (
        <ChatWindow 
          rideId={activeRequest.id}
          currentUser={{ id: driver.id, name: driver.name, role: 'DRIVER' }}
          otherUserName={activeRequest.passengerName}
          onClose={() => { setShowChat(false); setHasUnread(false); }}
        />
      )}

      {/* --- BILLETERA DUAL --- */}
      {showWallet && (
          <div className="fixed inset-0 z-[70] bg-black/60 dark:bg-slate-950/90 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in">
              <div className="bg-white dark:bg-[#0f172a] w-full max-w-md rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-h-[90vh] overflow-y-auto relative transition-colors">
                  
                  <div className="p-6">
                      <div className="flex justify-between items-center mb-6">
                          <div>
                              <h3 className="text-xl font-black text-slate-900 dark:text-white">Mi Billetera</h3>
                              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Gestiona tus ingresos y créditos</p>
                          </div>
                          <button onClick={() => setShowWallet(false)} className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"><X className="w-5 h-5"/></button>
                      </div>

                      {/* Tarjeta de CRÉDITOS (COMISIONES) */}
                      <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl p-4 mb-4 border border-slate-200 dark:border-slate-700 relative">
                           <div className="flex justify-between items-start">
                               <div>
                                   <p className="text-[10px] font-bold uppercase text-slate-500 tracking-wider mb-1">Créditos Operativos</p>
                                   <p className="text-3xl font-black text-slate-900 dark:text-white">{(driver.credits || 0).toFixed(2)}</p>
                                   <p className="text-[10px] text-slate-400 mt-1">Usado para pagar comisiones</p>
                               </div>
                               <div className="bg-white dark:bg-slate-700 p-2 rounded-lg">
                                   <Bike className="w-6 h-6 text-slate-400"/>
                               </div>
                           </div>
                           <button onClick={() => setWalletTab('RECHARGE')} className="mt-3 w-full bg-white dark:bg-slate-700 text-slate-900 dark:text-white py-2 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-600">Recargar Créditos</button>
                      </div>

                      {/* Tarjeta de GANANCIAS (RETIRABLE) */}
                      <div className="bg-gradient-to-br from-yellow-400 via-yellow-500 to-yellow-600 rounded-2xl p-4 mb-6 shadow-lg shadow-yellow-500/20 text-slate-900">
                           <div className="flex justify-between items-start">
                               <div>
                                   <p className="text-[10px] font-bold uppercase opacity-70 tracking-wider mb-1">Saldo Vento Retirable</p>
                                   <p className="text-3xl font-black">S/ {(driver.walletBalance || 0).toFixed(2)}</p>
                                   {pendingWithdrawalsAmount > 0 && (
                                       <p className="text-[10px] font-bold bg-black/10 px-2 py-0.5 rounded-lg inline-block mt-1 border border-black/5">
                                           - S/ {pendingWithdrawalsAmount.toFixed(2)} Pendiente
                                       </p>
                                   )}
                                   <p className="text-[10px] opacity-80 mt-1">Ganancias de viajes prepagados</p>
                               </div>
                               <div className="bg-white/20 p-2 rounded-lg">
                                   <Wallet className="w-6 h-6 text-slate-900"/>
                               </div>
                           </div>
                           <div className="flex gap-2 mt-3">
                               <button onClick={handleTransferToCredits} className="flex-1 bg-white/20 hover:bg-white/30 text-slate-900 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1"><ArrowLeftRight className="w-3 h-3"/> Mover a Créditos</button>
                               <button onClick={() => setWalletTab('WITHDRAW')} className="flex-1 bg-white text-slate-900 py-2 rounded-lg text-xs font-bold">Retirar</button>
                           </div>
                      </div>

                      {/* TABS DE ACCIÓN */}
                      {walletTab === 'RECHARGE' ? (
                            <div className="space-y-4 animate-in slide-in-from-right-10">
                                <h4 className="text-slate-900 dark:text-white font-bold text-xs uppercase tracking-widest mb-2">Comprar Créditos</h4>
                                
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Monto a Recargar (S/)</label>
                                    <div className="relative">
                                        <input 
                                            type="number" 
                                            value={rechargeAmount}
                                            onChange={e => setRechargeAmount(e.target.value)}
                                            className="w-full bg-slate-50 dark:bg-slate-800 rounded-xl p-3 pl-8 font-bold border border-slate-200 dark:border-slate-700 outline-none focus:border-yellow-400 dark:text-white"
                                            placeholder="Ingresa el monto"
                                        />
                                        <span className="absolute left-3 top-3 text-slate-400 font-bold">S/</span>
                                    </div>
                                    
                                    {/* DYNAMIC PROMO TEXT - STRICTLY CHECK BOOLEAN (NO FALLBACK) */}
                                    {(adminSettings?.enableDriverBonus === true) && (
                                        <p className="text-[10px] text-green-500 font-bold mt-1 ml-1 flex items-center gap-1">
                                            <Zap className="w-3 h-3 fill-current"/> 
                                            Recarga S/{adminSettings?.driverBonusThreshold ?? 50} o más y recibe {((adminSettings.driverBonusPercent || 0.10) * 100).toFixed(0)}% extra
                                        </p>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-3 mb-4">
                                     <button onClick={() => setRechargeAmount('10')} className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-yellow-400 dark:hover:border-yellow-500 transition-colors text-left">
                                         <p className="text-slate-900 dark:text-white font-bold text-sm">Paquete Básico</p>
                                         <p className="text-slate-500 dark:text-slate-400 text-xs">S/ 10.00</p>
                                     </button>
                                     <button onClick={() => setRechargeAmount('50')} className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-yellow-500/30 hover:border-yellow-500 transition-colors text-left relative overflow-hidden">
                                         {/* FIXED: HARDCODED BONUS TAG NOW CONDITIONAL */}
                                         {(adminSettings?.enableDriverBonus === true) && (
                                             <div className="absolute top-0 right-0 bg-yellow-400 text-black text-[8px] font-black px-1.5 py-0.5 rounded-bl">BONUS</div>
                                         )}
                                         <p className="text-yellow-600 dark:text-yellow-400 font-bold text-sm">Paquete Pro</p>
                                         <p className="text-slate-500 dark:text-slate-400 text-xs">S/ 50.00</p>
                                     </button>
                                </div>

                                <div className="flex justify-center gap-4 mb-4">
                                    {/* YAPE QR (CLICKABLE) */}
                                    <div 
                                        onClick={() => adminSettings?.yapeQrUrl && setViewingImage(adminSettings.yapeQrUrl)}
                                        className="bg-slate-100 dark:bg-white p-2 rounded-xl w-24 h-24 flex items-center justify-center overflow-hidden border border-slate-200 cursor-pointer hover:border-yellow-400 transition-colors"
                                    >
                                        {adminSettings?.yapeQrUrl ? <img src={adminSettings.yapeQrUrl} className="w-full h-full object-contain" /> : <p className="text-black text-xs text-center font-bold">QR Yape</p>}
                                    </div>
                                    {/* PLIN QR (CLICKABLE) */}
                                    <div 
                                        onClick={() => adminSettings?.plinQrUrl && setViewingImage(adminSettings.plinQrUrl)}
                                        className="bg-slate-100 dark:bg-white p-2 rounded-xl w-24 h-24 flex items-center justify-center overflow-hidden border border-slate-200 cursor-pointer hover:border-yellow-400 transition-colors"
                                    >
                                        {adminSettings?.plinQrUrl ? <img src={adminSettings.plinQrUrl} className="w-full h-full object-contain" /> : <p className="text-black text-xs text-center font-bold">QR Plin</p>}
                                    </div>
                                </div>

                                    <div className="mb-6">
                                        <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-2">Adjunta tu comprobante de pago</p>
                                        <input 
                                            type="file" 
                                            ref={fileInputProofRef} 
                                        className="hidden" 
                                        accept="image/*" 
                                        onChange={handleProofUpload} 
                                    />
                                    <div 
                                        onClick={() => !uploading && fileInputProofRef.current?.click()} 
                                        className={`border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer transition-all ${proofImage ? 'border-green-500 bg-green-500/10' : 'border-slate-300 dark:border-slate-700 hover:border-yellow-500'}`}
                                    >
                                        {uploading ? (
                                             <div className="flex flex-col items-center">
                                                 <Loader className="w-5 h-5 animate-spin text-yellow-500 mb-1"/>
                                                 <p className="text-xs text-yellow-500">Procesando...</p>
                                             </div>
                                        ) : proofImage ? (
                                            <div className="w-full flex flex-col items-center group">
                                                {/* Imagen Clickable para Ver */}
                                                <div className="relative mb-2 w-full max-w-[150px]">
                                                    <img 
                                                        src={proofImage} 
                                                        onClick={(e) => { e.stopPropagation(); setViewingImage(proofImage); }}
                                                        alt="Comprobante" 
                                                        className="h-24 w-full object-contain rounded border border-slate-200 bg-white dark:bg-black cursor-zoom-in hover:opacity-90 transition-opacity"
                                                    />
                                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <div className="bg-black/50 p-1 rounded-full"><ZoomIn className="w-4 h-4 text-white"/></div>
                                                    </div>
                                                </div>
                                                <p className="text-green-500 dark:text-green-400 text-xs font-bold">Comprobante Cargado</p>
                                                <p className="text-[10px] text-slate-400 hover:text-slate-600 underline mt-1">Clic aquí para cambiar</p>
                                            </div>
                                        ) : (
                                            <p className="text-slate-500 text-xs text-center flex items-center gap-2">
                                                <Upload className="w-4 h-4"/> Subir captura
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <button onClick={handleRechargeSubmit} disabled={!rechargeAmount || !proofImage || uploading} className="w-full bg-yellow-400 text-slate-900 font-bold py-4 rounded-xl disabled:opacity-50 hover:bg-yellow-300 shadow-xl">
                                    {uploading ? 'ENVIANDO...' : 'ENVIAR SOLICITUD'}
                                </button>
                            </div>
                      ) : (
                        // TAB WITHDRAW
                        <div className="animate-in slide-in-from-right-10 space-y-4">
                            <h4 className="text-slate-900 dark:text-white font-bold text-xs uppercase tracking-widest mb-2">Retirar Ganancias</h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Mínimo de retiro: S/ 30.00</p>
                            
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase">Monto a Retirar</label>
                                <input 
                                    type="number" 
                                    value={withdrawAmount}
                                    onChange={e => setWithdrawAmount(e.target.value)}
                                    className="w-full bg-slate-50 dark:bg-slate-800 rounded-xl p-3 font-bold border border-slate-200 dark:border-slate-700 outline-none focus:border-yellow-400 dark:text-white"
                                    placeholder="0.00"
                                />
                            </div>

                            <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Sube tu QR de Yape/Plin</label>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-3 leading-tight">Adjunta tu código QR personal de Yape o Plin para que podamos depositarte tus ganancias.</p>
                                <input 
                                    type="file" 
                                    ref={fileInputProofRef} 
                                    className="hidden" 
                                    accept="image/*" 
                                    onChange={handleProofUpload} 
                                />
                                <div 
                                    onClick={() => !uploading && fileInputProofRef.current?.click()} 
                                    className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all ${proofImage ? 'border-green-500 bg-green-500/10' : 'border-slate-300 dark:border-slate-700 hover:border-yellow-500'}`}
                                >
                                    {uploading ? (
                                        <div className="flex flex-col items-center">
                                            <Loader className="w-5 h-5 animate-spin text-yellow-500 mb-1"/>
                                            <p className="text-xs text-yellow-500">Procesando...</p>
                                        </div>
                                    ) : proofImage ? (
                                        <div className="w-full flex flex-col items-center group">
                                            {/* Imagen Clickable para Ver */}
                                            <div className="relative mb-2 w-full max-w-[150px]">
                                                <img 
                                                    src={proofImage} 
                                                    onClick={(e) => { e.stopPropagation(); setViewingImage(proofImage); }}
                                                    alt="QR" 
                                                    className="h-24 w-full object-contain rounded border border-slate-200 bg-white dark:bg-black cursor-zoom-in hover:opacity-90 transition-opacity"
                                                />
                                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <div className="bg-black/50 p-1 rounded-full"><ZoomIn className="w-4 h-4 text-white"/></div>
                                                </div>
                                            </div>
                                            <p className="text-green-500 dark:text-green-400 text-xs font-bold">QR Cargado</p>
                                            <p className="text-[10px] text-slate-400 hover:text-slate-600 underline mt-1">Clic aquí para cambiar</p>
                                        </div>
                                    ) : (
                                        <p className="text-slate-500 text-xs text-center flex items-center gap-2">
                                            <Upload className="w-4 h-4"/> Subir QR
                                        </p>
                                    )}
                                </div>
                            </div>
                            
                            <button onClick={handleWithdrawSubmit} disabled={!withdrawAmount || !proofImage || uploading} className="w-full bg-slate-900 dark:bg-white text-white dark:text-black font-bold py-4 rounded-xl disabled:opacity-50">
                                {uploading ? 'Procesando...' : 'SOLICITAR RETIRO'}
                            </button>
                        </div>
                      )}
                  </div>
              </div>
          </div>
      )}

      {/* VISOR DE IMÁGENES (LIGHTBOX) */}
      {viewingImage && (
          <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in" onClick={() => setViewingImage(null)}>
              <div className="relative bg-slate-900 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col border border-slate-800" onClick={e => e.stopPropagation()}>
                  <div className="flex justify-between items-center p-4 border-b border-slate-800">
                      <h3 className="text-white font-bold flex items-center gap-2">
                          <FileText className="w-5 h-5 text-yellow-400"/> Vista Previa
                      </h3>
                      <button onClick={() => setViewingImage(null)} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-full text-white transition-colors">
                          <X className="w-6 h-6" />
                      </button>
                  </div>
                  <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-black/50 rounded-b-2xl">
                      <img 
                        src={viewingImage} 
                        className="max-w-full max-h-[75vh] object-contain rounded-lg shadow-lg border border-slate-800" 
                        alt="Comprobante ampliado" 
                      />
                  </div>
                  <div className="p-3 bg-slate-900 border-t border-slate-800 text-center text-xs text-slate-400 rounded-b-2xl">
                      Toca fuera de la imagen o el botón X para cerrar
                  </div>
              </div>
          </div>
      )}

    </div>
    </div>
  );
};

export default DriverDashboard;
