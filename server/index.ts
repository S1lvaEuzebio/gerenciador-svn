import { createApp } from './app.ts';
import { configPath, loadConfig } from './config.ts';

const config = await loadConfig();
const port = Number(process.env.GERENCIADOR_SVN_PORT ?? config.port);
const dev = process.env.GERENCIADOR_SVN_DEV === '1';

createApp({ port, dev }).listen(port, '127.0.0.1', (error) => {
  if (error) {
    console.error(`não foi possível escutar em 127.0.0.1:${port}: ${error.message}`);
    process.exit(1);
  }
  console.log(`gerenciador-svn em http://127.0.0.1:${port} (config: ${configPath})`);
});
