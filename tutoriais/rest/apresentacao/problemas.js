// Camada de Apresentação — tradução dos erros para HTTP no formato Problem Details (RFC 9457).
import { STATUS_CODES } from 'node:http';

// Identificadores de tipo: não precisam ser endereços reais
export const BASE_PROBLEMAS = 'https://emprestai.example.com/problemas/';

// A natureza do erro (definida no domínio) decide o código HTTP
const STATUS_POR_NATUREZA = {
  parametro: 400,      // a requisição nem pôde ser entendida (id não numérico, filtro inválido)
  permissao: 403,      // quem pediu não pode fazer esta ação
  'nao-encontrado': 404,
  conflito: 409,       // conflita com o estado atual (período ocupado, transição inválida)
  validacao: 422,      // JSON correto, conteúdo inválido
  regra: 422,          // regra de negócio violada
};

export function rotaInexistente(req, res, next) {
  next(Object.assign(new Error(`${req.method} ${req.path} não existe nesta API.`),
    { status: 404, tipo: 'rota-nao-encontrada', titulo: 'Rota não encontrada' }));
}

// O Express reconhece o tratador de erros pelos 4 parâmetros (err, req, res, next)
// eslint-disable-next-line no-unused-vars
export function tratadorDeErros(err, req, res, next) {
  const status = STATUS_POR_NATUREZA[err.natureza] ?? err.status ?? err.statusCode ?? 500;
  const esperado = status < 500; // erro do cliente: explicamos; erro nosso: não vazamos detalhes

  let detalhe = err.message;
  if (err.type === 'entity.parse.failed') detalhe = 'O corpo da requisição não é um JSON válido.';
  if (!esperado) {
    console.error(`[rest] ${req.id}`, err); // o detalhe real fica só no log do servidor
    detalhe = 'Ocorreu um erro inesperado. Tente novamente mais tarde.';
  }

  const identificacao = err.tipo
    ? { type: BASE_PROBLEMAS + err.tipo, title: err.titulo }
    : { type: 'about:blank', title: STATUS_CODES[status] };

  res.status(status).type('application/problem+json').json({
    ...identificacao,
    status,
    detail: detalhe,
    instance: req.originalUrl,
    requestId: req.id,
    ...(esperado ? err.extras : {}),
  });
}
