// Camada de Domínio — erros de negócio.
// O domínio não conhece HTTP: ele diz QUAL foi o problema (o "tipo"),
// e a Camada de Apresentação decide o código de status (ver apresentacao/problemas.js).

export class ErroDominio extends Error {
  /**
   * @param {'validacao'|'regra'|'conflito'|'nao-encontrado'|'permissao'|'parametro'} natureza
   * @param {string} tipo   identificador curto do problema (vira o "type" do Problem Details)
   * @param {string} titulo resumo igual para todas as ocorrências do mesmo tipo
   * @param {string} detalhe explicação desta ocorrência
   * @param {object} extras campos adicionais (ex.: lista de erros por campo)
   */
  constructor(natureza, tipo, titulo, detalhe, extras = {}) {
    super(detalhe);
    this.natureza = natureza;
    this.tipo = tipo;
    this.titulo = titulo;
    this.extras = extras;
  }
}

const NOMES = {
  usuario: { titulo: 'Usuário não encontrado', artigo: 'usuário' },
  objeto: { titulo: 'Objeto não encontrado', artigo: 'objeto' },
  aluguel: { titulo: 'Aluguel não encontrado', artigo: 'aluguel' },
  avaliacao: { titulo: 'Avaliação não encontrada', artigo: 'avaliação' },
};

export const naoEncontrado = (recurso, id) =>
  new ErroDominio('nao-encontrado', `${recurso}-nao-encontrado`, NOMES[recurso].titulo,
    `Não existe ${NOMES[recurso].artigo} com id ${id}.`);

export const parametroInvalido = (detalhe) =>
  new ErroDominio('parametro', 'parametro-invalido', 'Parâmetro inválido', detalhe);

export const dadosInvalidos = (erros) =>
  new ErroDominio('validacao', 'dados-invalidos', 'Dados inválidos',
    'Um ou mais campos são inválidos.', { erros });
