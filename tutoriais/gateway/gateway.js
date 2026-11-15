// API Gateway do Emprestaí — único ponto de entrada (porta 3000). Rode com: npm run gateway
// Filtros, nesta ordem: X-Request-Id e log → autenticação por chave → autorização por rota (403)
// → limite de uso por cliente (429) → encaminhamento com timeout (504), falha (502) e disjuntor (503).
import express from 'express';
import { randomUUID } from 'node:crypto';
import { STATUS_CODES } from 'node:http';

const app = express();
app.disable('x-powered-by');

// ---------- Configuração ----------
const SERVICOS = {
  rest: process.env.URL_REST ?? 'http://127.0.0.1:3001',
  graphql: process.env.URL_GRAPHQL ?? 'http://127.0.0.1:4000',
};

// Atores do Emprestaí, cada um com o seu plano de uso. Chaves FICTÍCIAS, só para a demonstração.
// Em produção: chaves guardadas como hash num banco ou cofre de segredos, nunca no código.
const CLIENTES = new Map([
  ['chave-app-emprestai-123', {
    id: 'app-emprestai', descricao: 'Aplicativo móvel (React Native) usado pelas pessoas',
    limitePorMinuto: 20, permissoes: 'todas',
  }],
  ['chave-painel-moderacao-456', {
    id: 'painel-moderacao', descricao: 'Painel interno da equipe de moderação',
    limitePorMinuto: 120, permissoes: 'todas',
  }],
  ['chave-parceiro-seguros-789', {
    id: 'parceiro-seguros', descricao: 'Seguradora parceira que cota seguro dos objetos anunciados',
    limitePorMinuto: 5,
    permissoes: [{ metodo: 'GET', prefixo: '/api/objetos' }], // só consulta o catálogo
  }],
]);

// ---------- Disjuntor (circuit breaker), um por serviço ----------
class Disjuntor {
  constructor(nome, { limiteFalhas = 3, esperaMs = 10_000 } = {}) {
    this.nome = nome;
    this.limiteFalhas = limiteFalhas; // quantas falhas seguidas abrem o disjuntor
    this.esperaMs = esperaMs;         // por quanto tempo ele fica aberto
    this.falhas = 0;
    this.abertoAte = 0;
  }
  permite() { return Date.now() >= this.abertoAte; } // fechado ou meio-aberto
  sucesso() {
    if (this.falhas >= this.limiteFalhas) console.log(`[gateway] disjuntor de ${this.nome} FECHOU (serviço recuperado)`);
    this.falhas = 0;
    this.abertoAte = 0;
  }
  falha() {
    this.falhas++;
    if (this.falhas >= this.limiteFalhas) {
      this.abertoAte = Date.now() + this.esperaMs;
      console.log(`[gateway] disjuntor de ${this.nome} ABERTO por ${this.esperaMs / 1000} s (${this.falhas} falhas seguidas)`);
    }
  }
  estado() { return this.permite() ? (this.falhas >= this.limiteFalhas ? 'meio-aberto' : 'fechado') : 'aberto'; }
  segundosRestantes() { return Math.max(1, Math.ceil((this.abertoAte - Date.now()) / 1000)); }
}

const DISJUNTORES = { rest: new Disjuntor('rest'), graphql: new Disjuntor('graphql') };

// ---------- Tabela de rotas: prefixo público -> serviço interno ----------
const ROTAS = [
  { prefixo: '/api/objetos', servico: 'rest', interno: '/objetos', timeoutMs: 2000 },
  { prefixo: '/api/alugueis', servico: 'rest', interno: '/alugueis', timeoutMs: 2000 },
  { prefixo: '/api/usuarios', servico: 'rest', interno: '/usuarios', timeoutMs: 2000 },
  { prefixo: '/api/avaliacoes', servico: 'rest', interno: '/avaliacoes', timeoutMs: 2000 },
  // O Apollo standalone atende em qualquer caminho: /api/graphql vira "/"
  { prefixo: '/api/graphql', servico: 'graphql', interno: '/', timeoutMs: 5000 },
];

