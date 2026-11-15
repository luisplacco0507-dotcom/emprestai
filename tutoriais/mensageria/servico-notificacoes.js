// Simulação do Serviço de Notificações externo (push/SMS) que aparece no C4 Nível 1 do Emprestaí.
// No protótipo ele não envia nada de verdade: só demora um pouco e às vezes recusa.
import { randomUUID } from 'node:crypto';

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

export async function enviarNotificacao(telefone, texto) {
  await esperar(150); // latência de um serviço externo
  // Para demonstrar a falha (cena 4): a operadora recusa números com DDD 00, que não existe.
  // Para simular o serviço todo fora do ar: defina SIMULAR_FALHA_NOTIFICACAO=1 antes de subir o consumidor.
  if (process.env.SIMULAR_FALHA_NOTIFICACAO === '1') throw new Error('serviço de notificações fora do ar');
  const ddd = telefone?.replace(/\D/g, '').slice(2, 4);
  if (!telefone || ddd === '00') throw new Error(`operadora recusou o número ${telefone}`);
  if (!texto) throw new Error('texto vazio');
  return `push-${randomUUID().slice(0, 8)}`;
}
