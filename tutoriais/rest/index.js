// API REST do Emprestaí — rode com: npm run rest
import { criarApp } from './app.js';
import { criarPublicador } from './infraestrutura/publicador-eventos.js';

const publicador = criarPublicador();
publicador.iniciar();

const app = criarApp({ publicador });

const HOST = '127.0.0.1'; // só esta máquina: de fora, apenas o gateway é acessível
const PORTA = Number(process.env.PORTA_REST ?? 3001);
app.listen(PORTA, HOST, () => console.log(`[rest] API REST do Emprestaí em http://${HOST}:${PORTA}`));
