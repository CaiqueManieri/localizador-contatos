"use strict";

const DDDS_POR_UF = {
  AC: [68], AL: [82], AM: [92, 97], AP: [96], BA: [71, 73, 74, 75, 77],
  CE: [85, 88], DF: [61], ES: [27, 28], GO: [62, 64], MA: [98, 99],
  MG: [31, 32, 33, 34, 35, 37, 38], MS: [67], MT: [65, 66], PA: [91, 93, 94],
  PB: [83], PE: [81, 87], PI: [86, 89], PR: [41, 42, 43, 44, 45, 46],
  RJ: [21, 22, 24], RN: [84], RO: [69], RR: [95], RS: [51, 53, 54, 55],
  SC: [47, 48, 49], SE: [79], SP: [11, 12, 13, 14, 15, 16, 17, 18, 19], TO: [63],
};

const UF_DO_DDD = {};
for (const [uf, lista] of Object.entries(DDDS_POR_UF)) {
  for (const ddd of lista) UF_DO_DDD[ddd] = uf;
}
const TODOS_DDDS = Object.keys(UF_DO_DDD).map(Number).sort((a, b) => a - b);

const FAIXAS = {
  ampla: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
  classica: ["6", "7", "8", "9"],
};
const TODOS_DIGITOS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

const LIMITE = 3_000_000;
const ALTURA_LINHA = 28;
const ALTURA_MAX_PX = 15_000_000;
const LOTE = 40_000;

const $ = (id) => document.getElementById(id);
const dddsSelecionados = new Set();
const operadorasSelecionadas = new Set();

const normalizarTexto = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const CIDADES = MUNICIPIOS.map(([nome, uf, ddd, capital]) => ({ nome, uf, ddd, capital, chave: normalizarTexto(nome) }));
const CIDADES_POR_DDD = {};
for (const c of CIDADES) {
  const info = (CIDADES_POR_DDD[c.ddd] ||= { total: 0, capital: null });
  info.total++;
  if (c.capital) info.capital = c;
}
let cidadeEscolhida = null;
let sugestoes = [];
let sugestaoAtiva = -1;
const inputsDigitos = [...document.querySelectorAll("#digitos input[data-pos]")];

let resultado = new Float64Array(0);
let resultadoOperadora = new Int16Array(0);
let totalResultado = 0;
let gerando = false;

// ---------- Seleção de DDD ----------

function montarDdds() {
  const container = $("dddGrupos");
  for (const uf of Object.keys(DDDS_POR_UF).sort()) {
    const grupo = document.createElement("div");
    grupo.className = "grupo";

    const sigla = document.createElement("div");
    sigla.className = "uf";
    sigla.textContent = uf;
    sigla.title = `Marcar/desmarcar todos os DDDs de ${uf}`;
    sigla.addEventListener("click", () => {
      const lista = DDDS_POR_UF[uf];
      const todosMarcados = lista.every((d) => dddsSelecionados.has(d));
      lista.forEach((d) => (todosMarcados ? dddsSelecionados.delete(d) : dddsSelecionados.add(d)));
      atualizarChips();
    });

    const ddds = document.createElement("div");
    ddds.className = "ddds";
    for (const ddd of DDDS_POR_UF[uf]) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.dataset.ddd = ddd;
      chip.textContent = ddd;
      chip.addEventListener("click", () => {
        dddsSelecionados.has(ddd) ? dddsSelecionados.delete(ddd) : dddsSelecionados.add(ddd);
        atualizarChips();
      });
      ddds.appendChild(chip);
    }

    grupo.append(sigla, ddds);
    container.appendChild(grupo);
  }
}

function atualizarChips(sincronizarCampo = true) {
  const lista = [...dddsSelecionados].sort((a, b) => a - b);
  document.querySelectorAll("#dddGrupos .chip").forEach((chip) => {
    chip.classList.toggle("ativo", dddsSelecionados.has(Number(chip.dataset.ddd)));
  });

  const grupos = agruparPorUf(lista);
  const campo = $("dddDigitado");
  if (sincronizarCampo) campo.value = rotuloCampoDdd(lista, grupos);
  campo.classList.toggle("varios", lista.length > 1);
  campo.title = lista.length > 1 ? lista.join(", ") : "";

  if (cidadeEscolhida && !(lista.length === 1 && lista[0] === cidadeEscolhida.ddd)) {
    cidadeEscolhida = null;
    $("cidadeBusca").value = "";
  }

  $("resumoDdd").innerHTML = lista.length > 1 ? etiquetasDdd(lista, grupos) : lista.length === 1
    ? resumoDddUnico(lista[0])
    : "";

  atualizarEstimativa();
}

function resumoDddUnico(ddd) {
  const info = CIDADES_POR_DDD[ddd] || { total: 0, capital: null };
  const regiao = `região com ${info.total.toLocaleString("pt-BR")} municípios`;
  if (cidadeEscolhida) return `DDD <b>${ddd}</b> · ${escaparHtml(cidadeEscolhida.nome)} - ${cidadeEscolhida.uf} · ${regiao}`;
  const capital = info.capital ? `, incluindo ${escaparHtml(info.capital.nome)}` : "";
  return `DDD <b>${ddd}</b> · ${UF_DO_DDD[ddd]} · ${regiao}${capital}`;
}

