import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pdf from 'pdf-parse';
import https from 'https';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================
// CONFIGURACIÓN DEL CRAWLER
// ==========================================
// 1. Patrón de URL. Cambia {{ID}} por la variable de iteración.
// Nota: Deberás ajustar este patrón a cómo descubras que Misiones guarda sus archivos.
// Ejemplos probables:
// - https://boletin.misiones.gov.ar/descargas/boletin_{{ID}}.pdf
// - https://boletin.misiones.gov.ar/wp-content/uploads/boletines/boletin_{{ID}}.pdf
const URL_PATTERN = "https://boletin.misiones.gov.ar/assets/boletines/boletin-oficial-{{ID}}.pdf";

// 2. Rango de IDs (por ejemplo, el número de edición del Boletín)
const START_ID = 15500;
const END_ID = 15505; // Solo 5 para probar, en producción pondrías 15000 a 16000

// 3. Pausa entre descargas (en ms) para evitar bloqueos del WAF o ban de IP
const DELAY_MS = 2000;
// ==========================================

const OUTPUT_FILE = path.resolve(__dirname, '..', 'public', 'crawled_peps.json');

// Helper: Pausa asíncrona
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Limpiador básico de nombres extraídos
function cleanName(nameRaw) {
    return nameRaw
        .replace(/(?:^|\s)(?:EL|LA|AL|A LA|DEL|SE([ÑN]?)OR(?:[A])?|DR(?:[A])?|LIC(?:[A])?|ABG|DON|DOÑA|SR(?:[A])?\.?)(?=\s)/gi, '')
        .replace(/[,()]/g, '')
        .trim();
}

// Helper: Descargar a Memoria
function downloadToMemory(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, (res) => {
            if (res.statusCode === 404) {
               return resolve(null); // No existe el archivo, saltar
            }
            if (res.statusCode !== 200) {
               return reject(new Error(`StatusCode ${res.statusCode}`));
            }
            const data = [];
            res.on('data', chunk => data.push(chunk));
            res.on('end', () => resolve(Buffer.concat(data)));
        }).on('error', reject);
    });
}

// Analizador de Hojas de PDF (Nuestra Heurística)
async function extractPEPsFromBuffer(buffer, boletinId) {
    const pdfData = await pdf(buffer);
    const textBase = pdfData.text;

    const dniRegex = /D\.?N\.?I\.?(?:\s*[Nn]?[°ºo.])?\s*([\d]{1,2}(?:\.?[\d]{3}){2}|[\d]{7,8})/g;
    let match;
    const candidates = [];
    const windowSize = 250; 

    while ((match = dniRegex.exec(textBase)) !== null) {
        const dniClean = match[1].replace(/\D/g, ''); 
        if (dniClean.length > 8 || dniClean.length < 7) continue;

        const start = Math.max(0, match.index - windowSize);
        const end = Math.min(textBase.length, match.index + windowSize);
        const chunk = textBase.substring(start, end).replace(/\n/g, ' '); 

        const isDesignation = /des[íi]gnas[ea]|nómbras[ea]|nombrar|designar|cargo de|en su reemplazo/i.test(chunk);
        
        if (isDesignation) {
            let nameExtracted = "DESCONOCIDO";
            const textBeforeDNI = textBase.substring(start, match.index).replace(/\n/g, ' ').trim();
            const wordsBefore = textBeforeDNI.split(/\s+/);
            const possibleNameArr = wordsBefore.slice(-5).join(' ');
            const nameMatch = possibleNameArr.match(/([A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ]+){1,3})/);
            
            if (nameMatch) {
                nameExtracted = cleanName(nameMatch[0]);
            } else {
                nameExtracted = cleanName(wordsBefore.slice(-3).join(' '));
            }

            let cargoExtracted = "Funcionario Designado";
            const cargoMatch = chunk.match(/cargo de\s+([A-Za-záéíóúñÁÉÍÓÚÑ\s,\.]+?(?=[\.\;]|\s+a\s+partir|\s+con\s+retenci|\s+en\s+el))/i);
            if (cargoMatch && cargoMatch[1]) cargoExtracted = cargoMatch[1].trim().replace(/\s+/g, ' ');

            candidates.push({
                nombre: nameExtracted.toUpperCase(),
                dni: dniClean,
                cargo: cargoExtracted,
                origen: `Boletin ${boletinId}`
            });
        }
    }
    return candidates;
}

// Bucle Principal del Crawler
async function startCrawler() {
    console.log(`\n======================================================`);
    console.log(` ROBOT CRAWLER DE BOLETINES (INICIANDO BUCLE) `);
    console.log(`======================================================\n`);
    
    let allPeps = [];

    // Cargar historial previo si existe para no perder trabajo anterior
    if (fs.existsSync(OUTPUT_FILE)) {
        allPeps = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
        console.log(`[*] Se encontraron ${allPeps.length} registros previamente crawleados en el disco.`);
    }

    for (let currentId = START_ID; currentId <= END_ID; currentId++) {
        const urlToFetch = URL_PATTERN.replace('{{ID}}', currentId);
        console.log(`[>>] Iteración ${currentId} | Descargando: ${urlToFetch}`);
        
        try {
            const buffer = await downloadToMemory(urlToFetch);
            
            if (!buffer) {
                console.log(`  └─ [!] Error 404: El Boletín no existe. Saltando...`);
            } else {
                console.log(`  └─ [ok] Descargado (${(buffer.length / 1024).toFixed(2)} KB). Analizando...`);
                const extracted = await extractPEPsFromBuffer(buffer, currentId);
                
                if (extracted.length > 0) {
                    console.log(`  └─ [Exito] ¡Se encontraron ${extracted.length} designaciones!`);
                    allPeps.push(...extracted);
                    
                    // Guardado atómico luego de cada boletín exitoso (por seguridad si se crashea el script)
                    // Hacemos Unique por DNI
                    const uniquePeps = Array.from(new Map(allPeps.map(item => [item.dni, item])).values());
                    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(uniquePeps, null, 2));
                    allPeps = uniquePeps;
                } else {
                    console.log(`  └─ [-] Ninguna designación detectada en este PDF.`);
                }
            }
        } catch (error) {
            console.error(`  └─ [X] Fallo la obtención del Boletín ${currentId}: ${error.message}`);
        }

        // Respetamos los límites de la plataforma oficial esperando N segundos
        if (currentId < END_ID) {
            await sleep(DELAY_MS);
        }
    }

    console.log(`\n======================================================`);
    console.log(` CRAWLING FINALIZADO.`);
    console.log(` Total acumulado de Políticos/Funcionarios: ${allPeps.length}`);
    console.log(` Archivo maestro actualizado en: ${OUTPUT_FILE}`);
    console.log(`======================================================\n`);
}

startCrawler();
