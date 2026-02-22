
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapPin, Search, Menu, Star, Crosshair, Loader, Bike, X, ChevronDown, ChevronUp, Map as MapIcon, Camera, Moon, Sun, ArrowUpDown, Circle, Navigation, Package, DollarSign, Wallet, Upload, AlertCircle, ZoomIn, FileText } from 'lucide-react';
import { AppState, Driver, RideOption, RouteDetails, Coordinates, User, RideRequest, BikeCategory, SearchResult, ServiceType, AdminSettings, PaymentMethod } from '../types';
import { RIDE_OPTIONS, INITIAL_CENTER } from '../constants';
import MapVisualization from './MapVisualization';
import RideSelection from './RideSelection';
import DriverFound from './DriverFound';
import ChatWindow from './ChatWindow';
import { searchAddress, calculateRealRoute, getDistanceKm } from '../services/mapService';
import { updateDoc, doc } from 'firebase/firestore';
import { db } from '../services/firebase';

interface ClientDashboardProps {
  user: User;
  drivers: Driver[];
  setDrivers: React.Dispatch<React.SetStateAction<Driver[]>>;
  onLogout: () => void;
  activeRide: RideRequest | null;
  onRequestRide: (request: RideRequest) => void;
  onCancelRide: () => void;
  onRequestRecharge?: (amount: number, balance: number, proof: string) => Promise<void>; // Updated to Promise
  adminSettings?: AdminSettings;
}

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