// ---------- Busca por cidade ----------

function buscarCidades(texto) {
  let termo = normalizarTexto(texto);
  if (termo.length < 2) return [];
  let ufFiltro = null;
  const partes = termo.split(" ");
  if (partes.length > 1 && DDDS_POR_UF[partes[partes.length - 1].toUpperCase()]) {
    ufFiltro = partes.pop().toUpperCase();
    termo = partes.join(" ");
  }

  const achados = [];
  for (const c of CIDADES) {
    if (ufFiltro && c.uf !== ufFiltro) continue;
    let nota;
    if (c.chave === termo) nota = 0;
    else if (c.chave.startsWith(termo)) nota = 1;
    else if (c.chave.includes(" " + termo)) nota = 2;
    else if (c.chave.includes(termo)) nota = 3;
    else continue;
    achados.push({ c, nota });
  }
  achados.sort((a, b) => a.nota - b.nota || b.c.capital - a.c.capital || a.c.nome.localeCompare(b.c.nome, "pt-BR"));
  return achados.slice(0, 8).map((a) => a.c);
}

function mostrarSugestoes() {
  const ul = $("cidadeSugestoes");
  const texto = $("cidadeBusca").value;
  sugestoes = buscarCidades(texto);
  sugestaoAtiva = sugestoes.length ? 0 : -1;
  if (normalizarTexto(texto).length < 2) {
    ul.hidden = true;
    return;
  }
  ul.innerHTML = sugestoes.length
    ? sugestoes.map((c, i) =>
        `<li data-i="${i}" class="${i === sugestaoAtiva ? "ativo" : ""}">${escaparHtml(c.nome)}` +
        `<small>${c.uf} · DDD <b>${c.ddd}</b></small></li>`
      ).join("")
    : `<li class="nada">Nenhuma cidade encontrada</li>`;
  ul.hidden = false;
}

function destacarSugestao(i) {
  sugestaoAtiva = i;
  [...$("cidadeSugestoes").children].forEach((li, k) => {
    li.classList.toggle("ativo", k === i);
    if (k === i) li.scrollIntoView({ block: "nearest" });
  });
}

function escolherCidade(c) {
  $("cidadeSugestoes").hidden = true;
  dddsSelecionados.clear();
  dddsSelecionados.add(c.ddd);
  cidadeEscolhida = c;
  $("cidadeBusca").value = `${c.nome} - ${c.uf}`;
  atualizarChips();
  inputsDigitos[0].focus();
}

function configurarBuscaCidade() {
  const campo = $("cidadeBusca");
  const ul = $("cidadeSugestoes");
  campo.addEventListener("input", mostrarSugestoes);
  campo.addEventListener("focus", () => {
    if (cidadeEscolhida) campo.select();
    else if (campo.value) mostrarSugestoes();
  });
  campo.addEventListener("blur", () => setTimeout(() => (ul.hidden = true), 150));
  campo.addEventListener("keydown", (e) => {
    if (ul.hidden || !sugestoes.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); destacarSugestao((sugestaoAtiva + 1) % sugestoes.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); destacarSugestao((sugestaoAtiva - 1 + sugestoes.length) % sugestoes.length); }
    else if (e.key === "Enter") { e.preventDefault(); escolherCidade(sugestoes[sugestaoAtiva]); }
    else if (e.key === "Escape") ul.hidden = true;
  });
  ul.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-i]");
    if (!li) return;
    e.preventDefault();
    escolherCidade(sugestoes[Number(li.dataset.i)]);
  });
}

function agruparPorUf(lista) {
  const grupos = new Map();
  for (const ddd of lista) {
    const uf = UF_DO_DDD[ddd];
    if (!grupos.has(uf)) grupos.set(uf, []);
    grupos.get(uf).push(ddd);
  }
  return grupos;
}

function ufCompleta(uf, ddds) {
  return ddds.length === DDDS_POR_UF[uf].length && DDDS_POR_UF[uf].length > 1;
}

function rotuloCampoDdd(lista, grupos) {
  if (lista.length === 0) return "";
  if (lista.length === 1) return String(lista[0]);
  if (lista.length === TODOS_DDDS.length) return "BR";
  if (grupos.size === 1) {
    const [[uf, ddds]] = grupos;
    if (ufCompleta(uf, ddds)) return uf;
  }
  return `${lista.length} DDD`;
}

const MAX_ETIQUETAS = 8;

