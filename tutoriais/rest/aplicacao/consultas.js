// Camada de Aplicação — leitura e validação da query string: filtros, ordenação e paginação.
import { ErroDominio, parametroInvalido } from '../dominio/erros.js';

export const LIMITE_MAXIMO = 50; // teto: ninguém pede a base inteira (OWASP: consumo irrestrito de recursos)

export function exigirId(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id < 1) {
    throw new ErroDominio('parametro', 'identificador-invalido', 'Identificador inválido',
      'O id deve ser um número inteiro positivo.');
  }
  return id;
}

function inteiroPositivo(valor, padrao, nome) {
  if (valor === undefined) return padrao;
  const n = Number(valor);
  if (typeof valor !== 'string' || !Number.isInteger(n) || n < 1) {
    throw parametroInvalido(`${nome} deve ser um inteiro positivo.`);
  }
  return n;
}

// Converte um parâmetro (sempre texto, ou lista se vier repetido) no tipo esperado
const CONVERSORES = {
  texto: (v, nome) => {
    if (typeof v !== 'string') throw parametroInvalido(`${nome} deve ser um texto.`);
    return v.trim().toLowerCase();
  },
  inteiro: (v, nome) => inteiroPositivo(v, undefined, nome),
  numero: (v, nome) => {
    const n = Number(v);
    if (typeof v !== 'string' || v.trim() === '' || !Number.isFinite(n) || n < 0) {
      throw parametroInvalido(`${nome} deve ser um número maior ou igual a zero.`);
    }
    return n;
  },
  booleano: (v, nome) => {
    if (v !== 'true' && v !== 'false') throw parametroInvalido(`${nome} deve ser true ou false.`);
    return v === 'true';
  },
  // ?ids=1,2,3 — usado pelo DataLoader do GraphQL para buscar vários registros em 1 chamada
  ids: (v, nome) => {
    if (typeof v !== 'string') throw parametroInvalido(`${nome} deve ser uma lista separada por vírgulas.`);
    const ids = v.split(',').map((x) => Number(x));
    if (ids.length > LIMITE_MAXIMO || ids.some((n) => !Number.isInteger(n) || n < 1)) {
      throw parametroInvalido(`${nome} deve ter até ${LIMITE_MAXIMO} inteiros positivos separados por vírgulas.`);
    }
    return ids;
  },
};

const conversorEnum = (valores) => (v, nome) => {
  if (!valores.includes(v)) throw parametroInvalido(`${nome} deve ser um de: ${valores.join(', ')}.`);
  return v;
};

/**
 * @param {object} query  req.query do Express
 * @param {object} spec   { filtros: { nome: 'texto'|'inteiro'|'numero'|'booleano'|'ids'|string[] }, ordenaveis: string[] }
 */
export function lerConsulta(query, { filtros, ordenaveis }) {
  const conhecidos = new Set([...Object.keys(filtros), 'ordenar', 'ordem', 'pagina', 'limite']);
  // "atraso" é tratado antes, só para a demonstração do timeout do gateway
  const desconhecido = Object.keys(query).find((k) => !conhecidos.has(k) && k !== 'atraso');
  if (desconhecido) {
    throw parametroInvalido(`Parâmetro "${desconhecido}" não é suportado. Use: ${[...conhecidos].join(', ')}.`);
  }

  const valores = {};
  for (const [nome, tipo] of Object.entries(filtros)) {
    if (query[nome] === undefined) continue;
    const converter = Array.isArray(tipo) ? conversorEnum(tipo) : CONVERSORES[tipo];
    valores[nome] = converter(query[nome], nome);
  }

  const { ordenar = 'id', ordem = 'asc' } = query;
  if (!ordenaveis.includes(ordenar) || !['asc', 'desc'].includes(ordem)) {
    throw parametroInvalido(`ordenar: ${ordenaveis.join(', ')}; ordem: asc ou desc.`);
  }
  const pagina = inteiroPositivo(query.pagina, 1, 'pagina');
  const limite = Math.min(inteiroPositivo(query.limite, 10, 'limite'), LIMITE_MAXIMO);
  return { filtros: valores, ordenar, ordem, pagina, limite };
}

export function ordenarEPaginar(lista, { ordenar, ordem, pagina, limite }) {
  const fator = ordem === 'desc' ? -1 : 1;
  const ordenada = [...lista].sort((a, b) => {
    const x = a[ordenar];
    const y = b[ordenar];
    return (typeof x === 'string' ? x.localeCompare(y, 'pt-BR') : x - y) * fator;
  });
  const total = ordenada.length;
  const inicio = (pagina - 1) * limite;
  return {
    dados: ordenada.slice(inicio, inicio + limite),
    paginacao: { pagina, limite, total, totalPaginas: Math.ceil(total / limite) },
  };
}
