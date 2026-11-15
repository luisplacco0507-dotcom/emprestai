// Camada de Domínio — valores fixos (enums), validações e regras de negócio do Emprestaí.
// Funções puras: não importam nada da infraestrutura (nem banco, nem RabbitMQ),
// conforme a regra arquitetural do ADR-002 (verificada em testes/unitarios/arquitetura.test.js).
import { ErroDominio, dadosInvalidos } from './erros.js';

// ---------- Valores fixos do domínio ----------
export const CATEGORIAS = ['FERRAMENTAS', 'ELETRONICOS', 'ESPORTE', 'CAMPING', 'CASA', 'FESTA', 'LIVROS', 'OUTROS'];
export const ESTADOS_CONSERVACAO = ['NOVO', 'SEMINOVO', 'USADO'];
export const STATUS_ALUGUEL = ['SOLICITADO', 'APROVADO', 'RECUSADO', 'CANCELADO', 'RETIRADO', 'DEVOLVIDO'];

// Aluguéis que "seguram" o objeto: enquanto existirem, o período fica ocupado
export const STATUS_ATIVOS = ['SOLICITADO', 'APROVADO', 'RETIRADO'];

export const LIMITE_DIARIA = 10_000; // R$ por dia
export const MAX_DIAS_PERMITIDO = 30; // teto que um dono pode configurar em maxDias

// Máquina de estados do aluguel: de onde se pode ir para onde, e quem pode fazer a mudança
export const TRANSICOES = {
  SOLICITADO: { APROVADO: 'proprietario', RECUSADO: 'proprietario', CANCELADO: 'locatario' },
  APROVADO: { RETIRADO: 'proprietario', CANCELADO: 'ambos' },
  RETIRADO: { DEVOLVIDO: 'proprietario' },
  RECUSADO: {},
  CANCELADO: {},
  DEVOLVIDO: {},
};

// ---------- Datas (formato AAAA-MM-DD, sem fuso horário) ----------
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

export function dataValida(texto) {
  if (typeof texto !== 'string' || !RE_DATA.test(texto)) return false;
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto; // recusa 2026-02-31
}

// "Hoje" no fuso da máquina (evita que às 22h no Brasil o UTC já seja amanhã)
export function hoje(agora = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
}