// ---------- Erros do gateway (Problem Details, RFC 9457) ----------
function problema(req, res, status, detalhe, cabecalhos = {}) {
  res.status(status).set(cabecalhos).type('application/problem+json').json({
    type: 'about:blank',
    title: STATUS_CODES[status],
    status,
    detail: detalhe,
    instance: req.originalUrl,
    requestId: req.id,
  });
}

// ---------- Filtro 1: identificador de correlação e log ----------
app.use((req, res, next) => {
  req.id = randomUUID(); // sempre novo: não confiamos num identificador vindo do cliente
  res.set('X-Request-Id', req.id);
  const inicio = performance.now();
  res.on('finish', () => {
    const ms = Math.round(performance.now() - inicio);
    console.log(`[gateway] ${req.id} ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms} ms) cliente=${req.cliente?.id ?? '-'}`);
  });
  next();
});

app.use(express.json()); // corpo máximo padrão: 100 KB

// Verificação de saúde do próprio gateway (fora da autenticação)
app.get('/saude', (req, res) => res.json({
  status: 'ok',
  disjuntores: Object.fromEntries(Object.entries(DISJUNTORES).map(([n, d]) => [n, d.estado()])),
}));

// ---------- Filtro 2: autenticação por chave de API ----------
function autenticar(req, res, next) {
  // Map, e não objeto comum: "X-API-Key: constructor" não pode virar um cliente válido
  const cliente = CLIENTES.get(req.get('x-api-key'));
  if (!cliente) {
    return problema(req, res, 401, 'Informe uma chave válida no cabeçalho X-API-Key.',
      { 'WWW-Authenticate': 'ApiKey header="X-API-Key"' });
  }
  req.cliente = cliente; // a partir daqui, o gateway sabe quem está chamando
  next();
}
app.use('/api', autenticar);

// ---------- Filtro 3: autorização por rota (403) ----------
function autorizar(req, res, next) {
  const { permissoes } = req.cliente;
  if (permissoes === 'todas') return next();
  const permitido = permissoes.some((p) => p.metodo === req.method &&
    (req.originalUrl === p.prefixo || req.originalUrl.startsWith(`${p.prefixo}/`) || req.originalUrl.startsWith(`${p.prefixo}?`)));
  if (!permitido) {
    return problema(req, res, 403, `O cliente ${req.cliente.id} não tem permissão para ${req.method} ${req.originalUrl.split("?")[0]}.`);
  }
  next();
}
app.use('/api', autorizar);

// ---------- Filtro 4: limite de uso por cliente (janela fixa de 1 minuto, em memória) ----------
const janelas = new Map(); // id do cliente -> { inicio, contagem }

function limitarUso(req, res, next) {
  const { id, limitePorMinuto } = req.cliente;
  const agora = Date.now();
  let janela = janelas.get(id);
  if (!janela || agora - janela.inicio >= 60_000) {
    janela = { inicio: agora, contagem: 0 }; // começou um novo minuto
    janelas.set(id, janela);
  }
  janela.contagem++;
  res.set({
    'X-RateLimit-Limit': String(limitePorMinuto),
    'X-RateLimit-Remaining': String(Math.max(0, limitePorMinuto - janela.contagem)),
  });
  if (janela.contagem > limitePorMinuto) {
    const espera = Math.ceil((janela.inicio + 60_000 - agora) / 1000);
    return problema(req, res, 429, `Limite de ${limitePorMinuto} requisições por minuto do plano de ${id} excedido.`,
      { 'Retry-After': String(espera) });
  }
  next();
}
app.use('/api', limitarUso);

// ---------- Comunicação com os serviços ----------
const CABECALHOS_DO_CLIENTE = ['content-type', 'accept', 'accept-language', 'if-none-match'];
const CABECALHOS_DO_SERVICO = ['content-type', 'etag', 'cache-control', 'retry-after'];

function cabecalhosInternos(req) {
  const cabecalhos = { 'x-request-id': req.id };
  if (req.cliente) cabecalhos['x-cliente-id'] = req.cliente.id; // a X-API-Key nunca chega aos serviços
  return cabecalhos;
}

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

