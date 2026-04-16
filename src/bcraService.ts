import type { Legislator, DebtRecord } from './types';

export async function fetchBcraDeudas(cuit: string): Promise<Legislator> {
  const cleanCuit = cuit.replace(/\D/g, '');
  if (cleanCuit.length !== 11) {
    throw new Error('El CUIT debe tener 11 dígitos numéricos.');
  }

  // Petición directa desde el navegador (para usar la IP local del usuario y evadir el bloqueo a IPs de nube del BCRA)
  const url = `https://api.bcra.gob.ar/centraldedeudores/v1.0/Deudas/Historicas/${cleanCuit}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 404 || (data.errorMessages && data.errorMessages.some((msg: string) => msg.includes('No se encontraron deudas')))) {
      // Devolver un legislador vacío sin deuda
      return createEmptyLegislator(cleanCuit, 'SIN DEUDA REGISTRADA');
    }

    if (data.status !== 200 || !data.results) {
       throw new Error(data.errorMessages ? data.errorMessages.join('. ') : 'Error desconocido al consultar el BCRA. Es posible que el servicio esté en mantenimiento.');
    }

    const results = data.results;
    const historial: DebtRecord[] = [];

    // Parsear el historial según la estructura habitual de la API de BCRA
    if (results.periodos) {
      for (const periodo of results.periodos) {
        // periodo de BCRA suele ser "YYYYMM"
        const year = periodo.periodo.substring(0, 4);
        const month = periodo.periodo.substring(4, 6);
        const fecha = `${year}-${month}`;

        if (periodo.entidades) {
          for (const entidad of periodo.entidades) {
            historial.push({
              entidad: entidad.entidad || 'Entidad Desconocida',
              fecha: fecha,
              situacion: entidad.situacion || 1,
              // BCRA API returns amount as number in sometimes decimals but represents hundreds/thousands? Usually full value. 
              // We'll divide it by 1000 since the app expects thousands of pesos.
              monto: typeof entidad.monto === 'number' ? (entidad.monto / 1000) : (parseFloat(entidad.monto || "0") / 1000)
            });
          }
        }
      }
    }

    // Calcular situación actual tomando el mes más reciente
    let situacion_bcra = 0;
    if (historial.length > 0) {
      // Ordenar de más reciente a más antigua
      const historialOrdenado = [...historial].sort((a, b) => b.fecha.localeCompare(a.fecha));
      const mesMasReciente = historialOrdenado[0].fecha;
      // Obtener peor situación de ese mes
      const deudasRecientes = historialOrdenado.filter(h => h.fecha === mesMasReciente);
      situacion_bcra = Math.max(...deudasRecientes.map(h => h.situacion));
    }

    return {
      cuit: cleanCuit,
      nombre: results.denominacion || cleanCuit,
      historial: historial,
      hitos_personales: [],
      cargo: 'Búsqueda por CUIT',
      poder: 'ejecutivo', // default para que se coloree
      hipoteca_bcra: { tiene: false },
      cambios_nivel: false,
      situacion_bcra: situacion_bcra,
    };
  } catch (error: any) {
    throw new Error(error.message || 'Error de conexión con la API del BCRA.');
  }
}

function createEmptyLegislator(cuit: string, nombre: string): Legislator {
  return {
    cuit,
    nombre,
    historial: [],
    hitos_personales: [],
    cargo: 'Búsqueda por CUIT',
    poder: 'ejecutivo',
    hipoteca_bcra: { tiene: false },
    cambios_nivel: false,
    situacion_bcra: 1, // Normal (sin deuda)
  };
}
