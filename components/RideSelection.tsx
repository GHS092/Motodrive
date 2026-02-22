
import React, { useState, useEffect } from 'react';
import { RideOption, BikeCategory, RouteDetails, Driver, ServiceType, PaymentMethod, User, AdminSettings } from '../types';
import { Clock, Zap, Star, Check, CheckCircle2, Package, Bike, DollarSign, Edit3, Wallet } from 'lucide-react';

interface RideSelectionProps {
  options: RideOption[];
  onSelect: (option: RideOption) => void;
  selectedId: string | null;
  routeDetails: RouteDetails | null;
  onConfirm: (specificDriverId?: string, customFare?: number, serviceType?: ServiceType, note?: string, paymentMethod?: PaymentMethod) => void;
  onCancel: () => void;
  nearbyDrivers?: Driver[];
  userBalance: number;
  initialDriverId?: string | null; // Nuevo prop para pre-selección
  adminSettings?: AdminSettings; // New Prop for dynamic pricing
}

const RideSelection: React.FC<RideSelectionProps> = ({ 
  options, 
  onSelect, 
  selectedId, 
  routeDetails,
  onConfirm,
  onCancel,
  nearbyDrivers = [],
  userBalance,
  initialDriverId = null,
  adminSettings
}) => {
  // Inicializamos con el driver seleccionado en el mapa, si existe
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(initialDriverId);
  const [serviceMode, setServiceMode] = useState<ServiceType>('RIDE');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  
  // States for Delivery / Negotiation
  const [deliveryNote, setDeliveryNote] = useState('');
  const [customFare, setCustomFare] = useState<string>('');
  
  // Calculate suggested price
  const calculateSuggestedPrice = () => {
      if (!routeDetails || typeof routeDetails.distanceValue !== 'number' || isNaN(routeDetails.distanceValue)) {
          return 5.00;
      }
      // USE DYNAMIC RATE FROM SETTINGS OR DEFAULT TO 1.50
      const RATE = adminSettings?.baseRatePerKm || 1.50;
      const price = routeDetails.distanceValue * RATE;
      return Math.max(price, 5.00); 
  };

  const suggestedPrice = calculateSuggestedPrice();

  useEffect(() => {
      // Initialize custom fare with suggested price
      setCustomFare(suggestedPrice.toFixed(2));
  }, [suggestedPrice]);

  const handleConfirm = () => {
      const finalFare = parseFloat(customFare);
      
      if (serviceMode === 'DELIVERY') {
          if (!deliveryNote.trim()) {
              alert("Por favor detalla qué vamos a enviar en la nota.");
              return;
          }
      }
      
      if (isNaN(finalFare) || finalFare < 3) {
          alert("Por favor ingresa una tarifa válida (mínimo S/ 3.00)");
          return;
      }

      if (paymentMethod === 'WALLET' && userBalance < finalFare) {
          alert("Saldo insuficiente para pagar con Saldo Vento. Por favor recarga o paga en efectivo.");
          return;
      }

      // Aseguramos que paymentMethod nunca sea undefined
      const safePaymentMethod = paymentMethod || 'CASH';

      onConfirm(
          selectedDriverId || undefined, 
          finalFare, 
          serviceMode,
          serviceMode === 'DELIVERY' ? deliveryNote : undefined,
          safePaymentMethod
      );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header Info */}
      <div className="flex justify-between items-end mb-4">
        <div>
           <h3 className="text-lg font-bold text-slate-900 dark:text-white">
               Configura tu pedido
           </h3>
           {routeDetails && (
             <p className="text-xs font-medium flex items-center gap-1.5 mt-1 text-slate-500 dark:text-slate-400">
               <Clock className="w-3.5 h-3.5" /> 
               {routeDetails.duration} 
               <span className="opacity-50">|</span> 
               {routeDetails.distance}
             </p>
           )}
        </div>
      </div>

      {/* SERVICE TABS */}
      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl mb-4">
          <button 
            onClick={() => setServiceMode('RIDE')}
            className={`flex-1 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all ${serviceMode === 'RIDE' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
          >
              <Bike className="w-4 h-4" /> Viajar
          </button>
          <button 
            onClick={() => setServiceMode('DELIVERY')}
            className={`flex-1 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all ${serviceMode === 'DELIVERY' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
          >
              <Package className="w-4 h-4" /> Envíos
          </button>
      </div>

      {/* DRIVER SELECTION (Horizontal Scroll) */}
      {nearbyDrivers.length > 0 && (
          <div className="mb-4 animate-in slide-in-from-right-5 duration-500 delay-100">
              <h4 className="text-[10px] font-bold uppercase tracking-widest mb-3 pl-1 text-slate-400">
                  Conductores Disponibles
              </h4>
              <div className="flex gap-3 overflow-x-auto pb-4 -mx-2 px-2 no-scrollbar">
                  {/* Option: Auto-Assign */}
                  <div 
                      onClick={() => setSelectedDriverId(null)}
                      className={`
                          relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 min-w-[100px] cursor-pointer transition-all
                          ${selectedDriverId === null 
                              ? 'border-slate-900 dark:border-white bg-slate-50 dark:bg-slate-800' 
                              : 'border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-900 opacity-60'
                          }
                      `}
                  >
                      <div className="p-2.5 rounded-full mb-2 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                          <Zap className="w-5 h-5" />
                      </div>
                      <p className="text-[10px] font-bold text-center leading-tight text-slate-900 dark:text-white">
                          Asignación<br/>Automática
                      </p>
                      {selectedDriverId === null && (
                          <div className="absolute -top-2 -right-2 rounded-full p-0.5 bg-white dark:bg-slate-700 text-slate-900 dark:text-white">
                              <CheckCircle2 className="w-5 h-5 fill-current" />
                          </div>
                      )}
                  </div>

                  {/* Specific Drivers */}
                  {nearbyDrivers.map(d => {
                      const isSelected = selectedDriverId === d.id;
                      return (
                          <div 
                              key={d.id} 
                              onClick={() => setSelectedDriverId(isSelected ? null : d.id)}
                              className={`
                                  relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 min-w-[100px] cursor-pointer transition-all
                                  ${isSelected 
                                      ? 'border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 shadow-lg shadow-yellow-200 dark:shadow-none' 
                                      : 'border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-200'
                                  }
                              `}
                          >
                              <img 
                                  src={d.photoUrl} 
                                  className="w-10 h-10 rounded-full object-cover mb-2 border-2 border-slate-100 dark:border-slate-600" 
                              />
                              <p className="text-xs font-bold truncate w-full text-center text-slate-900 dark:text-white">
                                  {typeof d.name === 'string' ? d.name.split(' ')[0] : 'Cond.'}
                              </p>
                              <div className="flex items-center gap-0.5 text-[9px] text-slate-400 mt-0.5">
                                  <Star className="w-2.5 h-2.5 fill-yellow-400 text-yellow-400"/> {d.rating}
                              </div>
                              
                              {isSelected && (
                                  <div className="absolute -top-2 -right-2 rounded-full p-0.5 bg-white text-yellow-500">
                                      <CheckCircle2 className="w-5 h-5 fill-current" />
                                  </div>
                              )}
                          </div>
                      );
                  })}
              </div>
          </div>
      )}

      {/* CONTENT AREA */}
      <div className="flex-1 overflow-y-auto no-scrollbar pb-4 space-y-4">
        
        {/* PRICE NEGOTIATION */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-4 rounded-2xl shadow-sm">
             <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">
                Tu Oferta (Tarifa)
             </label>
             <div className="relative">
                 <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                 <input 
                    type="number" 
                    value={customFare}
                    onChange={(e) => setCustomFare(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 rounded-xl py-3 pl-12 pr-4 text-xl font-black text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-400 border border-transparent"
                    placeholder="0.00"
                 />
                 <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">PEN</span>
             </div>
             <p className="text-[10px] text-slate-400 mt-2 text-center">
                 Sugerido: S/ {suggestedPrice.toFixed(2)}
             </p>
        </div>

        {/* PAYMENT METHOD SELECTOR */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-4 rounded-2xl shadow-sm">
             <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">
                Método de Pago
             </label>
             <div className="flex gap-3">
                 <div 
                    onClick={() => setPaymentMethod('CASH')}
                    className={`flex-1 p-3 rounded-xl border-2 cursor-pointer transition-all flex flex-col items-center justify-center gap-1 ${paymentMethod === 'CASH' ? 'border-slate-900 dark:border-white bg-slate-100 dark:bg-slate-800' : 'border-slate-100 dark:border-slate-700'}`}
                 >
                     <DollarSign className="w-5 h-5 text-slate-700 dark:text-white" />
                     <p className="text-xs font-bold text-slate-900 dark:text-white">Efectivo</p>
                 </div>
                 
                 <div 
                    onClick={() => setPaymentMethod('WALLET')}
                    className={`flex-1 p-3 rounded-xl border-2 cursor-pointer transition-all flex flex-col items-center justify-center gap-1 relative overflow-hidden ${paymentMethod === 'WALLET' ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : 'border-slate-100 dark:border-slate-700'}`}
                 >
                     {/* DYNAMIC CASHBACK BADGE - STRICTLY CHECKED (NO FALLBACK) */}
                     {(adminSettings?.enableClientCashback === true) && (
                         <div className="absolute top-0 right-0 bg-yellow-400 text-[8px] font-black px-1.5 py-0.5 rounded-bl text-slate-900">
                             {((adminSettings.clientCashbackPercent || 0.05) * 100).toFixed(0)}% OFF
                         </div>
                     )}
                     <Wallet className={`w-5 h-5 ${paymentMethod === 'WALLET' ? 'text-green-600' : 'text-slate-400'}`} />
                     <p className={`text-xs font-bold ${paymentMethod === 'WALLET' ? 'text-green-700 dark:text-green-400' : 'text-slate-500'}`}>Saldo Vento</p>
                     <p className="text-[10px] font-mono text-slate-500">S/ {userBalance.toFixed(2)}</p>
                 </div>
             </div>
        </div>

        {/* DELIVERY SPECIFIC */}
        {serviceMode === 'DELIVERY' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-4 rounded-2xl shadow-sm animate-in slide-in-from-bottom-2">
                 <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block flex items-center gap-2">
                    <Edit3 className="w-3 h-3"/> Detalles del Envío
                 </label>
                 <textarea 
                    value={deliveryNote}
                    onChange={(e) => setDeliveryNote(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 rounded-xl p-3 text-sm font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-400 border border-transparent resize-none h-20"
                    placeholder="Ej: Una caja de zapatos, llaves..."
                 />
            </div>
        )}
      </div>

      {/* ACTIONS */}
      <div className="mt-4 flex gap-3">
         <button 
           onClick={onCancel}
           className="px-6 py-4 rounded-2xl font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
         >
           Atrás
         </button>
         <button 
           onClick={handleConfirm}
           className={`
             flex-1 py-4 rounded-2xl font-bold text-base transition-all shadow-xl flex items-center justify-center gap-2
             bg-black dark:bg-white text-white dark:text-black hover:scale-[1.02] shadow-slate-900/20
           `}
         >
           {serviceMode === 'DELIVERY' ? 'SOLICITAR ENVÍO' : 'SOLICITAR MOTO'}
         </button>
      </div>
    </div>
  );
};

export default RideSelection;