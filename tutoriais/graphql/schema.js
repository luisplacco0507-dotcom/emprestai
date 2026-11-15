// schema.js — o contrato GraphQL do Emprestaí (o que o aplicativo pode pedir)
export const typeDefs = `#graphql
  "Pessoa cadastrada no Emprestaí. E-mail e telefone não são expostos aqui (privacidade)."
  type Usuario {
    id: ID!
    nome: String!
    cidade: String!
    "Média e quantidade das avaliações recebidas"
    reputacao: Reputacao!
    "Anúncios publicados por esta pessoa"
    objetos(disponivel: Boolean): [Objeto!]!
    "Aluguéis em que a pessoa pegou algo emprestado"
    alugueisComoLocatario(status: StatusAluguel): [Aluguel!]!
    "Aluguéis dos objetos desta pessoa"
    alugueisComoProprietario(status: StatusAluguel): [Aluguel!]!
  }

  type Reputacao {
    "null quando ainda não há avaliações"
    media: Float
    totalAvaliacoes: Int!
  }

  "Um objeto anunciado para empréstimo ou aluguel"
  type Objeto {
    id: ID!
    titulo: String!
    descricao: String
    categoria: Categoria!
    estado: EstadoConservacao!
    "0 = empréstimo gratuito"
    valorDiaria: Float!
    "Período máximo que o dono aceita"
    maxDias: Int!
    cidade: String!
    disponivel: Boolean!
    proprietario: Usuario!
    alugueis(status: StatusAluguel): [Aluguel!]!
  }

  type Aluguel {
    id: ID!
    objeto: Objeto
    proprietario: Usuario!
    locatario: Usuario!
    "Dia da retirada (AAAA-MM-DD)"
    dataInicio: String!
    "Dia da devolução (AAAA-MM-DD)"
    dataFim: String!
    dias: Int!
    valorTotal: Float!
    status: StatusAluguel!
    historico: [MudancaDeStatus!]!
  }

  type MudancaDeStatus {
    status: StatusAluguel!
    em: String!
    por: Usuario!
  }

  enum Categoria { FERRAMENTAS ELETRONICOS ESPORTE CAMPING CASA FESTA LIVROS OUTROS }
  enum EstadoConservacao { NOVO SEMINOVO USADO }
  enum StatusAluguel { SOLICITADO APROVADO RECUSADO CANCELADO RETIRADO DEVOLVIDO }

  "Filtros da busca de objetos"
  input FiltroObjetos {
    categoria: Categoria
    cidade: String
    busca: String
    precoMax: Float
    disponivel: Boolean
  }

  input SolicitarAluguelInput {
    objetoId: ID!
    locatarioId: ID!
    dataInicio: String!
    dataFim: String!
  }

  input AnunciarObjetoInput {
    proprietarioId: ID!
    titulo: String!
    descricao: String
    categoria: Categoria!
    estado: EstadoConservacao!
    valorDiaria: Float!
    maxDias: Int!
    cidade: String!
  }

  type Query {
    "Busca de objetos com filtros (até 50 por página)"
    objetos(filtro: FiltroObjetos, pagina: Int = 1, limite: Int = 10): [Objeto!]!
    objeto(id: ID!): Objeto
    usuario(id: ID!): Usuario
    aluguel(id: ID!): Aluguel
  }

  type Mutation {
    solicitarAluguel(dados: SolicitarAluguelInput!): Aluguel!
    anunciarObjeto(dados: AnunciarObjetoInput!): Objeto!
    "Aprovar, recusar, cancelar, registrar retirada ou devolução"
    mudarStatusAluguel(id: ID!, status: StatusAluguel!, usuarioId: ID!): Aluguel!
  }
`;