function etiquetasDdd(lista, grupos) {
  if (lista.length === TODOS_DDDS.length) {
    return `<div class="selecionados"><span class="tag">Todos os ${lista.length} DDDs do Brasil` +
      `<button data-remover="todos" title="Remover">×</button></span></div>`;
  }

  const tags = [];
  for (const [uf, ddds] of grupos) {
    if (ufCompleta(uf, ddds)) {
      tags.push(`<span class="tag"><b>${uf}</b> todos os ${ddds.length} DDDs` +
        `<button data-remover="${uf}" title="Remover ${uf}">×</button></span>`);
    } else {
      for (const ddd of ddds) {
        tags.push(`<span class="tag"><b>${ddd}</b> ${uf}<button data-remover="${ddd}" title="Remover ${ddd}">×</button></span>`);
      }
    }
  }

  const visiveis = tags.slice(0, MAX_ETIQUETAS);
  const resto = tags.length - visiveis.length;
  if (resto > 0) visiveis.push(`<button class="tag mais" data-abrir-ddds>+${resto}</button>`);
  return `<div class="selecionados">${visiveis.join("")}</div>`;
}

function removerSelecao(alvo) {
  if (alvo === "todos") dddsSelecionados.clear();
  else if (DDDS_POR_UF[alvo]) DDDS_POR_UF[alvo].forEach((d) => dddsSelecionados.delete(d));
  else dddsSelecionados.delete(Number(alvo));
  atualizarChips();
}

function lerDddsDigitados() {
  const campo = $("dddDigitado");
  const partes = campo.value.toUpperCase().split(/[^0-9A-Z]+/).filter(Boolean);
  const invalidos = [];
  dddsSelecionados.clear();
  for (const p of partes) {
    if (DDDS_POR_UF[p]) {
      DDDS_POR_UF[p].forEach((d) => dddsSelecionados.add(d));
    } else if (p === "BR") {
      TODOS_DDDS.forEach((d) => dddsSelecionados.add(d));
    } else if (/^\d+$/.test(p) && UF_DO_DDD[Number(p)]) {
      dddsSelecionados.add(Number(p));
    } else if (p.length >= 2 && !/^\d+DDD$/.test(p) && p !== "DDD") {
      invalidos.push(p);
    }
  }
  atualizarChips(false);
  if (invalidos.length) {
    mostrarMensagem(`Não existe no Brasil: ${invalidos.join(", ")}. Use um DDD (ex.: 11) ou a sigla do estado (ex.: SP).`, "erro");
  }
  if (/^\d{2}$/.test(campo.value) && dddsSelecionados.size === 1) inputsDigitos[0].focus();
}

// ---------- Dígitos conhecidos ----------

function configurarDigitos() {
  inputsDigitos.forEach((input, i) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(-1);
      if (input.value && i < inputsDigitos.length - 1) inputsDigitos[i + 1].focus();
      atualizarEstimativa();
    });
    input.addEventListener("keydown", (e) => {
      const anterior = i > 0 ? inputsDigitos[i - 1] : $("dddDigitado");
      if (e.key === "Backspace" && !input.value) anterior.focus();
      if (e.key === "ArrowLeft") anterior.focus();
      if (e.key === "ArrowRight" && i < inputsDigitos.length - 1) inputsDigitos[i + 1].focus();
    });
    input.addEventListener("paste", (e) => {
      e.preventDefault();
      const texto = (e.clipboardData.getData("text") || "").replace(/[^0-9?_xX*]/g, "");
      for (let k = 0; k < texto.length && i + k < inputsDigitos.length; k++) {
        const c = texto[k];
        inputsDigitos[i + k].value = /\d/.test(c) ? c : "";
      }
      atualizarEstimativa();
    });
  });
}

// ---------- Regras e montagem das combinações ----------

function parseDigitos(texto) {
  return [...new Set((texto.match(/\d/g) || []))];
}

/**
 * Monta a configuração da geração. Cada "grupo" é uma lista de 9 conjuntos de
 * dígitos possíveis (posição 0 = o nono dígito, sempre 9).
 */
