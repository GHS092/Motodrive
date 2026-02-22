
import { BikeCategory, Driver, RideOption } from './types';

// Centro de Lima (Plaza de Armas / Centro Cívico aprox para la demo)
export const INITIAL_CENTER = { lat: -12.0464, lng: -77.0428 };

// LISTA VACÍA: Los conductores vendrán de Firebase Real
export const MOCK_DRIVERS: Driver[] = [];

// Single Service Option as requested - Fixed Rate logic applied in Component
export const RIDE_OPTIONS: RideOption[] = [
  {
    id: BikeCategory.STANDARD,
    name: 'Moto Urbana',
    description: 'Tarifa única: S/ 1.50 por km.',
    price: 5.00, // Precio mínimo
    multiplier: 1.0, 
    eta: 3,
    image: 'Standard'
  }
];
