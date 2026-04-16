import { useMemo, useState, useEffect } from 'react';
import { Home, AlertCircle, X, Users, ShieldAlert, ArrowDownAZ, ArrowUpAZ, TrendingUp, BarChart2, Download } from 'lucide-react';

import type { Legislator } from './types';
import { COLORS } from './Colors';
import { usePostHog } from '@posthog/react';
import { fetchBcraDeudas } from './bcraService';

const SITUACION_BCRA: Record<number, { label: string; color: string }> = {
  0:  { label: 'Sin datos',          color: '#9ca3af' },
  1:  { label: 'Normal',             color: '#16a34a' },
  2:  { label: 'Riesgo bajo',        color: '#ca8a04' },
  3:  { label: 'Riesgo medio',       color: '#ea580c' },
  4:  { label: 'Riesgo alto',        color: '#dc2626' },
  5:  { label: 'Irrecuperable',      color: '#7f1d1d' },
  11: { label: 'Con garantías "A"',  color: '#0284c7' },
}

const getDebtStats = (l: Legislator) => {
  const monthly: { [key: string]: number } = {};
  let total = 0;
  const months = new Set<string>();

  for (const h of (l.historial || [])) {
    monthly[h.fecha] = (monthly[h.fecha] || 0) + h.monto;
    total += h.monto;
    months.add(h.fecha);
  }

  let max = 0;
  let maxDate = '';
  for (const [date, amount] of Object.entries(monthly)) {
    if (amount > max) {
      max = amount;
      maxDate = date;
    }
  }

  return {
    max,
    maxDate,
    avg: months.size > 0 ? total / months.size : 0
  };
};

interface LegislatorSelectorProps {
  legisladores: Legislator[];
  onSelect: (l: Legislator) => void;
  selectedIds?: string[];
  selectedColors?: Record<string, string>;
}

