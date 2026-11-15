// Consumidor 2 — Auditoria: guarda a trilha de TODOS os eventos do Emprestaí ("#"),
// para resolver disputas entre anunciante e locatário (quem aprovou, quando retirou, quando devolveu).
// Rode com: npm run auditoria
import { iniciarConsumidor, registrarEmArquivo } from './base-consumidor.js';

await iniciarConsumidor({
  nome: 'auditoria',
  padroes: ['#'], // todos os eventos: aluguel.*, objeto.*, avaliacao.*
  async processar(evento, { chave, log }) {
    registrarEmArquivo('auditoria.jsonl', {
      eventoId: evento.eventoId,
      tipo: chave,
      requestId: evento.requestId,
      ocorridoEm: evento.ocorridoEm,
      registradoEm: new Date().toISOString(),
      resumo: evento.dados?.status
        ? `aluguel ${evento.dados.id} → ${evento.dados.status}`
        : evento.dados?.titulo ?? `id ${evento.dados?.id}`,
    });
    log(`registrado na trilha de auditoria (evento ${evento.eventoId})`);
  },
});
