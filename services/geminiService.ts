
import { GoogleGenAI, Type } from "@google/genai";
import { RouteDetails } from "../types";

// Always use the direct process.env.API_KEY as per Google GenAI SDK guidelines
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const getRouteInsights = async (
  origin: string,
  destination: string
): Promise<RouteDetails | null> => {
  try {
    // Prompt mejorado para obtener datos más realistas en contexto local
    const prompt = `
      Eres un experto en rutas de tránsito y geografía de Lima, Perú.
      Calcula la distancia de conducción y tiempo estimado en MOTO (más rápido que auto) entre:
      Origen: "${origin}" (Asume Centro de Lima si es ambiguo)
      Destino: "${destination}"
      
      Reglas:
      1. Sé preciso con la geografía de Lima.
      2. Devuelve 'distanceValue' como un número (ej: 5.5) representando kilómetros.
      
      Devuelve JSON.
    `;

    // Always use ai.models.generateContent directly with model name and prompt
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            distance: { type: Type.STRING, description: "Texto ej: '5.5 km'" },
            distanceValue: { type: Type.NUMBER, description: "Número de km ej: 5.5" },
            duration: { type: Type.STRING, description: "Tiempo ej: '12 min'" },
            trafficNote: { type: Type.STRING, description: "Nota corta de tráfico" }
          },
          required: ["distance", "distanceValue", "duration", "trafficNote"]
        }
      }
    });

    // Accessing the .text property directly as per modern GenAI SDK usage
    const text = response.text;
    if (!text) return null;
    return JSON.parse(text) as RouteDetails;

  } catch (error) {
    console.error("Gemini Error:", error);
    // Fallback if API fails
    return {
      distance: "-- km",
      distanceValue: 0,
      duration: "-- min",
      trafficNote: "Error de conexión"
    };
  }
};
