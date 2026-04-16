import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Función matemática para generar CUITs válidos dado un DNI
function getValidCuits(dni) {
  const dniStr = String(dni).replace(/\D/g, '').padStart(8, '0');
  const validCuits = [];
  // 20 = Hombre, 27 = Mujer, 23/24 = Repetidos/Casos particulares, 30/33/34 = Empresas (no aplican para DNIs físicos normalmente)
  const prefixes = ['20', '27', '23', '24'];

  prefixes.forEach(prefix => {
    const base = prefix + dniStr;
    const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 10; i++) {
        sum += parseInt(base[i], 10) * weights[i];
    }
    const remainder = sum % 11;
    let z;
    if (remainder === 0) {
        z = 0;
    } else if (remainder === 1) {
        if (prefix === '20') z = 9;
        else if (prefix === '27') z = 4;
        else z = null; // No valido
    } else {
        z = 11 - remainder;
    }
    
    if (z !== null && z >= 0 && z <= 9) {
        validCuits.push(base + String(z));
    }
  });

  // Hacemos unique para evitar duplicados
  return [...new Set(validCuits)];
}

// Retrasos para no saturar al BCRA (Rate Limiting)
const delay = ms => new Promise(res => setTimeout(res, ms));

// Verifica un CUIT en el BCRA
async function testCuitInBcra(cuit) {
  try {
    const url = `https://api.bcra.gob.ar/centraldedeudores/v1.0/Deudas/Historicas/${cuit}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    if (data.status === 404 || (data.errorMessages && data.errorMessages.length > 0)) {
       // El BCRA asume que si no hay deudas o no se encuentra con un error, a veces devuelve mensajes de error específicos
       // Pero si devuelve { denominacion: "X" } es que existe el CUIT en la base
       if (!data.denominacion) {
           return null;
       }
    }
    
    return data.denominacion ? data.denominacion : null;

  } catch (error) {
    console.error(`Error de red al consultar ${cuit}:`, error.message);
    return null;
  }
}

// Función Principal
async function processDnis() {
  console.log("========================================");
  console.log(" MOTOR DE MINERÍA DNI -> CUIT (MISIONES) ");
  console.log("========================================\n");

  // TODO: En un caso real, leeremos un archivo CSV o JSON crudo farmeado del boletin
  // Muestra de prueba:
  const rawScrapedData = [
    { nombreDescubierto: "HUGO MARIO PASSALACQUA", dni: "12848123", cargo: "Gobernador" },
    { nombreDescubierto: "OSCAR HERRERA AHUAD", dni: "22333454", cargo: "Presidente de la Cámara" }
  ];

  const results = [];

  for (const person of rawScrapedData) {
    console.log(`Buscando a: ${person.nombreDescubierto} (DNI ${person.dni})`);
    
    const candidatesCuit = getValidCuits(person.dni);
    console.log(`  -> CUITs Candidatos matemáticos: ${candidatesCuit.join(', ')}`);
    
    let resolvedCuit = null;
    let resolvedName = null;

    for (const cuit of candidatesCuit) {
      console.log(`  -> Consultando BCRA para ${cuit}...`);
      const bcraName = await testCuitInBcra(cuit);
      
      if (bcraName) {
        console.log(`  [ÉXITO] BCRA devolvió indentidad: ${bcraName}`);
        resolvedCuit = cuit;
        resolvedName = bcraName;
        break; // Detenernos, ya encontramos el correcto.
      }
      
      // Delay cortesía anti-ban BCRA
      await delay(1000); 
    }

    if (resolvedCuit) {
      results.push({
        cuit: resolvedCuit,
        nombre: bcraNameFormatter(resolvedName), // Normalizamos a Title Case
        cargo: person.cargo,
        poder: "ejecutivo", // o la logica segun el cargo
        distrito: "Misiones"
      });
    } else {
      console.log(`  [FALLO] No se encontró el CUIT para ${person.nombreDescubierto} o no tiene historial financiero en BCRA.\n`);
    }

    console.log("----------------------------------------");
  }

  // Guardar archivo si hubo éxitos
  if (results.length > 0) {
    const outFile = path.join(__dirname, '..', 'public', 'misiones_peps.temp.json');
    fs.writeFileSync(outFile, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`\nMinería completa. Se escribieron ${results.length} registros exitosos en public/misiones_peps.temp.json`);
  }
}

function bcraNameFormatter(nameStr) {
   if(!nameStr) return "Desconocido";
   return nameStr.toLowerCase().split(' ').map(s => s.charAt(0).toUpperCase() + s.substring(1)).join(' ');
}

// Iniciador
processDnis().catch(console.error);
