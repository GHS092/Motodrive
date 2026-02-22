
import React, { useEffect, useRef } from 'react';
import { Coordinates, Driver } from '../types';
import * as L from 'leaflet';

interface MapVisualizationProps {
  userLocation: Coordinates | null;
  drivers: Driver[];
  isSearching: boolean;
  isAdminView?: boolean;
  recenterTrigger?: number; 
  routeCoords?: [number, number][]; 
  trackUser?: boolean; // Para modo navegación "Waze"
}

const MapVisualization: React.FC<MapVisualizationProps> = ({ 
  userLocation, 
  drivers, 
  isSearching, 
  isAdminView = false,
  recenterTrigger = 0,
  routeCoords,
  trackUser = false
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<{ [id: string]: L.Marker }>({});
  const userMarkerRef = useRef<L.Marker | null>(null);
  const radarCircleRef = useRef<L.Circle | null>(null);
  const routePolylineRef = useRef<L.Polyline | null>(null);
  
  // Referencia para saber si ya hicimos el centrado inicial
  const hasInitialCentered = useRef(false);

  // Default Center (Lima)
  const DEFAULT_CENTER = { lat: -12.0464, lng: -77.0428 };

  // 1. Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialLat = userLocation ? userLocation.lat : DEFAULT_CENTER.lat;
    const initialLng = userLocation ? userLocation.lng : DEFAULT_CENTER.lng;

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLng],
      zoom: 16,
      zoomControl: false,
      attributionControl: false 
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);

    mapInstanceRef.current = map;

    // Fix inicial de tamaño
    setTimeout(() => { 
        if (mapInstanceRef.current) map.invalidateSize(); 
    }, 500);

    return () => {
      // Limpieza robusta
      map.remove();
      mapInstanceRef.current = null;
      markersRef.current = {};
      userMarkerRef.current = null;
    };
  }, []); 

  // 2. EFECTO CRÍTICO: Manejo de Transición de Viaje y Centrado Inicial
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // LÓGICA DE AUTO-CENTRADO AL INICIO (NUEVO)
    if (userLocation && !hasInitialCentered.current) {
        if (!isNaN(userLocation.lat) && !isNaN(userLocation.lng)) {
            // Usamos flyTo para una animación suave hacia la ubicación del usuario apenas cargue
            map.flyTo([userLocation.lat, userLocation.lng], 16, { animate: true, duration: 1.5 });
            hasInitialCentered.current = true;
        }
    }

    // LÓGICA DE TRACKING ACTIVO (Modo Waze)
    if (trackUser && userLocation && !isNaN(userLocation.lat) && !isNaN(userLocation.lng)) {
        map.flyTo([userLocation.lat, userLocation.lng], 18, { animate: true, duration: 1 });
    }

    // SI LA UBICACIÓN CAMBIA DRÁSTICAMENTE (MODO PLANIFICADOR)
    // Si el usuario selecciona manualmente otro punto de origen, movemos el mapa
    if (userLocation && !trackUser && hasInitialCentered.current && !isNaN(userLocation.lat) && !isNaN(userLocation.lng)) {
         // Comprobamos si el mapa está muy lejos del nuevo centro
         const center = map.getCenter();
         const dist = map.distance([center.lat, center.lng], [userLocation.lat, userLocation.lng]);
         if (dist > 500) { // Si se movió más de 500 metros
             map.flyTo([userLocation.lat, userLocation.lng], 16, { animate: true, duration: 0.8 });
         }
    }

    // LÓGICA DE FIN DE VIAJE
    if (!trackUser && userLocation) {
        const timer = setTimeout(() => {
            if (mapInstanceRef.current) {
                map.invalidateSize();
            }
        }, 400);
        return () => clearTimeout(timer);
    }

  }, [trackUser, userLocation]); 

  // 3. Handle User Location Updates
  useEffect(() => {
    if (!mapInstanceRef.current || !userLocation) return;
    if (isNaN(userLocation.lat) || isNaN(userLocation.lng)) return;

    const map = mapInstanceRef.current;
    const { lat, lng } = userLocation;

    // Actualizar Marcador Visual del Usuario
    if (userMarkerRef.current) {
      // Verificamos si sigue en el mapa
      if (!map.hasLayer(userMarkerRef.current)) {
          userMarkerRef.current.addTo(map);
      }
      userMarkerRef.current.setLatLng([lat, lng]);
    } else {
      const userIcon = L.divIcon({
        className: 'custom-user-marker',
        html: `
          <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px;">
            <div style="width: 16px; height: 16px; background-color: #2563eb; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 10px rgba(0,0,0,0.3); z-index: 20; position: relative;"></div>
            <div style="position: absolute; width: 100%; height: 100%; background-color: rgba(37, 99, 235, 0.3); border-radius: 50%; animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
          </div>
          <style>@keyframes ping { 75%, 100% { transform: scale(2.5); opacity: 0; } }</style>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      userMarkerRef.current = L.marker([lat, lng], { 
        icon: userIcon,
        zIndexOffset: 1000 
      }).addTo(map);
    }

    // Radar de búsqueda (Solo visual)
    if (isSearching) {
      if (!radarCircleRef.current) {
        radarCircleRef.current = L.circle([lat, lng], {
          color: '#eab308',
          fillColor: '#eab308',
          fillOpacity: 0.15,
          radius: 200,
          weight: 0
        }).addTo(map);
      } else {
        radarCircleRef.current.setLatLng([lat, lng]);
        if (!map.hasLayer(radarCircleRef.current)) {
             radarCircleRef.current.addTo(map);
        }
      }
    } else {
      if (radarCircleRef.current) {
        radarCircleRef.current.remove();
        radarCircleRef.current = null;
      }
    }
    
  }, [userLocation, isSearching]);

  // 4. Handle Route Polyline
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    if (routeCoords && routeCoords.length > 0) {
      if (routePolylineRef.current) {
        routePolylineRef.current.setLatLngs(routeCoords);
        if (!map.hasLayer(routePolylineRef.current)) {
            routePolylineRef.current.addTo(map);
        }
      } else {
        routePolylineRef.current = L.polyline(routeCoords, {
          color: '#4285F4',
          weight: 6,
          opacity: 1,
          lineJoin: 'round',
          lineCap: 'round',
        }).addTo(map);
      }

      if (!trackUser) {
          const bounds = L.latLngBounds(routeCoords);
          setTimeout(() => {
              if (mapInstanceRef.current) {
                  map.fitBounds(bounds, { 
                    paddingTopLeft: [50, 150], 
                    paddingBottomRight: [50, 250], 
                    animate: true 
                  });
              }
          }, 100);
      }

    } else {
      if (routePolylineRef.current) {
        routePolylineRef.current.remove();
        routePolylineRef.current = null;
      }
    }
  }, [routeCoords, trackUser]);

  // 5. Manual Recenter (Botón de mira)
  useEffect(() => {
    if (mapInstanceRef.current && userLocation && recenterTrigger > 0) {
      mapInstanceRef.current.invalidateSize();
      mapInstanceRef.current.flyTo([userLocation.lat, userLocation.lng], 17, { animate: true });
    }
  }, [recenterTrigger]);

  // 6. Handle Drivers Markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    const currentDriverIds = new Set(drivers.map(d => d.id));

    // Remove old markers safely
    Object.keys(markersRef.current).forEach(id => {
      if (!currentDriverIds.has(id)) {
        const marker = markersRef.current[id];
        if (marker) {
            try { marker.remove(); } catch(e) { console.warn("Error removing marker", e); }
        }
        delete markersRef.current[id];
      }
    });

    // Update existing or create new
    drivers.forEach(driver => {
      if (!driver.position || typeof driver.position.lat !== 'number' || typeof driver.position.lng !== 'number' || isNaN(driver.position.lat) || isNaN(driver.position.lng)) {
          return;
      }

      const { lat, lng } = driver.position;
      
      const motoIconHtml = `
        <div style="position: relative; transition: all 0.3s ease;">
           ${isAdminView ? `<div style="position: absolute; top: -24px; left: 50%; transform: translateX(-50%); background: #1e293b; color: white; font-size: 10px; font-weight: bold; padding: 2px 8px; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.2); white-space: nowrap; z-index: 20;">${driver.name}</div>` : ''}
           
           <div style="background: #1e293b; padding: 6px; border-radius: 50%; box-shadow: 0 4px 12px rgba(0,0,0,0.3); border: 2px solid white; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px;">
             <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>
           </div>
        </div>
      `;

      const motoIcon = L.divIcon({
        className: 'custom-driver-marker',
        html: motoIconHtml,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      });

      if (markersRef.current[driver.id]) {
        const marker = markersRef.current[driver.id];
        try {
            // Aseguramos que el marcador esté en el mapa
            if (!map.hasLayer(marker)) {
                marker.addTo(map);
            }
            marker.setLatLng([lat, lng]);
            marker.setIcon(motoIcon);
            marker.setZIndexOffset(900); 
        } catch (error) {
            console.warn("Error updating driver marker:", error);
        }
      } else {
        const marker = L.marker([lat, lng], { icon: motoIcon }).addTo(map);
        markersRef.current[driver.id] = marker;
      }
    });

  }, [drivers, isAdminView]);

  return (
    <div className="absolute inset-0 w-full h-full z-0">
      <div ref={mapContainerRef} className="w-full h-full bg-slate-100" />
      <div className="absolute top-0 left-0 w-full h-32 map-fade-top pointer-events-none z-[400]" />
    </div>
  );
};

export default MapVisualization;
