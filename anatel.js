"use strict";

/**
 * Base de faixas SMP da Anatel (arquivo público do nSAPN/ABR Telecom).
 * Guarda, por DDD + prefixo de 5 dígitos (9XXXX), as faixas atribuídas
 * dentro dos 4 últimos dígitos e a operadora de origem.
 */
const Anatel = (() => {
  const DB_NOME = "localizador-contato";
  const DB_STORE = "base";
  const DB_CHAVE = "anatel-smp";

  // { operadoras: string[], faixas: Map<"DDD9XXXX", number[] (ini, fim, op, ...)>, totalFaixas, importadaEm, arquivo }
  let base = null;

  // ---------- Leitura de arquivos (CSV, TXT ou ZIP) ----------

  async function lerArquivo(arquivo) {
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      const textos = await extrairZip(bytes);
      if (!textos.length) throw new Error("O ZIP não tem nenhum arquivo CSV ou TXT dentro.");
      return textos.map(decodificar).join("\n");
    }
    if (/\.xlsx?$/i.test(arquivo.name)) {
      throw new Error("Arquivo do Excel não é suportado. Abra no Excel e salve como CSV.");
    }
    return decodificar(bytes);
  }

  function decodificar(bytes) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return new TextDecoder("windows-1252").decode(bytes);
    }
  }

  async function extrairZip(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let fimDiretorio = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { fimDiretorio = i; break; }
    }
    if (fimDiretorio < 0) throw new Error("ZIP inválido.");

    const quantidade = view.getUint16(fimDiretorio + 10, true);
    let pos = view.getUint32(fimDiretorio + 16, true);
    const textos = [];

    for (let n = 0; n < quantidade; n++) {
      const metodo = view.getUint16(pos + 10, true);
      const tamanhoComprimido = view.getUint32(pos + 20, true);
      const tamNome = view.getUint16(pos + 28, true);
      const tamExtra = view.getUint16(pos + 30, true);
      const tamComentario = view.getUint16(pos + 32, true);
      const inicioLocal = view.getUint32(pos + 42, true);
      const nome = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + tamNome));
      pos += 46 + tamNome + tamExtra + tamComentario;

      if (!/\.(csv|txt)$/i.test(nome)) continue;
      const inicioDados = inicioLocal + 30 + view.getUint16(inicioLocal + 26, true) + view.getUint16(inicioLocal + 28, true);
      const dados = bytes.subarray(inicioDados, inicioDados + tamanhoComprimido);

      if (metodo === 0) {
        textos.push(dados);
      } else if (metodo === 8) {
        const fluxo = new Blob([dados]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        textos.push(new Uint8Array(await new Response(fluxo).arrayBuffer()));
      } else {
        throw new Error(`O arquivo "${nome}" dentro do ZIP usa uma compressão não suportada. Extraia o ZIP e importe o CSV.`);
      }
    }
    return textos;
  }

  // ---------- Interpretação do CSV ----------

  const normalizar = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const soDigitos = (s) => (s || "").replace(/\D/g, "");

  function dividirLinha(linha, sep) {
    const campos = [];
    let atual = "";
    let aspas = false;
    for (let i = 0; i < linha.length; i++) {
      const c = linha[i];
      if (c === '"') {
        if (aspas && linha[i + 1] === '"') { atual += '"'; i++; } else aspas = !aspas;
      } else if (c === sep && !aspas) {
        campos.push(atual.trim());
        atual = "";
      } else {
        atual += c;
      }
    }
    campos.push(atual.trim());
    return campos;
  }

  function detectarSeparador(linha) {
    let melhor = ";";
    let maior = 0;
    for (const sep of [";", ",", "\t", "|"]) {
      const n = linha.split(sep).length;
      if (n > maior) { maior = n; melhor = sep; }
    }
    return melhor;
  }

  function detectarColunas(cabecalho) {
    const nomes = cabecalho.map(normalizar);
    const achar = (teste) => nomes.findIndex(teste);
    return {
      ddd: achar((n) => n.includes("CODIGONACIONAL") || n === "CN" || n.includes("DDD")),
      prefixo: achar((n) => n.includes("PREFIXO")),
      inicio: achar((n) => n.includes("INICIAL") || n.includes("INICIO")),
      fim: achar((n) => n.includes("FINAL") || n.includes("FIM")),
      operadora: achar((n) => /PRESTADORA|OPERADORA|EMPRESA|RAZAOSOCIAL/.test(n) || (n.startsWith("NOME") && !n.includes("ARQUIVO"))),
      status: achar((n) => n.includes("STATUS") || n.includes("SITUACAO")),
    };
  }

  const STATUS_SEM_USO = /CANCEL|DEVOLV|VAG|LIVRE|DISPONIV|RESERV/;

  function nomeOperadora(bruto) {
    const n = normalizar(bruto);
    if (/TELEFONICA|VIVO/.test(n)) return "Vivo";
    if (/CLARO|EMBRATEL|NEXTEL|NETSERV/.test(n)) return "Claro";
    if (/^TIM|TIMSA|TIMCELULAR|TIMBRASIL/.test(n)) return "TIM";
    if (/^OI|TELEMAR|BRASILTELECOM|OIMOVEL/.test(n)) return "Oi";
    if (/ALGAR|CTBC/.test(n)) return "Algar";
    if (/SERCOMTEL/.test(n)) return "Sercomtel";
    return bruto.replace(/\s+/g, " ").trim() || "Não informada";
  }

  function interpretar(texto) {
    const linhas = texto.split(/\r?\n/);
    let inicio = -1;
    let sep = ";";
    let col = null;
    for (let i = 0; i < Math.min(linhas.length, 30); i++) {
      if (!linhas[i].trim()) continue;
      sep = detectarSeparador(linhas[i]);
      const c = detectarColunas(dividirLinha(linhas[i], sep));
      if (c.ddd >= 0 && c.prefixo >= 0) { col = c; inicio = i + 1; break; }
    }
    if (!col) {
      throw new Error("Não encontrei as colunas de DDD (Código Nacional) e Prefixo no arquivo. Confira se é o arquivo SMP do nSAPN.");
    }

    const operadoras = [];
    const indiceOperadora = new Map();
    const faixas = new Map();
    let totalFaixas = 0;
    let ignoradas = 0;

    for (let i = inicio; i < linhas.length; i++) {
      if (!linhas[i].trim()) continue;
      const campos = dividirLinha(linhas[i], sep);

      if (col.status >= 0 && STATUS_SEM_USO.test(normalizar(campos[col.status] || ""))) { ignoradas++; continue; }

      const ddd = soDigitos(campos[col.ddd]);
      let prefixo = soDigitos(campos[col.prefixo]);
      if (prefixo.length === 7 && prefixo.startsWith(ddd)) prefixo = prefixo.slice(2);
      // Prefixo antigo de 8 dígitos: só 6-9 eram celular (2-5 é telefone fixo)
      if (prefixo.length === 4) prefixo = /^[6-9]/.test(prefixo) ? "9" + prefixo : "";
      if (!/^[1-9][1-9]$/.test(ddd) || !/^9[1-9]\d{3}$/.test(prefixo)) { ignoradas++; continue; }

      let ini = 0;
      let fim = 9999;
      if (col.inicio >= 0 && col.fim >= 0) {
        const a = soDigitos(campos[col.inicio]);
        const b = soDigitos(campos[col.fim]);
        if (!a || !b) { ignoradas++; continue; }
        ini = Number(a.slice(-4));
        fim = Number(b.slice(-4));
        if (ini > fim) [ini, fim] = [fim, ini];
      }

      const nome = col.operadora >= 0 ? nomeOperadora(campos[col.operadora] || "") : "Não informada";
      if (!indiceOperadora.has(nome)) {
        indiceOperadora.set(nome, operadoras.length);
        operadoras.push(nome);
      }

      const chave = ddd + prefixo;
      if (!faixas.has(chave)) faixas.set(chave, []);
      faixas.get(chave).push(ini, fim, indiceOperadora.get(nome));
      totalFaixas++;
    }

    if (!totalFaixas) throw new Error("Nenhuma faixa de celular válida foi encontrada no arquivo.");
    normalizarFaixas(faixas);
    return { operadoras, faixas, totalFaixas, ignoradas };
  }

  /** Ordena as faixas de cada prefixo e corta repetições/sobreposições, para nenhum número contar duas vezes. */
  function normalizarFaixas(faixas) {
    for (const [chave, lista] of faixas) {
      const trios = [];
      for (let i = 0; i < lista.length; i += 3) trios.push([lista[i], lista[i + 1], lista[i + 2]]);
      trios.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const limpa = [];
      let ultimoFim = -1;
      for (let [ini, fim, op] of trios) {
        if (ini <= ultimoFim) ini = ultimoFim + 1;
        if (ini > fim) continue;
        limpa.push(ini, fim, op);
        ultimoFim = fim;
      }
      faixas.set(chave, limpa);
    }
  }

  // ---------- Armazenamento no navegador (IndexedDB) ----------

  function abrirBanco() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NOME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function operacao(modo, acao) {
    const db = await abrirBanco();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, modo);
      const req = acao(tx.objectStore(DB_STORE));
      tx.oncomplete = () => { db.close(); resolve(req.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  // ---------- API pública ----------

  // DDD -> [[prefixo "9XXXX", faixas (ini, fim, op, ...)], ...]
  let porDdd = new Map();

  function indexar() {
    porDdd = new Map();
    if (!base) return;
    normalizarFaixas(base.faixas);
    for (const [chave, lista] of base.faixas) {
      const ddd = Number(chave.slice(0, 2));
      if (!porDdd.has(ddd)) porDdd.set(ddd, []);
      porDdd.get(ddd).push([chave.slice(2), lista]);
    }
  }

  async function carregarSalva() {
    try {
      base = (await operacao("readonly", (s) => s.get(DB_CHAVE))) || null;
    } catch {
      base = null;
    }
    indexar();
    return base;
  }

  async function importar(arquivo) {
    const texto = await lerArquivo(arquivo);
    const dados = interpretar(texto);
    base = { ...dados, importadaEm: new Date().toISOString(), arquivo: arquivo.name };
    indexar();
    try {
      await operacao("readwrite", (s) => s.put(base, DB_CHAVE));
    } catch {
      // Sem IndexedDB (ex.: modo privado): a base vale só até fechar a página
    }
    return base;
  }

  async function remover() {
    base = null;
    indexar();
    try { await operacao("readwrite", (s) => s.delete(DB_CHAVE)); } catch { /* nada salvo */ }
  }

  /** Índice da operadora de origem do número (11 dígitos, com DDD) ou -1 se a faixa não foi atribuída. */
  function operadoraDe(numero) {
    const lista = base && base.faixas.get(numero.slice(0, 7));
    if (!lista) return -1;
    const sufixo = Number(numero.slice(7));
    for (let i = 0; i < lista.length; i += 3) {
      if (sufixo >= lista[i] && sufixo <= lista[i + 1]) return lista[i + 2];
    }
    return -1;
  }

  /**
   * Conta, por operadora, quantos números do padrão cabem nas faixas atribuídas.
   * grupos: listas de 9 conjuntos de dígitos possíveis (posição 0 = o 9).
   */
  function contarPorOperadora(ddds, grupos) {
    const contagem = new Map();
    if (!base) return contagem;
    for (const grupo of grupos) {
      const conjPrefixo = grupo.slice(0, 5).map((c) => new Set(c));
      const sufixos = combinarSufixos(grupo.slice(5));
      for (const ddd of ddds) {
        for (const [prefixo, lista] of porDdd.get(ddd) || []) {
          let compativel = true;
          for (let p = 0; p < 5 && compativel; p++) compativel = conjPrefixo[p].has(prefixo[p]);
          if (!compativel) continue;
          for (let i = 0; i < lista.length; i += 3) {
            const n = contarNoIntervalo(sufixos, lista[i], lista[i + 1]);
            if (n) contagem.set(lista[i + 2], (contagem.get(lista[i + 2]) || 0) + n);
          }
        }
      }
    }
    return contagem;
  }

  /** Gera [numero, assinante, operadora] só dentro das faixas atribuídas (e das operadoras escolhidas, se houver). */
  function* numerosNaBase(ddds, grupos, operadoras) {
    if (!base) return;
    for (const ddd of ddds) {
      const blocos = (porDdd.get(ddd) || []).slice().sort((a, b) => (a[0] < b[0] ? -1 : 1));
      for (const grupo of grupos) {
        const conjPrefixo = grupo.slice(0, 5).map((c) => new Set(c));
        const sufixos = combinarSufixos(grupo.slice(5));
        for (const [prefixo, lista] of blocos) {
          let compativel = true;
          for (let p = 0; p < 5 && compativel; p++) compativel = conjPrefixo[p].has(prefixo[p]);
          if (!compativel) continue;
          const assinanteBase = Number(prefixo) * 10000;
          const faixas = [];
          for (let i = 0; i < lista.length; i += 3) {
            if (!operadoras || operadoras.has(lista[i + 2])) faixas.push([lista[i], lista[i + 1], lista[i + 2]]);
          }
          faixas.sort((a, b) => a[0] - b[0]);
          for (const [ini, fim, op] of faixas) {
            for (let k = primeiroMaiorOuIgual(sufixos, ini); k < sufixos.length && sufixos[k] <= fim; k++) {
              const assinante = assinanteBase + sufixos[k];
              yield [ddd * 1e9 + assinante, assinante, op];
            }
          }
        }
      }
    }
  }

  /**
   * Para cada uma das 9 posições do número, quais dígitos aparecem em algum número
   * possível dentro das faixas atribuídas (e das operadoras escolhidas, se houver).
   */
  function digitosPossiveis(ddds, grupos, operadoras) {
    const conjuntos = Array.from({ length: 9 }, () => new Set());
    if (!base) return conjuntos;
    for (const grupo of grupos) {
      const conjPrefixo = grupo.slice(0, 5).map((c) => new Set(c));
      const sufixos = combinarSufixos(grupo.slice(5));
      const locais = [new Set(), new Set(), new Set(), new Set()];
      const sufixosCompletos = () => locais.every((conj, p) => conj.size === grupo[5 + p].length);
      let sufixosCheios = false;

      for (const ddd of ddds) {
        for (const [prefixo, lista] of porDdd.get(ddd) || []) {
          let compativel = true;
          for (let p = 0; p < 5 && compativel; p++) compativel = conjPrefixo[p].has(prefixo[p]);
          if (!compativel) continue;

          for (let i = 0; i < lista.length; i += 3) {
            if (operadoras && !operadoras.has(lista[i + 2])) continue;
            const fim = lista[i + 1];
            let k = primeiroMaiorOuIgual(sufixos, lista[i]);
            if (k >= sufixos.length || sufixos[k] > fim) continue;

            for (let p = 0; p < 5; p++) conjuntos[p].add(prefixo[p]);
            for (; !sufixosCheios && k < sufixos.length && sufixos[k] <= fim; k++) {
              const s = String(sufixos[k]).padStart(4, "0");
              for (let p = 0; p < 4; p++) locais[p].add(s[p]);
              sufixosCheios = sufixosCompletos();
            }
          }
        }
      }
      locais.forEach((conj, p) => conj.forEach((d) => conjuntos[5 + p].add(d)));
    }
    return conjuntos;
  }

  /** Começos reais (DDD + 9XXXX) que têm números do padrão nas faixas, com a quantidade e a operadora. */
  function iniciosPossiveis(ddds, grupos, operadoras) {
    const inicios = new Map();
    if (!base) return [];
    for (const grupo of grupos) {
      const conjPrefixo = grupo.slice(0, 5).map((c) => new Set(c));
      const sufixos = combinarSufixos(grupo.slice(5));
      for (const ddd of ddds) {
        for (const [prefixo, lista] of porDdd.get(ddd) || []) {
          let compativel = true;
          for (let p = 0; p < 5 && compativel; p++) compativel = conjPrefixo[p].has(prefixo[p]);
          if (!compativel) continue;
          for (let i = 0; i < lista.length; i += 3) {
            if (operadoras && !operadoras.has(lista[i + 2])) continue;
            const n = contarNoIntervalo(sufixos, lista[i], lista[i + 1]);
            if (!n) continue;
            const chave = ddd + prefixo;
            const item = inicios.get(chave) || { ddd, prefixo, n: 0, operadoras: new Set() };
            item.n += n;
            item.operadoras.add(lista[i + 2]);
            inicios.set(chave, item);
          }
        }
      }
    }
    return [...inicios.values()].sort((a, b) => a.ddd - b.ddd || (a.prefixo < b.prefixo ? -1 : 1));
  }

  function combinarSufixos(conjuntos) {
    let valores = [0];
    for (const conj of conjuntos) {
      const proximos = [];
      for (const v of valores) for (const d of conj) proximos.push(v * 10 + Number(d));
      valores = proximos;
    }
    return valores.sort((a, b) => a - b);
  }

  function primeiroMaiorOuIgual(lista, alvo) {
    let a = 0;
    let b = lista.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if (lista[m] < alvo) a = m + 1; else b = m;
    }
    return a;
  }

  function contarNoIntervalo(ordenados, ini, fim) {
    return primeiroMaiorOuIgual(ordenados, fim + 1) - primeiroMaiorOuIgual(ordenados, ini);
  }

  return {
    carregarSalva,
    importar,
    remover,
    operadoraDe,
    contarPorOperadora,
    numerosNaBase,
    digitosPossiveis,
    iniciosPossiveis,
    get carregada() { return !!base; },
    get info() { return base; },
    get operadoras() { return base ? base.operadoras : []; },
  };
})();