// fetch com timeout e, para leituras (GET), novas tentativas com espera crescente se a conexão falhar
async function chamarServico(url, opcoes, { timeoutMs, idempotente }) {
  const maxTentativas = idempotente ? 3 : 1;
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await fetch(url, { ...opcoes, signal: AbortSignal.timeout(timeoutMs) });
    } catch (erro) {
      // timeout não se repete (o serviço está lento, repetir piora); conexão recusada, sim
      if (erro.name === 'TimeoutError' || tentativa >= maxTentativas) throw erro;
      await esperar(100 * 2 ** (tentativa - 1)); // 100 ms, 200 ms
    }
  }
}

const juntar = (interno, sufixo) =>
  (interno.endsWith('/') && sufixo.startsWith('/') ? interno + sufixo.slice(1) : interno + sufixo);

async function encaminhar(req, res, rota) {
  const disjuntor = DISJUNTORES[rota.servico];
  // Disjuntor aberto: recusa na hora, sem nem tentar o serviço
  if (!disjuntor.permite()) {
    return problema(req, res, 503, `O serviço ${rota.servico} está temporariamente indisponível. Tente novamente em instantes.`,
      { 'Retry-After': String(disjuntor.segundosRestantes()) });
  }

  // /api/alugueis/3?x=1 -> sufixo "/3?x=1" -> http://127.0.0.1:3001/alugueis/3?x=1
  const sufixo = req.originalUrl.slice(rota.prefixo.length);
  const url = SERVICOS[rota.servico] + juntar(rota.interno, sufixo);

  const cabecalhos = cabecalhosInternos(req);
  for (const nome of CABECALHOS_DO_CLIENTE) {
    if (req.get(nome)) cabecalhos[nome] = req.get(nome);
  }
  cabecalhos['x-forwarded-for'] = req.ip;
  const temCorpo = !['GET', 'HEAD'].includes(req.method) && req.body !== undefined;

  let resposta;
  let corpo;
  try {
    resposta = await chamarServico(url, {
      method: req.method,
      headers: cabecalhos,
      body: temCorpo ? JSON.stringify(req.body) : undefined,
    }, { timeoutMs: rota.timeoutMs, idempotente: ['GET', 'HEAD'].includes(req.method) });
    corpo = await resposta.text();
  } catch (erro) {
    disjuntor.falha(); // timeout ou conexão recusada contam como falha (uma por requisição)
    if (erro.name === 'TimeoutError') {
      return problema(req, res, 504, `O serviço ${rota.servico} não respondeu em ${rota.timeoutMs} ms.`);
    }
    return problema(req, res, 502, `Não foi possível obter resposta do serviço ${rota.servico}.`);
  }

  // Erro 5xx do próprio serviço também é falha; 4xx é erro do cliente e não conta
  if (resposta.status >= 500) disjuntor.falha();
  else disjuntor.sucesso();

  // Repassa só os cabeçalhos da lista de permissão
  for (const nome of CABECALHOS_DO_SERVICO) {
    const valor = resposta.headers.get(nome);
    if (valor) res.set(nome, valor);
  }
  // O Location do serviço usa o caminho interno; o cliente precisa do público
  const local = resposta.headers.get('location');
  if (local && rota.interno !== '/' && local.startsWith(rota.interno)) {
    res.set('Location', rota.prefixo + local.slice(rota.interno.length));
  }
  res.status(resposta.status).send(corpo);
}

// Chamada interna usada pela rota agregada; respeita o disjuntor do serviço
async function lerJson(servico, caminho, req, opcoes = {}) {
  const disjuntor = DISJUNTORES[servico];
  if (!disjuntor.permite()) throw Object.assign(new Error(`disjuntor de ${servico} aberto`), { status: 503 });
  let resposta;
  try {
    resposta = await fetch(SERVICOS[servico] + caminho, {
      method: opcoes.corpo ? 'POST' : 'GET',
      headers: { ...cabecalhosInternos(req), ...(opcoes.corpo ? { 'content-type': 'application/json' } : {}) },
      body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
      signal: AbortSignal.timeout(2000),
    });
  } catch (erro) {
    disjuntor.falha();
    throw erro;
  }
  if (resposta.status >= 500) disjuntor.falha();
  else disjuntor.sucesso();
  if (!resposta.ok) {
    throw Object.assign(new Error(`HTTP ${resposta.status}`), { status: resposta.status });
  }
  return resposta.json();
}

