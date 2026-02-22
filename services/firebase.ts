
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";

/**
 * --- REGLAS DE SEGURIDAD DE FIRESTORE (COPIAR EN FIREBASE CONSOLE) ---
 * 
 * rules_version = '2';
 * service cloud.firestore {
 *   match /databases/{database}/documents {
 *     
 *     // 1. Conductores (Lectura pública para mapa, Escritura solo dueño)
 *     match /drivers/{driverId} {
 *       allow read: if true;
 *       allow write: if request.auth != null && request.auth.uid == driverId;
 *     }
 * 
 *     // 2. Clientes (Privado)
 *     match /clients/{clientId} {
 *       allow read, write: if request.auth != null && request.auth.uid == clientId;
 *     }
 * 
 *     // 3. Viajes y Chat (Participantes)
 *     match /rides/{rideId} {
 *       allow read, write: if request.auth != null;
 *       
 *       match /messages/{messageId} {
 *         allow read, write: if request.auth != null;
 *       }
 *     }
 * 
 *     // 4. Solicitudes de Recarga (Solo crear, admin lee)
 *     match /recharge_requests/{requestId} {
 *       allow read, write: if request.auth != null;
 *     }
 * 
 *     // 5. Configuración Global (Admin escribe, todos leen QR)
 *     match /admin_settings/{docId} {
 *       allow read: if true;
 *       allow write: if request.auth != null; // Idealmente restringir a admin ID
 *     }
 *   }
 * }
 */

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBTwvufTL-TSq6FAvOTQvg7atzNjjzmznA",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "taxi-moto-b3b1f.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "taxi-moto-b3b1f",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "taxi-moto-b3b1f.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "889432749814",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:889432749814:web:47d5c2a79a5f35561f1ed7",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-TN6GKRGM8Z"
};

const app = initializeApp(firebaseConfig);
const analytics = typeof window !== 'undefined' ? getAnalytics(app) : null;

export const auth = getAuth(app);
export const db = getFirestore(app);
export { analytics };