const ClientDashboard: React.FC<ClientDashboardProps> = ({ 
  user, drivers, setDrivers, onLogout, activeRide, onRequestRide, onCancelRide, onRequestRecharge, adminSettings
}) => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [isGpsLoading, setIsGpsLoading] = useState(true);
  const [logoError, setLogoError] = useState(false);
  
  // CHAT STATE
  const [showChat, setShowChat] = useState(false);

  // DARK MODE STATE
  const [isDarkMode, setIsDarkMode] = useState(false);

  const toggleTheme = () => {
    // Disabled as per user request for white theme
    setIsDarkMode(false);
  };
  
  // WALLET STATE
  const [showWallet, setShowWallet] = useState(false);
  const [proofImage, setProofImage] = useState<string | null>(null);
  const [rechargeAmount, setRechargeAmount] = useState('');
  const [uploading, setUploading] = useState(false);
  // VISOR DE IMAGENES
  const [viewingImage, setViewingImage] = useState<string | null>(null);

  // TRIP PLANNER STATE
  const [isPlannerOpen, setIsPlannerOpen] = useState(false);
  const [activeSearchField, setActiveSearchField] = useState<'PICKUP' | 'DESTINATION' | null>(null);
  
  const [pickupAddress, setPickupAddress] = useState('');
  const [pickupCoords, setPickupCoords] = useState<Coordinates | null>(null);

  const [destination, setDestination] = useState('');
  const [destinationCoords, setDestinationCoords] = useState<Coordinates | null>(null);
  
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const searchTimeoutRef = useRef<number | null>(null);

  const [selectedRide, setSelectedRide] = useState<RideOption | null>(RIDE_OPTIONS[0]); 
  const [activeDriver, setActiveDriver] = useState<Driver | null>(null); 
  const [viewingDriver, setViewingDriver] = useState<Driver | null>(null); 
  const [routeDetails, setRouteDetails] = useState<RouteDetails | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [recenterTrigger, setRecenterTrigger] = useState(0); 
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);

  const [isUpdatingPhoto, setIsUpdatingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputProofRef = useRef<HTMLInputElement>(null); // Ref para comprobante de pago

  // CONDUCTORES CERCANOS: Ahora dependen del punto de partida seleccionado (pickupCoords) si existe
  const nearbyDrivers = useMemo(() => {
    if (!drivers || drivers.length === 0) return [];
    
    // Si estamos planeando viaje y tenemos un punto de partida, buscamos cerca de ahí.
    // Si no, usamos la ubicación GPS del usuario.
    const refLocation = pickupCoords || userLocation || INITIAL_CENTER;

    return drivers
      .filter(d => 
          d.status === 'AVAILABLE' && 
          d.position && 
          typeof d.position.lat === 'number' && 
          typeof d.position.lng === 'number'
      )
      .map(d => ({
        ...d,
        distanceToUser: getDistanceKm(refLocation, d.position)
      }))
      .filter(d => d.distanceToUser <= 30) // Radio de 30km
      .sort((a, b) => a.distanceToUser - b.distanceToUser);
  }, [drivers, userLocation, pickupCoords]);

  useEffect(() => {
    if (!activeRide) {
      if (appState !== AppState.IDLE) handleRideCompletion();
      return;
    }
    
    if (activeRide.status === 'ACCEPTED') {
      setAppState(AppState.DRIVER_FOUND);
      const driver = drivers.find(d => d.id === activeRide.driverId);
      if (driver) setActiveDriver(driver);
    } else if (activeRide.status === 'IN_PROGRESS') {
        setAppState(AppState.ON_TRIP);
        const driver = drivers.find(d => d.id === activeRide.driverId);
        if (driver) setActiveDriver(driver);
        if (appState !== AppState.ON_TRIP) setIsPanelCollapsed(true);
    } else if (activeRide.status === 'PENDING') {
      setAppState(AppState.SEARCHING_DRIVER);
      setIsPanelCollapsed(false);
    } else if (['REJECTED', 'CANCELLED', 'COMPLETED'].includes(activeRide.status)) {
        handleRideCompletion();
    }
  }, [activeRide, drivers]);

  // EFFECT: Auto-collapse panel when Menu is opened
  useEffect(() => {
      if (showMenu) {
          setIsPanelCollapsed(true);
      }
  }, [showMenu]);

  useEffect(() => {
    if (!navigator.geolocation) { setIsGpsLoading(false); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(coords);
        // Si no se ha movido el pin de partida manualmente, lo actualizamos al GPS
        if (!pickupCoords && !isPlannerOpen) {
            setPickupCoords(coords);
        }
        setIsGpsLoading(false);
      },
      () => setIsGpsLoading(false),
      { timeout: 5000 }
    );
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(coords);
      },
      (err) => console.warn(err), { enableHighAccuracy: true }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // --- LÓGICA DE BÚSQUEDA ---
  const handleAddressSearch = (text: string, field: 'PICKUP' | 'DESTINATION') => {
    if (field === 'PICKUP') setPickupAddress(text);
    else setDestination(text);

    setActiveSearchField(field);

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (text.length < 3) { setSuggestions([]); return; }
    
    setIsSearchingAddress(true);
    searchTimeoutRef.current = window.setTimeout(async () => {
      const results = await searchAddress(text);
      setSuggestions(results);
      setIsSearchingAddress(false);
    }, 500); 
  };

  const selectSuggestion = async (result: SearchResult) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);

    if (isNaN(lat) || isNaN(lng)) {
        console.error("Invalid coordinates selected:", result);
        alert("Error: La ubicación seleccionada no tiene coordenadas válidas.");
        return;
    }

    const coords = { lat, lng };
    
    // Usamos el main_text (ej: "Av. Larco 123") si existe, sino display_name
    const cleanName = result.main_text || result.display_name.split(',')[0];

    if (activeSearchField === 'PICKUP') {
        setPickupAddress(cleanName);
        setPickupCoords(coords);
    } else {
        setDestination(cleanName);
        setDestinationCoords(coords);
    }
    
    setSuggestions([]);
    setActiveSearchField(null);

    // Si ambos están seteados, calculamos ruta
    const originToUse = activeSearchField === 'PICKUP' ? coords : (pickupCoords || userLocation || INITIAL_CENTER);
    const destToUse = activeSearchField === 'DESTINATION' ? coords : destinationCoords;

    if (destToUse) {
        setIsCalculating(true);
        // Si el usuario no ha definido origen manual, usamos su GPS para el cálculo
        const startPoint = originToUse;
        const insights = await calculateRealRoute(startPoint, destToUse);
        setRouteDetails(insights);
        setIsCalculating(false);
        setAppState(AppState.SELECTING_RIDE);
        setIsPanelCollapsed(false);
    }
  };

  const swapLocations = () => {
     const tempAddr = pickupAddress;
     const tempCoords = pickupCoords;
     
     setPickupAddress(destination);
     setPickupCoords(destinationCoords);
     
     setDestination(tempAddr || "Ubicación GPS anterior"); // Fallback text
     setDestinationCoords(tempCoords || userLocation);
     
     if (destinationCoords && (tempCoords || userLocation)) {
         recalculateRoute(destinationCoords, tempCoords || userLocation!);
     }
  };

  const recalculateRoute = async (start: Coordinates, end: Coordinates) => {
      setIsCalculating(true);
      const insights = await calculateRealRoute(start, end);
      setRouteDetails(insights);
      setIsCalculating(false);
  };

  const initiateRideRequest = (specificDriverId?: string, customFare?: number, serviceType: ServiceType = 'RIDE', deliveryNote?: string, paymentMethod: PaymentMethod = 'CASH') => {
    try {
      const pickupLoc = pickupCoords || userLocation || INITIAL_CENTER;
      const pickupText = pickupAddress || "Ubicación Actual";

      if(!destinationCoords || !routeDetails) {
          alert("Selecciona un destino válido");
          return;
      }

      let targetDriverId = specificDriverId;
      if (!targetDriverId) {
          targetDriverId = nearbyDrivers.length > 0 ? nearbyDrivers[0].id : '';
      }
      
      // Permitir solicitud sin conductor (Modo Broadcast)
      if (!targetDriverId) targetDriverId = ""; 

      // Use custom fare if provided, otherwise calculate
      let finalFare = 5.00;
      if (customFare) {
          finalFare = customFare;
      } else {
          // DYNAMIC RATE CALCULATION
          const RATE = adminSettings?.baseRatePerKm || 1.50;
          const rawDistance = routeDetails.distanceValue || 0;
          const calculatedFare = rawDistance * RATE;
          finalFare = isNaN(calculatedFare) ? 5.00 : Math.max(5.00, parseFloat(calculatedFare.toFixed(2)));
      }
      
      const commissionCost = parseFloat((finalFare * 0.10).toFixed(2));

      const newRequest: RideRequest = {
          id: `ride-${Date.now()}-${user.id}`,
          passengerId: user.id,
          passengerName: user.name || 'Pasajero',
          passengerPhone: user.phone || '', // FALLBACK SEGURO A STRING VACÍO
          driverId: targetDriverId, // Puede ser "" (broadcast)
          pickup: pickupText, 
          pickupCoordinates: pickupLoc, 
          destination: destination || 'Destino seleccionado',
          destinationCoordinates: destinationCoords, 
          fare: finalFare,
          distance: routeDetails.distance || '0 km',
          status: 'PENDING',
          category: BikeCategory.STANDARD,
          commission: commissionCost,
          serviceType: serviceType,
          paymentMethod: paymentMethod,
          ...(deliveryNote ? { deliveryNote } : {})
      };

      setViewingDriver(null);
      setIsPlannerOpen(false); // Cerramos el planificador al pedir
      onRequestRide(newRequest);
    } catch (error) {
      console.error("Error al iniciar viaje:", error);
    }
  };
  
  const handleAcceptCounterOffer = async () => {
      if (activeRide && activeRide.driverOffer) {
          const newFare = activeRide.driverOffer;
          const newCommission = parseFloat((newFare * 0.10).toFixed(2));
          
          await updateDoc(doc(db, "rides", activeRide.id), {
              fare: newFare,
              commission: newCommission,
              status: 'ACCEPTED',
              driverOffer: null
          });
      }
  };

  const handleRideCompletion = () => {
    setAppState(AppState.IDLE);
    setDestination('');
    setDestinationCoords(null);
    setPickupAddress('');
    setPickupCoords(null); // Reset a GPS
    setRouteDetails(null);
    setActiveDriver(null);
    setViewingDriver(null);
    setIsPanelCollapsed(false);
    setIsPlannerOpen(false);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsUpdatingPhoto(true);
      try {
          const base64 = await compressImage(file);
          await updateDoc(doc(db, 'clients', user.id), { photoUrl: base64 });
          user.photoUrl = base64; 
          alert("Foto actualizada.");
      } catch (error) {
          console.error("Error updating photo:", error);
          alert("Error al subir imagen.");
      } finally {
          setIsUpdatingPhoto(false);
      }
  };
  
  // MANEJADOR DE CARGA DE COMPROBANTE
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

  const handleRechargeSubmit = async () => {
      if(!proofImage || !rechargeAmount || !onRequestRecharge) return;
      const amt = parseFloat(rechargeAmount);
      if(isNaN(amt) || amt <= 0) {
          alert("Ingresa un monto válido");
          return;
      }
      
      setUploading(true);
      
      try {
          // IMPORTANT: AWAIT THE REQUEST TO ENSURE IT'S SAVED BEFORE CLOSING UI
          await onRequestRecharge(amt, amt, proofImage); 
          
          setProofImage(null);
          setRechargeAmount('');
          setShowWallet(false);
          alert("Recarga solicitada. Tu saldo se actualizará pronto.");
      } catch (error) {
          console.error("Error submitting recharge:", error);
          alert("Error al enviar la solicitud. Por favor intenta de nuevo.");
      } finally {
          setUploading(false);
      }
  }

  // --- NUEVA FUNCIÓN: Ir a selección desde el preview ---
  const handleGoToSelection = () => {
      setIsPlannerOpen(false);
      setAppState(AppState.SELECTING_RIDE);
      // NO limpiamos viewingDriver aquí, lo usamos para pasarlo al RideSelection y que aparezca marcado
      // El modal de viewingDriver se ocultará porque cambiamos la condición de renderizado
  };

  const SafeAvatar = ({ url, alt, className }: { url?: string, alt: string, className?: string }) => {
    const [src, setSrc] = useState(url || '');
    useEffect(() => { setSrc(url || ''); }, [url]);
    const fallback = `https://ui-avatars.com/api/?name=${alt.replace(/ /g, '+')}&background=random`;
    return (
        <img 
            src={src && src.length > 10 ? src : fallback}
            onError={() => setSrc(fallback)}
            alt={alt}
            className={className}
        />
    );
  };

  return (
    <div className={`${isDarkMode ? 'dark' : ''} relative w-full h-screen overflow-hidden`}>
    <div className="relative w-full h-screen bg-slate-50 overflow-hidden transition-colors duration-300">
      
      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 z-50 p-4 flex justify-between items-center pointer-events-none">
        
        <div className="flex gap-2 pointer-events-auto">
            <button onClick={() => setShowMenu(!showMenu)} className="p-3 rounded-full shadow-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-100 dark:border-slate-700 active:scale-95 transition-transform">
                <Menu className="w-6 h-6" />
            </button>
            
            {/* Wallet Button */}
            <button onClick={() => setShowWallet(true)} className="p-3 rounded-full shadow-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-100 dark:border-slate-700 active:scale-95 transition-transform relative group">
                <Wallet className="w-6 h-6" />
                <div className="absolute top-1 right-1 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white dark:border-slate-800"></div>
                <div className="absolute left-full ml-2 bg-black dark:bg-white text-white dark:text-black text-[10px] font-bold px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    S/ {(user.walletBalance || 0).toFixed(2)}
                </div>
            </button>
        </div>

        {showMenu && (
             <div className="absolute top-20 left-4 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-700 rounded-2xl shadow-2xl p-4 w-64 z-[60] pointer-events-auto animate-in fade-in zoom-in-95">
                <div className="flex items-center gap-3 mb-4 p-2 border-b dark:border-slate-800 pb-4 relative">
                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handlePhotoUpload} />
                    <div onClick={() => !isUpdatingPhoto && fileInputRef.current?.click()} className="relative cursor-pointer group">
                        <SafeAvatar url={user.photoUrl} alt={user.name} className="w-12 h-12 rounded-full object-cover border border-slate-200 dark:border-slate-600" />
                        <div className="absolute -bottom-1 -right-1 bg-yellow-400 p-1 rounded-full border border-white dark:border-slate-800">
                            <Camera className="w-2 h-2 text-black" />
                        </div>
                    </div>
                    <div className="flex-1 overflow-hidden">
                        <p className="font-bold text-sm truncate text-slate-800 dark:text-white">{user.name}</p>
                        <p className="text-[10px] text-slate-400">Editar Perfil</p>
                    </div>
                </div>
                
                <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-3 mb-3">
                    <p className="text-[10px] uppercase font-bold text-slate-500">Saldo Disponible</p>
                    <p className="text-xl font-black text-slate-900 dark:text-white">S/ {(user.walletBalance || 0).toFixed(2)}</p>
                    <button onClick={() => { setShowWallet(true); setShowMenu(false); }} className="text-xs text-blue-500 font-bold mt-1">Recargar Saldo</button>
                </div>

                <div className="space-y-1">
                    <button onClick={() => { setIsPlannerOpen(true); setShowMenu(false); }} className="w-full text-left p-3 bg-yellow-400 text-black rounded-lg text-sm font-bold shadow-lg shadow-yellow-400/20 mb-2 flex items-center gap-2">
                        <Navigation className="w-4 h-4" /> Planificar Viaje / Envío
                    </button>
                    <button className="w-full text-left p-3 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-sm font-medium">Mis Viajes</button>
                    <button onClick={toggleTheme} className="w-full text-left p-3 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-sm font-medium flex items-center gap-2">
                         {isDarkMode ? <Sun className="w-4 h-4"/> : <Moon className="w-4 h-4"/>} Cambiar Tema
                    </button>
                    <button onClick={onLogout} className="w-full text-left p-3 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-sm font-bold transition-colors">Cerrar Sesión</button>
                </div>
             </div>
        )}
        
        <div className="bg-white/95 dark:bg-slate-900/90 backdrop-blur rounded-full px-4 py-1.5 border dark:border-slate-700 shadow-xl flex items-center gap-2 pointer-events-auto">
             {!logoError ? (
                 <img 
                    src="/images/logosecundario.png" 
                    alt="VentoDrive" 
                    className="h-7 w-auto object-contain" 
                    onError={() => setLogoError(true)}
                 />
             ) : (
                 <div className="flex items-center gap-1">
                     <Bike className="w-4 h-4 text-slate-900 dark:text-white" />
                     <span className="font-black text-xs text-slate-900 dark:text-white tracking-tighter">VENTO<span className="text-yellow-400">DRIVE</span></span>
                 </div>
             )}
        </div>
      </div>

      {/* WALLET MODAL */}
      {showWallet && (
          <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in">
              <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl p-6 shadow-2xl animate-in slide-in-from-bottom-10 max-h-[90vh] overflow-y-auto">
                  <div className="flex justify-between items-center mb-6">
                      <h3 className="text-xl font-black text-slate-900 dark:text-white">Mi Billetera</h3>
                      <button onClick={() => setShowWallet(false)} className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full"><X className="w-5 h-5 text-slate-500"/></button>
                  </div>

                  <div className="bg-gradient-to-r from-slate-900 to-slate-800 dark:from-slate-800 dark:to-slate-700 rounded-2xl p-6 text-white mb-6 relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-4 opacity-10"><Wallet className="w-24 h-24"/></div>
                      <p className="text-xs font-bold opacity-70 uppercase tracking-widest mb-1">Saldo Vento</p>
                      <p className="text-4xl font-black tracking-tight">S/ {(user.walletBalance || 0).toFixed(2)}</p>
                      
                      {/* DYNAMIC CASHBACK BADGE - STRICTLY CHECKED (NO FALLBACK) */}
                      {(adminSettings?.enableClientCashback === true) && (
                          <div className="mt-4 flex items-center gap-2 text-green-400 text-xs font-bold bg-green-400/10 py-1 px-2 rounded w-fit">
                              <Star className="w-3 h-3 fill-current" /> Ganas {((adminSettings.clientCashbackPercent || 0.05) * 100).toFixed(0)}% Cashback por viaje
                          </div>
                      )}
                  </div>

                  <div className="space-y-4">
                      <h4 className="font-bold text-slate-900 dark:text-white">Recargar Saldo Express</h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Sube tu comprobante de Yape/Plin para que validemos tu recarga.</p>

                      <div className="flex justify-center gap-4 mb-2">
                            {/* YAPE QR (CLICKABLE) */}
                            <div 
                                onClick={() => adminSettings?.yapeQrUrl && setViewingImage(adminSettings.yapeQrUrl)}
                                className="bg-slate-100 dark:bg-slate-800 p-2 rounded-xl w-24 h-24 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-700 cursor-pointer hover:border-yellow-400 transition-colors"
                            >
                                {adminSettings?.yapeQrUrl ? <img src={adminSettings.yapeQrUrl} className="w-full h-full object-contain" /> : <span className="text-[10px] text-center">QR Yape</span>}
                            </div>
                            {/* PLIN QR (CLICKABLE) */}
                            <div 
                                onClick={() => adminSettings?.plinQrUrl && setViewingImage(adminSettings.plinQrUrl)}
                                className="bg-slate-100 dark:bg-slate-800 p-2 rounded-xl w-24 h-24 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-700 cursor-pointer hover:border-yellow-400 transition-colors"
                            >
                                {adminSettings?.plinQrUrl ? <img src={adminSettings.plinQrUrl} className="w-full h-full object-contain" /> : <span className="text-[10px] text-center">QR Plin</span>}
                            </div>
                      </div>

                      <div>
                          <label className="text-xs font-bold text-slate-500 mb-1 block">Monto a Recargar (S/)</label>
                          <input 
                            type="number" 
                            value={rechargeAmount}
                            onChange={e => setRechargeAmount(e.target.value)}
                            className="w-full bg-slate-50 dark:bg-slate-800 rounded-xl p-3 font-bold outline-none border border-slate-200 dark:border-slate-700 focus:border-yellow-400 dark:text-white"
                            placeholder="Ej: 20.00"
                          />
                      </div>
                      
                      {/* INPUT DE ARCHIVO OCULTO */}
                      <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-2">Adjunta tu comprobante de pago</p>
                      <input 
                          type="file" 
                          ref={fileInputProofRef} 
                          className="hidden" 
                          accept="image/*" 
                          onChange={handleProofUpload} 
                      />
                      
                      {/* ZONA DE CLICK PARA SUBIR */}
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
                                  {/* Contenedor de Imagen Clickable para Ver */}
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
                                  <p className="text-green-500 text-xs font-bold">Comprobante Listo</p>
                                  <p className="text-[10px] text-slate-400 hover:text-slate-600 underline mt-1">Clic aquí para cambiar</p>
                              </div>
                          ) : (
                              <p className="text-slate-500 text-xs flex items-center gap-2">
                                  <Upload className="w-4 h-4"/> Subir Captura
                              </p>
                          )}
                      </div>

                      <button onClick={handleRechargeSubmit} disabled={uploading || !proofImage} className="w-full bg-yellow-400 text-black font-bold py-3 rounded-xl disabled:opacity-50">
                          {uploading ? 'Enviando...' : 'Enviar Solicitud'}
                      </button>
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

      {/* TRIP PLANNER MODAL (Floating Card) */}
      {/* ... (rest of the file remains unchanged) */}
      {isPlannerOpen && appState === AppState.IDLE && (
          <div className="absolute top-24 left-4 right-4 z-[55] pointer-events-auto animate-in slide-in-from-top-5">
              <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl p-4 border border-slate-100 dark:border-slate-700 relative">
                   <button onClick={() => setIsPlannerOpen(false)} className="absolute top-2 right-2 p-1 text-slate-300 hover:text-slate-500 dark:hover:text-slate-200">
                       <X className="w-5 h-5" />
                   </button>

                   <div className="flex gap-3 items-center mb-0 relative">
                       {/* Linea conectora */}
                       <div className="flex flex-col items-center gap-1 mt-2">
                           <div className="w-3 h-3 border-2 border-slate-800 dark:border-white rounded-full"></div>
                           <div className="w-0.5 h-8 bg-slate-200 dark:bg-slate-700 my-1"></div>
                           <div className="w-3 h-3 bg-yellow-400 rounded-sm"></div>
                       </div>
                       
                       <div className="flex-1 flex flex-col gap-3">
                           {/* ORIGIN INPUT */}
                           <div className="relative group">
                               <input 
                                  type="text" 
                                  value={pickupAddress}
                                  onChange={(e) => handleAddressSearch(e.target.value, 'PICKUP')}
                                  onFocus={() => setActiveSearchField('PICKUP')}
                                  placeholder="Tu ubicación actual"
                                  className="w-full bg-slate-50 dark:bg-slate-950 p-3 rounded-xl text-sm font-bold text-slate-900 dark:text-white outline-none border border-transparent focus:border-yellow-400 focus:bg-white dark:focus:bg-slate-900 transition-all placeholder:text-slate-400"
                               />
                               {pickupCoords && <span className="absolute right-3 top-3.5 text-[9px] text-green-500 font-bold uppercase bg-green-100 dark:bg-green-900/30 px-1.5 rounded">Fijado</span>}
                           </div>
                           
                           {/* DESTINATION INPUT */}
                           <div className="relative group">
                               <input 
                                  type="text" 
                                  value={destination}
                                  onChange={(e) => handleAddressSearch(e.target.value, 'DESTINATION')}
                                  onFocus={() => setActiveSearchField('DESTINATION')}
                                  placeholder="¿A dónde quieres ir?"
                                  className="w-full bg-slate-50 dark:bg-slate-950 p-3 rounded-xl text-sm font-bold text-slate-900 dark:text-white outline-none border border-transparent focus:border-yellow-400 focus:bg-white dark:focus:bg-slate-900 transition-all"
                               />
                           </div>
                       </div>
                       
                       {/* SWAP BUTTON */}
                       <button onClick={swapLocations} className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                           <ArrowUpDown className="w-5 h-5 text-slate-600 dark:text-slate-300" />
                       </button>
                   </div>
                   
                   {/* SUGGESTIONS LIST (Floating over map) */}
                   {suggestions.length > 0 && activeSearchField && (
                        <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-700 overflow-hidden z-[60] max-h-48 overflow-y-auto">
                            {suggestions.map(s => (
                                <div key={s.place_id} onClick={() => selectSuggestion(s)} className="p-3 border-b border-slate-50 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer flex items-center gap-3">
                                    <div className="bg-slate-100 dark:bg-slate-900 p-2 rounded-full shrink-0"><MapIcon className="w-4 h-4 text-slate-500"/></div>
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">{s.main_text || s.display_name.split(',')[0]}</p>
                                        <p className="text-[10px] text-slate-400 truncate">{s.secondary_text || s.display_name.split(',').slice(1).join(',')}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                   )}
              </div>
          </div>
      )}


      {/* Mapa Fullscreen */}
      <div className={`absolute inset-0 z-0 transition-[filter] duration-500 ${isDarkMode ? 'brightness-[0.7] contrast-[1.2] invert hue-rotate-180 saturate-[0.8]' : ''}`}>
        <MapVisualization 
          userLocation={isPlannerOpen && pickupCoords ? pickupCoords : (userLocation || INITIAL_CENTER)} 
          drivers={appState === AppState.IDLE || appState === AppState.SELECTING_RIDE ? nearbyDrivers : (activeDriver ? [activeDriver] : [])} 
          isSearching={appState === AppState.SEARCHING_DRIVER}
          recenterTrigger={recenterTrigger}
          routeCoords={(appState === AppState.DRIVER_FOUND || appState === AppState.ON_TRIP || appState === AppState.SELECTING_RIDE) && routeDetails?.geometry ? routeDetails.geometry : undefined}
        />
      </div>
      
      {/* Botones Flotantes Laterales */}
      <div className="absolute bottom-36 right-4 flex flex-col gap-3 pointer-events-auto">
          {!isPlannerOpen && appState === AppState.IDLE && (
              <button 
                onClick={() => setIsPlannerOpen(true)} 
                className="p-3 rounded-full shadow-xl bg-yellow-400 text-black z-40 border border-yellow-500 transform active:scale-90 transition-transform"
              >
                <Navigation className="w-6 h-6" />
              </button>
          )}

          <button 
                onClick={() => setRecenterTrigger(prev => prev+1)} 
                className="p-3 rounded-full shadow-xl bg-white dark:bg-slate-800 text-slate-700 dark:text-white z-40 border border-slate-100 dark:border-slate-700 transform active:scale-90 transition-transform"
          >
                <Crosshair className="w-6 h-6" />
          </button>
      </div>

      {/* Driver Modal (Preview) */}
      {/* IMPORTANTE: Ahora solo se muestra si NO estamos seleccionando viaje */}
      {viewingDriver && !activeRide && appState === AppState.IDLE && (
        <div className="absolute inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-end p-4 animate-in fade-in duration-300">
           <div className="w-full bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl animate-in slide-in-from-bottom-5">
              <div className="flex justify-between items-start mb-6">
                  <div className="flex items-center gap-4">
                      <SafeAvatar url={viewingDriver.photoUrl} alt={viewingDriver.name || 'Conductor'} className="w-16 h-16 rounded-full object-cover border-2 border-yellow-400" />
                      <div>
                          <h2 className="text-xl font-black text-slate-900 dark:text-white">{viewingDriver.name}</h2>
                          <div className="flex items-center gap-2 mt-1">
                             <span className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md text-[10px] font-bold text-slate-600 dark:text-slate-300">{viewingDriver.bikeModel}</span>
                             <div className="flex items-center gap-0.5 ml-1"><Star className="w-3 h-3 fill-yellow-400 text-yellow-400" /><span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">{viewingDriver.rating?.toFixed(1) || '5.0'}</span></div>
                          </div>
                      </div>
                  </div>
                  <button onClick={() => setViewingDriver(null)} className="p-2 -mr-2 -mt-2 text-slate-300 hover:text-slate-500 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"><X className="w-6 h-6" /></button>
              </div>
              
              {!isPlannerOpen && (
                  <div className="relative mb-4 group">
                      <MapPin className="absolute left-4 top-4 w-5 h-5 text-slate-400 group-focus-within:text-yellow-500 transition-colors" />
                      <input type="text" value={destination} onChange={(e) => handleAddressSearch(e.target.value, 'DESTINATION')} placeholder="¿A dónde vas?" className="w-full bg-slate-50 dark:bg-slate-950 dark:text-white py-4 pl-12 pr-6 rounded-2xl outline-none border border-slate-200 dark:border-slate-700 focus:border-yellow-400 transition-colors font-bold text-slate-800" autoFocus />
                  </div>
              )}
              
              {suggestions.length > 0 && !isPlannerOpen && (
                <div className="max-h-40 overflow-y-auto mb-4 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl shadow-xl">
                    {suggestions.map(s => (
                        <div key={s.place_id} onClick={() => selectSuggestion(s)} className="p-4 border-b dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer flex items-center gap-3">
                            <div className="bg-slate-100 dark:bg-slate-900 p-2 rounded-full shrink-0"><MapIcon className="w-4 h-4 text-slate-300"/></div>
                            <div className="min-w-0">
                                <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">{s.main_text || s.display_name.split(',')[0]}</p>
                                <p className="text-[10px] text-slate-400 truncate">{s.secondary_text || s.display_name}</p>
                            </div>
                        </div>
                    ))}
                </div>
              )}
              
              <button 
                onClick={handleGoToSelection} 
                disabled={!destinationCoords || isCalculating} 
                className="w-full bg-slate-900 dark:bg-white dark:text-black text-white py-4 rounded-2xl font-black text-lg disabled:opacity-30 shadow-xl active:scale-95 transition-transform flex justify-center items-center gap-2"
              >
                {isCalculating ? <Loader className="w-5 h-5 animate-spin"/> : 'PEDIR AHORA'}
              </button>
           </div>
        </div>
      )}

      {/* Panel Inferior Flotante (Overlay absoluto) */}
      <div 
        className={`
            absolute bottom-0 left-0 right-0 z-50
            bg-white rounded-t-[2.5rem] 
            shadow-[0_-10px_40px_rgba(0,0,0,0.1)]
            transition-all duration-500 cubic-bezier(0.32, 0.72, 0, 1)
            flex flex-col
            ${viewingDriver && appState === AppState.IDLE ? 'translate-y-full opacity-0' : 'translate-y-0 opacity-100'}
            ${isPanelCollapsed ? 'max-h-28 overflow-hidden' : 'max-h-[85vh] overflow-y-auto'}
        `}
      >
          {/* Handle de arrastre */}
          <div 
            onClick={() => setIsPanelCollapsed(!isPanelCollapsed)}
            className="w-full pt-3 pb-2 flex flex-col items-center justify-center cursor-pointer active:bg-slate-50 dark:active:bg-slate-800 transition-colors rounded-t-[2.5rem] touch-none"
          >
              <div className="w-10 h-1 bg-slate-300 dark:bg-slate-600 rounded-full mb-1" />
          </div>

          {/* CONTENIDO MINIMIZADO */}
          {isPanelCollapsed && (
              <div className="px-6 flex items-center justify-between animate-in fade-in duration-300 h-full pb-6">
                  <div className="flex flex-col justify-center">
                       <p className="font-bold text-slate-900 dark:text-white text-sm">
                            {appState === AppState.ON_TRIP ? 'En Curso' : 'Detalles del Viaje'}
                       </p>
                       <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`w-2 h-2 rounded-full ${appState === AppState.ON_TRIP ? 'bg-green-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-600'}`}></span>
                            <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                                {appState === AppState.ON_TRIP ? 'Conductor en camino' : 'Desliza para ver más'}
                            </p>
                       </div>
                  </div>
                  <div className="text-right">
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Tarifa</p>
                      <p className="text-xl font-black text-slate-900 dark:text-white">
                          S/ {(activeRide?.fare || 0).toFixed(2)}
                      </p>
                  </div>
              </div>
          )}

          {/* CONTENIDO EXPANDIDO */}
          <div className={`px-6 pb-4 transition-opacity duration-200 ${isPanelCollapsed ? 'opacity-0 hidden' : 'opacity-100 block'}`}>
            
            {appState === AppState.IDLE && (
                    <div className="animate-in fade-in slide-in-from-bottom-4">
                        {!isPlannerOpen && (
                            <>
                            <h1 className="text-2xl font-black mb-1 text-slate-900 dark:text-white">¿A dónde vas?</h1>
                            <p className="text-xs text-slate-400 font-bold mb-3 flex items-center gap-1">
                                {isGpsLoading ? <Loader className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />}
                                {isGpsLoading ? 'Localizando...' : 'Elige destino o conductor'}
                            </p>
                            
                            <div className="relative mb-4 group">
                                <Search className="absolute left-4 top-3.5 w-5 h-5 text-slate-400" />
                                <input 
                                    type="text" 
                                    value={destination} 
                                    onChange={(e) => handleAddressSearch(e.target.value, 'DESTINATION')} 
                                    onFocus={() => setActiveSearchField('DESTINATION')}
                                    placeholder="Busca un lugar..." 
                                    className="w-full pl-12 pr-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-950 dark:text-white border border-slate-200 dark:border-slate-700 outline-none font-bold text-slate-800 focus:bg-white dark:focus:bg-slate-900 focus:border-yellow-400 transition-all" 
                                />
                                {suggestions.length > 0 && activeSearchField === 'DESTINATION' && !isPlannerOpen && (
                                <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-2xl rounded-2xl z-50 max-h-56 overflow-y-auto">
                                    {suggestions.map(s => (
                                        <div key={s.place_id} onClick={() => selectSuggestion(s)} className="p-4 border-b dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer flex items-center gap-4 text-slate-700 dark:text-slate-200">
                                            <div className="bg-slate-100 dark:bg-slate-900 p-2 rounded-full shrink-0 text-slate-400"><MapIcon className="w-4 h-4"/></div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">{s.main_text || s.display_name.split(',')[0]}</p>
                                                <p className="text-[10px] text-slate-400 truncate">{s.secondary_text || s.display_name.split(',').slice(1).join(',')}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                )}
                            </div>
                            </>
                        )}

                        <div className="flex justify-between items-center mb-2">
                            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                {isPlannerOpen ? 'Motorizados por la zona' : 'Motorizados cercanos'}
                            </h3>
                            <span className="text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full">{nearbyDrivers.length} Disp.</span>
                        </div>

                        <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2 min-h-[110px]">
                            {nearbyDrivers.map(d => (
                                <button key={d.id} onClick={() => setViewingDriver(d)} className="flex-shrink-0 w-28 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl p-3 shadow-sm hover:border-yellow-400 dark:hover:border-yellow-400 transition-all text-center relative active:scale-95">
                                    <div className="relative mx-auto w-12 h-12 mb-2">
                                        <SafeAvatar url={d.photoUrl} alt={d.name} className="w-full h-full rounded-full object-cover border-2 border-slate-50 dark:border-slate-600" />
                                        <div className="absolute -bottom-1 -right-1 bg-green-500 w-3 h-3 rounded-full border-2 border-white dark:border-slate-800"></div>
                                    </div>
                                    <p className="text-[10px] font-black uppercase truncate text-slate-800 dark:text-slate-200">{d.name}</p>
                                    <div className="flex items-center justify-center gap-1 mt-1">
                                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${d.distanceToUser && d.distanceToUser < 5 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                                            {d.distanceToUser ? (d.distanceToUser < 1 ? `${(d.distanceToUser*1000).toFixed(0)}m` : `${d.distanceToUser.toFixed(1)}km`) : '--'}
                                        </span>
                                    </div>
                                </button>
                            ))}
                            {nearbyDrivers.length === 0 && !isGpsLoading && (
                                <div className="w-full py-6 text-center bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                                    <p className="text-slate-400 text-xs font-bold">No hay unidades cerca del punto de partida.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {appState === AppState.SELECTING_RIDE && (
                    <RideSelection 
                        options={RIDE_OPTIONS} 
                        selectedId={selectedRide?.id || null} 
                        onSelect={setSelectedRide} 
                        routeDetails={routeDetails} 
                        onConfirm={(id, fare, type, note, pm) => initiateRideRequest(id, fare, type, note, pm)} 
                        onCancel={() => setAppState(AppState.IDLE)} 
                        nearbyDrivers={nearbyDrivers} 
                        userBalance={user.walletBalance || 0}
                        initialDriverId={viewingDriver?.id} 
                        adminSettings={adminSettings}
                    />
                )}

                {appState === AppState.SEARCHING_DRIVER && (
                    <div className="text-center py-6 animate-pulse">
                        <div className="w-20 h-20 bg-yellow-400 rounded-full flex items-center justify-center mx-auto mb-4 shadow-xl">
                            <Loader className="w-10 h-10 animate-spin text-slate-900" />
                        </div>
                        <h3 className="text-xl font-black text-slate-900 dark:text-white">Buscando...</h3>
                        <p className="text-xs text-slate-400 font-bold mt-2 mb-6">Ofreciendo S/ {activeRide?.fare.toFixed(2)}</p>

                        {/* NEGOTIATION / COUNTER OFFER VIEW */}
                        {activeRide?.driverOffer && (
                            <div className="bg-white dark:bg-slate-800 border-2 border-yellow-500 p-4 rounded-2xl mb-6 shadow-xl animate-in zoom-in-95">
                                <p className="text-xs font-black uppercase text-yellow-600 dark:text-yellow-400 mb-2 animate-bounce">¡Contraoferta del Conductor!</p>
                                <div className="flex items-center justify-between mb-4">
                                    <span className="text-slate-500 dark:text-slate-400 text-xs font-bold">Nueva Tarifa Propuesta:</span>
                                    <span className="text-2xl font-black text-slate-900 dark:text-white">S/ {activeRide.driverOffer.toFixed(2)}</span>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={onCancelRide} className="flex-1 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg text-slate-500 dark:text-slate-300 font-bold text-xs">Rechazar</button>
                                    <button onClick={handleAcceptCounterOffer} className="flex-1 py-2 bg-yellow-400 text-black rounded-lg font-bold text-xs shadow-lg">Aceptar Oferta</button>
                                </div>
                            </div>
                        )}

                        <button onClick={onCancelRide} className="bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300 py-3 px-8 rounded-xl font-black text-xs uppercase hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 transition-colors">Cancelar Solicitud</button>
                    </div>
                )}

                {(appState === AppState.DRIVER_FOUND || appState === AppState.ON_TRIP) && activeDriver && (
                    <DriverFound 
                        driver={activeDriver} 
                        activeRide={activeRide} 
                        currentUser={user}
                        statusText={appState === AppState.ON_TRIP ? (activeRide?.serviceType === 'DELIVERY' ? "ENVÍO EN CURSO" : "VIAJE EN CURSO") : (activeRide?.serviceType === 'DELIVERY' ? "MOTORIZADO ASIGNADO" : "CONDUCTOR ASIGNADO")} 
                        onCancel={onCancelRide} 
                        onOpenChat={() => setShowChat(true)}
                    />
                )}
                
                {activeRide?.status === 'COMPLETED' && activeRide.paymentMethod === 'WALLET' && (
                    <div className="text-center py-6 animate-in zoom-in">
                        <div className="inline-block p-4 rounded-full bg-green-100 dark:bg-green-900/30 mb-4">
                            <Star className="w-8 h-8 text-green-500 fill-current animate-bounce" />
                        </div>
                        <h3 className="text-xl font-black text-slate-900 dark:text-white mb-1">¡Viaje Pagado con Éxito!</h3>
                        
                        {/* DYNAMIC CASHBACK MESSAGE - STRICT CHECK (NO FALLBACK) */}
                        {(adminSettings?.enableClientCashback === true) && (
                            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                                Has ganado <span className="text-green-500 font-bold">S/ {(activeRide.fare * (adminSettings?.clientCashbackPercent ?? 0.05)).toFixed(2)}</span> de Cashback
                            </p>
                        )}
                        <button onClick={handleRideCompletion} className="mt-6 w-full bg-yellow-400 text-black font-bold py-3 rounded-xl">Entendido</button>
                    </div>
                )}
          </div>
      </div>

      {/* CHAT WINDOW (OUTSIDE SLIDING PANEL) */}
      {showChat && activeRide && activeDriver && (
        <ChatWindow 
            rideId={activeRide.id}
            currentUser={user}
            otherUserName={activeDriver.name}
            onClose={() => setShowChat(false)}
        />
      )}
    </div>
    </div>
  );
};

export default ClientDashboard;