import 'dotenv/config';
import { startApiServer } from './api/server.js';

const app = await startApiServer();
const address = app.server.address();
const port = typeof address === 'object' && address ? address.port : process.env.KAMPRO_API_PORT;
console.log(`Kampro CRM listo en http://127.0.0.1:${port}/`);
