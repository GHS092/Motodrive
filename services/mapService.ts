

import { Coordinates, RouteDetails, SearchResult } from "../types";

// Servicio gratuito de OpenStreetMap para geocodificación
const NOMINATIM_API = "https://nominatim.openstreetmap.org/search";
// Servicio gratuito de OSRM para rutas
const OSRM_API = "https://router.project-osrm.org/route/v1/driving";

// Bounding Box de Lima Metropolitana para restringir búsquedas
// Formato: min_lon, min_lat, max_lon, max_lat (approx)
const LIMA_VIEWBOX = "-77.20,-12.30,-76.50,-11.50";

export const searchAddress = async (query: string): Promise<SearchResult[]> => {
  if (!query || query.length < 3) return [];

  try {
    // Forzamos la búsqueda dentro de Perú y específicamente Lima
    // Añadimos 'addressdetails=1' para obtener desglose de calle, numero, distrito
    const searchQuery = query.toLowerCase().includes('lima') ? query : `${query}, Lima`;

    const url = `${NOMINATIM_API}?format=json&q=${encodeURIComponent(searchQuery)}&limit=8&addressdetails=1&countrycodes=pe&viewbox=${LIMA_VIEWBOX}&bounded=1&dedupe=1`;

    const response = await fetch(url);
    
    if (!response.ok) throw new Error("Error fetching address");
    
    const data = await response.json();
    
    // PROCESAMIENTO INTELIGENTE DE DIRECCIONES
    const processedResults: SearchResult[] = [];
    const seenAddresses = new Set<string>();

    data.forEach((item: any) => {
        const addr = item.address || {};
        
        // 1. Construir el Título Principal (Calle / Lugar)
        // Prioridad: Nombre del POI > Calle + Número > Calle sola > Barrio
        let mainText = '';
        
        if (item.name && item.name !== addr.road) {
             // Es un lugar específico (ej: "Real Plaza", "Aeropuerto")
             mainText = item.name;
        } else if (addr.road) {
             // Es una calle
             mainText = addr.road;
             if (addr.house_number) {
                 mainText += ` ${addr.house_number}`;
             }
        } else if (addr.neighbourhood || addr.suburb) {
             mainText = addr.neighbourhood || addr.suburb;
        } else {
             // Fallback
             mainText = item.display_name.split(',')[0];
        }

        // 2. Construir el Texto Secundario (Distrito / Ciudad)
        const parts = [];
        if (addr.neighbourhood && mainText !== addr.neighbourhood) parts.push(addr.neighbourhood);
        if (addr.suburb && mainText !== addr.suburb) parts.push(addr.suburb); // Distrito
        if (addr.city && addr.city !== 'Lima') parts.push(addr.city);
        if (addr.city_district) parts.push(addr.city_district);
        if (parts.length === 0) parts.push('Lima');

        // Eliminar duplicados en el array de partes secundarias
        const uniqueSecondary = [...new Set(parts)].join(', ');

        // 3. Clave única para evitar duplicados en la lista visual
        // Ej: "Av Arequipa, Miraflores" vs "Av Arequipa, San Isidro" son diferentes.
        // Pero "Av Arequipa, Miraflores" vs "Av Arequipa 123, Miraflores" se mantienen.
        const uniqueKey = `${mainText.toLowerCase()}|${uniqueSecondary.toLowerCase()}`;

        if (!seenAddresses.has(uniqueKey)) {
            seenAddresses.add(uniqueKey);
            processedResults.push({
                display_name: item.display_name, // Mantenemos el original por si acaso
                lat: item.lat,
                lon: item.lon,
                place_id: item.place_id,
                main_text: mainText,
                secondary_text: uniqueSecondary
            });
        }
    });

    return processedResults;
  } catch (error) {
    console.error("Error searching address:", error);
    return [];
  }
};

/**
 * Calculates the Haversine distance between two coordinates.
 * Exported as getDistanceKm to resolve the dependency in ClientDashboard.tsx.
 */
export const getDistanceKm = (start: Coordinates, end: Coordinates): number => {
  const R = 6371; // Radio de la Tierra en km
  const dLat = (end.lat - start.lat) * Math.PI / 180;
  const dLon = (end.lng - start.lng) * Math.PI / 180;
  const a = 
     Math.sin(dLat/2) * Math.sin(dLat/2) +
     Math.cos(start.lat * Math.PI / 180) * Math.cos(end.lat * Math.PI / 180) * 
     Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

export const calculateRealRoute = async (
  start: Coordinates,
  end: Coordinates
): Promise<RouteDetails | null> => {
  try {
    const url = `${OSRM_API}/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error("Error calculation route");

    const data = await response.json();
    
    if (data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      const distanceMeters = route.distance;
      const durationSeconds = route.duration;

      const distanceKm = distanceMeters / 1000;
      const durationMin = Math.ceil(durationSeconds / 60);

      const geometry = route.geometry.coordinates.map((coord: number[]) => [coord[1], coord[0]] as [number, number]);

      return {
        distance: `${distanceKm.toFixed(1)} km`,
        distanceValue: distanceKm,
        duration: `${durationMin} min`,
        trafficNote: "Ruta óptima",
        geometry: geometry
      };
    }
    throw new Error("No route found");
  } catch (error) {
    console.warn("Routing error, using fallback:", error);
    
    // Use the exported getDistanceKm for fallback calculation
    const linearDist = getDistanceKm(start, end);
    // Estimamos que la ruta real es ~1.3 veces la distancia lineal (factor de tortuosidad urbano)
    const estimatedDist = linearDist * 1.3;
    // Estimamos velocidad promedio de moto en ciudad: 30km/h (0.5 km/min)
    const estimatedMin = Math.ceil(estimatedDist / 0.5);

    return {
        distance: `${estimatedDist.toFixed(1)} km`,
        distanceValue: estimatedDist,
        duration: `${estimatedMin} min`,
        trafficNote: "Ruta estimada (GPS)",
        geometry: [[start.lat, start.lng], [end.lat, end.lng]] // Línea recta visual
    };
  }
};