function montarConfiguracao() {
  const faixa = document.querySelector("input[name=faixa]:checked").value;
  const excluidos = new Set(parseDigitos($("exclui").value));
  const obrigatorios = parseDigitos($("contem").value);
  const conhecidos = inputsDigitos.map((inp) => inp.value);

  if (dddsSelecionados.size === 0) {
    return { erro: "Comece digitando o DDD.", neutro: true };
  }

  const segundo = conhecidos[0];
  if (segundo && !FAIXAS[faixa].includes(segundo)) {
    return {
      erro: segundo === "0"
        ? "Celular brasileiro não tem 0 logo depois do 9 (faixa 90 não existe para celular)."
        : `Na faixa clássica o dígito depois do 9 precisa ser de 6 a 9. Troque para a faixa ampliada se o número começa com 9${segundo}.`,
    };
  }

  const base = [["9"]];
  const desconhecidas = [];
  for (let pos = 1; pos <= 8; pos++) {
    const valor = conhecidos[pos - 1];
    if (valor) {
      base.push([valor]);
    } else {
      const universo = pos === 1 ? FAIXAS[faixa] : TODOS_DIGITOS;
      const permitidos = universo.filter((d) => !excluidos.has(d));
      if (!permitidos.length) {
        return { erro: `Os dígitos excluídos não deixam nenhuma opção para a posição ${pos + 1}.` };
      }
      base.push(permitidos);
      desconhecidas.push(pos);
    }
  }

  if (obrigatorios.length > desconhecidas.length) {
    return { erro: "Há mais dígitos obrigatórios do que posições em branco." };
  }
  if (obrigatorios.some((d) => excluidos.has(d))) {
    return { erro: "Um mesmo dígito está como obrigatório e como excluído." };
  }

  let prefixos = $("prefixos").value.split(/[^0-9]+/).filter(Boolean);
  for (const p of prefixos) {
    if (p[0] !== "9") return { erro: `O prefixo "${p}" precisa começar com 9 (todo celular começa com 9).` };
    if (p.length > 9) return { erro: `O prefixo "${p}" tem mais de 9 dígitos.` };
  }
  // Remove prefixos repetidos ou já cobertos por um prefixo mais curto
  prefixos = [...new Set(prefixos)].sort((a, b) => a.length - b.length);
  prefixos = prefixos.filter((p, i) => !prefixos.slice(0, i).some((q) => p.startsWith(q)));
  if (!prefixos.length) prefixos = ["9"];

  const grupos = [];
  for (const p of prefixos) {
    const grupo = base.map((conj, pos) => (pos < p.length ? conj.filter((d) => d === p[pos]) : conj));
    if (grupo.every((conj) => conj.length)) grupos.push(grupo);
  }
  if (!grupos.length) {
    return { erro: "Nenhum prefixo informado é compatível com os dígitos e a faixa escolhidos." };
  }

  const porDdd = grupos.reduce((soma, g) => soma + g.reduce((m, conj) => m * conj.length, 1), 0);
  const ddds = [...dddsSelecionados].sort((a, b) => a - b);
  const total = porDdd * ddds.length;

  const contagem = Anatel.carregada ? Anatel.contarPorOperadora(ddds, grupos) : new Map();
  const operadoras = Anatel.carregada && operadorasSelecionadas.size ? new Set(operadorasSelecionadas) : null;
  const usaBase = Anatel.carregada && ($("soAtribuidas").checked || !!operadoras);
  let totalBase = 0;
  for (const [op, n] of contagem) if (!operadoras || operadoras.has(op)) totalBase += n;

  return {
    ddds,
    grupos,
    desconhecidas,
    obrigatorios,
    semRepetidos: $("semRepetidos").checked,
    operadoras,
    usaBase,
    contagem,
    total,
    totalBase,
    alvo: usaBase ? totalBase : total,
  };
}

function atualizarEstimativa() {
  if (gerando) return;
  const cfg = montarConfiguracao();
  const est = $("estimativa");
  renderizarOperadoras(cfg.erro ? null : cfg.contagem);
  if (!cfg.erro && cfg.usaBase) aplicarDicas(cfg);
  else limparDicas();
  renderizarInicios(cfg.erro || !cfg.usaBase ? null : cfg);
  if (cfg.erro) {
    est.innerHTML = `<span class="valor zero">0</span><span class="rotulo">possibilidades</span>`;
    mostrarMensagem(cfg.erro, cfg.neutro ? "" : "erro");
    $("gerar").disabled = true;
    return;
  }
  const temFiltroExtra = cfg.obrigatorios.length || cfg.semRepetidos;
  const fmt = (n) => n.toLocaleString("pt-BR");
  est.innerHTML = `<span class="valor${cfg.alvo ? "" : " zero"}">${temFiltroExtra ? "até " : ""}${fmt(cfg.alvo)}</span>` +
    `<span class="rotulo">possibilidade${cfg.alvo === 1 ? "" : "s"}` +
    (cfg.usaBase && cfg.total !== cfg.alvo ? ` · de ${fmt(cfg.total)} combinações, só essas existem na base da Anatel` : "") +
    `</span>`;
  if (cfg.alvo > LIMITE) {
    mostrarMensagem(
      `Passa do limite de ${fmt(LIMITE)} números. Preencha mais dígitos, escolha menos DDDs, marque uma operadora ou use o filtro "Começa com".`,
      "erro"
    );
    $("gerar").disabled = true;
  } else if (cfg.alvo === 0) {
    mostrarMensagem(cfg.operadoras
      ? "Nenhum número desse padrão nas faixas das operadoras marcadas. Se a pessoa fez portabilidade, o número pode ter nascido em outra operadora: tente desmarcar."
      : "Nenhum número desse padrão existe na base da Anatel.", "aviso");
    $("gerar").disabled = true;
  } else {
    mostrarMensagem("", "");
    $("gerar").disabled = false;
  }
}

// ---------- Dicas nas caixas: dígitos possíveis pela base da Anatel ----------

/** Ex.: [6,7,8,9] -> "6-9"; [1,5] -> "1/5"; [1,2,3,7] -> "1-3/7" */
function formatarDigitos(digitos) {
  const ordenados = [...digitos].map(Number).sort((a, b) => a - b);
  const partes = [];
  for (let i = 0; i < ordenados.length; ) {
    let j = i;
    while (j + 1 < ordenados.length && ordenados[j + 1] === ordenados[j] + 1) j++;
    if (j - i >= 2) partes.push(`${ordenados[i]}-${ordenados[j]}`);
    else for (let k = i; k <= j; k++) partes.push(String(ordenados[k]));
    i = j + 1;
  }
  return partes.join("/");
}

