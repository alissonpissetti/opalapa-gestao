import { fetchGrupos, fetchGrupoSpaces, saveGrupoSpaces, moveEspacoReserva, moveEspacosReserva } from './api.js';
import { isSaleGroupValorLeader } from './format.js';

const GRUPO_STORAGE_KEY = 'opalapa-grupo-ativo';

export function defaultSpace(numero = 0) {
  return {
    numero,
    label: numero ? `Espaço ${numero}` : '',
    points: '',
    status: 'disp',
    tipo: '',
    client: '',
    participanteId: null,
    participanteNome: '',
    obs: '',
    custo: null,
    valor: null,
    valorPago: null,
    valorFalta: null,
    saleGroup: '',
    updatedAt: null,
  };
}

export function createSpacesStore() {
  const spaces = {};
  let grupos = [];
  let currentGrupo = null;
  let ready = false;
  let saving = false;
  let saveError = null;
  let tiposComercio = [];
  let participantes = [];

  function spaceNumeros() {
    return Object.keys(spaces)
      .map(Number)
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
  }

  function applySpacesData(remoteSpaces) {
    Object.keys(spaces).forEach((k) => delete spaces[k]);
    for (const [key, data] of Object.entries(remoteSpaces || {})) {
      const numero = Number(key);
      spaces[numero] = { ...defaultSpace(numero), ...data, numero };
    }
  }

  async function loadGrupos() {
    const data = await fetchGrupos();
    grupos = data.grupos || [];
    return grupos;
  }

  async function loadGrupo(slug) {
    const data = await fetchGrupoSpaces(slug);
    currentGrupo = data.grupo;
    applySpacesData(data.spaces);
    if (data.participantes) participantes = data.participantes;
    ready = true;
    saveError = null;
    sessionStorage.setItem(GRUPO_STORAGE_KEY, slug);
    return currentGrupo;
  }

  async function load() {
    await loadGrupos();
    const saved = sessionStorage.getItem(GRUPO_STORAGE_KEY);
    const slug = grupos.some((g) => g.slug === saved) ? saved : grupos[0]?.slug;
    if (!slug) throw new Error('Nenhum agrupamento de espaços configurado');
    await loadGrupo(slug);
  }

  async function switchGrupo(slug) {
    if (currentGrupo?.slug === slug) return currentGrupo;
    await loadGrupo(slug);
    return currentGrupo;
  }

  async function moveReserva(origemNumero, payload) {
    if (!ready || !currentGrupo) return;

    saving = true;
    saveError = null;
    try {
      const data = await moveEspacoReserva(currentGrupo.slug, origemNumero, payload);
      currentGrupo = data.grupo;
      applySpacesData(data.spaces);
      if (data.tipos) tiposComercio = data.tipos;
      if (data.participantes) participantes = data.participantes;
    } catch (err) {
      saveError = err.message;
      throw err;
    } finally {
      saving = false;
    }
  }

  async function moveReservas(movimentos, payload) {
    if (!ready || !currentGrupo) return;

    saving = true;
    saveError = null;
    try {
      const data = await moveEspacosReserva(currentGrupo.slug, { ...payload, movimentos });
      currentGrupo = data.grupo;
      applySpacesData(data.spaces);
      if (data.tipos) tiposComercio = data.tipos;
      if (data.participantes) participantes = data.participantes;
    } catch (err) {
      saveError = err.message;
      throw err;
    } finally {
      saving = false;
    }
  }

  async function persist(changedNumeros, explicitUpdates) {
    if (!ready || !currentGrupo) return;

    const updates =
      explicitUpdates ??
      (changedNumeros?.length
        ? changedNumeros.map(Number).map((numero) => buildSpaceUpdate(numero))
        : spaceNumeros().map((numero) => buildSpaceUpdate(numero)));

    saving = true;
    saveError = null;
    try {
      const data = await saveGrupoSpaces(currentGrupo.slug, updates);
      currentGrupo = data.grupo;
      applySpacesData(data.spaces);
      if (data.tipos) tiposComercio = data.tipos;
      if (data.participantes) participantes = data.participantes;
    } catch (err) {
      saveError = err.message;
      throw err;
    } finally {
      saving = false;
    }
  }

  function isActiveStatus(status) {
    return status === 'lead' || status === 'neg' || status === 'res' || status === 'vend';
  }

  function totalNegociado() {
    let sum = 0;
    Object.entries(spaces).forEach(([numero, s]) => {
      if (s.valor == null || !isActiveStatus(s.status)) return;
      if (s.saleGroup && !isSaleGroupValorLeader(spaces, numero, s)) return;
      sum += Number(s.valor);
    });
    return sum;
  }

  function totalArrecadacaoField(field) {
    let sum = 0;
    Object.entries(spaces).forEach(([numero, s]) => {
      if (!isActiveStatus(s.status)) return;
      if (s.saleGroup && !isSaleGroupValorLeader(spaces, numero, s)) return;
      if (s[field] == null) return;
      sum += Number(s[field]);
    });
    return sum;
  }

  function totalPago() {
    return totalArrecadacaoField('valorPago');
  }

  function totalFalta() {
    return totalArrecadacaoField('valorFalta');
  }

  function totalCusto() {
    let sum = 0;
    Object.values(spaces).forEach((s) => {
      if (s.custo != null) sum += Number(s.custo);
    });
    return sum;
  }

  function totalsByStatus() {
    const totals = {
      disp: { count: 0, custo: 0, valor: 0, valorPago: 0, valorFalta: 0 },
      lead: { count: 0, custo: 0, valor: 0, valorPago: 0, valorFalta: 0 },
      neg: { count: 0, custo: 0, valor: 0, valorPago: 0, valorFalta: 0 },
      res: { count: 0, custo: 0, valor: 0, valorPago: 0, valorFalta: 0 },
      vend: { count: 0, custo: 0, valor: 0, valorPago: 0, valorFalta: 0 },
    };
    Object.entries(spaces).forEach(([numero, s]) => {
      const bucket = totals[s.status];
      if (!bucket) return;

      bucket.count += 1;
      if (s.custo != null) bucket.custo += Number(s.custo);

      if (!isActiveStatus(s.status)) return;
      if (s.saleGroup && !isSaleGroupValorLeader(spaces, numero, s)) return;
      if (s.valor != null) bucket.valor += Number(s.valor);
      if (s.valorPago != null) bucket.valorPago += Number(s.valorPago);
      if (s.valorFalta != null) bucket.valorFalta += Number(s.valorFalta);
    });

    return totals;
  }

  function buildSpaceUpdate(numero) {
    const s = spaces[numero];
    if (!s) {
      throw new Error(`Espaço ${numero} não encontrado`);
    }
    return {
      numero: Number(numero),
      status: s.status,
      tipo: s.tipo || '',
      client: s.client || '',
      participanteId: s.participanteId ?? null,
      participanteNome: s.participanteNome || '',
      obs: s.obs || '',
      custo: s.custo ?? null,
      valor: s.valor ?? null,
      saleGroup: s.saleGroup || '',
      points: s.points || '',
      updatedAt: s.updatedAt,
    };
  }

  return {
    spaces,
    get grupos() {
      return grupos;
    },
    get currentGrupo() {
      return currentGrupo;
    },
    spaceNumeros,
    load,
    loadGrupos,
    loadGrupo,
    switchGrupo,
    persist,
    moveReserva,
    moveReservas,
    isActiveStatus,
    totalNegociado,
    totalPago,
    totalFalta,
    totalCusto,
    totalsByStatus,
    get ready() {
      return ready;
    },
    get saving() {
      return saving;
    },
    get saveError() {
      return saveError;
    },
    get tiposComercio() {
      return tiposComercio;
    },
    setTiposComercio(tipos) {
      tiposComercio = tipos;
    },
    get participantes() {
      return participantes;
    },
    setParticipantes(list) {
      participantes = list;
    },
  };
}
