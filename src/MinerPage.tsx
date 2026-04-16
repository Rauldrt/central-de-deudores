import { useState } from 'react';
import { fetchBcraDeudas } from './bcraService';

interface RawRow {
  nombre: string;
  dni: string;
  cargo: string;
}

interface MiningResult {
  cuit: string;
  nombre_bcra: string;
  cargo: string;
  poder: string;
  distrito: string;
}

export default function MinerPage() {
  const [inputData, setInputData] = useState<string>('JUAN PEREZ\t12345678\tConcejal\nMARIA GOMEZ\t22345678\tIntendenta');
  const [logs, setLogs] = useState<string[]>([]);
  const [results, setResults] = useState<MiningResult[]>([]);
  const [isMining, setIsMining] = useState(false);
  const [progress, setProgress] = useState(0);

  const addLog = (msg: string) => setLogs(prev => [...prev, msg]);

  function getValidCuits(dni: string): string[] {
    const dniStr = String(dni).replace(/\D/g, '').padStart(8, '0');
    const validCuits: string[] = [];
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
          else z = null;
      } else {
          z = 11 - remainder;
      }
      
      if (z !== null && z >= 0 && z <= 9) {
          validCuits.push(base + String(z));
      }
    });

    return [...new Set(validCuits)];
  }

  const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

  // Capitalize name
  const formatName = (str: string) => {
    return str.toLowerCase().split(' ').map(s => s.charAt(0).toUpperCase() + s.substring(1)).join(' ');
  };

  const startMining = async () => {
    setIsMining(true);
    setLogs([]);
    setResults([]);
    setProgress(0);

    const lines = inputData.split('\n').map(l => l.trim()).filter(l => l.length > 5);
    const parsedRows: RawRow[] = lines.map(line => {
      // Intenta separar por tabs primero (pegar de excel)
      let parts = line.split('\t');
      if (parts.length < 2) {
          // Si no hay tabs, intentamos separar por coma
          parts = line.split(',');
      }
      return {
        nombre: parts[0]?.trim() || '',
        dni: parts[1]?.trim() || '',
        cargo: parts[2]?.trim() || 'Funcionario'
      };
    }).filter(r => r.nombre && r.dni);

    addLog(`Iniciando minería para ${parsedRows.length} personas...`);
    const mined: MiningResult[] = [];

    for (let i = 0; i < parsedRows.length; i++) {
      const row = parsedRows[i];
      addLog(`[${i+1}/${parsedRows.length}] Procesando ${row.nombre} (DNI ${row.dni})...`);
      
      const candidates = getValidCuits(row.dni);
      addLog(`   -> CUITs probables: ${candidates.join(', ')}`);
      
      let foundCuit = null;
      let foundName = null;

      for (const cuit of candidates) {
        addLog(`   -> Consultando a BCRA para ${cuit}...`);
        try {
          // Reutilizamos nuestro fetchBcraDeudas que ya resuelve CORS/Proxies automágicamente
          const bcraData = await fetchBcraDeudas(cuit);
          if (bcraData && bcraData.nombre && bcraData.nombre !== cuit) {
             foundCuit = cuit;
             foundName = bcraData.nombre;
             addLog(`   ✅ ÉXITO: Confirmado como ${foundName}`);
             break;
          }
        } catch (e: any) {
          if (!e.message.includes("404") && !e.message.includes("No se encontraron deudas")) {
              addLog(`   ⚠️ BCRA Error: ${e.message}`);
          }
        }
        await delay(300); // 300ms de cortesía para no saturar 
      }

      if (foundCuit && foundName) {
         mined.push({
            cuit: foundCuit,
            nombre_bcra: formatName(foundName),
            cargo: row.cargo,
            poder: "ejecutivo",
            distrito: "Misiones"
         });
      } else {
         addLog(`   ❌ FALLO: No se validó identidad en BCRA para el DNI ${row.dni}`);
      }

      setProgress(Math.round(((i + 1) / parsedRows.length) * 100));
    }

    setResults(mined);
    setIsMining(false);
    addLog('✨ Minería completada.');
  };

  const downloadJSON = () => {
    // Generar formato final compatible con app (ej politicos_full.json)
    const finalData = results.map(r => ({
      cuit: r.cuit,
      nombre: r.nombre_bcra,
      cargo: r.cargo,
      poder: r.poder,
      distrito: r.distrito,
      historial: [],
      hipoteca_bcra: { tiene: false },
      cambios_nivel: false
    }));

    const blob = new Blob([JSON.stringify(finalData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'misiones_peps.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Limpiador básico de nombres extraídos
  const cleanName = (nameRaw: string) => {
    return nameRaw
        .replace(/(?:^|\s)(?:EL|LA|AL|A LA|DEL|SE([ÑN]?)OR(?:[A])?|DR(?:[A])?|LIC(?:[A])?|ABG|DON|DOÑA|SR(?:[A])?\.?)(?=\s)/gi, '')
        .replace(/[,()]/g, '')
        .trim();
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    addLog(`[+] Leyendo archivo PDF: ${file.name}...`);
    try {
      // Importación dinámica para evitar crashear el SSR Builder (Node.js) en Vite
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

      const arrayBuffer = await file.arrayBuffer();
      const pdf: any = await (pdfjsLib.getDocument(arrayBuffer) as any).promise;
      
      let fullText = "";
      addLog(`[+] Extrayendo texto de ${pdf.numPages} páginas...`);
      for (let i = 1; i <= pdf.numPages; i++) {
         const page: any = await pdf.getPage(i);
         const content: any = await page.getTextContent();
         const pageText = content.items.map((item: any) => item.str).join(' ');
         fullText += pageText + " ";
      }

      addLog(`[+] Buscando patrones de designación militar/burocrática...`);
      
      const dniRegex = /D\.?N\.?I\.?(?:\s*[Nn]?[°ºo.])?\s*([\d]{1,2}(?:\.?[\d]{3}){2}|[\d]{7,8})/g;
      
      let match;
      const candidates = [];
      const windowSize = 250; 

      while ((match = dniRegex.exec(fullText)) !== null) {
          const dniRaw = match[1];
          const dniClean = dniRaw.replace(/\D/g, ''); 
          if (dniClean.length > 8 || dniClean.length < 7) continue;

          const matchIndex = match.index;
          const start = Math.max(0, matchIndex - windowSize);
          const end = Math.min(fullText.length, matchIndex + windowSize);
          const chunk = fullText.substring(start, end).replace(/\n/g, ' '); 

          // Heurística
          const isDesignation = /des[íi]gnas[ea]|nómbras[ea]|nombrar|designar|cargo de|en su reemplazo/i.test(chunk);
          
          if (isDesignation) {
              let nameExtracted = "DESCONOCIDO";
              const textBeforeDNI = fullText.substring(start, matchIndex).replace(/\n/g, ' ').trim();
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

      // Evitar duplicados por DNI
      const uniqueCandidates = Array.from(new Map(candidates.map(item => [item.dni, item])).values());
      addLog(`✨ Extracción exitosa: ${uniqueCandidates.length} designaciones encontradas.`);

      if (uniqueCandidates.length > 0) {
         const tsvData = uniqueCandidates.map(c => `${c.nombre}\t${c.dni}\t${c.cargo}`).join('\n');
         setInputData(prev => prev.trim() ? prev + '\n' + tsvData : tsvData);
         addLog(`[+] Completado! Datos inyectados en la tabla de extracción.`);
      } else {
         addLog(`[!] No se encontraron designaciones en el PDF.`);
      }

    } catch (e: any) {
      addLog(`❌ Error procesando PDF: ${e.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col p-6">
      <h1 className="text-3xl font-black text-gray-900 mb-2 uppercase">Extractor de Identidades OSINT</h1>
      <p className="text-gray-600 mb-6">Pega aquí los datos extraídos o <strong>sube un Boletín en PDF</strong> para que la IA extraiga los DNI y valide los identidades reales contra el BCRA en modo incógnito.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Panel izquierdo */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
          
          <div className="mb-4 bg-blue-50 border border-blue-200 p-3 rounded text-sm text-blue-900">
             <label className="block font-bold mb-1 uppercase text-xs tracking-wide">1. Procesar Boletín Oficial (PDF) Automáticamente</label>
             <input type="file" accept=".pdf" onChange={handlePdfUpload} disabled={isMining} className="w-full text-xs" />
          </div>

          <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">2. Datos Crudos Encontrados</label>
          <p className="text-xs text-gray-500 mb-2">Edita manualmente o usa el extractor de PDF arriba. Formato: `Nombre [TAB] DNI [TAB] Cargo`</p>
          <textarea 
            value={inputData}
            onChange={e => setInputData(e.target.value)}
            disabled={isMining}
            className="w-full h-48 p-3 border border-gray-300 rounded font-mono text-xs bg-gray-50 focus:bg-white"
          />
          <button 
            disabled={isMining || inputData.trim() === ''}
            onClick={startMining}
            className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded uppercase tracking-wide disabled:opacity-50"
          >
            {isMining ? 'Minando BCRA...' : 'Iniciar Extracción'}
          </button>
        </div>

        {/* Panel derecho */}
        <div className="bg-gray-900 p-4 rounded-xl shadow-sm border border-gray-800 text-green-400 font-mono text-xs flex flex-col">
          <div className="flex justify-between items-center mb-2">
            <span className="font-bold uppercase tracking-wide text-gray-100">Terminal de Procesamiento</span>
            <span className="text-blue-400">{progress}% Completado</span>
          </div>
          <div className="flex-1 overflow-y-auto bg-black p-3 rounded">
            {logs.map((L, i) => (
              <div key={i} className="mb-1 leading-tight">{L}</div>
            ))}
          </div>

          {results.length > 0 && !isMining && (
            <button 
              onClick={downloadJSON}
              className="mt-4 bg-green-600 hover:bg-green-500 text-white font-bold py-3 rounded uppercase tracking-wide"
            >
              ⬇️ Descargar misiones_peps.json ({results.length} validados)
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
