

import React, { useState, useEffect } from 'react';
import { User, Driver, RideRequest, Client, AdminSettings, RechargeRequest, Coordinates, WithdrawalRequest } from './types';
import AuthScreen from './components/AuthScreen';
import AdminDashboard from './components/AdminDashboard';
import ClientDashboard from './components/ClientDashboard';
import DriverDashboard from './components/DriverDashboard';
import { auth, db } from './services/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, collection, onSnapshot, query, updateDoc, deleteDoc, setDoc, where, addDoc, serverTimestamp, runTransaction } from 'firebase/firestore';
import { AlertCircle, Clock, Lock, Loader2 } from 'lucide-react';
import { INITIAL_CENTER } from './constants';

// --- HELPERS DE SANITIZACIÓN ---
const safeString = (val: any, def: string) => (typeof val === 'string' && val.trim().length > 0 ? val : def);
const safeNumber = (val: any, def: number) => {
    const num = parseFloat(val);
    return isNaN(num) ? def : num;
};
const safeCoords = (val: any): Coordinates => {
    if (val && typeof val.lat === 'number' && !isNaN(val.lat) && typeof val.lng === 'number' && !isNaN(val.lng)) {
        return { lat: val.lat, lng: val.lng };
    }
    return { ...INITIAL_CENTER }; // Fallback seguro
};

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [clients, setClients] = useState<Client[]>([]); // Nuevo estado para clientes (Admin view)
  
  // Estado dividido para conductores
  const [activeRide, setActiveRide] = useState<RideRequest | null>(null); // El viaje que estoy atendiendo o viendo detalle
  const [nearbyRides, setNearbyRides] = useState<RideRequest[]>([]); // Lista de viajes libres
  const [driversLoaded, setDriversLoaded] = useState(false); // New state to prevent premature cancellation
  
  const [dbError, setDbError] = useState<string | null>(null);
  const [adminSettings, setAdminSettings] = useState<AdminSettings | undefined>(undefined);

  // --- 1. PERSISTENCIA DE SESIÓN ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // DETECCIÓN DE ADMIN
        if (['super_admin@motofast.com', 'root_admin@motofast.com', 'admin@motofast.com'].includes(user.email || '')) {
            setCurrentUser({
                id: user.uid,
                name: 'Administrador Principal',
                role: 'ADMIN'
            });
            setLoadingSession(false);
            return;
        }

        try {
          const driverSnap = await getDoc(doc(db, "drivers", user.uid));
          if (driverSnap.exists()) {
            const dData = driverSnap.data();
            setCurrentUser({
              id: user.uid,
              name: safeString(dData.name, 'Conductor'),
              role: 'DRIVER',
              driverId: dData.id,
              phone: safeString(dData.phone, ''),
              photoUrl: safeString(dData.photoUrl, ''),
              walletBalance: safeNumber(dData.walletBalance, 0),
              verificationStatus: dData.verificationStatus || 'VERIFIED'
            });
          } else {
            const clientSnap = await getDoc(doc(db, "clients", user.uid));
            if (clientSnap.exists()) {
              const cData = clientSnap.data();
              setCurrentUser({
                id: user.uid,
                name: safeString(cData.name, 'Pasajero'),
                role: 'CLIENT',
                phone: safeString(cData.phone, ''),
                photoUrl: safeString(cData.photoUrl, ''),
                walletBalance: safeNumber(cData.walletBalance, 0)
              });
            }
          }
        } catch (e: any) { 
          console.error("Error cargando perfil:", e);
          if (e.code === 'permission-denied') setDbError("PERMISSIONS_ERROR");
        }
      } else {
        setCurrentUser(null);
      }
      setLoadingSession(false);
    });
    return () => unsubscribe();
  }, []);

  // --- 2. SINCRONIZACIÓN DE CONDUCTORES CON SANITIZACIÓN TOTAL ---
  useEffect(() => {
    if (loadingSession || !currentUser || dbError) return;

    const q = query(collection(db, "drivers"));
    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        const driversList = snapshot.docs.map(doc => {
            const data = doc.data();
            // CONSTRUCCIÓN SEGURA DEL OBJETO DRIVER
            return {
                id: doc.id,
                name: safeString(data.name, 'Conductor'),
                bikeModel: safeString(data.bikeModel, 'Moto Estándar'),
                rating: safeNumber(data.rating, 5.0),
                plates: safeString(data.plates, 'SIN-PLACA'),
                category: data.category || 'STANDARD',
                position: safeCoords(data.position),
                // Fallback seguro si no hay foto
                photoUrl: safeString(data.photoUrl, 'https://ui-avatars.com/api/?name=Moto&background=random'),
                status: data.status === 'AVAILABLE' || data.status === 'BUSY' ? data.status : 'OFFLINE',
                phone: safeString(data.phone, ''),
                credits: safeNumber(data.credits, 0),
                reservedCredits: safeNumber(data.reservedCredits, 0),
                walletBalance: safeNumber(data.walletBalance, 0),
                // NEW FIELDS
                verificationStatus: data.verificationStatus || 'VERIFIED',
                licenseUrl: safeString(data.licenseUrl, ''),
                plateUrl: safeString(data.plateUrl, '')
            } as Driver;
        });
        setDrivers(driversList);
        setDriversLoaded(true);
        
        // Actualizar datos del currentUser si soy yo (especialmente verificationStatus y balance)
        if (currentUser.role === 'DRIVER') {
             const myData = driversList.find(d => d.id === currentUser.id);
             if (myData) {
                 if (myData.walletBalance !== currentUser.walletBalance || myData.verificationStatus !== currentUser.verificationStatus) {
                     setCurrentUser(prev => prev ? ({
                         ...prev, 
                         walletBalance: myData.walletBalance,
                         verificationStatus: myData.verificationStatus
                     }) : null);
                 }
             }
        }
        
        if (dbError) setDbError(null);
      },
      (error) => {
        console.error("Error en conductores:", error);
        if (error.code === 'permission-denied') setDbError("PERMISSIONS_ERROR");
      }
    );
    return () => unsubscribe();
  }, [loadingSession, currentUser, dbError]);
  
  // --- SYNC CLIENTE (Para ver wallet en tiempo real) ---
  useEffect(() => {
      if (currentUser?.role !== 'CLIENT') return;
      
      const unsub = onSnapshot(doc(db, "clients", currentUser.id), (docSnap) => {
          if (docSnap.exists()) {
              const data = docSnap.data();
              const newBalance = safeNumber(data.walletBalance, 0);
              if (newBalance !== currentUser.walletBalance) {
                  setCurrentUser(prev => prev ? ({...prev, walletBalance: newBalance}) : null);
              }
          }
      });
      return () => unsub();
  }, [currentUser?.id, currentUser?.role]);

  // --- 2.5 SYNC TODOS LOS CLIENTES (SOLO ADMIN) ---
  useEffect(() => {
      if (currentUser?.role !== 'ADMIN') return;

      const q = query(collection(db, "clients"));
      const unsub = onSnapshot(q, (snapshot) => {
          const clientsList = snapshot.docs.map(doc => {
              const data = doc.data();
              return {
                  id: doc.id,
                  name: safeString(data.name, 'Cliente'),
                  phone: safeString(data.phone, 'Sin teléfono'),
                  photoUrl: safeString(data.photoUrl, 'https://ui-avatars.com/api/?name=User&background=random'),
                  walletBalance: safeNumber(data.walletBalance, 0),
                  password: '***' // No needed for admin view
              } as Client;
          });
          setClients(clientsList);
      }, (error) => console.error("Error fetching clients for admin", error));
      
      return () => unsub();
  }, [currentUser?.role]);


  // --- 3. SINCRONIZACIÓN DE VIAJES CON SANITIZACIÓN ---
  useEffect(() => {
    if (!currentUser || dbError) return;
    if (currentUser.role === 'ADMIN') return;

    const ridesRef = collection(db, "rides");
    let q;

    if (currentUser.role === 'DRIVER') {
        // Conductores: Escuchan sus viajes asignados O viajes libres (broadcast)
        const driverId = currentUser.driverId || currentUser.id;
        q = query(ridesRef, where('driverId', 'in', [driverId, '']));
    } else {
        // Pasajeros: Escuchan sus propios viajes
        q = query(ridesRef, where('passengerId', '==', currentUser.id));
    }

    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        const allRides = snapshot.docs.map(doc => {
             const data = doc.data();
             return {
                 id: doc.id,
                 ...data,
                 passengerName: safeString(data.passengerName, 'Pasajero'),
                 passengerPhone: safeString(data.passengerPhone, ''), // NEW
                 pickup: safeString(data.pickup, 'Ubicación de recojo'),
                 destination: safeString(data.destination, 'Destino'),
                 fare: safeNumber(data.fare, 0),
                 distance: safeString(data.distance, '0 km'),
                 commission: safeNumber(data.commission, 0),
                 pickupCoordinates: safeCoords(data.pickupCoordinates),
                 destinationCoordinates: safeCoords(data.destinationCoordinates),
             } as RideRequest;
          });

        if (currentUser.role === 'CLIENT') {
             // Cliente ve su viaje activo (que no esté completado/cancelado/rechazado)
             const active = allRides.find(r => !['COMPLETED','CANCELLED','REJECTED'].includes(r.status));
             setActiveRide(active || null);
        } else {
             // LÓGICA CONDUCTOR: Separar "Lo que estoy haciendo" de "Lo que hay disponible"
             
             // 1. Viaje Activo: El que tengo asignado y está aceptado o en curso.
             // O BIEN, si he seleccionado uno para ver (aunque sea pending y asignado a mi temporalmente)
             const myCurrentEngagement = allRides.find(r => 
                (r.driverId === (currentUser.driverId || currentUser.id)) && 
                (['ACCEPTED', 'IN_PROGRESS'].includes(r.status))
             );

             // Si no tengo un compromiso firme, quizás estoy viendo una solicitud específica
             if (myCurrentEngagement) {
                 setActiveRide(myCurrentEngagement);
             } else {
                 const specificRequest = allRides.find(r => 
                    r.driverId === (currentUser.driverId || currentUser.id) && r.status === 'PENDING'
                 );
                 setActiveRide(specificRequest || null);
             }

             // 2. Viajes Disponibles (Panel de Mercado):
             const market = allRides.filter(r => 
                 r.status === 'PENDING' && 
                 (r.driverId === '' || r.driverId === (currentUser.driverId || currentUser.id))
             );
             
             setNearbyRides(market);
        }
      },
      (error) => {
        console.error("Error en viajes:", error);
        if (error.code === 'permission-denied') setDbError("PERMISSIONS_ERROR");
      }
    );

    return () => unsubscribe();
  }, [currentUser, dbError]);

  // --- 5. SAFETY CHECK: DETECT DELETED DRIVERS IN ACTIVE RIDES ---
  useEffect(() => {
    if (!driversLoaded || !currentUser || currentUser.role !== 'CLIENT' || !activeRide) return;
    
    // Solo verificar si el viaje está aceptado o en curso (tiene conductor asignado)
    if (['ACCEPTED', 'IN_PROGRESS'].includes(activeRide.status) && activeRide.driverId) {
        const assignedDriver = drivers.find(d => d.id === activeRide.driverId);
        
        // Si el conductor NO está en la lista (y ya cargó), significa que fue eliminado
        if (!assignedDriver) {
            console.warn("Conductor eliminado detectado. Cancelando viaje...");
            
            // Cancelar el viaje en Firestore
            updateDoc(doc(db, "rides", activeRide.id), { 
                status: 'CANCELLED',
                cancellationReason: 'DRIVER_DELETED_BY_ADMIN'
            }).then(() => {
                alert("El conductor asignado ya no está disponible. El servicio ha sido anulado automáticamente y no se ha realizado ningún cobro.");
                // El snapshot de rides se encargará de poner activeRide en null
            }).catch(err => console.error("Error cancelando viaje huérfano:", err));
        }
    }
  }, [activeRide, drivers, driversLoaded, currentUser]);

  // --- 4. CARGAR SETTINGS GLOBALES ---
  useEffect(() => {
    if (!currentUser || dbError) return;

    const settingsRef = doc(db, 'admin_settings', 'global_config');
    const unsub = onSnapshot(settingsRef, (snapshot) => {
        if(snapshot.exists()) {
            const data = snapshot.data();
            setAdminSettings({
                yapeQrUrl: data.yapeQrUrl || '',
                plinQrUrl: data.plinQrUrl || '',
                supportPhone: data.supportPhone || '',
                baseRatePerKm: safeNumber(data.baseRatePerKm, 1.50),
                enableClientCashback: data.enableClientCashback ?? true,
                clientCashbackPercent: safeNumber(data.clientCashbackPercent, 0.05),
                enableDriverBonus: data.enableDriverBonus ?? true,
                driverBonusThreshold: safeNumber(data.driverBonusThreshold, 50.00),
                driverBonusPercent: safeNumber(data.driverBonusPercent, 0.10)
            });
        } else {
            // Inicializar con valores por defecto si no existe
            const defaultSettings: AdminSettings = { 
                yapeQrUrl: '', plinQrUrl: '', supportPhone: '',
                baseRatePerKm: 1.50,
                enableClientCashback: true,
                clientCashbackPercent: 0.05,
                enableDriverBonus: true,
                driverBonusThreshold: 50.00,
                driverBonusPercent: 0.10
            };
            setDoc(settingsRef, defaultSettings).catch(e => console.warn("No se pudo crear settings default", e));
            setAdminSettings(defaultSettings);
        }
    }, (error) => {
        console.warn("Error settings:", error.code);
    });
    return () => unsub();
  }, [currentUser, dbError]);

  const handleLogout = async () => {
    await auth.signOut();
    setCurrentUser(null);
    setDbError(null); 
  };

  const handleRequestRide = async (request: RideRequest) => {
    try {
      // Validación de Saldo si es pago WALLET
      if (request.paymentMethod === 'WALLET') {
          if ((currentUser?.walletBalance || 0) < request.fare) {
              alert("Saldo insuficiente en tu Billetera Vento. Por favor recarga.");
              return;
          }
      }
      
      const safeRequest = JSON.parse(JSON.stringify(request));
      await setDoc(doc(db, "rides", request.id), safeRequest);
    } catch (e) {
      console.error("Error solicitando viaje:", e);
      alert("No se pudo solicitar el viaje. Revisa los permisos de la base de datos.");
    }
  };

  // --- LÓGICA DE ACEPTACIÓN: GESTIÓN DE CRÉDITOS SEGÚN MÉTODO DE PAGO ---
  const handleAcceptRide = async (ride: RideRequest) => {
      if (!ride || !currentUser?.driverId) return;
      
      const driverRef = doc(db, "drivers", currentUser.driverId);
      const driverSnap = await getDoc(driverRef);
      if (!driverSnap.exists()) return;
      const driverData = driverSnap.data();

      let commission = ride.commission;
      if (!commission || commission <= 0) {
          commission = parseFloat((ride.fare * 0.10).toFixed(2));
      }

      // LÓGICA CRÍTICA:
      // Si el pago es en EFECTIVO (CASH) -> El conductor DEBE tener saldo en créditos operativos para cubrir la comisión.
      // Si el pago es en WALLET -> NO se descuentan créditos operativos. La app retendrá la comisión del pago del cliente.
      
      if (ride.paymentMethod === 'CASH') {
          const currentCredits = safeNumber(driverData.credits, 0);
          
          if (currentCredits < commission) {
              alert(`SALDO OPERATIVO INSUFICIENTE. Necesitas ${commission.toFixed(2)} créditos para aceptar este viaje en efectivo.`);
              return;
          }

          const newCredits = parseFloat((currentCredits - commission).toFixed(2));
          const currentReserved = safeNumber(driverData.reservedCredits, 0);
          const newReserved = parseFloat((currentReserved + commission).toFixed(2));

          // Descontamos créditos y los reservamos (escrow)
          await updateDoc(driverRef, { 
              credits: newCredits, 
              reservedCredits: newReserved,
              status: 'BUSY'
          });

      } else {
          // Si es WALLET, no tocamos los créditos operativos. Solo ponemos al conductor ocupado.
          await updateDoc(driverRef, { 
              status: 'BUSY'
          });
      }

      // Actualizamos el viaje
      try {
          await updateDoc(doc(db, "rides", ride.id), { 
              status: 'ACCEPTED',
              commission: commission,
              driverId: currentUser.driverId 
          });
      } catch (e) { console.error("Error accepting ride:", e); }
  };

  // --- LÓGICA DE COMPLETAR VIAJE (TRANSACCIÓN ATÓMICA ROBUSTA) ---
  const handleCompleteRide = async () => {
      if (!activeRide || !currentUser?.driverId) return;
      
      try {
        await runTransaction(db, async (transaction) => {
            // 1. LEER DATOS FRESCOS (Critical for Transactions)
            const driverRef = doc(db, "drivers", currentUser.driverId!);
            const rideRef = doc(db, "rides", activeRide.id);
            
            const driverDoc = await transaction.get(driverRef);
            const rideDoc = await transaction.get(rideRef);

            if (!driverDoc.exists() || !rideDoc.exists()) {
                throw new Error("Documento no encontrado");
            }

            const driverData = driverDoc.data();
            const rideData = rideDoc.data();

            // Verificar si ya fue pagado para evitar duplicidad
            if (rideData.status === 'COMPLETED' || rideData.isPaid) {
                return; 
            }

            const commission = safeNumber(rideData.commission, 0);
            const fare = safeNumber(rideData.fare, 0);
            const currentReserved = safeNumber(driverData.reservedCredits, 0);
            const currentCredits = safeNumber(driverData.credits, 0);
            const currentDriverWallet = safeNumber(driverData.walletBalance, 0);

            // CASO 1: EFECTIVO (CASH)
            if (rideData.paymentMethod === 'CASH') {
                // El conductor se queda con el efectivo.
                // La app "quema" la comisión que fue reservada previamente en handleAcceptRide.
                const newReserved = parseFloat(Math.max(0, currentReserved - commission).toFixed(2));
                
                transaction.update(driverRef, { 
                    reservedCredits: newReserved,
                    status: 'AVAILABLE'
                });
                
                // Cliente no se toca en Efectivo
            } 
            // CASO 2: WALLET (SALDO VENTO)
            else {
                // Validar Cliente
                const clientRef = doc(db, "clients", rideData.passengerId);
                const clientDoc = await transaction.get(clientRef);
                
                if (!clientDoc.exists()) throw new Error("Cliente no encontrado para cobrar");
                
                const clientData = clientDoc.data();
                const clientBalance = safeNumber(clientData.walletBalance, 0);

                // LÓGICA FINANCIERA PARA WALLET:
                // 1. El cliente paga el 100% (Fare)
                // 2. La app retiene la comisión automáticamente.
                // 3. El conductor recibe (Fare - Commission) en su SALDO VENTO (walletBalance).
                // NOTA: NO tocamos credits ni reservedCredits porque en handleAcceptRide NO los descontamos.

                const driverEarnings = parseFloat((fare - commission).toFixed(2));
                const newDriverWallet = parseFloat((currentDriverWallet + driverEarnings).toFixed(2));
                
                // Cashback lógica
                const isCashbackEnabled = adminSettings?.enableClientCashback ?? true;
                const cashbackPercent = adminSettings?.clientCashbackPercent ?? 0.05;
                const cashback = isCashbackEnabled ? parseFloat((fare * cashbackPercent).toFixed(2)) : 0;
                
                const newClientBalance = parseFloat((clientBalance - fare + cashback).toFixed(2));

                // ESCRITURA EN DB (Atomic)
                transaction.update(driverRef, {
                    // No tocamos credits ni reservedCredits
                    walletBalance: newDriverWallet, // Se abona la ganancia neta
                    status: 'AVAILABLE'
                });

                transaction.update(clientRef, {
                    walletBalance: newClientBalance // Se descuenta viaje y suma cashback
                });
            }

            // Marcar viaje completado
            transaction.update(rideRef, { 
                status: 'COMPLETED', 
                isPaid: true 
            });
        });

        console.log("Transacción de viaje completada con éxito.");
        
      } catch (e) { 
          console.error("Error CRÍTICO en transacción:", e);
          alert("Hubo un error procesando el pago. Por favor contacta a soporte si persiste.");
      }
  };

  const handleCancelRide = async () => {
      if (!activeRide) return;
      const driverId = activeRide.driverId;
      const commission = activeRide.commission || 0;

      try {
        if (['ACCEPTED', 'IN_PROGRESS'].includes(activeRide.status) && driverId) {
             const driverRef = doc(db, "drivers", driverId);
             const driverSnap = await getDoc(driverRef);
             
             if (driverSnap.exists()) {
                 const dData = driverSnap.data();
                 
                 // Solo devolvemos créditos SI el viaje era en efectivo (porque solo ahí los descontamos)
                 if (activeRide.paymentMethod === 'CASH') {
                     const currentCredits = safeNumber(dData.credits, 0);
                     const currentReserved = safeNumber(dData.reservedCredits, 0);

                     const newCredits = parseFloat((currentCredits + commission).toFixed(2));
                     const newReserved = parseFloat(Math.max(0, currentReserved - commission).toFixed(2));
                     
                     await updateDoc(driverRef, { 
                         credits: newCredits, 
                         reservedCredits: newReserved,
                         status: 'AVAILABLE'
                     });
                 } else {
                     // Si era WALLET, no habíamos descontado nada, solo liberamos al conductor
                     await updateDoc(driverRef, { status: 'AVAILABLE' });
                 }
             }
        }
        await updateDoc(doc(db, "rides", activeRide.id), { status: 'CANCELLED' });
      } catch (e) { console.error(e); }
  };

  const handleRejectRide = async () => {
    if (activeRide) {
        if (activeRide.driverId) {
             await updateDoc(doc(db, "rides", activeRide.id), { driverId: '' }); 
        }
        setActiveRide(null);
    }
  }

  // RECARGA DE SALDO (GENÉRICA PARA CLIENTE Y CHOFER)
  // FIX: Se devuelve Promise para que el componente espere la escritura en DB
  const handleRequestRecharge = async (amount: number, creditsOrBalance: number, proof: string): Promise<void> => {
      if (!currentUser) return;
      const newReq: RechargeRequest = {
          id: `req_${Date.now()}`,
          userId: currentUser.role === 'DRIVER' ? (currentUser.driverId || currentUser.id) : currentUser.id,
          userName: currentUser.name,
          userType: currentUser.role === 'DRIVER' ? 'DRIVER' : 'CLIENT',
          amount,
          creditsRequested: creditsOrBalance, // Si es cliente es saldo wallet, si es chofer son créditos
          proofUrl: proof,
          status: 'PENDING',
          timestamp: Date.now(),
          requestType: 'RECHARGE'
      };
      // Propagamos error para que el frontend pueda manejar el estado de carga
      try { 
          await setDoc(doc(db, 'recharge_requests', newReq.id), newReq); 
      } catch (e) { 
          console.error("Error creating recharge request:", e);
          throw e; 
      }
  }

  // RETIRO DE SALDO (SOLO CHOFER)
  // FIX: Se devuelve Promise para que el componente espere la escritura en DB
  const handleRequestWithdrawal = async (amount: number, qrUrl: string): Promise<void> => {
      if (!currentUser || currentUser.role !== 'DRIVER') return;
      const driverId = currentUser.driverId || currentUser.id;
      
      // Usamos la misma colección 'recharge_requests' pero con tipo 'WITHDRAWAL'
      // Mapeamos los campos de WithdrawalRequest a RechargeRequest para compatibilidad
      const newReq: RechargeRequest = {
          id: `withdraw_${Date.now()}`,
          userId: driverId,
          userName: currentUser.name,
          userType: 'DRIVER',
          amount: amount,
          creditsRequested: 0, // No aplica créditos en retiro
          proofUrl: qrUrl, // Aquí va el QR
          status: 'PENDING',
          timestamp: Date.now(),
          requestType: 'WITHDRAWAL'
      };

      try {
        // MODIFICADO: No descontamos saldo aquí. Se descontará al aprobar en Admin.
        await setDoc(doc(db, 'recharge_requests', newReq.id), newReq);
      } catch (e) {
          console.error("Error creating withdrawal request:", e);
          throw e;
      }
  }

  if (loadingSession) return (
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

  if (dbError === "PERMISSIONS_ERROR") {
     return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white p-6">
            <div className="bg-red-500/10 p-4 rounded-full mb-6 animate-pulse">
                <AlertCircle className="w-16 h-16 text-red-500" />
            </div>
            <h2 className="text-2xl font-bold mb-2 text-center">Configuración Pendiente</h2>
            <p className="text-slate-400 text-center mb-8 max-w-md">La aplicación no puede acceder a la base de datos.</p>
            <button onClick={() => window.location.reload()} className="bg-white text-slate-900 font-bold py-3 px-8 rounded-xl hover:bg-slate-200 transition-colors">Reintentar</button>
        </div>
     )
  }

  if (!currentUser) return <AuthScreen onLogin={setCurrentUser} drivers={drivers} />;

  // --- DRIVER PENDING SCREEN ---
  if (currentUser.role === 'DRIVER' && currentUser.verificationStatus === 'PENDING') {
      return (
          <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-8 text-center relative overflow-hidden">
               <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
                   <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-yellow-500 rounded-full blur-[100px]"></div>
               </div>

               <div className="bg-slate-900 p-8 rounded-3xl border border-slate-800 shadow-2xl max-w-sm w-full relative z-10">
                   <div className="w-20 h-20 bg-yellow-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                       <Clock className="w-10 h-10 text-yellow-500 animate-pulse" />
                   </div>
                   
                   <h2 className="text-2xl font-black mb-2">Registro en Revisión</h2>
                   <p className="text-slate-400 text-sm mb-8 leading-relaxed">
                       Tus documentos han sido enviados y están siendo verificados por nuestro equipo administrativo.
                   </p>

                   <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 mb-8 flex items-center gap-3 text-left">
                       <div className="p-2 bg-slate-900 rounded-lg"><Lock className="w-5 h-5 text-slate-500"/></div>
                       <div>
                           <p className="text-xs font-bold text-slate-300">Acceso Restringido</p>
                           <p className="text-[10px] text-slate-500">Podrás tomar viajes una vez aprobado.</p>
                       </div>
                   </div>

                   <button 
                       onClick={handleLogout} 
                       className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition-colors text-sm"
                   >
                       Cerrar Sesión
                   </button>
               </div>
               
               <p className="mt-8 text-[10px] text-slate-600 font-bold uppercase tracking-widest">VentoDrive Safety Team</p>
          </div>
      );
  }
  
  // --- DRIVER REJECTED SCREEN ---
  if (currentUser.role === 'DRIVER' && currentUser.verificationStatus === 'REJECTED') {
      return (
          <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-8 text-center">
               <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                   <AlertCircle className="w-10 h-10 text-red-500" />
               </div>
               <h2 className="text-2xl font-black mb-2 text-red-500">Solicitud Rechazada</h2>
               <p className="text-slate-400 text-sm mb-8 max-w-xs">
                   Tu perfil no cumple con los requisitos de seguridad de VentoDrive. Contacta a soporte para más detalles.
               </p>
               <button onClick={handleLogout} className="px-8 py-3 bg-slate-800 rounded-xl font-bold">Cerrar Sesión</button>
          </div>
      );
  }

  if (currentUser.role === 'ADMIN') return (
    <AdminDashboard 
        drivers={drivers} 
        clients={clients} 
        onAddDriver={()=>{}} 
        onRemoveDriver={async (id) => { await deleteDoc(doc(db, "drivers", id)); }}
        onRemoveClient={async (id) => { await deleteDoc(doc(db, "clients", id)); }}
        onLogout={handleLogout} 
    />
  );

  if (currentUser.role === 'DRIVER') {
    const profile = drivers.find(d => d.id === (currentUser.driverId || currentUser.id));
    const safeDriver = profile || { 
        ...currentUser, status: 'OFFLINE', position: INITIAL_CENTER, rating: 5, credits: 0, reservedCredits: 0, bikeModel: '', plates: '', category: 'STANDARD', walletBalance: 0 
    } as any;

    return (
      <DriverDashboard 
        driver={safeDriver}
        onUpdateDriver={async (data) => await updateDoc(doc(db, "drivers", safeDriver.id), data)}
        onLogout={handleLogout}
        activeRequest={activeRide}
        nearbyRides={nearbyRides} 
        onSelectRide={setActiveRide} 
        onAcceptRequest={() => activeRide && handleAcceptRide(activeRide)}
        onRejectRequest={handleRejectRide}
        onCompleteRide={handleCompleteRide}
        onStartTrip={async () => await updateDoc(doc(db, "rides", activeRide!.id), { status: 'IN_PROGRESS' })}
        onRequestRecharge={handleRequestRecharge}
        onRequestWithdrawal={handleRequestWithdrawal}
        adminSettings={adminSettings}
      />
    );
  }

  return (
    <ClientDashboard 
      user={currentUser} 
      drivers={drivers} 
      setDrivers={setDrivers}
      onLogout={handleLogout} 
      activeRide={activeRide}
      onRequestRide={handleRequestRide}
      onCancelRide={handleCancelRide}
      onRequestRecharge={handleRequestRecharge}
      adminSettings={adminSettings}
    />
  );
}

export default App;