function limparDicas() {
  inputsDigitos.forEach((input) => {
    input.placeholder = "?";
    input.title = "";
    input.classList.remove("dica", "dica-multi", "dica-impossivel");
  });
  $("legendaDica").hidden = true;
}

function aplicarDicas(cfg) {
  const possiveis = Anatel.digitosPossiveis(cfg.ddds, cfg.grupos, cfg.operadoras);
  let algumaDica = false;

  inputsDigitos.forEach((input, i) => {
    const pos = i + 1;
    input.classList.remove("dica", "dica-multi", "dica-impossivel");
    input.placeholder = "?";
    input.title = "";
    if (input.value) return;

    const candidatos = new Set(cfg.grupos.flatMap((g) => g[pos]));
    const achados = [...possiveis[pos]].filter((d) => candidatos.has(d));
    if (achados.length === candidatos.size) return;

    algumaDica = true;
    input.classList.add("dica");
    if (achados.length === 0) {
      input.placeholder = "×";
      input.classList.add("dica-impossivel");
      input.title = "Nenhum dígito possível aqui com os filtros atuais";
      return;
    }
    const texto = formatarDigitos(achados);
    input.placeholder = texto.length <= 5 ? texto : "…";
    if (achados.length > 1) input.classList.add("dica-multi");
    input.title = achados.length === 1
      ? `Só pode ser ${achados[0]}`
      : `Pode ser: ${achados.sort().join(", ")}`;
  });

  $("legendaDica").hidden = !algumaDica;
  $("legendaDicaTexto").textContent = cfg.operadoras
    ? `Possível na${cfg.operadoras.size > 1 ? "s operadoras de origem marcadas" : " operadora de origem marcada"}`
    : "Possível pela base da Anatel";
  $("legendaDica").title = cfg.operadoras
    ? "Considera onde o número foi criado. Se a pessoa fez portabilidade, os dígitos podem ser de outra operadora."
    : "";
}

const MAX_INICIOS = 40;

/** Lista clicável dos começos de número (9XXXX) que existem de fato na base para o padrão atual. */
function renderizarInicios(cfg) {
  const caixa = $("inicios");
  const comecoConhecido = inputsDigitos.slice(0, 4).every((inp) => inp.value);
  if (!cfg || comecoConhecido) {
    caixa.hidden = true;
    return;
  }
  const inicios = Anatel.iniciosPossiveis(cfg.ddds, cfg.grupos, cfg.operadoras);
  if (!inicios.length) {
    caixa.hidden = true;
    return;
  }

  const fmt = (n) => n.toLocaleString("pt-BR");
  const varios = cfg.ddds.length > 1;
  const finalConhecido = inputsDigitos.slice(4).some((inp) => inp.value);
  let html = `<div class="titulo-inicios">${fmt(inicios.length)} começo${inicios.length > 1 ? "s" : ""} de número possíve${inicios.length > 1 ? "is" : "l"}` +
    `${finalConhecido ? " com o final que você digitou" : ""} <small>· clique para preencher</small></div>`;

  if (inicios.length > MAX_INICIOS) {
    html += `<div class="muitos">São muitos para listar. Preencha mais dígitos ou marque a operadora de origem para afunilar.</div>`;
  } else {
    html += `<div class="lista-inicios">` + inicios.map((it) => {
      const ops = [...it.operadoras].map((op) => Anatel.operadoras[op]).join(", ");
      const detalhe = `${fmt(it.n)} nº${cfg.operadoras && cfg.operadoras.size === 1 ? "" : " · " + escaparHtml(ops)}`;
      return `<button class="inicio" data-ddd="${it.ddd}" data-prefixo="${it.prefixo}" title="${escaparHtml(ops)}">` +
        `${varios ? `(${it.ddd}) ` : ""}${it.prefixo[0]} ${it.prefixo.slice(1)}<small>${detalhe}</small></button>`;
    }).join("") + `</div>`;
  }
  caixa.innerHTML = html;
  caixa.hidden = false;
}

function preencherInicio(ddd, prefixo) {
  prefixo.slice(1).split("").forEach((d, i) => (inputsDigitos[i].value = d));
  if (dddsSelecionados.size > 1 || !dddsSelecionados.has(ddd)) {
    dddsSelecionados.clear();
    dddsSelecionados.add(ddd);
    atualizarChips();
  } else {
    atualizarEstimativa();
  }
  const proximo = inputsDigitos.find((inp) => !inp.value);
  if (proximo) proximo.focus();
}

function mostrarMensagem(texto, tipo) {
  const el = $("mensagem");
  el.textContent = texto;
  el.className = "msg " + (tipo || "");
}

// ---------- Geração ----------

