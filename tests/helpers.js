// Truy cập module CommonJS (cùng cache với code app) để thay db.query bằng bản giả.
import { createRequire } from 'module';
export const require = createRequire(import.meta.url);
export const db = require('../lib/db.js');