export function somarDias(texto, dias) {
  const d = new Date(`${texto}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const diferencaEmDias = (inicio, fim) =>
  Math.round((new Date(`${fim}T00:00:00Z`) - new Date(`${inicio}T00:00:00Z`)) / 86_400_000);

// ---------- Validação estrutural (erros por campo → 422) ----------
function validador(dados, parcial) {
  const erros = [];
  const checar = (campo, valido, esperado, { obrigatorio = true } = {}) => {
    if (dados[campo] === undefined) {
      if (!parcial && obrigatorio) erros.push({ campo, mensagem: `obrigatório: ${esperado}` });
      return;
    }
    if (!valido(dados[campo])) erros.push({ campo, mensagem: `inválido: ${esperado}` });
  };
  return { erros, checar };
}

const texto = (min, max) => (v) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
const inteiroPositivo = (v) => Number.isInteger(v) && v >= 1;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const telefoneValido = (v) => {
  if (typeof v !== 'string' || !/^\+?[\d\s()-]+$/.test(v)) return false;
  const digitos = v.replace(/\D/g, '').length;
  return digitos >= 10 && digitos <= 13;
};

export function validarUsuario(dados, { parcial = false } = {}) {
  const { erros, checar } = validador(dados, parcial);
  checar('nome', texto(2, 80), 'texto com 2 a 80 caracteres');
  checar('email', (v) => typeof v === 'string' && RE_EMAIL.test(v), 'e-mail no formato nome@dominio.com');
  checar('telefone', telefoneValido, 'telefone com DDD, de 10 a 13 dígitos');
  checar('cidade', texto(2, 60), 'texto com 2 a 60 caracteres');
  if (erros.length) throw dadosInvalidos(erros);
}

export function validarObjeto(dados, { parcial = false } = {}) {
  const { erros, checar } = validador(dados, parcial);
  checar('titulo', texto(3, 80), 'texto com 3 a 80 caracteres');
  checar('descricao', (v) => typeof v === 'string' && v.length <= 500, 'texto com até 500 caracteres',
    { obrigatorio: false });
  checar('categoria', (v) => CATEGORIAS.includes(v), `um de ${CATEGORIAS.join(', ')}`);
  checar('estado', (v) => ESTADOS_CONSERVACAO.includes(v), `um de ${ESTADOS_CONSERVACAO.join(', ')}`);
  checar('valorDiaria', (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= LIMITE_DIARIA,
    `número entre 0 (empréstimo gratuito) e ${LIMITE_DIARIA}`);
  checar('maxDias', (v) => Number.isInteger(v) && v >= 1 && v <= MAX_DIAS_PERMITIDO,
    `inteiro entre 1 e ${MAX_DIAS_PERMITIDO}`);
  checar('cidade', texto(2, 60), 'texto com 2 a 60 caracteres');
  checar('disponivel', (v) => typeof v === 'boolean', 'true ou false', { obrigatorio: false });
  if (erros.length) throw dadosInvalidos(erros);
}

export function validarSolicitacao(dados) {
  const { erros, checar } = validador(dados, false);
  checar('objetoId', inteiroPositivo, 'inteiro positivo');
  checar('locatarioId', inteiroPositivo, 'inteiro positivo');
  checar('dataInicio', dataValida, 'data no formato AAAA-MM-DD');
  checar('dataFim', dataValida, 'data no formato AAAA-MM-DD');
  if (erros.length) throw dadosInvalidos(erros);
}

export function validarMudancaStatus(dados) {
  const { erros, checar } = validador(dados, false);
  checar('status', (v) => STATUS_ALUGUEL.includes(v), `um de ${STATUS_ALUGUEL.join(', ')}`);
  checar('usuarioId', inteiroPositivo, 'inteiro positivo (quem executa a ação)');
  if (erros.length) throw dadosInvalidos(erros);
}

export function validarAvaliacao(dados) {
  const { erros, checar } = validador(dados, false);
  checar('aluguelId', inteiroPositivo, 'inteiro positivo');
  checar('avaliadorId', inteiroPositivo, 'inteiro positivo');
  checar('nota', (v) => Number.isInteger(v) && v >= 1 && v <= 5, 'inteiro de 1 a 5');
  checar('comentario', (v) => typeof v === 'string' && v.length <= 300, 'texto com até 300 caracteres',
    { obrigatorio: false });
  if (erros.length) throw dadosInvalidos(erros);
}

// ---------- Regras de negócio do aluguel ----------

// R1 (422): não se solicita aluguel com retirada no passado
export function exigirInicioNaoPassado(dataInicio, dataDeHoje) {
  if (dataInicio < dataDeHoje) {
    throw new ErroDominio('regra', 'data-no-passado', 'Data de retirada no passado',
      `A retirada (${dataInicio}) não pode ser anterior a hoje (${dataDeHoje}).`);
  }
}

// R2 (422): devolução depois da retirada e período dentro do máximo definido pelo dono
export function calcularPeriodo(objeto, dataInicio, dataFim) {
  if (dataFim < dataInicio) {
    throw new ErroDominio('regra', 'periodo-invalido', 'Período inválido',
      'A data de devolução deve ser igual ou posterior à data de retirada.');
  }
  const dias = diferencaEmDias(dataInicio, dataFim) + 1; // conta o dia da retirada e o da devolução
  if (dias > objeto.maxDias) {
    throw new ErroDominio('regra', 'periodo-acima-do-limite', 'Período acima do limite do anunciante',
      `"${objeto.titulo}" pode ser alugado por no máximo ${objeto.maxDias} dia(s); foram pedidos ${dias}.`,
      { maxDias: objeto.maxDias, diasSolicitados: dias });
  }
  return { dias, valorTotal: Math.round(dias * objeto.valorDiaria * 100) / 100 };
}

// R3 (422): ninguém aluga o próprio objeto
export function exigirLocatarioDiferenteDoDono(objeto, locatarioId) {
  if (objeto.proprietarioId === locatarioId) {
    throw new ErroDominio('regra', 'aluguel-do-proprio-objeto', 'Aluguel do próprio objeto',
      'O anunciante não pode solicitar o aluguel do próprio objeto.');
  }
}

// R4 (422): anúncio pausado pelo dono não recebe solicitações
export function exigirObjetoDisponivel(objeto) {
  if (!objeto.disponivel) {
    throw new ErroDominio('regra', 'objeto-indisponivel', 'Objeto indisponível',
      `O anúncio "${objeto.titulo}" está pausado e não aceita solicitações.`);
  }
}

// R5 (409): o objeto não pode estar com dois aluguéis ativos no mesmo período
export function exigirPeriodoLivre(alugueisDoObjeto, dataInicio, dataFim, ignorarId = null) {
  const conflito = alugueisDoObjeto.find((a) =>
    a.id !== ignorarId && STATUS_ATIVOS.includes(a.status) &&
    a.dataInicio <= dataFim && dataInicio <= a.dataFim);
  if (conflito) {
    throw new ErroDominio('conflito', 'periodo-ocupado', 'Período já reservado',
      `O objeto já tem o aluguel ${conflito.id} (${conflito.status}) entre ${conflito.dataInicio} e ${conflito.dataFim}.`,
      { aluguelConflitante: conflito.id });
  }
}

// R6 (409) e R7 (403): só transições previstas, e só por quem tem o papel certo
export function exigirTransicaoPermitida(aluguel, novoStatus, usuarioId) {
  const destinos = TRANSICOES[aluguel.status];
  const papelExigido = destinos[novoStatus];
  if (!papelExigido) {
    const possiveis = Object.keys(destinos);
    throw new ErroDominio('conflito', 'transicao-invalida', 'Mudança de status inválida',
      `Um aluguel ${aluguel.status} não pode passar para ${novoStatus}.` +
      (possiveis.length ? ` Próximos status possíveis: ${possiveis.join(', ')}.` : ' Este status é final.'),
      { statusAtual: aluguel.status, possiveis });
  }
  const papel = usuarioId === aluguel.proprietarioId ? 'proprietario'
    : usuarioId === aluguel.locatarioId ? 'locatario' : null;
  if (!papel || (papelExigido !== 'ambos' && papelExigido !== papel)) {
    const quem = { proprietario: 'o anunciante', locatario: 'quem solicitou', ambos: 'as partes do aluguel' };
    throw new ErroDominio('permissao', 'acao-nao-permitida', 'Ação não permitida',
      `Só ${quem[papelExigido]} pode mudar este aluguel para ${novoStatus}.`);
  }
  return papel;
}

// R8 (409): anúncio com aluguel em andamento não pode ser removido nem pausado
export function exigirSemAluguelAtivo(objeto, alugueisDoObjeto, acao) {
  const ativo = alugueisDoObjeto.find((a) => STATUS_ATIVOS.includes(a.status));
  if (ativo) {
    throw new ErroDominio('conflito', 'objeto-com-aluguel-ativo', 'Objeto com aluguel em andamento',
      `Não é possível ${acao} "${objeto.titulo}": o aluguel ${ativo.id} está ${ativo.status}.`,
      { aluguelAtivo: ativo.id });
  }
}

// ---------- Regras da avaliação (depois da devolução) ----------
export function definirAvaliado(aluguel, avaliadorId, avaliacoesExistentes) {
  if (aluguel.status !== 'DEVOLVIDO') {
    throw new ErroDominio('regra', 'aluguel-nao-concluido', 'Aluguel ainda não concluído',
      `Só é possível avaliar depois da devolução; o aluguel ${aluguel.id} está ${aluguel.status}.`);
  }
  let avaliadoId;
  if (avaliadorId === aluguel.locatarioId) avaliadoId = aluguel.proprietarioId;
  else if (avaliadorId === aluguel.proprietarioId) avaliadoId = aluguel.locatarioId;
  else {
    throw new ErroDominio('permissao', 'acao-nao-permitida', 'Ação não permitida',
      'Só as partes do aluguel podem avaliá-lo.');
  }
  if (avaliacoesExistentes.some((av) => av.aluguelId === aluguel.id && av.avaliadorId === avaliadorId)) {
    throw new ErroDominio('conflito', 'avaliacao-duplicada', 'Avaliação já registrada',
      `O usuário ${avaliadorId} já avaliou o aluguel ${aluguel.id}.`);
  }
  return avaliadoId;
}