function* combinacoes(cfg) {
  for (const ddd of cfg.ddds) {
    const prefixoDdd = ddd * 1e9;
    for (const grupo of cfg.grupos) {
      const conjuntos = grupo.map((conj) => conj.map(Number));
      const idx = new Array(9).fill(0);
      while (true) {
        let assinante = 0;
        for (let pos = 0; pos < 9; pos++) assinante = assinante * 10 + conjuntos[pos][idx[pos]];
        yield [prefixoDdd + assinante, assinante];

        let pos = 8;
        while (pos >= 0) {
          idx[pos]++;
          if (idx[pos] < conjuntos[pos].length) break;
          idx[pos] = 0;
          pos--;
        }
        if (pos < 0) break;
      }
    }
  }
}

function crescerResultado() {
  const tamanho = Math.max(1024, resultado.length * 2);
  const novo = new Float64Array(tamanho);
  novo.set(resultado);
  resultado = novo;
  const novoOp = new Int16Array(tamanho);
  novoOp.set(resultadoOperadora);
  resultadoOperadora = novoOp;
}

function passaFiltros(assinante, cfg) {
  const s = String(assinante);
  if (cfg.semRepetidos && /^9(\d)\1{7}$/.test(s)) return false;
  if (cfg.obrigatorios.length) {
    const desconhecidos = cfg.desconhecidas.map((pos) => s[pos]);
    if (!cfg.obrigatorios.every((d) => desconhecidos.includes(d))) return false;
  }
  return true;
}

function gerar() {
  const cfg = montarConfiguracao();
  if (cfg.erro || cfg.alvo > LIMITE || cfg.alvo === 0) return;

  gerando = true;
  $("gerar").disabled = true;
  $("copiar").disabled = true;
  $("exportarExcel").disabled = true;
  $("exportarCsv").disabled = true;
  mostrarMensagem("Gerando...", "");

  resultado = new Float64Array(cfg.alvo);
  resultadoOperadora = new Int16Array(cfg.alvo);
  const consultarAnatel = Anatel.carregada && !cfg.usaBase;
  totalResultado = 0;
  const it = cfg.usaBase ? Anatel.numerosNaBase(cfg.ddds, cfg.grupos, cfg.operadoras) : combinacoes(cfg);
  let processados = 0;

  const passo = () => {
    for (let i = 0; i < LOTE; i++) {
      const prox = it.next();
      if (prox.done) return concluir();
      processados++;
      const [numero, assinante, opBase] = prox.value;
      if (!passaFiltros(assinante, cfg)) continue;
      if (totalResultado === resultado.length) crescerResultado();
      resultadoOperadora[totalResultado] = cfg.usaBase ? opBase : consultarAnatel ? Anatel.operadoraDe(String(numero)) : -1;
      resultado[totalResultado++] = numero;
    }
    $("barraProgresso").style.width = `${Math.min(100, (processados / cfg.alvo) * 100)}%`;
    $("total").innerHTML = `Gerando: <b>${totalResultado.toLocaleString("pt-BR")}</b>`;
    setTimeout(passo, 0);
  };

  const concluir = () => {
    gerando = false;
    $("barraProgresso").style.width = "100%";
    const removidos = cfg.total - cfg.alvo;
    $("total").innerHTML = `<b>${totalResultado.toLocaleString("pt-BR")}</b> números gerados` +
      (cfg.usaBase && removidos > 0 ? ` · ${removidos.toLocaleString("pt-BR")} descartados pela base da Anatel` : "") +
      (cfg.operadoras ? ` · <span title="Números que fizeram portabilidade continuam na faixa da operadora antiga e ficaram de fora.">filtrado por operadora de origem ⓘ</span>` : "");
    $("copiar").disabled = totalResultado === 0;
    $("exportarExcel").disabled = totalResultado === 0;
    $("exportarCsv").disabled = totalResultado === 0;
    atualizarEstimativa();
    if (totalResultado === 0) mostrarMensagem("Nenhum número passou pelos filtros.", "aviso");
    $("lista").scrollTop = 0;
    renderizarLista();
  };

  passo();
}

// ---------- Formatação ----------

function partes(numero) {
  const s = String(numero);
  return { ddd: s.slice(0, 2), assinante: s.slice(2) };
}

function formatar(numero) {
  const { ddd, assinante } = partes(numero);
  return `(${ddd}) ${assinante.slice(0, 5)}-${assinante.slice(5)}`;
}

const escaparHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function nomeOperadora(i) {
  const op = resultadoOperadora[i];
  if (op >= 0) return Anatel.operadoras[op] || "";
  return Anatel.carregada ? "Fora da base" : "";
}

// ---------- Base da Anatel ----------

function atualizarAnatelUI() {
  const info = Anatel.info;
  $("anatelSelo").textContent = info ? "carregada" : "não carregada";
  $("anatelSelo").classList.toggle("ok", !!info);
  $("anatelVazia").hidden = !!info;
  $("anatelCarregada").hidden = !info;
  $("anatelRemover").hidden = !info;
  $("anatelImportar").textContent = info ? "Atualizar arquivo" : "Importar arquivo SMP";

  if (info) {
    const data = new Date(info.importadaEm).toLocaleDateString("pt-BR");
    $("anatelResumo").innerHTML = `<b>${info.totalFaixas.toLocaleString("pt-BR")}</b> faixas de ` +
      `<b>${info.operadoras.length}</b> operadoras · arquivo "${escaparHtml(info.arquivo)}" importado em ${data}.`;
  }
  atualizarEstimativa();
}

