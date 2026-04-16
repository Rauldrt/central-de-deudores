import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pdf from 'pdf-parse';
import https from 'https';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Función para descargar un PDF de una URL a un buffer
function downloadPDF(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Fallo al descargar: StatusCode ${res.statusCode}`));
                return;
            }
            const data = [];
            res.on('data', chunk => data.push(chunk));
            res.on('end', () => resolve(Buffer.concat(data)));
        }).on('error', reject);
    });
}

// Limpiador básico de nombres extraídos
function cleanName(nameRaw) {
    return nameRaw
        .replace(/(?:^|\s)(?:EL|LA|AL|A LA|DEL|SE([ÑN]?)OR(?:[A])?|DR(?:[A])?|LIC(?:[A])?|ABG|DON|DOÑA|SR(?:[A])?\.?)(?=\s)/gi, '')
        .replace(/[,()]/g, '')
        .trim();
}

async function scrapeBoletin(pdfInput) {
    console.log(`\n========================================`);
    console.log(` MINERO DEL BOLETÍN OFICIAL (PDF a JSON)`);
    console.log(`========================================`);

    let dataBuffer;
    
    // Identificar si es URL o archivo local
    if (pdfInput.startsWith('http')) {
        console.log(`[+] Descargando Boletín desde URL: ${pdfInput}`);
        dataBuffer = await downloadPDF(pdfInput);
    } else {
        console.log(`[+] Cargando PDF local: ${pdfInput}`);
        dataBuffer = fs.readFileSync(path.resolve(process.cwd(), pdfInput));
    }

    console.log(`[+] Procesando texto del PDF (puede demorar)...`);
    const pdfData = await pdf(dataBuffer);
    const textBase = pdfData.text;

    // Patrón 1: Capturar DNI en todo el texto para análisis por proximidad
    // Misiones y otras prov. suelen redactar: "D.N.I. N° 25.123.456" o "DNI 25123456"
    const dniRegex = /D\.?N\.?I\.?(?:\s*[Nn]?[°ºo.])?\s*([\d]{1,2}(?:\.?[\d]{3}){2}|[\d]{7,8})/g;
    
    let match;
    const candidates = [];
    const windowSize = 250; // Caracteres antes y después del DNI para buscar contexto de DESIGNACIÓN

    console.log(`[+] Buscando coincidencias y extrayendo metadatos...\n`);

    while ((match = dniRegex.exec(textBase)) !== null) {
        const dniRaw = match[1];
        const dniClean = dniRaw.replace(/\D/g, ''); // Deja solo los numeros
        
        // Evitamos CUITs que se hayan detectado erróneamente como DNIs
        if (dniClean.length > 8 || dniClean.length < 7) continue;

        const matchIndex = match.index;
        
        // Ventana de texto alrededor del DNI para analizar
        const start = Math.max(0, matchIndex - windowSize);
        const end = Math.min(textBase.length, matchIndex + windowSize);
        const chunk = textBase.substring(start, end).replace(/\n/g, ' '); 

        // Heurística de Designación (Filtramos solo cuando es un nombramiento/designación)
        const isDesignation = /des[íi]gnas[ea]|nómbras[ea]|nombrar|designar|cargo de|en su reemplazo/i.test(chunk);
        
        if (isDesignation) {
            // Extraer nombre: A menudo está junto antes del DNI o después de palabras clave
            // Patrón común: "Señor JUAN PEREZ, D.N.I..." o "al Ciudadano MARCELO GOMEZ DNI..."
            let nameExtracted = "DESCONOCIDO";
            
            // Buscar una secuencia de palabras MAYÚSCULAS o Tituladas justo antes del DNI
            // Expresión para agarrar la cadena de texto previa al DNI:
            const textBeforeDNI = textBase.substring(start, matchIndex).replace(/\n/g, ' ').trim();
            const wordsBefore = textBeforeDNI.split(/\s+/);
            
            // Tomar las últimas 2-4 palabras como intento de nombre
            const possibleNameArr = wordsBefore.slice(-5).join(' ');
            // Limpiaremos el nombre usando regex:
            // Busca la secuencia de palabras contiguas más larga que parezca un nombre en los últimos caracteres
            const nameMatch = possibleNameArr.match(/([A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ]+){1,3})/);
            
            if (nameMatch) {
                nameExtracted = cleanName(nameMatch[0]);
            } else {
                // Alternativa: Extracción brusca de las últimas palabras
                nameExtracted = cleanName(wordsBefore.slice(-3).join(' '));
            }

            // Extraer Cargo (suele estar introducido por "cargo de", "cargo de la", "Secretario de", etc.)
            let cargoExtracted = "Funcionario Designado";
            const cargoMatch = chunk.match(/cargo de\s+([A-Za-záéíóúñÁÉÍÓÚÑ\s,\.]+?(?=[\.\;]|\s+a\s+partir|\s+con\s+retenci|\s+en\s+el))/i);
            
            if (cargoMatch && cargoMatch[1]) {
                cargoExtracted = cargoMatch[1].trim().replace(/\s+/g, ' ');
            }

            candidates.push({
                nombre: nameExtracted.toUpperCase(),
                dni: dniClean,
                cargo: cargoExtracted
            });
        }
    }

    // Filtrar duplicados en caso de que aparezca el mismo DNI 2 veces por recitación de articulos
    const uniqueCandidates = Array.from(new Map(candidates.map(item => [item.dni, item])).values());

    console.log(`----------------------------------------`);
    uniqueCandidates.forEach(c => {
        console.log(` -> Nombre: ${c.nombre}`);
        console.log(`    DNI:    ${c.dni}`);
        console.log(`    Cargo:  ${c.cargo}`);
        console.log(`----------------------------------------`);
    });
    
    console.log(`\n[!] Se han extraído mediante IA/Heurística ${uniqueCandidates.length} designaciones probables.`);

    if (uniqueCandidates.length > 0) {
        // Guardamos los datos para pegarlos en el MINER o mandarlos directo
        const tsvData = uniqueCandidates.map(c => `${c.nombre}\t${c.dni}\t${c.cargo}`).join('\n');
        
        fs.writeFileSync(path.resolve(__dirname, '..', 'public', 'scraped_boletin.txt'), tsvData);
        console.log(`[!] Archivo de exportación temporal guardado en: public/scraped_boletin.txt.`);
        console.log(`[!] Puedes copiar ese archivo y pegarlo diréctamente en /miner de la aplicación web.\n`);
    } else {
        console.log(`[!] No se extrajeron nombramientos. Verifica si el PDF es texto o es una imagen escaneada (requeriría OCR).\n`);
    }
}

// Control por argumentos de consola
const args = process.argv.slice(2);
if (args.length === 0) {
    console.log(`Uso: node scripts/boletin-scraper.mjs <ruta-al-pdf-o-URL>`);
    console.log(`Ej:  node scripts/boletin-scraper.mjs "./boletin-15600.pdf"`);
    console.log(`Ej:  node scripts/boletin-scraper.mjs "https://www.boletinoficial.gob.ar/descargar/pdf/..."`);
} else {
    scrapeBoletin(args[0]).catch(e => console.error("Error Craso:", e));
}
