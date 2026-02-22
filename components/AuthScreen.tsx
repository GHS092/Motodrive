
import React, { useState, useRef } from 'react';
import { User, Driver, Client } from '../types';
import { 
  Bike, ShieldCheck, User as UserIcon, Lock, Navigation, 
  Camera, FileText, CheckCircle, ArrowRight, ArrowLeft, Image as ImageIcon, Loader2, Upload, AlertTriangle
} from 'lucide-react';

// Firebase Imports
import { auth, db } from '../services/firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';

interface AuthScreenProps {
  onLogin: (user: User) => void;
  drivers?: Driver[];
  clients?: Client[];
  onRegisterClient?: (client: Client) => void;
  onRegisterDriver?: (driver: Driver) => void;
}

type DriverRegisterStep = 1 | 2 | 3;

// --- UTILIDAD DE COMPRESIÓN ---
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
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    if (!ctx) { resolve(event.target?.result as string); return; }

                    const MAX_WIDTH = 500;
                    const scaleFactor = MAX_WIDTH / img.width;
                    const finalWidth = scaleFactor < 1 ? MAX_WIDTH : img.width;
                    const finalHeight = scaleFactor < 1 ? img.height * scaleFactor : img.height;

                    canvas.width = finalWidth;
                    canvas.height = finalHeight;
                    ctx.drawImage(img, 0, 0, finalWidth, finalHeight);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                    resolve(dataUrl);
                } catch (err) {
                    resolve(event.target?.result as string);
                }
            };
            img.onerror = (err) => reject(new Error("Imagen inválida."));
        };
        reader.onerror = (err) => reject(new Error("Error al leer archivo."));
    });
};