/** Mostra só as operadoras com faixas nos DDDs escolhidos, com quantos números do padrão cada uma tem. */
function renderizarOperadoras(contagem) {
  const container = $("operadoras");
  if (!Anatel.carregada) {
    container.innerHTML = "";
    return;
  }
  if (!contagem) {
    container.innerHTML = `<span class="vazio-op">Informe o DDD para ver as operadoras da região.</span>`;
    $("operadorasLimpar").hidden = operadorasSelecionadas.size === 0;
    return;
  }

  const itens = [...contagem.entries()].map(([op, n]) => ({ op, n, nome: Anatel.operadoras[op] }));
  for (const op of operadorasSelecionadas) {
    if (!contagem.has(op)) itens.push({ op, n: 0, nome: Anatel.operadoras[op] });
  }
  itens.sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome, "pt-BR"));

  container.innerHTML = itens.length
    ? itens.map(({ op, n, nome }) =>
        `<span class="chip${operadorasSelecionadas.has(op) ? " ativo" : ""}${n ? "" : " zero"}" data-op="${op}" ` +
        `title="${n.toLocaleString("pt-BR")} números possíveis">${escaparHtml(nome)} <small>${n.toLocaleString("pt-BR")}</small></span>`
      ).join("")
    : `<span class="vazio-op">Nenhuma operadora tem faixas para esse padrão nos DDDs escolhidos.</span>`;
  $("operadorasLimpar").hidden = operadorasSelecionadas.size === 0;
  $("avisoPortabilidade").hidden = operadorasSelecionadas.size === 0;
}

async function importarAnatel(arquivo) {
  const msg = $("anatelMensagem");
  msg.className = "msg";
  msg.textContent = "Lendo o arquivo...";
  try {
    const info = await Anatel.importar(arquivo);
    operadorasSelecionadas.clear();
    msg.textContent = info.ignoradas
      ? `Pronto. ${info.ignoradas.toLocaleString("pt-BR")} linhas sem uso ou fora do padrão foram ignoradas.`
      : "Pronto.";
  } catch (erro) {
    msg.className = "msg erro";
    msg.textContent = erro.message;
  }
  atualizarAnatelUI();
}

// ---------- Lista virtual (desenha só as linhas visíveis) ----------

function renderizarLista() {
  const lista = $("lista");
  const espaco = $("espaco");
  $("vazio").style.display = totalResultado ? "none" : "block";

  const alturaReal = totalResultado * ALTURA_LINHA;
  const escalado = alturaReal > ALTURA_MAX_PX;
  espaco.style.height = `${Math.min(alturaReal, ALTURA_MAX_PX)}px`;

  const alturaVisivel = lista.clientHeight;
  const visiveis = Math.ceil(alturaVisivel / ALTURA_LINHA) + 1;
  const scrollTop = lista.scrollTop;

  let primeiro;
  if (escalado) {
    const maxScroll = Math.max(1, espaco.offsetHeight - alturaVisivel);
    primeiro = Math.floor((scrollTop / maxScroll) * Math.max(0, totalResultado - visiveis + 1));
  } else {
    primeiro = Math.floor(scrollTop / ALTURA_LINHA);
  }
  primeiro = Math.max(0, Math.min(primeiro, Math.max(0, totalResultado - 1)));
  const ultimo = Math.min(totalResultado, primeiro + visiveis);

  let html = "";
  for (let i = primeiro; i < ultimo; i++) {
    const numero = resultado[i];
    const { ddd } = partes(numero);
    const topo = escalado ? scrollTop + (i - primeiro) * ALTURA_LINHA : i * ALTURA_LINHA;
    html += `<div class="linha-num" style="top:${topo}px"><span class="idx">${(i + 1).toLocaleString("pt-BR")}</span>` +
      `<span>${formatar(numero)}</span><span>${ddd}</span><span class="uf">${UF_DO_DDD[ddd]}</span>` +
      `<span class="op">${escaparHtml(nomeOperadora(i))}</span></div>`;
  }
  espaco.innerHTML = html;
}

// ---------- Exportação ----------

