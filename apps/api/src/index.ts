import { loadConfig } from '@hangban/config';
import { airports } from '@hangban/testkit';

import { startApi } from './start-api';

const config = loadConfig(process.env);
await startApi({ config, airports });