const AuthScreen: React.FC<AuthScreenProps> = ({ 
  onLogin, 
  onRegisterClient,
  onRegisterDriver
}) => {
  // Eliminado 'ADMIN' de los modos visibles, se accede por puerta trasera
  const [mode, setMode] = useState<'LOGIN' | 'REGISTER' | 'DRIVER' | 'DRIVER_REGISTER'>('LOGIN');
  const [registerStep, setRegisterStep] = useState<DriverRegisterStep>(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isPhotoProcessing, setIsPhotoProcessing] = useState(false);
  
  const [logoError, setLogoError] = useState(false);
  
  const fileInputPlateRef = useRef<HTMLInputElement>(null);
  const fileInputLicenseRef = useRef<HTMLInputElement>(null);
  const fileInputProfileRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    name: '',
    phone: '', 
    email: '', 
    clientPassword: '',
    // Eliminados campos explícitos de admin del estado inicial visual
    driverPlate: '',
    driverPass: '',
    driverModel: '',
    driverCategory: 'STANDARD'
  });

  const [photos, setPhotos] = useState<{
    plate?: string;
    license?: string;
    profile?: string;
  }>({});
  
  const [error, setError] = useState('');

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, field: 'plate' | 'license' | 'profile') => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsPhotoProcessing(true);
      setError('');

      try {
          const base64 = await compressImage(file);
          setPhotos(prev => ({ ...prev, [field]: base64 }));
      } catch (err: any) {
          setError(`Error imagen: ${err.message}`);
      } finally {
          setIsPhotoProcessing(false);
          if (e.target) e.target.value = '';
      }
  };

  const getFriendlyErrorMessage = (err: any) => {
    const code = err.code || '';
    console.error("Auth Error:", code, err.message); // Log para depuración

    switch (code) {
        case 'auth/invalid-credential':
        case 'auth/user-not-found':
        case 'auth/wrong-password':
            return 'Credenciales incorrectas. Verifica tu correo y contraseña.';
        case 'auth/email-already-in-use':
            return 'Este correo ya está registrado. Intenta iniciar sesión.';
        case 'auth/weak-password':
            return 'La contraseña es muy débil. Usa al menos 6 caracteres.';
        case 'auth/invalid-email':
            return 'El formato del correo electrónico no es válido.';
        case 'auth/network-request-failed':
            return !navigator.onLine ? 'No tienes conexión a internet.' : 'Error de conexión con el servidor. Verifica tu red o intenta más tarde.';
        case 'auth/too-many-requests':
            return 'Demasiados intentos. Por favor espera unos minutos.';
        case 'auth/internal-error':
            return 'Ocurrió un error interno. Intenta nuevamente más tarde.';
        case 'auth/popup-closed-by-user':
            return 'Se cerró la ventana de autenticación antes de terminar.';
        default:
            // Fallback para mensajes que contienen palabras clave comunes
            if (err.message && (err.message.includes('network') || err.message.includes('connection'))) {
                return 'Error de conexión. Verifica tu internet.';
            }
            return 'Ocurrió un error inesperado. Intenta nuevamente.';
    }
  };

  const handleGenericLogin = async (e: React.FormEvent, isDriverLogin: boolean) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    const emailToUse = formData.email.trim(); 
    const passToUse = isDriverLogin ? formData.driverPass : formData.clientPassword;

    // --- PUERTA TRASERA ADMIN (SECRET BACKDOOR) ---
    // Si el usuario ingresa las credenciales personalizadas en el login de pasajero
    if (!isDriverLogin && emailToUse === 'ghs092' && passToUse === '997796929') {
        const ADMIN_EMAIL = "super_admin@motofast.com";
        const ADMIN_PASS = "123456admin";
        
        try {
            // Intentamos loguear con la cuenta real de admin de Firebase
            await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASS);
            // Si el login es exitoso, App.tsx detectará el cambio de auth y mostrará el dashboard admin
            // No necesitamos llamar a onLogin manualmente aquí si App.tsx maneja onAuthStateChanged
            return;
        } catch (err: any) {
            // Si falla (ej: primera vez), intentamos crear la cuenta admin oculta
            if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
                 try {
                     await createUserWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASS);
                     return;
                 } catch (createErr) {
                     console.error(createErr);
                     setError("Error crítico de sistema admin.");
                     setIsLoading(false);
                     return;
                 }
            }
            console.error(err);
            setError("Credenciales de sistema inválidas.");
            setIsLoading(false);
            return;
        }
    }

    if (!validateEmail(emailToUse)) {
        setError('El formato del correo electrónico no es válido.');
        setIsLoading(false);
        return;
    }

    // --- FLUJO NORMAL DE LOGIN ---
    try {
      const userCredential = await signInWithEmailAndPassword(auth, emailToUse, passToUse);
      const uid = userCredential.user.uid;

      if (isDriverLogin) {
          // Si estamos en la pestaña CONDUCTOR, solo buscamos en 'drivers'
          const driverDocRef = doc(db, "drivers", uid);
          const driverSnap = await getDoc(driverDocRef);

          if (driverSnap.exists()) {
              const driverData = driverSnap.data() as Driver;
              onLogin({
                id: `user-driver-${driverData.id}`,
                name: driverData.name,
                role: 'DRIVER',
                driverId: driverData.id,
                phone: driverData.phone,
                photoUrl: driverData.photoUrl,
                walletBalance: driverData.walletBalance,
                verificationStatus: driverData.verificationStatus || 'VERIFIED'
              });
              return;
          } else {
              await signOut(auth);
              setError("Esta cuenta no es de Conductor. Intenta como Pasajero.");
              return;
          }
      } else {
          // Si estamos en la pestaña PASAJERO, solo buscamos en 'clients'
          const clientDocRef = doc(db, "clients", uid);
          const clientSnap = await getDoc(clientDocRef);

          if (clientSnap.exists()) {
             const clientData = clientSnap.data() as Client;
             onLogin({
               id: clientData.id,
               name: clientData.name,
               role: 'CLIENT',
               phone: clientData.phone,
               photoUrl: clientData.photoUrl,
               walletBalance: clientData.walletBalance
             });
             return;
          } else {
              // Verificamos si es Admin por si acaso
              if (['super_admin@motofast.com'].includes(userCredential.user.email || '')) {
                  // Es admin logueándose con email real
                  return; 
              }
              await signOut(auth);
              setError("Esta cuenta no es de Pasajero. Usa la pestaña Conductor.");
              return;
          }
      }

    } catch (err: any) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const validateEmail = (email: string) => {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleNextStep = () => {
    if (registerStep === 1) {
      if (!formData.name || !formData.email || !formData.phone || !formData.driverPass || !formData.driverPlate || !formData.driverModel) {
        setError('Completa todos los campos básicos.');
        return;
      }
      
      // VALIDACIÓN CELULAR (9 Dígitos)
      if (formData.phone.length !== 9 || !/^\d+$/.test(formData.phone)) {
          setError('El número de celular debe tener exactamente 9 dígitos.');
          return;
      }
      
      if (!formData.phone.startsWith('9')) {
          setError('El número de celular debe empezar con 9. Por favor verifícalo.');
          return;
      }

      // VALIDACIÓN EMAIL
      if (!validateEmail(formData.email.trim())) {
          setError('El formato del correo electrónico no es válido.');
          return;
      }

      setError('');
      setRegisterStep(2);
    } else if (registerStep === 2) {
      if (!photos.plate || !photos.license) {
        setError('Falta subir fotos de documentos.');
        return;
      }
      setError('');
      setRegisterStep(3);
    }
  };

  const handleDriverRegisterFinal = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!photos.profile) {
          setError('¡Es obligatorio subir tu Foto de Perfil!');
          return;
      }
      
      const emailToUse = formData.email.trim();
      if (!validateEmail(emailToUse)) {
          setError('El formato del correo electrónico no es válido.');
          return;
      }

      setIsLoading(true);
      setError('');

      let uid = '';

      try {
        // INTENTO DE CREACIÓN
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, emailToUse, formData.driverPass);
            uid = userCredential.user.uid;
        } catch (authErr: any) {
            // LOGICA DE RECUPERACIÓN: Si el usuario ya existe (por fallo anterior), intentamos loguear
            if (authErr.code === 'auth/email-already-in-use') {
                try {
                    const loginCredential = await signInWithEmailAndPassword(auth, emailToUse, formData.driverPass);
                    uid = loginCredential.user.uid;
                } catch (loginErr) {
                    throw new Error("El correo ya existe y la contraseña es incorrecta. Inicia sesión normalmente.");
                }
            } else {
                throw authErr;
            }
        }

        if (!uid) throw new Error("No se pudo obtener el ID de usuario.");

        // PREPARAR DATOS CONDUCTOR
        const newDriver: Driver = {
            id: uid, 
            name: formData.name,
            phone: formData.phone,
            password: '***',
            plates: formData.driverPlate.toUpperCase(),
            bikeModel: formData.driverModel,
            category: formData.driverCategory as any,
            rating: 5.0,
            status: 'OFFLINE', // Start offline
            position: { lat: -12.0464, lng: -77.0428 },
            photoUrl: photos.profile,
            credits: 0,
            reservedCredits: 0,
            walletBalance: 0,
            // Verification Fields
            verificationStatus: 'PENDING',
            licenseUrl: photos.license,
            plateUrl: photos.plate
        };

        // ESCRIBIR SIEMPRE (Sobreescribir para asegurar datos frescos si falló antes)
        await setDoc(doc(db, "drivers", uid), newDriver);
        
        if (onRegisterDriver) onRegisterDriver(newDriver);
        
        // TRIGGER DE LOGIN MANUAL PARA EVITAR RACE CONDITIONS
        onLogin({
          id: `user-driver-${uid}`,
          name: newDriver.name,
          role: 'DRIVER',
          driverId: uid,
          phone: newDriver.phone,
          photoUrl: newDriver.photoUrl,
          walletBalance: newDriver.walletBalance,
          verificationStatus: 'PENDING'
        });

      } catch (err: any) {
        setError(getFriendlyErrorMessage(err));
      } finally {
        setIsLoading(false);
      }
  };

  const handleClientRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.phone || !formData.clientPassword) {
      setError('Todos los campos son obligatorios.');
      return;
    }

    // VALIDACIÓN CELULAR (9 Dígitos)
    if (formData.phone.length !== 9 || !/^\d+$/.test(formData.phone)) {
        setError('El número de celular debe tener exactamente 9 dígitos.');
        return;
    }

    if (!formData.phone.startsWith('9')) {
        setError('El número de celular debe empezar con 9. Por favor verifícalo.');
        return;
    }

    const emailToUse = formData.email.trim();
    if (!validateEmail(emailToUse)) {
        setError('El formato del correo electrónico no es válido.');
        return;
    }
    
    setIsLoading(true);
    setError('');

    try {
       const userCredential = await createUserWithEmailAndPassword(auth, emailToUse, formData.clientPassword);
       const uid = userCredential.user.uid;
       const finalPhoto = photos.profile ? photos.profile : `https://ui-avatars.com/api/?name=${formData.name.replace(/ /g, '+')}&background=random&color=fff`;

       const newClient: Client = {
         id: uid,
         name: formData.name,
         phone: formData.phone,
         password: '***',
         photoUrl: finalPhoto,
         walletBalance: 0
       };

       await setDoc(doc(db, "clients", uid), newClient);
       if (onRegisterClient) onRegisterClient(newClient);
       onLogin({
           id: newClient.id,
           name: newClient.name,
           role: 'CLIENT',
           phone: newClient.phone,
           photoUrl: newClient.photoUrl,
           walletBalance: newClient.walletBalance
       });

    } catch (err: any) {
        setError(getFriendlyErrorMessage(err));
    } finally {
        setIsLoading(false);
    }
  };

  const [isLogoLoaded, setIsLogoLoaded] = useState(false);

  // PRELOAD LOGO
  React.useEffect(() => {
      const img = new Image();
      img.src = "https://i.ibb.co/twY8RDmf/ventodrive.png";
      img.onload = () => {
          // Pequeño delay para transición suave
          setTimeout(() => setIsLogoLoaded(true), 800);
      };
      img.onerror = () => {
          // Fallback si falla la imagen
          setIsLogoLoaded(true);
      };
  }, []);

  if (!isLogoLoaded) {
      return (
          <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 animate-in fade-in duration-500">
              <div className="relative mb-6">
                  <div className="absolute inset-0 bg-yellow-500/20 blur-xl rounded-full animate-pulse"></div>
                  <Loader2 className="w-12 h-12 text-yellow-400 animate-spin relative z-10" />
              </div>
              <h2 className="text-white font-black text-xl tracking-tighter italic">
                  VENTO<span className="text-yellow-400">DRIVE</span>
              </h2>
              <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mt-2 animate-pulse">
                  Cargando Experiencia...
              </p>
          </div>
      );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 p-6 relative overflow-hidden">
      
      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
         <div className="absolute -top-20 -right-20 w-80 h-80 bg-yellow-500/10 rounded-full blur-3xl"></div>
         <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl"></div>
      </div>

      <div className="relative z-10 w-full max-w-md">
        
        {/* LOGO AREA */}
        <div className="flex flex-col items-center mb-8 relative">
            {/* Brillo detrás del logo */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-yellow-500/10 blur-[80px] rounded-full pointer-events-none"></div>

            {!logoError ? (
                <img 
                    src="https://i.ibb.co/twY8RDmf/ventodrive.png" 
                    alt="VentoDrive" 
                    className="relative z-10 w-80 md:w-96 h-auto object-contain hover:scale-105 transition-transform duration-500"
                    onError={(e) => {
                        setLogoError(true);
                    }}
                />
            ) : (
                <div className="bg-white/10 p-4 rounded-3xl backdrop-blur-sm shadow-2xl border border-white/5 relative">
                    <div className="flex flex-col items-center justify-center px-4 py-2">
                        <div className="bg-yellow-400 p-2 rounded-full mb-1 shadow-lg">
                            <Bike className="w-10 h-10 text-slate-900" />
                        </div>
                        <h1 className="text-2xl font-black italic tracking-tighter text-white">
                            VENTO<span className="text-yellow-400">DRIVE</span>
                        </h1>
                    </div>
                </div>
            )}
        </div>

        {/* Auth Box */}
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl transition-all duration-500">
          
          {mode !== 'DRIVER_REGISTER' && (
            <div className="flex bg-slate-800 rounded-xl p-1 mb-6">
                <button onClick={() => { setMode('LOGIN'); setError(''); }} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${mode === 'LOGIN' || mode === 'REGISTER' ? 'bg-slate-700 text-white shadow' : 'text-slate-500'}`}>Pasajero</button>
                <button onClick={() => { setMode('DRIVER'); setError(''); }} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${mode === 'DRIVER' ? 'bg-slate-700 text-white shadow' : 'text-slate-500'}`}>Conductor</button>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs font-medium text-center animate-pulse flex items-center justify-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {error}
            </div>
          )}

          {/* LOGIN FORMS */}
          {(mode === 'LOGIN' || mode === 'DRIVER') && (
             <form onSubmit={(e) => handleGenericLogin(e, mode === 'DRIVER')} className="space-y-4 animate-in fade-in">
                 
                 <input 
                    type={mode === 'DRIVER' ? "email" : "text"} 
                    value={formData.email} 
                    onChange={e => setFormData({...formData, email: e.target.value})} 
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-white focus:border-yellow-500 outline-none" 
                    placeholder={mode === 'DRIVER' ? "Correo Electrónico" : "Correo o Usuario"} 
                 />
                 
                 <input 
                    type="password" 
                    value={mode === 'DRIVER' ? formData.driverPass : formData.clientPassword} 
                    onChange={e => setFormData({...formData, [mode === 'DRIVER' ? 'driverPass' : 'clientPassword']: e.target.value})} 
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-white focus:border-yellow-500 outline-none" 
                    placeholder="Contraseña" 
                 />
                 
                 <button type="submit" disabled={isLoading} className="w-full bg-yellow-400 hover:bg-yellow-300 text-slate-900 font-bold py-3 rounded-xl transition-colors mt-2 flex justify-center items-center">
                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Iniciar Sesión'}
                 </button>

                 <div className="text-center mt-4">
                    <button type="button" onClick={() => { setMode(mode === 'DRIVER' ? 'DRIVER_REGISTER' : 'REGISTER'); setError(''); setPhotos({}); }} className="text-xs text-slate-400 hover:text-white underline">
                        {mode === 'DRIVER' ? '¿Nuevo conductor? Regístrate aquí' : '¿No tienes cuenta? Regístrate'}
                    </button>
                </div>
             </form>
          )}

          {/* DRIVER REGISTER */}
          {mode === 'DRIVER_REGISTER' && (
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <h3 className="text-white font-bold mb-4 text-center">Registro Conductor - {registerStep}/3</h3>
                  
                  {registerStep === 1 && (
                      <div className="space-y-3">
                          <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-3 text-white text-xs" placeholder="Nombre Completo" />
                          <input type="tel" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-3 text-white text-xs" placeholder="Teléfono" />
                          <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-3 text-white text-xs" placeholder="Email" />
                          <div className="grid grid-cols-2 gap-3">
                              <input type="text" value={formData.driverModel} onChange={e => setFormData({...formData, driverModel: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-3 text-white text-xs" placeholder="Modelo Moto" />
                              <input type="text" value={formData.driverPlate} onChange={e => setFormData({...formData, driverPlate: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-3 text-white text-xs uppercase" placeholder="Placa" />
                          </div>
                          <input type="password" value={formData.driverPass} onChange={e => setFormData({...formData, driverPass: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-3 text-white text-xs" placeholder="Contraseña" />
                          <button onClick={handleNextStep} className="w-full bg-yellow-400 text-slate-900 font-bold py-3 rounded-xl mt-2">Siguiente</button>
                      </div>
                  )}

                  {registerStep === 2 && (
                       <div className="space-y-4">
                          <p className="text-slate-400 text-xs text-center mb-2">Sube las fotos de tus documentos</p>
                          {['plate', 'license'].map((field) => (
                             <div key={field} onClick={() => field === 'plate' ? fileInputPlateRef.current?.click() : fileInputLicenseRef.current?.click()} 
                                  className={`relative border-2 border-dashed rounded-xl p-3 flex items-center gap-3 cursor-pointer transition-colors ${photos[field as 'plate'|'license'] ? 'border-green-500 bg-green-900/10' : 'border-slate-700 hover:border-slate-500'}`}>
                                  <input type="file" ref={field === 'plate' ? fileInputPlateRef : fileInputLicenseRef} className="hidden" accept="image/*" onChange={e => handleFileChange(e, field as any)} />
                                  <div className="w-12 h-12 bg-slate-800 rounded-lg flex items-center justify-center flex-shrink-0">
                                      {photos[field as 'plate'|'license'] ? <CheckCircle className="w-6 h-6 text-green-500"/> : (field === 'plate' ? <Camera className="w-6 h-6 text-slate-500"/> : <FileText className="w-6 h-6 text-slate-500"/>)}
                                  </div>
                                  <div>
                                      <p className="text-xs font-bold text-white">{field === 'plate' ? 'Foto de Placa' : 'Licencia de Conducir'}</p>
                                      <p className="text-[10px] text-slate-400">{photos[field as 'plate'|'license'] ? 'Imagen cargada' : 'Toca para subir'}</p>
                                  </div>
                                  {isPhotoProcessing && !photos[field as 'plate'|'license'] && <Loader2 className="w-4 h-4 animate-spin ml-auto text-yellow-500" />}
                             </div>
                          ))}
                          <div className="flex gap-2">
                              <button onClick={() => setRegisterStep(1)} className="flex-1 bg-slate-800 text-white py-3 rounded-xl font-bold text-xs">Atrás</button>
                              <button onClick={handleNextStep} className="flex-1 bg-yellow-400 text-black py-3 rounded-xl font-bold text-xs">Siguiente</button>
                          </div>
                       </div>
                  )}

                  {registerStep === 3 && (
                       <div className="space-y-4">
                          <p className="text-slate-400 text-xs text-center mb-2">¡Último paso! Tu foto de perfil</p>
                          <input type="file" ref={fileInputProfileRef} className="hidden" accept="image/*" onChange={e => handleFileChange(e, 'profile')} />
                          <div onClick={() => fileInputProfileRef.current?.click()} className={`relative border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all ${photos.profile ? 'border-green-500 bg-green-900/10' : 'border-slate-700 hover:border-yellow-500'}`}>
                              {isPhotoProcessing ? (
                                  <div className="flex flex-col items-center">
                                      <Loader2 className="w-8 h-8 text-yellow-500 animate-spin mb-2"/>
                                      <span className="text-xs text-yellow-500 font-bold">Procesando imagen...</span>
                                  </div>
                              ) : photos.profile ? (
                                  <img src={photos.profile} className="w-32 h-32 rounded-full object-cover border-4 border-green-500"/>
                              ) : (
                                  <>
                                    <ImageIcon className="w-8 h-8 text-slate-500 mb-2"/>
                                    <span className="text-slate-400 text-xs">Subir Foto Perfil</span>
                                  </>
                              )}
                          </div>
                          <div className="flex gap-2">
                              <button onClick={() => setRegisterStep(2)} disabled={isPhotoProcessing} className="flex-1 bg-slate-800 text-white py-3 rounded-xl font-bold text-xs">Atrás</button>
                              <button onClick={handleDriverRegisterFinal} disabled={isLoading || isPhotoProcessing || !photos.profile} className="flex-1 bg-yellow-400 text-black py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 disabled:opacity-50">
                                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : 'Finalizar Registro'}
                              </button>
                          </div>
                       </div>
                  )}
                  <button onClick={() => setMode('DRIVER')} className="w-full text-center text-xs text-slate-500 mt-4 underline">Cancelar</button>
              </div>
          )}

          {/* CLIENT REGISTER */}
          {mode === 'REGISTER' && (
            <form onSubmit={handleClientRegister} className="space-y-4 animate-in fade-in">
                <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-white focus:border-yellow-500 outline-none" placeholder="Nombre Completo" required />
                <input type="tel" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-white focus:border-yellow-500 outline-none" placeholder="Celular" required />
                <div onClick={() => !isPhotoProcessing && fileInputProfileRef.current?.click()} className={`border border-dashed rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:bg-slate-800 transition-colors ${photos.profile ? 'border-green-500 bg-green-900/10' : 'border-slate-700'}`}>
                    <input type="file" ref={fileInputProfileRef} className="hidden" accept="image/*" onChange={e => handleFileChange(e, 'profile')} />
                    <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center overflow-hidden flex-shrink-0">
                        {isPhotoProcessing ? <Loader2 className="w-5 h-5 animate-spin text-yellow-500"/> : photos.profile ? <img src={photos.profile} className="w-full h-full object-cover"/> : <Upload className="w-4 h-4 text-slate-400"/>}
                    </div>
                    <div className="flex-1">
                        <p className="text-xs font-bold text-white">{photos.profile ? 'Foto cargada correctamente' : 'Subir Foto de Perfil (Opcional)'}</p>
                        <p className="text-[10px] text-slate-500">{isPhotoProcessing ? 'Optimizando...' : photos.profile ? 'Toca para cambiar' : 'Toca para seleccionar'}</p>
                    </div>
                </div>
                <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-white focus:border-yellow-500 outline-none" placeholder="Email" required />
                <input type="password" value={formData.clientPassword} onChange={e => setFormData({...formData, clientPassword: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-white focus:border-yellow-500 outline-none" placeholder="Contraseña" required />

                <button type="submit" disabled={isLoading || isPhotoProcessing} className="w-full bg-yellow-400 hover:bg-yellow-300 text-slate-900 font-bold py-3 rounded-xl transition-colors mt-2 flex justify-center items-center disabled:opacity-50">
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Registrar Cuenta'}
                </button>
                <div className="text-center mt-4">
                    <button type="button" onClick={() => { setMode('LOGIN'); setError(''); setPhotos({}); }} className="text-xs text-slate-400 hover:text-white underline">
                        ¿Ya tienes cuenta? Inicia sesión
                    </button>
                </div>
            </form>
          )}
        </div>
        
        <div className="mt-8 flex justify-center gap-2 text-slate-600 text-[10px] uppercase font-bold tracking-widest">
           <ShieldCheck className="w-3 h-3" /> Seguridad Garantizada por VentoDrive
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
