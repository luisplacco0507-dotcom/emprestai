// resolvers.js — cada campo busca o que precisa na API REST (context.rest), nunca numa cópia local.
import { GraphQLError } from 'graphql';

const id = (valor) => encodeURIComponent(valor); // o id vem do cliente: nada de "../" no caminho interno

// Busca um item; 404 vira null (o schema declara Usuario, Objeto e Aluguel opcionais nas consultas)
async function ouNulo(promessa) {
  try {
    return await promessa;
  } catch (erro) {
    if (erro.extensions?.code === 'NOT_FOUND') return null;
    throw erro;
  }
}

// IDs do GraphQL são texto; a API REST espera inteiros
function inteiro(valor, campo) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1) {
    throw new GraphQLError(`${campo} deve ser um inteiro positivo`, { extensions: { code: 'BAD_USER_INPUT', campo } });
  }
  return n;
}

const comFiltro = (base, filtros) => {
  const q = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]));
  return q.size ? `${base}?${q}` : base;
};

export const resolvers = {
  Query: {
    objetos: async (_, { filtro = {}, pagina, limite }, { rest }) => {
      const r = await rest.get(comFiltro('/objetos', { ...filtro, pagina, limite }));
      return r.dados;
    },
    objeto: (_, args, { rest }) => ouNulo(rest.get(`/objetos/${id(args.id)}`)),
    usuario: (_, args, { rest }) => ouNulo(rest.get(`/usuarios/${id(args.id)}`)),
    aluguel: (_, args, { rest }) => ouNulo(rest.get(`/alugueis/${id(args.id)}`)),
  },

  // Campos calculados: o primeiro argumento é o objeto do nível de cima
  Usuario: {
    reputacao: async (usuario, _, { rest }) => {
      const avaliacoes = await rest.avaliacoesRecebidas(usuario.id);
      const total = avaliacoes.length;
      const media = total ? Math.round((avaliacoes.reduce((s, a) => s + a.nota, 0) / total) * 10) / 10 : null;
      return { media, totalAvaliacoes: total };
    },
    objetos: (usuario, { disponivel }, { rest }) =>
      rest.listar(comFiltro('/objetos', { proprietarioId: usuario.id, disponivel })),
    alugueisComoLocatario: (usuario, { status }, { rest }) =>
      rest.listar(comFiltro('/alugueis', { locatarioId: usuario.id, status, ordenar: 'dataInicio' })),
    alugueisComoProprietario: (usuario, { status }, { rest }) =>
      rest.listar(comFiltro('/alugueis', { proprietarioId: usuario.id, status, ordenar: 'dataInicio' })),
  },

  Objeto: {
    proprietario: (objeto, _, { rest }) => rest.usuario(objeto.proprietarioId),
    alugueis: (objeto, { status }, { rest }) =>
      rest.listar(comFiltro('/alugueis', { objetoId: objeto.id, status, ordenar: 'dataInicio' })),
  },

  Aluguel: {
    objeto: (aluguel, _, { rest }) => rest.objeto(aluguel.objetoId), // null se o anúncio foi removido
    proprietario: (aluguel, _, { rest }) => rest.usuario(aluguel.proprietarioId),
    locatario: (aluguel, _, { rest }) => rest.usuario(aluguel.locatarioId),
  },

  MudancaDeStatus: {
    por: (mudanca, _, { rest }) => rest.usuario(mudanca.porUsuarioId),
  },

  Mutation: {
    // As regras (data no passado, período ocupado...) são da API REST; aqui só traduzimos o erro
    solicitarAluguel: (_, { dados }, { rest }) => rest.post('/alugueis', {
      objetoId: inteiro(dados.objetoId, 'objetoId'),
      locatarioId: inteiro(dados.locatarioId, 'locatarioId'),
      dataInicio: dados.dataInicio,
      dataFim: dados.dataFim,
    }),

    anunciarObjeto: (_, { dados }, { rest }) => rest.post('/objetos', {
      ...dados,
      proprietarioId: inteiro(dados.proprietarioId, 'proprietarioId'),
    }),

    mudarStatusAluguel: (_, args, { rest }) =>
      rest.patch(`/alugueis/${id(args.id)}`, { status: args.status, usuarioId: inteiro(args.usuarioId, 'usuarioId') }),
  },
};
