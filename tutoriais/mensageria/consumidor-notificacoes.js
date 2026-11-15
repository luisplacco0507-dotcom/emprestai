// Consumidor 1 — Notificações (integração com o Serviço de Notificações do C4 Nível 1).
// Recebe SÓ os eventos de aluguel ("aluguel.*") e avisa a parte interessada por push/SMS.
// Rode com: npm run notificacoes
import { iniciarConsumidor, registrarEmArquivo, ErroPermanente } from './base-consumidor.js';
import { enviarNotificacao } from './servico-notificacoes.js';

// Quem recebe o aviso e o que ele diz, para cada evento do ciclo do aluguel
const AVISOS = {
  'aluguel.solicitado': (a) => [[a.proprietario, `${a.locatario.nome} quer alugar "${a.objeto.titulo}" de ${a.dataInicio} a ${a.dataFim} (R$ ${a.valorTotal}).`]],
  'aluguel.aprovado': (a) => [[a.locatario, `Seu aluguel de "${a.objeto.titulo}" foi aprovado. Retirada em ${a.dataInicio}.`]],
  'aluguel.recusado': (a) => [[a.locatario, `${a.proprietario.nome} recusou o aluguel de "${a.objeto.titulo}".`]],
  'aluguel.cancelado': (a) => [
    [a.proprietario, `O aluguel ${a.id} de "${a.objeto.titulo}" foi cancelado.`],
    [a.locatario, `O aluguel ${a.id} de "${a.objeto.titulo}" foi cancelado.`],
  ],
  'aluguel.retirado': (a) => [[a.locatario, `Retirada de "${a.objeto.titulo}" registrada. Devolva até ${a.dataFim}.`]],
  'aluguel.devolvido': (a) => [
    [a.proprietario, `"${a.objeto.titulo}" foi devolvido. Que tal avaliar ${a.locatario.nome}?`],
    [a.locatario, `Devolução registrada. Que tal avaliar ${a.proprietario.nome}?`],
  ],
};

await iniciarConsumidor({
  nome: 'notificacoes',
  padroes: ['aluguel.*'], // só parte dos eventos: objeto.* e avaliacao.* não chegam aqui
  async processar(evento, { chave, log, tentativa }) {
    const montar = AVISOS[chave];
    if (!montar || !evento.dados?.proprietario) {
      throw new ErroPermanente(`evento ${chave} sem os dados necessários`);
    }
    for (const [destinatario, texto] of montar(evento.dados)) {
      // Pode falhar (serviço externo): a base do consumidor tenta de novo e, depois, manda para a DLQ
      const protocolo = await enviarNotificacao(destinatario.telefone, texto);
      registrarEmArquivo('notificacoes-enviadas.jsonl', {
        eventoId: evento.eventoId, requestId: evento.requestId, para: destinatario.nome, telefone: destinatario.telefone,
        texto, protocolo, em: new Date().toISOString(),
      });
      log(`notificação enviada a ${destinatario.nome} (${protocolo}${tentativa > 1 ? `, tentativa ${tentativa}` : ''}): ${texto}`);
    }
  },
});
