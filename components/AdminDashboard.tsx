

import React, { useState, useEffect, useRef } from 'react';
import { Driver, BikeCategory, RechargeRequest, AdminSettings, WithdrawalRequest, Client } from '../types';
import { Plus, Trash2, LogOut, Bike, Phone, Key, AlertCircle, Settings, FileText, Users, Check, X, Upload, Wallet, XCircle, DollarSign, ArrowUpRight, ArrowDownLeft, Search, User, ZoomIn, Loader, CheckCircle, Clock, Percent, ToggleRight, ToggleLeft, Download, FileSpreadsheet } from 'lucide-react';
import { collection, query, onSnapshot, orderBy, updateDoc, doc, addDoc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';

interface AdminDashboardProps {
  drivers: Driver[];
  clients?: Client[]; 
  onAddDriver: (driver: Driver) => void;
  onRemoveDriver: (id: string) => Promise<void>; 
  onRemoveClient?: (id: string) => Promise<void>; 
  onLogout: () => void;
}

// Función de compresión para QRs (Reutilizada localmente)
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
                const MAX_WIDTH = 600; // QR decente
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

const AdminDashboard: React.FC<AdminDashboardProps> = ({ drivers, clients = [], onAddDriver, onRemoveDriver, onRemoveClient, onLogout }) => {
  const [activeTab, setActiveTab] = useState<'DRIVERS' | 'CLIENTS' | 'TREASURY' | 'SETTINGS'>('DRIVERS');
  const [subTabDriver, setSubTabDriver] = useState<'ACTIVE' | 'REQUESTS'>('ACTIVE'); 
  
  const [rechargeRequests, setRechargeRequests] = useState<RechargeRequest[]>([]);
  // Derived state for withdrawals
  const withdrawalRequests = rechargeRequests.filter(r => r.requestType === 'WITHDRAWAL').map(r => ({
      id: r.id,
      driverId: r.userId,
      driverName: r.userName,
      amount: r.amount,
      qrUrl: r.proofUrl,
      status: r.status,
      timestamp: r.timestamp,
      requestType: 'WITHDRAWAL'
  } as WithdrawalRequest));

  // Filtered recharges (exclude withdrawals)
  const filteredRecharges = rechargeRequests.filter(r => r.requestType !== 'WITHDRAWAL');

  const [searchTerm, setSearchTerm] = useState(''); 
  
  // Estados para el Modal de Recarga Manual
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [manualAmount, setManualAmount] = useState<string>('');
  
  // Estado para el Modal de Aprobación de Conductor
  const [driverToApprove, setDriverToApprove] = useState<Driver | null>(null);
  const [isProcessing, setIsProcessing] = useState(false); 

  // Estado para el Visor de Imágenes (Lightbox)
  const [viewingImage, setViewingImage] = useState<string | null>(null);

  // Estados para eliminación segura (2 pasos)
  const [deleteConfirmationId, setDeleteConfirmationId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Refs para subida de QR
  const yapeInputRef = useRef<HTMLInputElement>(null);
  const plinInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingQr, setIsUploadingQr] = useState(false);

  // Local Settings State
  const [settings, setSettings] = useState<AdminSettings>({
      yapeQrUrl: '',
      plinQrUrl: '',
      supportPhone: '',
      baseRatePerKm: 1.50,
      enableClientCashback: true,
      clientCashbackPercent: 0.05,
      enableDriverBonus: true,
      driverBonusThreshold: 50.00,
      driverBonusPercent: 0.10
  });

  // Listen to Recharge Requests (Merged)
  useEffect(() => {
      const q = query(collection(db, 'recharge_requests'), orderBy('timestamp', 'desc'));
      const unsubscribe = onSnapshot(q, 
          (snapshot) => {
              const reqs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as RechargeRequest));
              setRechargeRequests(reqs);
          },
          (error) => {
              console.warn("Error recharge requests:", error.code);
          }
      );
      return () => unsubscribe();
  }, []);

  // Listen to Withdrawal Requests (REMOVED - Now merged)

  // Listen to Settings
  useEffect(() => {
      const unsub = onSnapshot(doc(db, 'admin_settings', 'global_config'), 
          (doc) => {
              if(doc.exists()) {
                  setSettings(doc.data() as AdminSettings);
              }
          },
          (error) => {
              console.warn("Error admin settings:", error.code);
          }
      );
      return () => unsub();
  }, []);

  // Reset search when tab changes
  useEffect(() => {
      setSearchTerm('');
      setDeleteConfirmationId(null);
  }, [activeTab, subTabDriver]);

  const handleUpdateCredit = async (driverId: string, currentCredits: number, amountToAdd: number) => {
      const newCredits = (currentCredits || 0) + amountToAdd;
      await updateDoc(doc(db, 'drivers', driverId), { credits: newCredits });
  };

  const handleManualRechargeSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedDriver || !manualAmount) return;
      
      const amount = parseFloat(manualAmount);
      if (isNaN(amount)) return;

      try {
          await handleUpdateCredit(selectedDriver.id, selectedDriver.credits, amount);
          alert(`Operación exitosa: ${amount > 0 ? 'Recarga' : 'Ajuste'} de ${amount} créditos realizado.`);
          setSelectedDriver(null);
          setManualAmount('');
      } catch (error) {
          console.error("Error updating credits:", error);
          alert("Error al actualizar créditos");
      }
  };

  const handleProcessRecharge = async (request: RechargeRequest, approved: boolean) => {
      // Use recharge_requests collection for status update
      await updateDoc(doc(db, 'recharge_requests', request.id), { status: approved ? 'APPROVED' : 'REJECTED' });

      if (approved) {
          if (request.userType === 'DRIVER') {
              const driverRef = doc(db, 'drivers', request.userId);
              const driver = drivers.find(d => d.id === request.userId);
              
              if (driver) {
                  await updateDoc(driverRef, { credits: (driver.credits || 0) + request.creditsRequested });
              } else {
                  const dSnap = await getDoc(driverRef);
                  if(dSnap.exists()) {
                      const current = dSnap.data().credits || 0;
                      await updateDoc(driverRef, { credits: current + request.creditsRequested });
                  }
              }
          } else {
              try {
                  const clientRef = doc(db, 'clients', request.userId);
                  const clientSnap = await getDoc(clientRef);
                  
                  if (clientSnap.exists()) {
                      const currentBalance = clientSnap.data().walletBalance || 0;
                      const validBalance = isNaN(parseFloat(currentBalance)) ? 0 : parseFloat(currentBalance);
                      const newBalance = validBalance + request.creditsRequested;
                      await updateDoc(clientRef, { walletBalance: newBalance });
                  } else {
                      alert("Error: El cliente no existe en la base de datos.");
                  }
              } catch (error) {
                  console.error("Error crítico actualizando saldo cliente:", error);
                  alert("Hubo un error al intentar sumar el saldo al cliente.");
              }
          }
      }
  };
  
  const handleProcessWithdrawal = async (request: WithdrawalRequest, approved: boolean) => {
      if (approved) {
           // Si se aprueba, verificamos saldo y descontamos
           const driverRef = doc(db, 'drivers', request.driverId);
           const driverSnap = await getDoc(driverRef);
           
           if (!driverSnap.exists()) {
               alert("Error: Conductor no encontrado.");
               return;
           }
           
           const currentBalance = driverSnap.data().walletBalance || 0;
           
           if (currentBalance < request.amount) {
               alert(`Error: Saldo insuficiente (S/ ${currentBalance.toFixed(2)}) para aprobar retiro de S/ ${request.amount.toFixed(2)}.`);
               return;
           }
           
           // Descontar saldo
           await updateDoc(driverRef, { walletBalance: currentBalance - request.amount });
      }
      
      // Actualizar estado de la solicitud en recharge_requests (porque ahí guardamos los retiros ahora)
      await updateDoc(doc(db, 'recharge_requests', request.id), { status: approved ? 'APPROVED' : 'REJECTED' });
  }

  const saveSettings = async () => {
      try {
          await updateDoc(doc(db, 'admin_settings', 'global_config'), { ...settings });
          alert("Configuración guardada exitosamente.");
      } catch (error) {
          console.error("Error saving settings:", error);
          alert("Error al guardar configuración.");
      }
  };

  const handleQrUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'yape' | 'plin') => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsUploadingQr(true);
      try {
          const base64 = await compressImage(file);
          setSettings(prev => ({
              ...prev,
              [type === 'yape' ? 'yapeQrUrl' : 'plinQrUrl']: base64
          }));
      } catch (error) {
          console.error("Error uploading QR", error);
          alert("Error al procesar la imagen");
      } finally {
          setIsUploadingQr(false);
          if (e.target) e.target.value = ''; 
      }
  };

  // --- LOGIC FOR APPROVING DRIVERS ---
  const handleApproveDriver = async (driver: Driver) => {
      setIsProcessing(true);
      try {
          // Actualizamos status a OFFLINE para que pueda loguearse y Verification a VERIFIED
          await updateDoc(doc(db, "drivers", driver.id), {
              verificationStatus: 'VERIFIED',
              status: 'OFFLINE' 
          });
          setDriverToApprove(null);
      } catch (e: any) {
          console.error(e);
          alert(`Error al aprobar: ${e.message}. Verifica permisos.`);
      } finally {
          setIsProcessing(false);
      }
  }

  const handleRejectDriver = async (driver: Driver) => {
      setIsProcessing(true);
      try {
          console.log("Intentando eliminar conductor:", driver.id);
          await onRemoveDriver(driver.id);
          setDriverToApprove(null);
          console.log("Conductor eliminado correctamente");
      } catch (e: any) {
          console.error("Error eliminando:", e);
          alert(`Error eliminando solicitud: ${e.message}`);
      } finally {
          setIsProcessing(false);
      }
  }

  // --- LÓGICA ELIMINACIÓN SEGURA (DOBLE CLICK) ---
  const handleDeleteClick = async (id: string, type: 'DRIVER' | 'CLIENT') => {
      if (deleteConfirmationId === id) {
          // Confirmado, ejecutar
          setIsDeleting(true);
          try {
              if (type === 'DRIVER') {
                  await onRemoveDriver(id);
              } else if (onRemoveClient) {
                  await onRemoveClient(id);
              }
          } catch (error) {
              console.error("Error eliminando", error);
              alert("Error al eliminar usuario.");
          } finally {
              setIsDeleting(false);
              setDeleteConfirmationId(null);
          }
      } else {
          // Primer click, pedir confirmación
          setDeleteConfirmationId(id);
          // Auto-cancelar después de 3 segundos
          setTimeout(() => setDeleteConfirmationId(prev => prev === id ? null : prev), 3000);
      }
  };

  // --- EXPORT FUNCTIONS ---
  const handleExportXML = () => {
      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Transactions>\n';
      
      // Drivers Section
      xml += '  <Drivers>\n';
      // Driver Recharges
      rechargeRequests.filter(r => r.userType === 'DRIVER').forEach(r => {
          xml += `    <Transaction>\n`;
          xml += `      <Type>Recarga</Type>\n`;
          xml += `      <Id>${r.id}</Id>\n`;
          xml += `      <Name>${r.userName}</Name>\n`;
          xml += `      <Amount>${r.amount}</Amount>\n`;
          xml += `      <Credits>${r.creditsRequested}</Credits>\n`;
          xml += `      <Date>${new Date(r.timestamp).toISOString()}</Date>\n`;
          xml += `      <Status>${r.status}</Status>\n`;
          xml += `    </Transaction>\n`;
      });
      // Driver Withdrawals
      withdrawalRequests.forEach(w => {
          xml += `    <Transaction>\n`;
          xml += `      <Type>Retiro</Type>\n`;
          xml += `      <Id>${w.id}</Id>\n`;
          xml += `      <Name>${w.driverName}</Name>\n`;
          xml += `      <Amount>${w.amount}</Amount>\n`;
          xml += `      <Date>${new Date(w.timestamp).toISOString()}</Date>\n`;
          xml += `      <Status>${w.status}</Status>\n`;
          xml += `    </Transaction>\n`;
      });
      xml += '  </Drivers>\n';

      // Clients Section
      xml += '  <Clients>\n';
      rechargeRequests.filter(r => r.userType === 'CLIENT').forEach(r => {
          xml += `    <Transaction>\n`;
          xml += `      <Type>Recarga</Type>\n`;
          xml += `      <Id>${r.id}</Id>\n`;
          xml += `      <Name>${r.userName}</Name>\n`;
          xml += `      <Amount>${r.amount}</Amount>\n`;
          xml += `      <Credits>${r.creditsRequested}</Credits>\n`;
          xml += `      <Date>${new Date(r.timestamp).toISOString()}</Date>\n`;
          xml += `      <Status>${r.status}</Status>\n`;
          xml += `    </Transaction>\n`;
      });
      xml += '  </Clients>\n';
      
      xml += '</Transactions>';

      const blob = new Blob([xml], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reporte_pagos_${new Date().toISOString().split('T')[0]}.xml`;
      a.click();
  };

  const handleExportExcelStyled = () => {
      // 1. Filter Data
      const driverRecharges = rechargeRequests.filter(r => r.userType === 'DRIVER');
      const clientRecharges = rechargeRequests.filter(r => r.userType === 'CLIENT');
      // Withdrawals are only for drivers currently
      const driverWithdrawals = withdrawalRequests;

      // Combine Driver Transactions (Recharges + Withdrawals)
      const driverTransactions = [
          ...driverRecharges.map(r => ({
              id: r.id,
              type: 'Recarga',
              name: r.userName,
              amount: r.amount,
              credits: r.creditsRequested,
              date: new Date(r.timestamp).toLocaleString(),
              status: r.status
          })),
          ...driverWithdrawals.map(w => ({
              id: w.id,
              type: 'Retiro',
              name: w.driverName,
              amount: w.amount,
              credits: 0, 
              date: new Date(w.timestamp).toLocaleString(),
              status: w.status
          }))
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      const clientTransactions = clientRecharges.map(r => ({
          id: r.id,
          type: 'Recarga',
          name: r.userName,
          amount: r.amount,
          credits: r.creditsRequested,
          date: new Date(r.timestamp).toLocaleString(),
          status: r.status
      })).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      // 2. Build HTML for Excel
      // Usamos una sola tabla para asegurar que todo se vea en la misma hoja y ordenado
      let html = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Arial', sans-serif; font-size: 12px; }
            table { border-collapse: collapse; width: 100%; }
            td, th { border: 1px solid #e2e8f0; padding: 8px; text-align: left; vertical-align: middle; }
            .status-approved { color: #15803d; } /* Green 700 */
            .status-pending { color: #b45309; } /* Amber 700 */
            .status-rejected { color: #b91c1c; } /* Red 700 */
            .amount { font-family: monospace; }
        </style>
        </head>
        <body>
            <table>
                <!-- TITLE -->
                <tr>
                    <td colspan="7" style="font-size: 16px; font-weight: bold; border: none; padding: 20px 0 10px 0;">
                        Reporte de Tesorería - VentoDrive
                    </td>
                </tr>
                <tr>
                    <td colspan="7" style="color: #64748b; border: none; padding-bottom: 20px;">
                        Generado el: ${new Date().toLocaleString()}
                    </td>
                </tr>

                <!-- CLIENTS SECTION (FIRST) -->
                <tr>
                    <td colspan="7" style="background-color: #4f46e5; color: white; font-weight: bold; font-size: 14px; padding: 10px;">
                        CLIENTES (Recargas de Saldo)
                    </td>
                </tr>
                <tr>
                    <th style="background-color: #312e81; color: white;">ID Transacción</th>
                    <th style="background-color: #312e81; color: white;">Tipo</th>
                    <th style="background-color: #312e81; color: white;">Cliente</th>
                    <th style="background-color: #312e81; color: white;">Monto Pagado (S/)</th>
                    <th style="background-color: #312e81; color: white;">Saldo Recibido (S/)</th>
                    <th style="background-color: #312e81; color: white;">Fecha</th>
                    <th style="background-color: #312e81; color: white;">Estado</th>
                </tr>
                ${clientTransactions.map(t => `
                    <tr>
                        <td>${t.id}</td>
                        <td>${t.type}</td>
                        <td>${t.name}</td>
                        <td class="amount">S/ ${t.amount.toFixed(2)}</td>
                        <td>S/ ${t.credits.toFixed(2)}</td>
                        <td>${t.date}</td>
                        <td class="${t.status === 'APPROVED' ? 'status-approved' : t.status === 'PENDING' ? 'status-pending' : 'status-rejected'}">${t.status}</td>
                    </tr>
                `).join('')}

                <!-- SPACER -->
                <tr><td colspan="7" style="border: none; height: 30px;"></td></tr>

                <!-- DRIVERS SECTION (SECOND) -->
                <tr>
                    <td colspan="7" style="background-color: #0f172a; color: white; font-weight: bold; font-size: 14px; padding: 10px;">
                        CONDUCTORES (Recargas y Retiros)
                    </td>
                </tr>
                <tr>
                    <th style="background-color: #1e293b; color: white;">ID Transacción</th>
                    <th style="background-color: #1e293b; color: white;">Tipo</th>
                    <th style="background-color: #1e293b; color: white;">Conductor</th>
                    <th style="background-color: #1e293b; color: white;">Monto (S/)</th>
                    <th style="background-color: #1e293b; color: white;">Créditos / Saldo</th>
                    <th style="background-color: #1e293b; color: white;">Fecha</th>
                    <th style="background-color: #1e293b; color: white;">Estado</th>
                </tr>
                ${driverTransactions.map(t => `
                    <tr>
                        <td>${t.id}</td>
                        <td>${t.type}</td>
                        <td>${t.name}</td>
                        <td class="amount">S/ ${t.amount.toFixed(2)}</td>
                        <td>${t.credits}</td>
                        <td>${t.date}</td>
                        <td class="${t.status === 'APPROVED' ? 'status-approved' : t.status === 'PENDING' ? 'status-pending' : 'status-rejected'}">${t.status}</td>
                    </tr>
                `).join('')}
            </table>
        </body>
        </html>
      `;

      const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Reporte_Tesorería_Vento_${new Date().toISOString().split('T')[0]}.xls`;
      a.click();
  };

  // Filter Logic
  // Separate lists for Drivers
  const activeDrivers = drivers.filter(d => 
      (d.verificationStatus === 'VERIFIED' || !d.verificationStatus) &&
      (d.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      (d.phone && d.phone.includes(searchTerm)) ||
      (d.plates && d.plates.toLowerCase().includes(searchTerm.toLowerCase())))
  );

  const pendingDrivers = drivers.filter(d => d.verificationStatus === 'PENDING');

  const filteredClients = clients.filter(c => 
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      (c.phone && c.phone.includes(searchTerm))
  );

  return (
    <div className="h-[100dvh] bg-slate-950 text-white flex flex-col overflow-hidden relative">
      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-800 p-4 flex justify-between items-center shrink-0 z-40">
        <div>
           <h2 className="text-xl font-bold flex items-center gap-2">
             <span className="bg-yellow-500 text-black px-2 py-0.5 rounded text-sm">ADMIN</span>
             Panel
           </h2>
        </div>
        <button onClick={onLogout} className="p-2 bg-slate-800 rounded-full hover:bg-slate-700 text-red-400">
           <LogOut className="w-5 h-5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-900 border-b border-slate-800 shrink-0 overflow-x-auto no-scrollbar">
          <button onClick={() => setActiveTab('DRIVERS')} className={`relative flex-1 min-w-[80px] py-4 font-bold text-sm flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 ${activeTab === 'DRIVERS' ? 'text-yellow-400 border-b-2 border-yellow-400' : 'text-slate-500'}`}>
              <Bike className="w-4 h-4"/> 
              <span className="text-xs sm:text-sm">Motos</span>
              {pendingDrivers.length > 0 && <span className="absolute top-2 right-2 bg-red-500 text-white text-[9px] w-4 h-4 flex items-center justify-center rounded-full">{pendingDrivers.length}</span>}
          </button>
          <button onClick={() => setActiveTab('CLIENTS')} className={`flex-1 min-w-[80px] py-4 font-bold text-sm flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 ${activeTab === 'CLIENTS' ? 'text-yellow-400 border-b-2 border-yellow-400' : 'text-slate-500'}`}>
              <Users className="w-4 h-4"/> <span className="text-xs sm:text-sm">Clients</span>
          </button>
          <button onClick={() => setActiveTab('TREASURY')} className={`relative flex-1 min-w-[80px] py-4 font-bold text-sm flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 ${activeTab === 'TREASURY' ? 'text-yellow-400 border-b-2 border-yellow-400' : 'text-slate-500'}`}>
              <DollarSign className="w-4 h-4"/> 
              <span className="text-xs sm:text-sm">Pagos</span>
              {rechargeRequests.filter(r => r.status === 'PENDING').length > 0 && (
                  <span className="absolute top-2 right-2 bg-red-500 text-white text-[9px] w-4 h-4 flex items-center justify-center rounded-full">
                      {rechargeRequests.filter(r => r.status === 'PENDING').length}
                  </span>
              )}
          </button>
          <button onClick={() => setActiveTab('SETTINGS')} className={`flex-1 min-w-[80px] py-4 font-bold text-sm flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 ${activeTab === 'SETTINGS' ? 'text-yellow-400 border-b-2 border-yellow-400' : 'text-slate-500'}`}>
              <Settings className="w-4 h-4"/> <span className="text-xs sm:text-sm">Config</span>
          </button>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 pb-24 max-w-5xl mx-auto w-full overflow-y-auto no-scrollbar">
        
        {/* TAB: DRIVERS */}
        {activeTab === 'DRIVERS' && (
            <div className="space-y-3">
              
              {/* DRIVER SUB-TABS */}
              <div className="flex bg-slate-900 border border-slate-800 p-1 rounded-xl mb-4 w-full sm:w-80">
                  <button 
                      onClick={() => setSubTabDriver('ACTIVE')} 
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${subTabDriver === 'ACTIVE' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}
                  >
                      Activos ({activeDrivers.length})
                  </button>
                  <button 
                      onClick={() => setSubTabDriver('REQUESTS')} 
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2 ${subTabDriver === 'REQUESTS' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}
                  >
                      Solicitudes
                      {pendingDrivers.length > 0 && <span className="bg-red-500 text-white px-1.5 py-0.5 rounded-full text-[9px]">{pendingDrivers.length}</span>}
                  </button>
              </div>

              {/* SEARCH (ONLY FOR ACTIVE) */}
              {subTabDriver === 'ACTIVE' && (
                <div className="relative mb-4">
                    <Search className="absolute left-3 top-3 w-5 h-5 text-slate-500"/>
                    <input 
                        type="text" 
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Buscar conductor por nombre, placa o teléfono..."
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl py-3 pl-10 text-white focus:border-yellow-500 outline-none"
                    />
                </div>
              )}

              {/* LIST: ACTIVE */}
              {subTabDriver === 'ACTIVE' && activeDrivers.map(driver => (
                <div key={driver.id} className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-center gap-4 flex-1">
                      <img src={driver.photoUrl} alt="avatar" className="w-12 h-12 rounded-full object-cover border border-slate-700" />
                      <div>
                        <div className="flex items-center gap-2">
                            <h4 className="font-bold text-white">{driver.name}</h4>
                            <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-yellow-400 border border-slate-700">{driver.category}</span>
                        </div>
                        <p className="text-xs text-slate-400">{driver.bikeModel} • {driver.plates}</p>
                      </div>
                  </div>
                  
                  <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto border-t sm:border-t-0 border-slate-800 pt-3 sm:pt-0">
                       <div className="text-right">
                           <p className="text-[10px] text-slate-500 uppercase font-bold">Créditos</p>
                           <p className={`font-mono font-bold text-lg ${(driver.credits || 0) < 2 ? 'text-red-400' : 'text-green-400'}`}>
                               {(driver.credits || 0).toFixed(2)}
                           </p>
                       </div>
                       
                       <button 
                         onClick={() => { setSelectedDriver(driver); setManualAmount(''); }}
                         className="px-4 py-2 bg-slate-800 text-white rounded-lg text-xs font-bold hover:bg-slate-700 flex items-center gap-2"
                       >
                           <Settings className="w-4 h-4" />
                       </button>

                       <button 
                            onClick={() => handleDeleteClick(driver.id, 'DRIVER')}
                            disabled={isDeleting && deleteConfirmationId === driver.id}
                            className={`p-2 transition-all rounded-lg flex items-center justify-center ${deleteConfirmationId === driver.id ? 'bg-red-500 text-white w-24' : 'text-slate-500 hover:text-red-400'}`}
                        >
                            {deleteConfirmationId === driver.id ? (
                                isDeleting ? <Loader className="w-4 h-4 animate-spin"/> : <span className="text-[10px] font-bold">¿CONFIRMAR?</span>
                            ) : (
                                <Trash2 className="w-5 h-5" />
                            )}
                        </button>
                  </div>
                </div>
              ))}

              {/* LIST: PENDING REQUESTS */}
              {subTabDriver === 'REQUESTS' && pendingDrivers.map(driver => (
                  <div 
                    key={driver.id} 
                    onClick={() => setDriverToApprove(driver)}
                    className="bg-slate-900 border border-yellow-500/30 p-4 rounded-xl flex items-center justify-between cursor-pointer hover:bg-slate-800/50 transition-colors group"
                  >
                      <div className="flex items-center gap-4">
                          <div className="relative">
                              <img src={driver.photoUrl} className="w-12 h-12 rounded-full object-cover border-2 border-yellow-500/50" />
                              <div className="absolute -top-1 -right-1 bg-red-500 w-3 h-3 rounded-full animate-ping"></div>
                              <div className="absolute -top-1 -right-1 bg-red-500 w-3 h-3 rounded-full border border-slate-900"></div>
                          </div>
                          <div>
                              <h4 className="font-bold text-white group-hover:text-yellow-400 transition-colors">{driver.name}</h4>
                              <p className="text-xs text-slate-400 flex items-center gap-1">
                                  <Clock className="w-3 h-3"/> Esperando aprobación
                              </p>
                          </div>
                      </div>
                      <div className="text-right">
                          <span className="bg-yellow-500 text-black text-xs font-bold px-3 py-1 rounded-full">Revisar</span>
                      </div>
                  </div>
              ))}
              
              {subTabDriver === 'REQUESTS' && pendingDrivers.length === 0 && (
                  <div className="text-center py-10 text-slate-500">
                      <p className="text-sm">No hay nuevas solicitudes de registro.</p>
                  </div>
              )}

            </div>
        )}

        {/* TAB: CLIENTS */}
        {activeTab === 'CLIENTS' && (
            <div className="space-y-3">
              <div className="relative mb-4">
                  <Search className="absolute left-3 top-3 w-5 h-5 text-slate-500"/>
                  <input 
                    type="text" 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar cliente por nombre o teléfono..."
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl py-3 pl-10 text-white focus:border-yellow-500 outline-none"
                  />
              </div>

              {filteredClients.map(client => (
                <div key={client.id} className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                      <div className="relative">
                          <img src={client.photoUrl} alt="avatar" className="w-12 h-12 rounded-full object-cover border border-slate-700" />
                          <div className="absolute -bottom-1 -right-1 bg-slate-800 p-0.5 rounded-full"><User className="w-3 h-3 text-slate-400"/></div>
                      </div>
                      <div>
                          <h4 className="font-bold text-white">{client.name}</h4>
                          <p className="text-xs text-slate-400">{client.phone || 'Sin teléfono'}</p>
                      </div>
                  </div>
                  
                  <div className="flex items-center gap-6">
                       <div className="text-right hidden sm:block">
                           <p className="text-[10px] text-slate-500 uppercase font-bold">Saldo Wallet</p>
                           <p className="font-mono font-bold text-lg text-white">
                               S/ {(client.walletBalance || 0).toFixed(2)}
                           </p>
                       </div>

                       <button 
                            onClick={() => handleDeleteClick(client.id, 'CLIENT')}
                            disabled={isDeleting && deleteConfirmationId === client.id}
                            className={`p-2 transition-all rounded-lg flex items-center justify-center bg-slate-800 ${deleteConfirmationId === client.id ? 'bg-red-500 text-white w-24' : 'text-slate-500 hover:text-red-400'}`}
                        >
                            {deleteConfirmationId === client.id ? (
                                isDeleting ? <Loader className="w-4 h-4 animate-spin"/> : <span className="text-[10px] font-bold">¿CONFIRMAR?</span>
                            ) : (
                                <Trash2 className="w-5 h-5" />
                            )}
                        </button>
                  </div>
                </div>
              ))}
              {filteredClients.length === 0 && (
                  <div className="text-center py-10 text-slate-500 text-sm">No se encontraron clientes.</div>
              )}
            </div>
        )}

        {/* TAB: TREASURY (Consolidated) */}
        {activeTab === 'TREASURY' && (
            <div className="space-y-6">
                
                {/* EXPORT BUTTONS */}
                <div className="flex flex-wrap gap-2 justify-end mb-4">
                    <button onClick={handleExportXML} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors">
                        <Download className="w-4 h-4 text-yellow-400" /> Exportar XML
                    </button>
                    <button onClick={handleExportExcelStyled} className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors">
                        <FileSpreadsheet className="w-4 h-4" /> Exportar Excel
                    </button>
                </div>

                {/* WITHDRAWALS SECTION */}
                <div>
                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                        <ArrowUpRight className="w-5 h-5 text-red-400"/> Solicitudes de Retiro
                    </h3>
                    <div className="space-y-3">
                        {withdrawalRequests.length === 0 && <p className="text-slate-500 text-sm italic">No hay retiros pendientes.</p>}
                        {withdrawalRequests.map(req => (
                            <div key={req.id} className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col md:flex-row gap-4 items-start md:items-center">
                                <div className="flex-1">
                                    <h4 className="font-bold text-white">{req.driverName}</h4>
                                    <p className="text-slate-400 text-xs">Monto a Retirar: <span className="text-yellow-400 font-bold text-lg">S/ {req.amount.toFixed(2)}</span></p>
                                    <p className="text-[10px] text-slate-600">{new Date(req.timestamp).toLocaleString()}</p>
                                </div>
                                <div 
                                    onClick={() => setViewingImage(req.qrUrl)}
                                    className="bg-white p-1 rounded-xl w-20 h-20 shrink-0 cursor-zoom-in hover:border-2 hover:border-yellow-400 transition-all flex items-center justify-center relative group"
                                >
                                    <img src={req.qrUrl} className="w-full h-full object-contain" />
                                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-xl transition-opacity">
                                        <ZoomIn className="w-6 h-6 text-white drop-shadow-md" />
                                    </div>
                                </div>
                                <div className="flex flex-col gap-2 w-full md:w-32">
                                    {req.status === 'PENDING' ? (
                                        <>
                                            <button onClick={() => handleProcessWithdrawal(req, true)} className="bg-green-500 text-black py-2 rounded font-bold text-xs hover:bg-green-400">Pagado</button>
                                            <button onClick={() => handleProcessWithdrawal(req, false)} className="bg-slate-800 text-slate-300 py-2 rounded font-bold text-xs hover:bg-slate-700">Rechazar</button>
                                        </>
                                    ) : (
                                        <span className={`text-center text-xs font-bold py-1 px-2 rounded ${req.status === 'APPROVED' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>{req.status === 'APPROVED' ? 'PAGADO' : 'RECHAZADO'}</span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="w-full h-px bg-slate-800"></div>

                {/* RECHARGES SECTION */}
                <div>
                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                         <ArrowDownLeft className="w-5 h-5 text-green-400"/> Solicitudes de Recarga
                    </h3>
                    <div className="space-y-3">
                        {filteredRecharges.length === 0 && <p className="text-slate-500 text-sm italic">No hay recargas pendientes.</p>}
                        {filteredRecharges.map(req => (
                            <div key={req.id} className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col md:flex-row gap-4 items-start md:items-center">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`text-[9px] font-black px-1.5 rounded uppercase ${req.userType === 'DRIVER' ? 'bg-blue-500 text-white' : 'bg-purple-500 text-white'}`}>{req.userType === 'DRIVER' ? 'CONDUCTOR' : 'CLIENTE'}</span>
                                        <h4 className="font-bold text-white text-sm">{req.userName}</h4>
                                    </div>
                                    <p className="text-slate-400 text-xs">Monto: <span className="text-white font-bold">S/ {req.amount}</span> → Recibe: <span className="text-green-400 font-bold">{req.creditsRequested} {req.userType === 'DRIVER' ? 'Créditos' : 'Soles'}</span></p>
                                    <p className="text-[10px] text-slate-600">{new Date(req.timestamp).toLocaleString()}</p>
                                </div>
                                <div 
                                    onClick={() => setViewingImage(req.proofUrl)}
                                    className="bg-slate-950 border border-slate-800 p-1 rounded-xl w-20 h-20 shrink-0 flex items-center justify-center overflow-hidden cursor-zoom-in hover:border-yellow-400 transition-all relative group"
                                >
                                    <img src={req.proofUrl} className="w-full h-full object-cover" />
                                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-xl transition-opacity">
                                        <ZoomIn className="w-6 h-6 text-white drop-shadow-md" />
                                    </div>
                                </div>
                                <div className="flex flex-col gap-2 w-full md:w-32">
                                    {req.status === 'PENDING' ? (
                                        <>
                                            <button onClick={() => handleProcessRecharge(req, true)} className="bg-yellow-500 text-black py-2 rounded font-bold text-xs hover:bg-yellow-400">Aprobar</button>
                                            <button onClick={() => handleProcessRecharge(req, false)} className="bg-slate-800 text-slate-300 py-2 rounded font-bold text-xs hover:bg-slate-700">Rechazar</button>
                                        </>
                                    ) : (
                                        <span className={`text-center text-xs font-bold py-1 px-2 rounded ${req.status === 'APPROVED' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>{req.status === 'APPROVED' ? 'APROBADO' : 'RECHAZADO'}</span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

            </div>
        )}

        {/* TAB: SETTINGS */}
        {activeTab === 'SETTINGS' && (
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl space-y-8 animate-in fade-in">
                
                {/* 1. CONFIGURACIÓN DE NEGOCIO (TARIFAS) */}
                <div>
                    <h3 className="font-bold text-lg mb-4 text-white flex items-center gap-2">
                        <DollarSign className="w-5 h-5 text-yellow-400"/> Configuración de Negocio
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                             <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Tarifa Base por KM</label>
                             <div className="relative">
                                 <span className="absolute left-3 top-3 text-slate-500 font-bold">S/</span>
                                 <input 
                                    type="number" 
                                    step="0.10"
                                    value={settings.baseRatePerKm}
                                    onChange={e => setSettings({...settings, baseRatePerKm: parseFloat(e.target.value)})}
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg py-2 pl-8 pr-3 text-white focus:border-yellow-500 outline-none font-mono"
                                 />
                             </div>
                             <p className="text-[10px] text-slate-500 mt-2">Precio sugerido por kilómetro al cliente.</p>
                        </div>
                    </div>
                </div>

                {/* 2. PROMO CLIENTES (CASHBACK) */}
                <div>
                    <h3 className="font-bold text-lg mb-4 text-white flex items-center gap-2">
                        <User className="w-5 h-5 text-blue-400"/> Promoción Clientes (Cashback)
                    </h3>
                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-4">
                         <div className="flex justify-between items-center">
                             <div>
                                 <p className="font-bold text-sm text-white">Activar Cashback en Viajes</p>
                                 <p className="text-[10px] text-slate-500">Devuelve un porcentaje del viaje al saldo del cliente.</p>
                             </div>
                             <button 
                                onClick={() => setSettings({...settings, enableClientCashback: !settings.enableClientCashback})}
                                className={`w-12 h-6 rounded-full relative transition-colors ${settings.enableClientCashback ? 'bg-green-500' : 'bg-slate-700'}`}
                             >
                                 <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${settings.enableClientCashback ? 'left-7' : 'left-1'}`}></div>
                             </button>
                         </div>

                         {settings.enableClientCashback && (
                             <div className="pt-4 border-t border-slate-800">
                                 <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Porcentaje de Devolución</label>
                                 <div className="flex items-center gap-4">
                                     <div className="relative w-32">
                                         <input 
                                            type="number" 
                                            step="1"
                                            min="1"
                                            max="100"
                                            value={(settings.clientCashbackPercent * 100).toFixed(0)}
                                            onChange={e => setSettings({...settings, clientCashbackPercent: parseFloat(e.target.value) / 100})}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg py-2 pl-3 pr-8 text-white focus:border-blue-500 outline-none font-mono"
                                         />
                                         <Percent className="absolute right-2 top-2.5 w-4 h-4 text-slate-500"/>
                                     </div>
                                     <span className="text-xs text-slate-500 font-medium">Del valor del viaje</span>
                                 </div>
                             </div>
                         )}
                    </div>
                </div>

                {/* 3. PROMO CONDUCTORES (BONO RECARGA) */}
                <div>
                    <h3 className="font-bold text-lg mb-4 text-white flex items-center gap-2">
                        <Bike className="w-5 h-5 text-green-400"/> Promoción Conductores (Bono)
                    </h3>
                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-4">
                         <div className="flex justify-between items-center">
                             <div>
                                 <p className="font-bold text-sm text-white">Activar Bono por Recarga</p>
                                 <p className="text-[10px] text-slate-500">Regala créditos extra al recargar un monto alto.</p>
                             </div>
                             <button 
                                onClick={() => setSettings({...settings, enableDriverBonus: !settings.enableDriverBonus})}
                                className={`w-12 h-6 rounded-full relative transition-colors ${settings.enableDriverBonus ? 'bg-green-500' : 'bg-slate-700'}`}
                             >
                                 <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${settings.enableDriverBonus ? 'left-7' : 'left-1'}`}></div>
                             </button>
                         </div>

                         {settings.enableDriverBonus && (
                             <div className="pt-4 border-t border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-6">
                                 <div>
                                     <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Monto Mínimo (Umbral)</label>
                                     <div className="relative">
                                         <span className="absolute left-3 top-3 text-slate-500 font-bold">S/</span>
                                         <input 
                                            type="number" 
                                            value={settings.driverBonusThreshold}
                                            onChange={e => setSettings({...settings, driverBonusThreshold: parseFloat(e.target.value)})}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg py-2 pl-8 pr-3 text-white focus:border-green-500 outline-none font-mono"
                                         />
                                     </div>
                                 </div>
                                 <div>
                                     <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Porcentaje Extra (Bono)</label>
                                     <div className="relative">
                                         <input 
                                            type="number" 
                                            step="1"
                                            value={(settings.driverBonusPercent * 100).toFixed(0)}
                                            onChange={e => setSettings({...settings, driverBonusPercent: parseFloat(e.target.value) / 100})}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg py-2 pl-3 pr-8 text-white focus:border-green-500 outline-none font-mono"
                                         />
                                         <Percent className="absolute right-3 top-2.5 w-4 h-4 text-slate-500"/>
                                     </div>
                                 </div>
                             </div>
                         )}
                    </div>
                </div>

                <div className="w-full h-px bg-slate-800 my-4"></div>

                {/* 4. MEDIOS DE PAGO Y CONTACTO */}
                <div>
                    <h3 className="font-bold text-lg mb-4 text-white">Códigos QR de Pago</h3>
                    <div className="grid grid-cols-2 gap-6 mb-6">
                        {/* YAPE INPUT */}
                        <div>
                            <input type="file" ref={yapeInputRef} className="hidden" accept="image/*" onChange={(e) => handleQrUpload(e, 'yape')} />
                            <p className="text-sm font-bold text-purple-400 mb-2">YAPE</p>
                            <div 
                                onClick={() => !isUploadingQr && yapeInputRef.current?.click()} 
                                className="border-2 border-dashed border-slate-700 rounded-xl h-40 flex flex-col items-center justify-center cursor-pointer hover:border-purple-500 transition-colors bg-slate-950 relative overflow-hidden"
                            >
                                {isUploadingQr ? (
                                    <div className="flex flex-col items-center">
                                        <Loader className="w-5 h-5 animate-spin text-purple-500 mb-1"/>
                                        <span className="text-[10px] text-purple-500">Subiendo...</span>
                                    </div>
                                ) : settings.yapeQrUrl ? (
                                    <img src={settings.yapeQrUrl} className="h-32 object-contain" />
                                ) : (
                                    <><Upload className="w-6 h-6 mb-2"/><span className="text-xs">Subir QR Yape</span></>
                                )}
                            </div>
                        </div>

                        {/* PLIN INPUT */}
                        <div>
                            <input type="file" ref={plinInputRef} className="hidden" accept="image/*" onChange={(e) => handleQrUpload(e, 'plin')} />
                            <p className="text-sm font-bold text-pink-400 mb-2">PLIN</p>
                            <div 
                                onClick={() => !isUploadingQr && plinInputRef.current?.click()} 
                                className="border-2 border-dashed border-slate-700 rounded-xl h-40 flex flex-col items-center justify-center cursor-pointer hover:border-pink-500 transition-colors bg-slate-950 relative overflow-hidden"
                            >
                                {isUploadingQr ? (
                                    <div className="flex flex-col items-center">
                                        <Loader className="w-5 h-5 animate-spin text-pink-500 mb-1"/>
                                        <span className="text-[10px] text-pink-500">Subiendo...</span>
                                    </div>
                                ) : settings.plinQrUrl ? (
                                    <img src={settings.plinQrUrl} className="h-32 object-contain" />
                                ) : (
                                    <><Upload className="w-6 h-6 mb-2"/><span className="text-xs">Subir QR Plin</span></>
                                )}
                            </div>
                        </div>
                    </div>
                    
                    <h3 className="font-bold text-lg mb-2 text-white">Soporte WhatsApp</h3>
                    <p className="text-slate-400 text-xs mb-2">Número al que serán redirigidos los conductores.</p>
                    <div className="relative">
                        <Phone className="absolute left-3 top-3 w-5 h-5 text-slate-500"/>
                        <input 
                            type="text" 
                            value={settings.supportPhone} 
                            onChange={e => setSettings({...settings, supportPhone: e.target.value})}
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-10 text-white"
                            placeholder="Ej: 51999999999"
                        />
                    </div>
                </div>

                <div className="mt-6 pt-6 border-t border-slate-800">
                    <button onClick={saveSettings} className="w-full bg-yellow-400 text-black font-bold py-4 rounded-xl hover:bg-yellow-300 shadow-lg shadow-yellow-400/20 active:scale-95 transition-transform">
                        GUARDAR CONFIGURACIÓN
                    </button>
                </div>
            </div>
        )}

      </div>

      {/* MODAL: APROBACIÓN DE CONDUCTOR */}
      {driverToApprove && (
          <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
              <div className="bg-slate-900 w-full max-w-2xl rounded-2xl border border-slate-800 shadow-2xl overflow-hidden animate-in zoom-in-95 max-h-[90vh] flex flex-col">
                  <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-800/50">
                      <h3 className="font-bold text-white flex items-center gap-2 text-sm uppercase tracking-wider">
                          <CheckCircle className="w-4 h-4 text-yellow-400"/> Aprobar Registro
                      </h3>
                      <button onClick={() => setDriverToApprove(null)} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 transition-colors"><X className="w-5 h-5"/></button>
                  </div>

                  <div className="overflow-y-auto p-6 flex-1 custom-scrollbar">
                      {/* PERFIL */}
                      <div className="flex flex-col items-center mb-8">
                          <div className="w-24 h-24 mb-4 relative">
                               <img 
                                src={driverToApprove.photoUrl} 
                                className="w-full h-full rounded-full object-cover border-4 border-slate-800 shadow-xl cursor-zoom-in hover:opacity-90 transition-opacity"
                                onClick={() => setViewingImage(driverToApprove.photoUrl)} 
                               />
                               <div className="absolute bottom-0 right-0 bg-yellow-500 text-black text-[10px] font-bold px-2 py-0.5 rounded-full border border-slate-900">
                                   PENDIENTE
                               </div>
                          </div>
                          
                          <h2 className="text-2xl font-bold text-white mb-1">{driverToApprove.name}</h2>
                          <p className="text-slate-400 text-sm font-mono mb-6">{driverToApprove.phone}</p>

                          <div className="grid grid-cols-2 gap-3 w-full max-w-md">
                              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col items-center">
                                  <span className="text-[10px] text-slate-500 uppercase font-bold mb-1">Modelo</span>
                                  <span className="text-white font-medium text-sm text-center">{driverToApprove.bikeModel}</span>
                              </div>
                              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col items-center">
                                  <span className="text-[10px] text-slate-500 uppercase font-bold mb-1">Placa</span>
                                  <span className="text-yellow-400 font-bold text-sm text-center tracking-wider">{driverToApprove.plates}</span>
                              </div>
                              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col items-center col-span-2">
                                  <span className="text-[10px] text-slate-500 uppercase font-bold mb-1">Email (ID)</span>
                                  <span className="text-slate-300 text-xs text-center break-all">{driverToApprove.id}</span>
                              </div>
                          </div>
                      </div>

                      {/* DOCUMENTOS */}
                      <div className="space-y-4">
                          <h4 className="text-white text-xs font-bold uppercase tracking-wider flex items-center gap-2 pb-2 border-b border-slate-800">
                              <FileText className="w-4 h-4 text-blue-400"/> Documentación
                          </h4>
                          <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                  <p className="text-[10px] text-slate-500 font-bold uppercase text-center">Foto de Placa</p>
                                  <div 
                                    className="bg-black/50 rounded-lg overflow-hidden border border-slate-700 aspect-video flex items-center justify-center cursor-zoom-in group relative hover:border-slate-600 transition-colors"
                                    onClick={() => driverToApprove.plateUrl && setViewingImage(driverToApprove.plateUrl)}
                                  >
                                      {driverToApprove.plateUrl ? (
                                          <>
                                            <img src={driverToApprove.plateUrl} className="w-full h-full object-contain" />
                                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                <ZoomIn className="text-white w-6 h-6"/>
                                            </div>
                                          </>
                                      ) : <span className="text-[10px] text-slate-600">No adjuntado</span>}
                                  </div>
                              </div>
                              <div className="space-y-2">
                                  <p className="text-[10px] text-slate-500 font-bold uppercase text-center">Licencia</p>
                                  <div 
                                    className="bg-black/50 rounded-lg overflow-hidden border border-slate-700 aspect-video flex items-center justify-center cursor-zoom-in group relative hover:border-slate-600 transition-colors"
                                    onClick={() => driverToApprove.licenseUrl && setViewingImage(driverToApprove.licenseUrl)}
                                  >
                                      {driverToApprove.licenseUrl ? (
                                          <>
                                            <img src={driverToApprove.licenseUrl} className="w-full h-full object-contain" />
                                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                <ZoomIn className="text-white w-6 h-6"/>
                                            </div>
                                          </>
                                      ) : <span className="text-[10px] text-slate-600">No adjuntado</span>}
                                  </div>
                              </div>
                          </div>
                      </div>
                  </div>

                  <div className="p-4 bg-slate-900 border-t border-slate-800 flex gap-3">
                      <button 
                        type="button"
                        onClick={() => handleRejectDriver(driverToApprove)} 
                        disabled={isProcessing}
                        className="flex-1 py-3.5 bg-slate-800 text-slate-300 font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-red-900/20 hover:text-red-400 hover:border-red-900/50 border border-transparent transition-all disabled:opacity-50 flex justify-center items-center gap-2"
                      >
                          {isProcessing ? <Loader className="w-4 h-4 animate-spin" /> : (
                              <>
                                  <Trash2 className="w-4 h-4" />
                                  Rechazar
                              </>
                          )}
                      </button>
                      <button 
                        type="button"
                        onClick={() => handleApproveDriver(driverToApprove)} 
                        disabled={isProcessing}
                        className="flex-1 py-3.5 bg-yellow-500 text-black font-black text-xs uppercase tracking-wider rounded-xl hover:bg-yellow-400 transition-all shadow-lg shadow-yellow-500/10 disabled:opacity-50 flex justify-center items-center gap-2"
                      >
                          {isProcessing ? <Loader className="w-4 h-4 animate-spin" /> : (
                              <>
                                  <Check className="w-4 h-4" />
                                  Aprobar
                              </>
                          )}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* MODAL DE RECARGA MANUAL */}
      {selectedDriver && (
          <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
              <div className="bg-slate-900 w-full max-w-sm rounded-2xl border border-slate-800 shadow-2xl overflow-hidden animate-in zoom-in-95">
                  <div className="p-4 border-b border-slate-800 flex justify-between items-center">
                      <h3 className="font-bold text-white">Gestionar Saldo (Créditos)</h3>
                      <button onClick={() => setSelectedDriver(null)} className="p-1 hover:bg-slate-800 rounded-full text-slate-400"><X className="w-5 h-5"/></button>
                  </div>
                  
                  <div className="p-6">
                      <div className="flex items-center gap-3 mb-6">
                          <img src={selectedDriver.photoUrl} className="w-12 h-12 rounded-full border border-slate-700"/>
                          <div>
                              <p className="font-bold text-white">{selectedDriver.name}</p>
                              <p className="text-xs text-slate-400 font-mono">ID: {selectedDriver.id.slice(0,6)}...</p>
                          </div>
                      </div>

                      <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 mb-6 flex justify-between">
                           <div>
                               <p className="text-[10px] uppercase font-bold text-slate-500">Créditos Disp.</p>
                               <p className="text-xl font-mono text-white">{(selectedDriver.credits || 0).toFixed(2)}</p>
                           </div>
                           <div className="text-right">
                               <p className="text-[10px] uppercase font-bold text-slate-500">Ganancias</p>
                               <p className="text-xl font-mono text-yellow-400">{(selectedDriver.walletBalance || 0).toFixed(2)}</p>
                           </div>
                      </div>

                      <form onSubmit={handleManualRechargeSubmit}>
                          <label className="block text-xs font-bold text-slate-400 mb-2 uppercase">Ajustar Créditos Operativos</label>
                          <div className="relative mb-2">
                              <Wallet className="absolute left-3 top-3 w-5 h-5 text-slate-500" />
                              <input 
                                type="number" 
                                step="0.50"
                                value={manualAmount}
                                onChange={e => setManualAmount(e.target.value)}
                                placeholder="Ej: 20.00 o -5.00"
                                className="w-full bg-slate-800 border border-slate-700 rounded-xl py-3 pl-10 text-white font-mono focus:border-yellow-500 outline-none"
                                autoFocus
                              />
                          </div>
                          <p className="text-[10px] text-slate-500 mb-6">* Usa números negativos para restar saldo.</p>

                          <div className="flex gap-3">
                              <button type="button" onClick={() => setSelectedDriver(null)} className="flex-1 py-3 bg-slate-800 text-slate-300 rounded-xl font-bold text-sm">Cancelar</button>
                              <button type="submit" className="flex-1 py-3 bg-yellow-500 text-black rounded-xl font-bold text-sm hover:bg-yellow-400 shadow-lg shadow-yellow-500/20">Confirmar</button>
                          </div>
                      </form>
                  </div>
              </div>
          </div>
      )}

      {/* VISOR DE IMÁGENES (LIGHTBOX) */}
      {viewingImage && (
          <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in" onClick={() => setViewingImage(null)}>
              <div className="relative bg-slate-900 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col border border-slate-800" onClick={e => e.stopPropagation()}>
                  {/* Cabecera del Modal */}
                  <div className="flex justify-between items-center p-4 border-b border-slate-800">
                      <h3 className="text-white font-bold flex items-center gap-2">
                          <FileText className="w-5 h-5 text-yellow-400"/> Vista Previa
                      </h3>
                      <button onClick={() => setViewingImage(null)} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-full text-white transition-colors">
                          <X className="w-6 h-6" />
                      </button>
                  </div>
                  
                  {/* Contenedor de Imagen */}
                  <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-black/50 rounded-b-2xl">
                      <img 
                        src={viewingImage} 
                        className="max-w-full max-h-[75vh] object-contain rounded-lg shadow-lg border border-slate-800" 
                        alt="Comprobante ampliado" 
                      />
                  </div>
                  
                  {/* Footer Informativo */}
                  <div className="p-3 bg-slate-900 border-t border-slate-800 text-center text-xs text-slate-400 rounded-b-2xl">
                      Toca fuera de la imagen o el botón X para cerrar
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};

export default AdminDashboard;