// ---------- Rota agregada: tela "Detalhe do aluguel" do app ----------
// Junta o aluguel e o objeto (API REST) com a reputação das duas partes (servidor GraphQL).
app.get('/api/painel/alugueis/:id', async (req, res) => {
  // 1. O aluguel é indispensável: se falhar, a resposta inteira falha
  let aluguel;
  try {
    aluguel = await lerJson('rest', `/alugueis/${encodeURIComponent(req.params.id)}`, req);
  } catch (erro) {
    if (erro.status === 404 || erro.status === 400) return problema(req, res, 404, 'Aluguel não encontrado.');
    if (erro.status === 503) {
      return problema(req, res, 503, 'A API REST está temporariamente indisponível.',
        { 'Retry-After': String(DISJUNTORES.rest.segundosRestantes()) });
    }
    const status = erro.name === 'TimeoutError' ? 504 : 502;
    return problema(req, res, status, 'A API REST não respondeu.');
  }

  // 2. Objeto e reputação são complementares: buscados em paralelo, aceitando falhas parciais
  const consultaPartes = {
    query: `query Partes($p: ID!, $l: ID!) {
      proprietario: usuario(id: $p) { id nome cidade reputacao { media totalAvaliacoes } }
      locatario: usuario(id: $l) { id nome cidade reputacao { media totalAvaliacoes } }
    }`,
    variables: { p: String(aluguel.proprietarioId), l: String(aluguel.locatarioId) },
  };
  const [objeto, partes] = await Promise.allSettled([
    lerJson('rest', `/objetos/${encodeURIComponent(aluguel.objetoId)}`, req),
    lerJson('graphql', '/', req, { corpo: consultaPartes }).then((r) => {
      if (r.errors) throw new Error(r.errors[0].message);
      return r.data;
    }),
  ]);

  const indisponiveis = [];
  if (objeto.status === 'rejected') indisponiveis.push('objeto (API REST)');
  if (partes.status === 'rejected') indisponiveis.push('reputação das partes (GraphQL)');

  res.json({
    id: aluguel.id,
    status: aluguel.status,
    periodo: { dataInicio: aluguel.dataInicio, dataFim: aluguel.dataFim, dias: aluguel.dias },
    valorTotal: aluguel.valorTotal,
    historico: aluguel.historico,
    objeto: objeto.status === 'fulfilled'
      ? { id: objeto.value.id, titulo: objeto.value.titulo, categoria: objeto.value.categoria, valorDiaria: objeto.value.valorDiaria }
      : null,
    proprietario: partes.status === 'fulfilled' ? partes.value.proprietario : { id: aluguel.proprietarioId },
    locatario: partes.status === 'fulfilled' ? partes.value.locatario : { id: aluguel.locatarioId },
    parcial: indisponiveis.length > 0,
    ...(indisponiveis.length ? { indisponivel: indisponiveis } : {}),
  });
});

// ---------- Rotas encaminhadas ----------
for (const rota of ROTAS) {
  app.use(rota.prefixo, (req, res) => encaminhar(req, res, rota));
}

// ---------- Nenhuma rota atende / erros inesperados (sempre por último) ----------
app.use((req, res) => {
  problema(req, res, 404, `Nenhuma rota atende ${req.method} ${req.path}.`);
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status ?? 500;
  if (status >= 500) console.error(`[gateway] ${req.id}`, err);
  const detalhe = err.type === 'entity.parse.failed' ? 'O corpo da requisição não é um JSON válido.'
    : status >= 500 ? 'Erro inesperado no gateway.' : err.message;
  problema(req, res, status, detalhe);
});

const PORTA = Number(process.env.PORTA_GATEWAY ?? 3000);
// Sem host: ouve em todas as interfaces. É a única porta pública do Emprestaí.
app.listen(PORTA, () => console.log(`[gateway] API Gateway do Emprestaí em http://localhost:${PORTA}`));