function baixar(conteudo, nome, tipo) {
  const blob = new Blob(conteudo, { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function exportarCsv() {
  const pedacos = ["\uFEFFn;ddd;uf;numero;formatado;internacional;operadora_origem\r\n"];
  let bloco = "";
  for (let i = 0; i < totalResultado; i++) {
    const numero = resultado[i];
    const { ddd, assinante } = partes(numero);
    bloco += `${i + 1};${ddd};${UF_DO_DDD[ddd]};${ddd}${assinante};${formatar(numero)};+55${ddd}${assinante};${nomeOperadora(i)}\r\n`;
    if (bloco.length > 1_000_000) {
      pedacos.push(bloco);
      bloco = "";
    }
  }
  pedacos.push(bloco);
  baixar(pedacos, "possibilidades.csv", "text/csv;charset=utf-8");
}

async function exportarExcel() {
  const botoes = ["gerar", "copiar", "exportarExcel", "exportarCsv"].map($);
  botoes.forEach((b) => (b.disabled = true));
  gerando = true;
  mostrarMensagem("Gerando Excel...", "");
  try {
    const blob = await Excel.gerar({
      total: totalResultado,
      linha: (i) => {
        const numero = resultado[i];
        return { numero, uf: UF_DO_DDD[partes(numero).ddd], operadora: nomeOperadora(i) };
      },
      aoProgresso: (fracao) => mostrarMensagem(`Gerando Excel: ${Math.floor(fracao * 100)}%`, ""),
    });
    baixar([blob], "possibilidades.xlsx", blob.type);
    mostrarMensagem("", "");
  } catch (erro) {
    mostrarMensagem(`Não foi possível gerar o Excel: ${erro.message}`, "erro");
  } finally {
    gerando = false;
    $("copiar").disabled = $("exportarExcel").disabled = $("exportarCsv").disabled = totalResultado === 0;
    atualizarEstimativa();
  }
}

async function copiarLista() {
  const linhas = new Array(totalResultado);
  for (let i = 0; i < totalResultado; i++) linhas[i] = formatar(resultado[i]);
  try {
    await navigator.clipboard.writeText(linhas.join("\n"));
    mostrarMensagem(`${totalResultado.toLocaleString("pt-BR")} números copiados.`, "");
  } catch {
    mostrarMensagem("O navegador bloqueou a cópia. Use o Exportar CSV.", "erro");
  }
}

// ---------- Inicialização ----------

montarDdds();
configurarDigitos();
configurarBuscaCidade();

$("dddTodos").addEventListener("click", () => {
  TODOS_DDDS.forEach((d) => dddsSelecionados.add(d));
  atualizarChips();
});
$("dddNenhum").addEventListener("click", () => {
  dddsSelecionados.clear();
  atualizarChips();
});
$("dddDigitado").addEventListener("input", lerDddsDigitados);
$("dddDigitado").addEventListener("focus", (e) => {
  if (dddsSelecionados.size > 1) e.target.select();
});
$("dddDigitado").addEventListener("blur", () => atualizarChips());
$("resumoDdd").addEventListener("click", (e) => {
  const remover = e.target.closest("[data-remover]");
  if (remover) return removerSelecao(remover.dataset.remover);
  if (e.target.closest("[data-abrir-ddds]")) {
    $("opcaoDdds").open = true;
    $("opcaoDdds").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
});
$("dddDigitado").addEventListener("keydown", (e) => {
  const campo = e.target;
  if (e.key === "ArrowRight" && campo.selectionStart === campo.value.length) inputsDigitos[0].focus();
});
$("limparDigitos").addEventListener("click", () => {
  inputsDigitos.forEach((inp) => (inp.value = ""));
  dddsSelecionados.clear();
  atualizarChips();
  $("dddDigitado").focus();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !$("gerar").disabled && e.target.tagName === "INPUT" && e.target.id !== "cidadeBusca") gerar();
});
document.querySelectorAll("input[name=faixa]").forEach((r) => r.addEventListener("change", atualizarEstimativa));
["prefixos", "contem", "exclui"].forEach((id) => $(id).addEventListener("input", atualizarEstimativa));
$("semRepetidos").addEventListener("change", atualizarEstimativa);
$("gerar").addEventListener("click", gerar);
$("exportarExcel").addEventListener("click", exportarExcel);
$("exportarCsv").addEventListener("click", exportarCsv);
$("copiar").addEventListener("click", copiarLista);
$("lista").addEventListener("scroll", () => requestAnimationFrame(renderizarLista));
window.addEventListener("resize", renderizarLista);

$("anatelImportar").addEventListener("click", () => $("anatelArquivo").click());
$("anatelArquivo").addEventListener("change", (e) => {
  const arquivo = e.target.files[0];
  e.target.value = "";
  if (arquivo) importarAnatel(arquivo);
});
$("anatelRemover").addEventListener("click", async () => {
  await Anatel.remover();
  operadorasSelecionadas.clear();
  $("anatelMensagem").textContent = "";
  atualizarAnatelUI();
});
$("soAtribuidas").addEventListener("change", atualizarEstimativa);
$("operadoras").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-op]");
  if (!chip) return;
  const op = Number(chip.dataset.op);
  operadorasSelecionadas.has(op) ? operadorasSelecionadas.delete(op) : operadorasSelecionadas.add(op);
  atualizarEstimativa();
});
$("inicios").addEventListener("click", (e) => {
  const botao = e.target.closest("[data-prefixo]");
  if (botao) preencherInicio(Number(botao.dataset.ddd), botao.dataset.prefixo);
});
$("operadorasLimpar").addEventListener("click", () => {
  operadorasSelecionadas.clear();
  atualizarEstimativa();
});

atualizarChips();
$("cidadeBusca").focus();
Anatel.carregarSalva().then(atualizarAnatelUI);
