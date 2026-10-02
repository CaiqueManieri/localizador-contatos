"use strict";

/**
 * Gera a planilha .xlsx da lista de possibilidades: cabeçalho fixo, filtro,
 * números formatados e coluna de status com lista suspensa.
 * O ZIP é escrito em fluxo para aguentar milhões de linhas.
 */
const Excel = (() => {
  const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const NS_PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
  const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;

  // Limite do Excel é 1.048.576 linhas por aba
  const LINHAS_POR_ABA = 1_000_000;
  const LINHA_CABECALHO = 4;
  const PRIMEIRA_LINHA = LINHA_CABECALHO + 1;

  const VERIFICADO = "Verificado";
  const NAO_VERIFICADO = "Não verificado";

  const COLUNAS = [
    { titulo: "Nº", largura: 11 },
    { titulo: "DDD", largura: 8 },
    { titulo: "UF", largura: 7 },
    { titulo: "Número", largura: 19 },
    { titulo: "Internacional (WhatsApp)", largura: 24 },
    { titulo: "Operadora de origem", largura: 26 },
    { titulo: "Status", largura: 18 },
    { titulo: "Observações", largura: 44 },
  ];
  const LETRAS = "ABCDEFGH";
  const ULTIMA = LETRAS[COLUNAS.length - 1];

  // Índices de cellXfs em styles.xml
  const S = { titulo: 1, subtitulo: 2, cabecalho: 3, indice: 4, centro: 5, telefone: 6, internacional: 7, texto: 8, status: 9 };

  const codificador = new TextEncoder();
  const escapar = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pausa = () => new Promise((r) => setTimeout(r, 0));

  // ---------- ZIP ----------

  const CRC_TABELA = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(crc, bytes) {
    let c = ~crc;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABELA[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return ~c >>> 0;
  }

  async function comprimir(pedacos) {
    const fluxo = new CompressionStream("deflate-raw");
    const escritor = fluxo.writable.getWriter();
    const partes = [];
    let comprimido = 0;
    const leitura = (async () => {
      const leitor = fluxo.readable.getReader();
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) return;
        partes.push(value);
        comprimido += value.length;
      }
    })();

    let crc = 0;
    let tamanho = 0;
    for await (const texto of pedacos) {
      const bytes = codificador.encode(texto);
      crc = crc32(crc, bytes);
      tamanho += bytes.length;
      await escritor.ready;
      escritor.write(bytes);
    }
    await escritor.close();
    await leitura;
    return { partes, crc, tamanho, comprimido };
  }

  async function montarZip(arquivos) {
    const agora = new Date();
    const hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1);
    const data = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
    const corpo = [];
    const central = [];
    let deslocamento = 0;

    for (const arquivo of arquivos) {
      const nome = codificador.encode(arquivo.nome);
      const c = await comprimir(typeof arquivo.conteudo === "function" ? arquivo.conteudo() : [arquivo.conteudo]);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(8, 8, true);
      local.setUint16(10, hora, true);
      local.setUint16(12, data, true);
      local.setUint32(14, c.crc, true);
      local.setUint32(18, c.comprimido, true);
      local.setUint32(22, c.tamanho, true);
      local.setUint16(26, nome.length, true);
      corpo.push(local, nome);
      for (const p of c.partes) corpo.push(p);

      const registro = new DataView(new ArrayBuffer(46));
      registro.setUint32(0, 0x02014b50, true);
      registro.setUint16(4, 20, true);
      registro.setUint16(6, 20, true);
      registro.setUint16(8, 0x0800, true);
      registro.setUint16(10, 8, true);
      registro.setUint16(12, hora, true);
      registro.setUint16(14, data, true);
      registro.setUint32(16, c.crc, true);
      registro.setUint32(20, c.comprimido, true);
      registro.setUint32(24, c.tamanho, true);
      registro.setUint16(28, nome.length, true);
      registro.setUint32(42, deslocamento, true);
      central.push(registro, nome);

      deslocamento += 30 + nome.length + c.comprimido;
    }

    const tamanhoCentral = central.reduce((soma, p) => soma + p.byteLength, 0);
    const fim = new DataView(new ArrayBuffer(22));
    fim.setUint32(0, 0x06054b50, true);
    fim.setUint16(8, arquivos.length, true);
    fim.setUint16(10, arquivos.length, true);
    fim.setUint32(12, tamanhoCentral, true);
    fim.setUint32(16, deslocamento, true);
    return new Blob([...corpo, ...central, fim], { type: MIME });
  }

  // ---------- Partes fixas da planilha ----------

  function tiposDeConteudo(abas) {
    return XML + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
      `</Types>`;
  }

  function relacoesRaiz() {
    return XML + `<Relationships xmlns="${NS_PKG}">` +
      `<Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
      `</Relationships>`;
  }

  function propriedades(agora) {
    const iso = agora.toISOString().replace(/\.\d+Z$/, "Z");
    return XML + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
      `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ` +
      `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>Lista de possibilidades</dc:title><dc:creator>Localizador de Contato</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created>` +
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified>` +
      `</cp:coreProperties>`;
  }

  function pastaDeTrabalho(abas) {
    const nomes = [];
    abas.forEach((aba, i) => {
      const ref = `'${aba.nome}'`;
      nomes.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${ref}!$A$${LINHA_CABECALHO}:$${ULTIMA}$${aba.ultimaLinha}</definedName>`);
      nomes.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${ref}!$${LINHA_CABECALHO}:$${LINHA_CABECALHO}</definedName>`);
    });
    return XML + `<workbook xmlns="${NS}" xmlns:r="${NS_R}">` +
      `<bookViews><workbookView activeTab="0"/></bookViews><sheets>` +
      abas.map((aba, i) => `<sheet name="${escapar(aba.nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
      `</sheets><definedNames>${nomes.join("")}</definedNames></workbook>`;
  }

  function relacoesPasta(abas) {
    const n = abas.length;
    return XML + `<Relationships xmlns="${NS_PKG}">` +
      abas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
      `<Relationship Id="rId${n + 1}" Type="${NS_R}/styles" Target="styles.xml"/>` +
      `<Relationship Id="rId${n + 2}" Type="${NS_R}/sharedStrings" Target="sharedStrings.xml"/>` +
      `</Relationships>`;
  }

  function estilos() {
    const fonte = (extra, tamanho, cor) => `<font>${extra}<sz val="${tamanho}"/><color rgb="${cor}"/><name val="Calibri"/><family val="2"/></font>`;
    const borda = (cor) => `<border>${["left", "right", "top", "bottom"].map((lado) => `<${lado} style="thin"><color rgb="${cor}"/></${lado}>`).join("")}<diagonal/></border>`;
    const xf = (fmt, fonteId, fill, bordaId, alinhamento) =>
      `<xf numFmtId="${fmt}" fontId="${fonteId}" fillId="${fill}" borderId="${bordaId}" xfId="0"` +
      ` applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"` +
      (alinhamento ? ` applyAlignment="1"><alignment ${alinhamento}/></xf>` : `/>`);
    const centro = `horizontal="center" vertical="center"`;

    return XML + `<styleSheet xmlns="${NS}">` +
      `<numFmts count="2">` +
      `<numFmt numFmtId="164" formatCode="\\(00\\)\\ 00000\\-0000"/>` +
      `<numFmt numFmtId="165" formatCode="\\+00\\ 00\\ 00000\\-0000"/>` +
      `</numFmts>` +
      `<fonts count="4">` +
      fonte("", 11, "FF1F2937") +
      fonte("<b/>", 16, "FF1F3864") +
      fonte("", 10, "FF6B7280") +
      fonte("<b/>", 11, "FFFFFFFF") +
      `</fonts>` +
      `<fills count="3">` +
      `<fill><patternFill patternType="none"/></fill>` +
      `<fill><patternFill patternType="gray125"/></fill>` +
      `<fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/><bgColor indexed="64"/></patternFill></fill>` +
      `</fills>` +
      `<borders count="3">` +
      `<border><left/><right/><top/><bottom/><diagonal/></border>` +
      borda("FFD9DEE7") +
      borda("FF3A5383") +
      `</borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="10">` +
      `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
      xf(0, 1, 0, 0, `vertical="center"`) +
      xf(0, 2, 0, 0, `vertical="center"`) +
      xf(0, 3, 2, 2, `${centro} wrapText="1"`) +
      xf(3, 2, 0, 1, centro) +
      xf(0, 0, 0, 1, centro) +
      xf(164, 0, 0, 1, centro) +
      xf(165, 0, 0, 1, centro) +
      xf(0, 0, 0, 1, `horizontal="left" vertical="center" indent="1"`) +
      xf(0, 0, 0, 1, centro) +
      `</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `<dxfs count="4">` +
      `<dxf><font><b/><color rgb="FF006100"/></font><fill><patternFill patternType="solid"><bgColor rgb="FFC6EFCE"/></patternFill></fill></dxf>` +
      `<dxf><font><color rgb="FF9C5700"/></font><fill><patternFill patternType="solid"><bgColor rgb="FFFFF2CC"/></patternFill></fill></dxf>` +
      `<dxf><fill><patternFill patternType="solid"><bgColor rgb="FFEEF8F1"/></patternFill></fill></dxf>` +
      `<dxf><fill><patternFill patternType="solid"><bgColor rgb="FFF5F7FB"/></patternFill></fill></dxf>` +
      `</dxfs>` +
      `<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>` +
      `</styleSheet>`;
  }

  // ---------- Abas ----------

  function inicioAba(aba, indice, texto) {
    const cols = COLUNAS.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.largura}" customWidth="1"/>`).join("");
    const cabecalho = COLUNAS.map((c, i) =>
      `<c r="${LETRAS[i]}${LINHA_CABECALHO}" s="${S.cabecalho}" t="s"><v>${texto(c.titulo)}</v></c>`).join("");
    return XML + `<worksheet xmlns="${NS}" xmlns:r="${NS_R}">` +
      `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
      `<dimension ref="A1:${ULTIMA}${aba.ultimaLinha}"/>` +
      `<sheetViews><sheetView showGridLines="0"${indice === 0 ? ` tabSelected="1"` : ""} workbookViewId="0">` +
      `<pane ySplit="${LINHA_CABECALHO}" topLeftCell="A${PRIMEIRA_LINHA}" activePane="bottomLeft" state="frozen"/>` +
      `<selection pane="bottomLeft" activeCell="G${PRIMEIRA_LINHA}" sqref="G${PRIMEIRA_LINHA}"/>` +
      `</sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="18" customHeight="1"/>` +
      `<cols>${cols}</cols><sheetData>` +
      `<row r="1" ht="30" customHeight="1"><c r="A1" s="${S.titulo}" t="s"><v>${texto(aba.titulo)}</v></c></row>` +
      `<row r="2" ht="18" customHeight="1"><c r="A2" s="${S.subtitulo}" t="s"><v>${texto(aba.subtitulo)}</v></c></row>` +
      `<row r="3" ht="8" customHeight="1"/>` +
      `<row r="${LINHA_CABECALHO}" ht="28" customHeight="1">${cabecalho}</row>`;
  }

  function fimAba(aba) {
    const fim = aba.ultimaLinha;
    const status = `G${PRIMEIRA_LINHA}:G${fim}`;
    const dados = `A${PRIMEIRA_LINHA}:${ULTIMA}${fim}`;
    return `</sheetData>` +
      `<autoFilter ref="A${LINHA_CABECALHO}:${ULTIMA}${fim}"/>` +
      `<conditionalFormatting sqref="${status}">` +
      `<cfRule type="cellIs" dxfId="0" priority="1" operator="equal"><formula>"${VERIFICADO}"</formula></cfRule>` +
      `<cfRule type="cellIs" dxfId="1" priority="2" operator="equal"><formula>"${NAO_VERIFICADO}"</formula></cfRule>` +
      `</conditionalFormatting>` +
      `<conditionalFormatting sqref="${dados}">` +
      `<cfRule type="expression" dxfId="2" priority="3"><formula>$G${PRIMEIRA_LINHA}="${VERIFICADO}"</formula></cfRule>` +
      `<cfRule type="expression" dxfId="3" priority="4"><formula>MOD(ROW(),2)=0</formula></cfRule>` +
      `</conditionalFormatting>` +
      `<dataValidations count="1">` +
      `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" ` +
      `errorTitle="Status inválido" error="Escolha ${VERIFICADO} ou ${NAO_VERIFICADO} na lista." ` +
      `promptTitle="Status" prompt="Marque se o número já foi verificado." sqref="${status}">` +
      `<formula1>"${VERIFICADO},${NAO_VERIFICADO}"</formula1></dataValidation>` +
      `</dataValidations>` +
      `<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>` +
      `<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>` +
      `<headerFooter><oddFooter>&amp;L&amp;8Localizador de Contato&amp;R&amp;8Página &amp;P de &amp;N</oddFooter></headerFooter>` +
      `</worksheet>`;
  }

  async function* linhasAba(aba, indice, opcoes, texto, progresso) {
    const naoVerificado = texto(NAO_VERIFICADO);
    const verificado = texto(VERIFICADO);
    let bloco = inicioAba(aba, indice, texto);
    for (let k = 0; k < aba.quantidade; k++) {
      const i = aba.inicio + k;
      const r = PRIMEIRA_LINHA + k;
      const linha = opcoes.linha(i);
      const { numero, uf, operadora } = linha;
      const ddd = Math.floor(numero / 1e9);
      bloco += `<row r="${r}">` +
        `<c r="A${r}" s="${S.indice}"><v>${i + 1}</v></c>` +
        `<c r="B${r}" s="${S.centro}"><v>${ddd}</v></c>` +
        `<c r="C${r}" s="${S.centro}" t="s"><v>${texto(uf)}</v></c>` +
        `<c r="D${r}" s="${S.telefone}"><v>${numero}</v></c>` +
        `<c r="E${r}" s="${S.internacional}"><v>${55e11 + numero}</v></c>` +
        (operadora ? `<c r="F${r}" s="${S.texto}" t="s"><v>${texto(operadora)}</v></c>` : `<c r="F${r}" s="${S.texto}"/>`) +
        `<c r="G${r}" s="${S.status}" t="s"><v>${linha.verificado ? verificado : naoVerificado}</v></c>` +
        `<c r="H${r}" s="${S.texto}"/>` +
        `</row>`;
      if (bloco.length > 1 << 20) {
        yield bloco;
        bloco = "";
        progresso(i + 1);
        await pausa();
      }
    }
    yield bloco + fimAba(aba);
  }

  /**
   * opcoes.total: quantidade de números
   * opcoes.linha(i): { numero (DDD + 9 dígitos), uf, operadora, verificado }
   * opcoes.aoProgresso(fracao): chamado durante a geração
   */
  async function gerar(opcoes) {
    const { total } = opcoes;
    const agora = new Date();
    const fmt = (n) => n.toLocaleString("pt-BR");
    const geradoEm = `Gerado em ${agora.toLocaleDateString("pt-BR")} às ` +
      `${agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;

    const quantidadeAbas = Math.max(1, Math.ceil(total / LINHAS_POR_ABA));
    const abas = [];
    for (let a = 0; a < quantidadeAbas; a++) {
      const inicio = a * LINHAS_POR_ABA;
      const quantidade = Math.min(LINHAS_POR_ABA, total - inicio);
      const varias = quantidadeAbas > 1;
      abas.push({
        nome: varias ? `Parte ${a + 1}` : "Possibilidades",
        titulo: "Lista de possibilidades de contato",
        subtitulo: `${geradoEm}  ·  ${fmt(total)} número${total === 1 ? "" : "s"}` +
          (varias ? `  ·  Parte ${a + 1} de ${quantidadeAbas} (do ${fmt(inicio + 1)} ao ${fmt(inicio + quantidade)})` : ""),
        inicio,
        quantidade,
        ultimaLinha: LINHA_CABECALHO + Math.max(1, quantidade),
      });
    }

    const textos = new Map();
    const texto = (s) => {
      let i = textos.get(s);
      if (i === undefined) textos.set(s, (i = textos.size));
      return i;
    };
    const progresso = (feitos) => opcoes.aoProgresso?.(feitos / Math.max(1, total));

    return montarZip([
      { nome: "[Content_Types].xml", conteudo: tiposDeConteudo(abas) },
      { nome: "_rels/.rels", conteudo: relacoesRaiz() },
      { nome: "docProps/core.xml", conteudo: propriedades(agora) },
      { nome: "xl/workbook.xml", conteudo: pastaDeTrabalho(abas) },
      { nome: "xl/_rels/workbook.xml.rels", conteudo: relacoesPasta(abas) },
      { nome: "xl/styles.xml", conteudo: estilos() },
      ...abas.map((aba, i) => ({
        nome: `xl/worksheets/sheet${i + 1}.xml`,
        conteudo: () => linhasAba(aba, i, opcoes, texto, progresso),
      })),
      {
        nome: "xl/sharedStrings.xml",
        conteudo: () => [XML + `<sst xmlns="${NS}" uniqueCount="${textos.size}">` +
          [...textos.keys()].map((s) => `<si><t xml:space="preserve">${escapar(s)}</t></si>`).join("") + `</sst>`],
      },
    ]);
  }

  return { gerar };
})();