export default function LegislatorSelector({
  legisladores,
  onSelect,
  selectedIds = [],
  selectedColors = {},
}: LegislatorSelectorProps) {
  const posthog = usePostHog();
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [positionFilter, setPositionFilter] = useState("todos");
  const [provinceFilter, setProvinceFilter] = useState("todas");
  const [partyFilter, setPartyFilter] = useState("todos");
  const [unitFilter, setUnitFilter] = useState("todas");
  const [cargoApnFilter, setCargoApnFilter] = useState("todos");
  const [cargoJudicialFilter, setCargoJudicialFilter] = useState("todos");
  const [camaraFilter, setCamaraFilter] = useState("todas");
  const [creditFilter, setCreditFilter] = useState("todos");
  const [levelChangeFilter, setLevelChangeFilter] = useState("todos");
  const [familiaresFilter, setFamiliaresFilter] = useState("todos");
  const [situacionFilter, setSituacionFilter] = useState("todos");
  const [sortOrder, setSortOrder] = useState("nombre_asc");

  const [cuitSearchTerm, setCuitSearchTerm] = useState("");
  const [isSearchingBcra, setIsSearchingBcra] = useState(false);
  const [bcraError, setBcraError] = useState<string | null>(null);

  const provinces = useMemo(() => [...new Set(legisladores.filter(l => l.distrito !== undefined).map(l => l.distrito).filter(p => (p || '').trim() !== ''))].sort(), [legisladores]);
  const parties = useMemo(() => [...new Set(legisladores.filter(l => l.partido !== undefined).map(l => l.partido).filter(p => (p || '').trim() !== ''))].sort(), [legisladores]);
  const units = useMemo(() => [...new Set(legisladores.filter(l => l.unidad !== undefined).map(l => l.unidad).filter(u => (u || '').trim() !== ''))].sort(), [legisladores]);
  const cargosApn = useMemo(() => [...new Set(legisladores.filter(l => l.poder === 'ejecutivo' && l.cargo).map(l => l.cargo).filter(c => (c || '').trim() !== ''))].sort(), [legisladores]);
  const cargosJudicial = useMemo(() => [...new Set(legisladores.filter(l => l.poder === 'judicial' && l.cargo).map(l => l.cargo).filter(c => (c || '').trim() !== ''))].sort(), [legisladores]);
  const camaras = useMemo(() => [...new Set(legisladores.filter(l => l.poder === 'judicial' && l.camara).map(l => l.camara).filter(c => (c || '').trim() !== ''))].sort(), [legisladores]);

  const debtStats = useMemo(() => {
    const stats = new Map<string, { max: number; avg: number; maxDate: string }>();
    legisladores.forEach(l => {
      stats.set(l.cuit, getDebtStats(l));
    });
    return stats;
  }, [legisladores]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchTerm]);


  const filteredAndSorted = useMemo(() => {
    return legisladores
      .filter(l => {
        const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const searchMatch = debouncedSearchTerm === "" || normalize(l.nombre).includes(normalize(debouncedSearchTerm));


        const isLegislador = l.poder === 'legislativo';
        const isJudicial = l.poder === 'judicial';
        const positionMatch = positionFilter === 'todos' ||
          (positionFilter === 'legisladores' && isLegislador) ||
          (positionFilter === 'apn' && !isLegislador && !isJudicial) ||
          (positionFilter === 'judicial' && isJudicial);
        const provinceMatch = provinceFilter === 'todas' || l.distrito === provinceFilter;
        const partyMatch = partyFilter === 'todos' || l.partido === partyFilter;
        const unitMatch = unitFilter === 'todas' || l.unidad === unitFilter;
        const cargoApnMatch = cargoApnFilter === 'todos' || l.cargo === cargoApnFilter;
        const cargoJudicialMatch = cargoJudicialFilter === 'todos' || l.cargo === cargoJudicialFilter;
        const camaraMatch = camaraFilter === 'todas' || l.camara === camaraFilter;

        const creditMatch = creditFilter === 'todos' || (creditFilter === 'si' ? l.hipoteca_bcra.tiene : !l.hipoteca_bcra.tiene);
        const levelChangeMatch = levelChangeFilter === 'todos' || (levelChangeFilter === 'si' ? l.cambios_nivel : !l.cambios_nivel);
        const hasFamiliares = l.familiares && l.familiares.length > 0;
        const familiaresMatch = familiaresFilter === 'todos' || (familiaresFilter === 'si' ? hasFamiliares : !hasFamiliares);
        const situacionMatch = situacionFilter === 'todos' || String(l.situacion_bcra ?? 1) === situacionFilter;

        return selectedIds.includes(l.cuit) || (searchMatch && positionMatch && provinceMatch && partyMatch && unitMatch && cargoApnMatch && cargoJudicialMatch && camaraMatch && creditMatch && levelChangeMatch && familiaresMatch && situacionMatch);
      })
      .sort((a, b) => {
        const aSelected = selectedIds.includes(a.cuit);
        const bSelected = selectedIds.includes(b.cuit);
        if (aSelected !== bSelected) return aSelected ? -1 : 1;

        if (sortOrder === 'nombre_desc') return b.nombre.localeCompare(a.nombre);
        if (sortOrder === 'nombre_asc') return a.nombre.localeCompare(b.nombre);

        const statsA = debtStats.get(a.cuit)!;
        const statsB = debtStats.get(b.cuit)!;

        if (sortOrder === 'max_deuda_desc') return statsB.max - statsA.max;
        if (sortOrder === 'promedio_deuda_desc') return statsB.avg - statsA.avg;

        return 0;
      });
  }, [legisladores, debouncedSearchTerm, positionFilter, provinceFilter, partyFilter, unitFilter, cargoApnFilter, cargoJudicialFilter, camaraFilter, creditFilter, levelChangeFilter, familiaresFilter, situacionFilter, selectedIds, sortOrder, debtStats]);

  const [showMobileFilters, setShowMobileFilters] = useState(false);

  const handleExportCSV = () => {
    const headers = [
      "CUIT", "Nombre", "Poder", "Bloque/Partido", "Cargo/Unidad",
      "Provincia", "Tiene Hipoteca/Garantía", "Nivel Riesgo Máx (BCRA)", "Monto Máximo", "Fecha Monto Máx"
    ];

    const csvContent = [
      headers.join(","),
      ...filteredAndSorted.map(l => {
        const stats = debtStats.get(l.cuit);
        const montoMax = stats ? stats.max : 0;
        const maxDate = stats ? stats.maxDate : '';
        return [
          l.cuit,
          `"${(l.nombre || '').replace(/"/g, '""')}"`,
          l.poder || '',
          `"${(l.partido || '').replace(/"/g, '""')}"`,
          `"${(l.cargo || l.unidad || '').replace(/"/g, '""')}"`,
          l.distrito || '',
          l.hipoteca_bcra?.tiene ? "Si" : "No",
          l.situacion_bcra || "",
          Math.round(montoMax),
          `"${maxDate}"`
        ].join(",");
      })
    ].join("\n");

    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `central_de_deudores_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    posthog?.capture('exported_csv', { count: filteredAndSorted.length });
  };

  return (
    <div className="w-full h-full flex flex-col bg-white overflow-hidden shadow-md">
      
      {/* 1. Header Fijo (Buscar y Toggle de Filtros) */}
      <div className="p-4 border-b shrink-0 bg-white flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-20">
        <div className="flex justify-between items-center shrink-0">
          <div>
            <h2 className="font-bold text-gray-800 text-lg">Funcionarios ({filteredAndSorted.length})</h2>
            <p className="text-xs text-gray-500 mt-0.5 leading-snug">Deuda BCRA · Selecciona para el gráfico</p>
          </div>
          <button 
            className="md:hidden text-xs bg-gray-100 px-3 py-2 border rounded-lg text-gray-700 font-semibold"
            onClick={() => setShowMobileFilters(!showMobileFilters)}
          >
            {showMobileFilters ? 'Ocultar Filtros' : 'Más Filtros'}
          </button>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
          {/* Búsqueda por Nombre */}
          <input
            className="w-full sm:w-64 p-2 border border-gray-300 rounded-lg text-sm bg-gray-50 focus:bg-white transition-colors"
            placeholder="Buscar por nombre..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
          
          {/* Búsqueda por CUIT (reducido a barra compacta) */}
          <form className="flex gap-2 w-full sm:w-auto" onSubmit={async (e) => {
            e.preventDefault();
            if (!cuitSearchTerm || cuitSearchTerm.length < 11) { setBcraError("Ingrese 11 dígitos"); return; }
            try {
              setBcraError(null); setIsSearchingBcra(true);
              const customLegislator = await fetchBcraDeudas(cuitSearchTerm);
              onSelect({ ...customLegislator, slug: customLegislator.cuit } as any);
              setCuitSearchTerm('');
            } catch(e: any) { setBcraError(e.message); } finally { setIsSearchingBcra(false); }
          }}>
            <input
              id="search-cuit"
              className="w-full sm:w-48 p-2 border border-gray-300 rounded-lg text-sm bg-gray-50 focus:bg-white"
              placeholder="Añadir otro CUIT..."
              value={cuitSearchTerm}
              onChange={e => setCuitSearchTerm(e.target.value)}
              disabled={isSearchingBcra}
            />
            <button type="submit" disabled={isSearchingBcra} className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-4 py-2 rounded-lg text-sm font-semibold transition">
              {isSearchingBcra ? '...' : '+'}
            </button>
          </form>
        </div>
      </div>
      
      {/* Mensaje error BCRA flotante */}
      {bcraError && <div className="px-4 py-2 bg-red-50 text-red-600 text-xs text-center border-b border-red-100">{bcraError}</div>}

      {/* 2. Barra de Filtros (Horizontal en Desktop) */}
      <div className={`p-4 bg-gray-50 border-b border-gray-200 shrink-0 overflow-y-auto max-h-[40vh] md:max-h-none md:overflow-visible transition-all ${showMobileFilters ? 'block' : 'hidden md:block'}`}>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3 items-end text-sm">
          
          <div className="col-span-2 lg:col-span-1 border border-gray-200 rounded p-1 bg-white flex gap-1 h-fit">
            {[
              { value: 'nombre_asc', icon: <ArrowDownAZ size={14} />, label: 'A' },
              { value: 'nombre_desc', icon: <ArrowUpAZ size={14} />, label: 'Z' },
              { value: 'max_deuda_desc', icon: <TrendingUp size={14} />, label: 'Max' },
              { value: 'promedio_deuda_desc', icon: <BarChart2 size={14} />, label: 'Prom' },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => { posthog?.capture('sort_order_changed', { sort_order: opt.value }); setSortOrder(opt.value); }}
                title={opt.label}
                className={`flex-1 flex items-center justify-center py-1 rounded text-xs ${sortOrder === opt.value ? 'bg-blue-100 text-blue-700 font-bold' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                {opt.icon}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-gray-500 text-[10px] uppercase font-bold mb-1">Poder</label>
            <select value={positionFilter} onChange={e => {
                const val = e.target.value; posthog?.capture('filter_applied', { filter: 'poder', value: val }); setPositionFilter(val);
                if (val === 'apn') { setProvinceFilter('todas'); setPartyFilter('todos'); setCargoJudicialFilter('todos'); } 
                else if (val === 'legisladores') { setUnitFilter('todas'); setCargoApnFilter('todos'); setCargoJudicialFilter('todos'); } 
                else if (val === 'judicial') { setProvinceFilter('todas'); setPartyFilter('todos'); setUnitFilter('todas'); setCargoApnFilter('todos'); } 
                else { setCamaraFilter('todas'); setCargoJudicialFilter('todos'); }
              }} className="w-full p-2 py-1.5 border border-gray-300 rounded shadow-sm bg-white text-gray-700 text-sm">
              <option value="todos">Todos</option>
              <option value="legisladores">Legislativo</option>
              <option value="apn">Ejecutivo</option>
              <option value="judicial">Judicial</option>
            </select>
          </div>

          {positionFilter === 'legisladores' && (
            <>
              <div>
                <label className="block text-gray-500 text-[10px] uppercase font-bold mb-1">Provincia</label>
                <select value={provinceFilter} onChange={e => setProvinceFilter(e.target.value)} className="w-full p-2 py-1.5 border border-gray-300 rounded shadow-sm bg-white text-gray-700 text-sm">
                  <option value="todas">Todas</option>
                  {provinces.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-gray-500 text-[10px] uppercase font-bold mb-1">Bloque</label>
                <select value={partyFilter} onChange={e => setPartyFilter(e.target.value)} className="w-full p-2 py-1.5 border border-gray-300 rounded shadow-sm bg-white text-gray-700 text-sm">
                  <option value="todos">Todos</option>
                  {parties.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </>
          )}

          {positionFilter === 'apn' && (
            <>
              <div>
                <label className="block text-gray-500 text-[10px] uppercase font-bold mb-1">Cargo</label>
                <select value={cargoApnFilter} onChange={e => setCargoApnFilter(e.target.value)} className="w-full p-2 py-1.5 border border-gray-300 rounded shadow-sm bg-white text-gray-700 text-sm">
                  <option value="todos">Todos</option>
                  {cargosApn.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-gray-500 text-[10px] uppercase font-bold mb-1">Unidad</label>
                <select value={unitFilter} onChange={e => setUnitFilter(e.target.value)} className="w-full p-2 py-1.5 border border-gray-300 rounded shadow-sm bg-white text-gray-700 text-sm">
                  <option value="todas">Todas</option>
                  {units.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </>
          )}

          {positionFilter === 'judicial' && (
            <>
              <div>
                <label className="block text-gray-500 text-[10px] uppercase font-bold mb-1">Cargo</label>
                <select value={cargoJudicialFilter} onChange={e => setCargoJudicialFilter(e.target.value)} className="w-full p-2 py-1.5 border border-gray-300 rounded shadow-sm bg-white text-gray-700 text-sm">
                  <option value="todos">Todos</option>
                  {cargosJudicial.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-gray-500 text-[10px] uppercase font-bold mb-1">Cámara</label>
                <select value={camaraFilter} onChange={e => setCamaraFilter(e.target.value)} className="w-full p-2 py-1.5 border border-gray-300 rounded shadow-sm bg-white text-gray-700 text-sm">
                  <option value="todas">Todas</option>
                  {camaras.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </>
          )}

          <div>
            <label className="flex items-center gap-1 text-gray-500 text-[10px] uppercase font-bold mb-1">
              <Home size={10} className="text-green-600" /> Garantía†
            </label>
            <select value={creditFilter} onChange={e => { posthog?.capture('filter_applied', { filter: 'garantia', value: e.target.value }); setCreditFilter(e.target.value); }} className="w-full p-2 py-1.5 border border-gray-300 rounded shadow-sm bg-white text-gray-700 text-sm">
              <option value="todos">Todos</option>
              <option value="si">Sí</option>
              <option value="no">No</option>
            </select>
          </div>

          <div>
            <label className="flex items-center gap-1 text-gray-500 text-[10px] uppercase font-bold mb-1">
              <ShieldAlert size={10} className="text-red-500" /> Situación
            </label>
            <select value={situacionFilter} onChange={e => { posthog?.capture('filter_applied', { filter: 'situacion_bcra', value: e.target.value }); setSituacionFilter(e.target.value); }} className="w-full p-2 py-1.5 border border-gray-300 rounded shadow-sm bg-white text-gray-700 text-sm">
              <option value="todos">Todas</option>
              {Object.entries(SITUACION_BCRA).map(([val, { label }]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="flex items-center gap-1 text-gray-500 text-[10px] uppercase font-bold mb-1">
              <AlertCircle size={10} className="text-orange-500" /> Alertas
            </label>
            <div className="flex gap-1 h-full">
              <button onClick={() => setLevelChangeFilter(levelChangeFilter === 'si' ? 'todos' : 'si')} title="Cambios Nivel Nocivos" className={`flex-1 border rounded shadow-sm p-1.5 flex justify-center items-center ${levelChangeFilter === 'si' ? 'bg-orange-100 border-orange-400 text-orange-700' : 'bg-white text-gray-400 border-gray-300'}`}>
                <AlertCircle size={14} />
              </button>
              <button onClick={() => setFamiliaresFilter(familiaresFilter === 'si' ? 'todos' : 'si')} title="Familiares en BCRA" className={`flex-1 border rounded shadow-sm p-1.5 flex justify-center items-center ${familiaresFilter === 'si' ? 'bg-blue-100 border-blue-400 text-blue-700' : 'bg-white text-gray-400 border-gray-300'}`}>
                <Users size={14} />
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 h-full justify-end">
            <button
              onClick={() => {
                setSearchTerm(""); setPositionFilter("todos"); setProvinceFilter("todas"); setPartyFilter("todos"); setUnitFilter("todas"); setCargoApnFilter("todos"); setCargoJudicialFilter("todos"); setCamaraFilter("todas"); setCreditFilter("todos"); setLevelChangeFilter("todos"); setFamiliaresFilter("todos"); setSituacionFilter("todos");
              }}
              className="w-full py-1.5 border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 shadow-sm text-xs font-bold rounded transition-colors"
            >
              Resetear
            </button>
            <button
              onClick={handleExportCSV}
              className="w-full flex justify-center items-center gap-1 py-1.5 border border-green-200 bg-green-50 hover:bg-green-100 text-green-700 shadow-sm text-xs font-bold rounded transition-colors"
              title="Descargar datos filtrados en CSV"
            >
              <Download size={12} /> CSV
            </button>
          </div>
        </div>
      </div>

      {/* 3. Área de Tabla (Scrollable Content) */}
      <div className="flex-1 overflow-x-auto overflow-y-auto bg-white">
        <table className="w-full min-w-max text-left text-sm whitespace-nowrap border-collapse">
          <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm border-b border-gray-200">
            <tr className="text-gray-500 text-[11px] uppercase tracking-wider">
              <th className="p-3 w-12 text-center">SEL</th>
              <th className="p-3">Nombre</th>
              <th className="p-3">Poder / Cargo</th>
              <th className="p-3">Distrito / Bloque</th>
              <th className="p-3">Situación BCRA</th>
              <th className="p-3 text-right">Deuda Máx.</th>
              <th className="p-3 text-center">Alertas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredAndSorted.map((l: Legislator) => {
              const index = selectedIds.indexOf(l.cuit);
              const isSelected = index !== -1;
              const color = isSelected ? (selectedColors[l.cuit] || COLORS[index % COLORS.length]) : undefined;
              const { max } = debtStats.get(l.cuit)!;
              
              let poderFormat = (l.poder ?? 'Otro').charAt(0).toUpperCase() + (l.poder ?? 'Otro').slice(1);
              let cargoFormat = l.cargo || l.unidad || '';
              let distritoSpace = l.distrito || '';
              let bloqueSpace = l.partido || '';

              return (
                <tr
                  key={l.cuit}
                  onClick={() => onSelect(l)}
                  className={`hover:bg-blue-50/50 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50' : ''}`}
                >
                  <td className="p-3 text-center align-middle">
                    <div
                      className="w-5 h-5 mx-auto rounded border shadow-sm flex items-center justify-center transition-all"
                      style={{ 
                        backgroundColor: isSelected ? color : '#fff',
                        borderColor: isSelected ? color : '#d1d5db'
                      }}
                    >
                      {isSelected && <X size={14} className="text-white" />}
                    </div>
                  </td>
                  
                  <td className="p-3 font-semibold text-gray-800 flex items-center gap-2">
                    {l.nombre}
                    {l.es_candidato && (
                      <span title="Candidato" className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-300">Cand.</span>
                    )}
                  </td>
                  
                  <td className="p-3 text-gray-600">
                    <span className="font-medium text-gray-800">{poderFormat}</span>
                    {cargoFormat && <span className="text-gray-400 mx-1">|</span>}
                    {cargoFormat && <span className="text-xs">{cargoFormat}</span>}
                  </td>
                  
                  <td className="p-3 text-gray-600">
                    <span className="font-medium text-gray-800">{distritoSpace || '-'}</span>
                    {bloqueSpace && <span className="text-gray-400 mx-1">|</span>}
                    {bloqueSpace && <span className="text-xs truncate max-w-[150px] inline-block align-bottom">{bloqueSpace}</span>}
                  </td>
                  
                  <td className="p-3">
                    {l.situacion_bcra !== undefined ? (
                      <span
                        className="text-[11px] font-bold px-2 py-1 rounded-full shadow-sm"
                        style={{ backgroundColor: SITUACION_BCRA[l.situacion_bcra]?.color ?? '#9ca3af', color: '#fff' }}
                      >
                        {SITUACION_BCRA[l.situacion_bcra]?.label ?? l.situacion_bcra}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">-</span>
                    )}
                  </td>
                  
                  <td className="p-3 text-right font-mono font-medium">
                    {max > 0 ? (
                      <span className="bg-gray-100 text-gray-800 px-2 py-1 rounded">
                        {new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', notation: "compact", compactDisplay: "short" }).format(max * 1000)}
                      </span>
                    ) : <span className="text-gray-400">-</span>}
                  </td>
                  
                  <td className="p-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {l.hipoteca_bcra.tiene ? <span title="Garantía / Hipoteca"><Home size={16} className="text-green-600" /></span> : <div className="w-4" />}
                      {l.cambios_nivel ? <span title="Cambios nivel nocivos"><AlertCircle size={16} className="text-orange-500" /></span> : <div className="w-4" />}
                      {l.familiares && l.familiares.length > 0 ? <span title="Familiares en BCRA"><Users size={16} className="text-blue-500" /></span> : <div className="w-4" />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export { SITUACION_BCRA };
