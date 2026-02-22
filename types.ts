

export enum AppState {
  IDLE = 'IDLE',
  CHOOSING_DESTINATION = 'CHOOSING_DESTINATION',
  SELECTING_RIDE = 'SELECTING_RIDE',
  SEARCHING_DRIVER = 'SEARCHING_DRIVER',
  DRIVER_FOUND = 'DRIVER_FOUND',
  ON_TRIP = 'ON_TRIP',
  COMPLETED = 'COMPLETED'
}

export type UserRole = 'ADMIN' | 'CLIENT' | 'GUEST' | 'DRIVER';

export interface User {
  id: string;
  name: string;
  role: UserRole;
  phone?: string;
  driverId?: string; // Link to driver profile if role is DRIVER
  photoUrl?: string;
  walletBalance?: number; // Para mostrar saldo en header
  verificationStatus?: 'PENDING' | 'VERIFIED' | 'REJECTED'; // New field for drivers
}

export interface Client {
  id: string;
  name: string;
  phone: string;
  password: string;
  photoUrl?: string;
  walletBalance: number; // Saldo Vento (Soles)
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Driver {
  id: string;
  name: string;
  bikeModel: string;
  rating: number;
  plates: string;
  category: BikeCategory;
  position: Coordinates;
  photoUrl: string;
  status: 'AVAILABLE' | 'BUSY' | 'OFFLINE';
  password?: string;
  phone?: string;
  // BUSINESS MODEL
  credits: number; // Saldo Operativo (Para pagar comisiones)
  reservedCredits: number; // Saldo congelado en viajes activos
  walletBalance: number; // Saldo de Ganancias (Retirable o canjeable)
  
  // VERIFICATION FIELDS
  verificationStatus?: 'PENDING' | 'VERIFIED' | 'REJECTED';
  licenseUrl?: string; // Foto de licencia
  plateUrl?: string;   // Foto de placa (moto)
}

export enum BikeCategory {
  STANDARD = 'STANDARD', // 150cc - 250cc
  SPORT = 'SPORT',       // Deportivo, carenado
  PREMIUM = 'PREMIUM'    // Alta cilindrada / Touring
}

export interface RideOption {
  id: BikeCategory;
  name: string;
  description: string;
  price: number; // Base price or Min fare
  multiplier: number; // New: For dynamic calculation
  eta: number; // minutes
  image: string;
}

export interface RouteDetails {
  distance: string; // Text representation e.g. "5.2 km"
  distanceValue: number; // New: Numeric value e.g. 5.2
  duration: string;
  trafficNote: string;
  geometry?: [number, number][]; // Array of [lat, lng] for drawing the line
}

export interface SearchResult {
  display_name: string;
  lat: string;
  lon: string;
  place_id: number;
  // Campos mejorados para UI tipo Uber
  main_text?: string;     // Ej: Av. Javier Prado Este 1234
  secondary_text?: string; // Ej: San Borja, Lima
}

export type RideStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export type ServiceType = 'RIDE' | 'DELIVERY';
export type PaymentMethod = 'CASH' | 'WALLET';

export interface RideRequest {
  id: string;
  passengerId: string;
  passengerName: string;
  passengerPhone?: string; // NUEVO: Telefono del pasajero para contacto
  driverId: string; // The specific driver targeted
  pickup: string;
  pickupCoordinates: Coordinates; // Essential for routing
  destination: string;
  destinationCoordinates: Coordinates; // Essential for routing
  fare: number;
  distance: string;
  status: RideStatus;
  category: BikeCategory;
  commission: number; // Monto en créditos (10% de fare)
  
  // NEW FIELDS FOR DELIVERY & NEGOTIATION
  serviceType: ServiceType;
  deliveryNote?: string; // "Caja de zapatos", "Llaves", etc.
  driverOffer?: number; // Si el conductor contra-oferta, se llena este campo
  
  // NEW FIELDS FOR WALLET
  paymentMethod: PaymentMethod;
  isPaid?: boolean; // True si ya se procesó el pago wallet
}

export interface ChatMessage {
  id?: string;
  text: string;
  senderId: string;
  senderName: string;
  timestamp: number;
}

// NUEVOS TIPOS PARA ADMINISTRACIÓN Y PAGOS

export interface AdminSettings {
  yapeQrUrl: string;
  plinQrUrl: string;
  supportPhone: string;
  
  // BUSINESS LOGIC CONFIG
  baseRatePerKm: number;      // Default: 1.50
  
  // CLIENT PROMOS
  enableClientCashback: boolean; // Toggle
  clientCashbackPercent: number; // Default: 0.05 (5%)
  
  // DRIVER PROMOS
  enableDriverBonus: boolean;    // Toggle for recharge bonus
  driverBonusThreshold: number;  // Default: 50.00
  driverBonusPercent: number;    // Default: 0.10 (10%)
}

export interface RechargeRequest {
  id: string;
  userId: string; // ID del conductor o cliente
  userName: string;
  userType: 'DRIVER' | 'CLIENT';
  amount: number; // Monto pagado en S/
  creditsRequested: number; // Créditos a recibir (o saldo wallet)
  proofUrl: string; // URL de la foto del comprobante
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  timestamp: number;
  requestType?: 'RECHARGE' | 'WITHDRAWAL'; // New field to distinguish
}

export interface WithdrawalRequest {
  id: string;
  driverId: string;
  driverName: string;
  amount: number;
  qrUrl: string; // QR de Yape del conductor para recibir pago
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  timestamp: number;
  requestType?: 'WITHDRAWAL';
}